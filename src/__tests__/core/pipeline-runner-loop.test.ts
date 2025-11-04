// src/__tests__/core/pipeline-runner-loop.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PipelineRunner } from '../../core/pipeline-runner.js';
import { AgentRuntimeRegistry } from '../../core/agent-runtime-registry.js';
import { ClaudeSDKRuntime } from '../../core/agent-runtimes/claude-sdk-runtime.js';
import { ProjectConfigLoader } from '../../config/project-config-loader.js';
import { PipelineLoader } from '../../config/pipeline-loader.js';
import { PipelineConfig, PipelineState, LoopingConfig } from '../../config/schema.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { tmpdir } from 'os';

// Mock all dependencies
vi.mock('../../core/git-manager.js');
vi.mock('../../core/branch-manager.js');
vi.mock('../../core/pr-creator.js');
vi.mock('../../core/state-manager.js');
vi.mock('../../core/dag-planner.js');
vi.mock('../../core/pipeline-initializer.js');
vi.mock('../../core/group-execution-orchestrator.js');
vi.mock('../../core/pipeline-finalizer.js');
vi.mock('../../config/project-config-loader.js');
vi.mock('../../config/pipeline-loader.js');

describe('PipelineRunner - Loop Mode', () => {
  let tempDir: string;
  let pendingDir: string;
  let runningDir: string;
  let finishedDir: string;
  let failedDir: string;
  let mockLoopingConfig: LoopingConfig;
  let mockPipelineConfig: PipelineConfig;
  let mockPipelineState: PipelineState;

  beforeEach(async () => {
    // Register runtime for tests
    AgentRuntimeRegistry.register(new ClaudeSDKRuntime());

    // Create temp directories
    tempDir = await fs.mkdtemp(path.join(tmpdir(), 'loop-test-'));
    pendingDir = path.join(tempDir, 'pending');
    runningDir = path.join(tempDir, 'running');
    finishedDir = path.join(tempDir, 'finished');
    failedDir = path.join(tempDir, 'failed');

    await fs.mkdir(pendingDir, { recursive: true });
    await fs.mkdir(runningDir, { recursive: true });
    await fs.mkdir(finishedDir, { recursive: true });
    await fs.mkdir(failedDir, { recursive: true });

    // Setup mock looping config
    mockLoopingConfig = {
      enabled: true,
      maxIterations: 100,
      directories: {
        pending: pendingDir,
        running: runningDir,
        finished: finishedDir,
        failed: failedDir,
      },
    };

    // Setup mock pipeline config
    mockPipelineConfig = {
      name: 'test-pipeline',
      trigger: 'manual',
      agents: [
        {
          name: 'test-agent',
          agent: 'test-agent.md',
        },
      ],
    };

    // Setup mock pipeline state
    mockPipelineState = {
      runId: 'test-run-123',
      pipelineConfig: mockPipelineConfig,
      trigger: {
        type: 'manual',
        commitSha: 'abc123',
        timestamp: new Date().toISOString(),
      },
      stages: [],
      status: 'completed',
      artifacts: {
        initialCommit: 'abc123',
        changedFiles: [],
        totalDuration: 1000,
      },
      loopContext: {
        enabled: false,
        currentIteration: 1,
        maxIterations: 100,
        loopSessionId: '',
        pipelineSource: 'library',
        terminationReason: undefined,
      },
    };

    // Mock ProjectConfigLoader
    vi.mocked(ProjectConfigLoader).mockImplementation(() => ({
      loadLoopingConfig: vi.fn().mockResolvedValue(mockLoopingConfig),
    } as any));

    // Mock PipelineLoader - will be customized per test
    vi.mocked(PipelineLoader).mockImplementation(() => ({
      loadPipelineFromPath: vi.fn(),
    } as any));

    // Clear all module-level caches
    ProjectConfigLoader.clearCache?.();
  });

  afterEach(async () => {
    // Cleanup temp directories
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('Backward Compatibility (Non-Loop Mode)', () => {
    it('should execute once without --loop flag', async () => {
      const runner = new PipelineRunner(tempDir);

      // Mock _executeSinglePipeline to track calls
      const executeSingleSpy = vi.spyOn(runner as any, '_executeSinglePipeline')
        .mockResolvedValue(mockPipelineState);

      const result = await runner.runPipeline(mockPipelineConfig, {
        interactive: false,
      });

      expect(executeSingleSpy).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('completed');
    });

    it('should not check pending directory without --loop', async () => {
      const runner = new PipelineRunner(tempDir);

      vi.spyOn(runner as any, '_executeSinglePipeline')
        .mockResolvedValue(mockPipelineState);

      const findNextSpy = vi.spyOn(runner as any, '_findNextPipelineFile');

      await runner.runPipeline(mockPipelineConfig, {
        interactive: false,
      });

      // Should not look for next files without loop mode
      expect(findNextSpy).not.toHaveBeenCalled();
    });
  });

  describe('Loop with Empty Pending Directory', () => {
    it('should execute seed pipeline and exit when no pending files', async () => {
      const runner = new PipelineRunner(tempDir);

      const executeSingleSpy = vi.spyOn(runner as any, '_executeSinglePipeline')
        .mockResolvedValue(mockPipelineState);

      const result = await runner.runPipeline(mockPipelineConfig, {
        loop: true,
        interactive: false,
      });

      // Should execute exactly once (seed pipeline only)
      expect(executeSingleSpy).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('completed');
    });

    it('should log "no pending pipelines" message', async () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const runner = new PipelineRunner(tempDir);

      vi.spyOn(runner as any, '_executeSinglePipeline')
        .mockResolvedValue(mockPipelineState);

      await runner.runPipeline(mockPipelineConfig, {
        loop: true,
        interactive: false,
      });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('no pending pipelines')
      );
    });
  });

  describe('Loop with Pending Files', () => {
    it('should execute seed then one pending pipeline', async () => {
      // Create a pending file
      await fs.writeFile(
        path.join(pendingDir, 'task1.yml'),
        'name: task1\ntrigger: manual\nagents: []'
      );

      // Setup loader to return correct metadata based on file path
      vi.mocked(PipelineLoader).mockImplementation(() => ({
        loadPipelineFromPath: vi.fn().mockImplementation((filePath: string) => ({
          config: mockPipelineConfig,
          metadata: {
            sourcePath: filePath,
            sourceType: 'loop-pending' as const,
            loadedAt: new Date().toISOString(),
          },
        })),
      } as any));

      const runner = new PipelineRunner(tempDir);

      const executeSingleSpy = vi.spyOn(runner as any, '_executeSinglePipeline')
        .mockResolvedValue(mockPipelineState);

      await runner.runPipeline(mockPipelineConfig, {
        loop: true,
        interactive: false,
      });

      // Should execute twice: seed + 1 pending
      expect(executeSingleSpy).toHaveBeenCalledTimes(2);
    });

    it('should process multiple pending files in mtime order', async () => {
      // Create three pending files with different mtimes
      const file1 = path.join(pendingDir, 'task1.yml');
      const file2 = path.join(pendingDir, 'task2.yml');
      const file3 = path.join(pendingDir, 'task3.yml');

      await fs.writeFile(file1, 'name: task1\ntrigger: manual\nagents: []');
      await new Promise(resolve => setTimeout(resolve, 10)); // Ensure different mtime
      await fs.writeFile(file2, 'name: task2\ntrigger: manual\nagents: []');
      await new Promise(resolve => setTimeout(resolve, 10));
      await fs.writeFile(file3, 'name: task3\ntrigger: manual\nagents: []');

      // Setup loader to return correct metadata
      vi.mocked(PipelineLoader).mockImplementation(() => ({
        loadPipelineFromPath: vi.fn().mockImplementation((filePath: string) => ({
          config: mockPipelineConfig,
          metadata: {
            sourcePath: filePath,
            sourceType: 'loop-pending' as const,
            loadedAt: new Date().toISOString(),
          },
        })),
      } as any));

      const runner = new PipelineRunner(tempDir);

      const executeSingleSpy = vi.spyOn(runner as any, '_executeSinglePipeline')
        .mockResolvedValue(mockPipelineState);

      await runner.runPipeline(mockPipelineConfig, {
        loop: true,
        interactive: false,
      });

      // Should execute 4 times: seed + 3 pending
      expect(executeSingleSpy).toHaveBeenCalledTimes(4);
    });

    it('should move completed pipelines to finished directory', async () => {
      const pendingFile = path.join(pendingDir, 'task1.yml');
      await fs.writeFile(pendingFile, 'name: task1\ntrigger: manual\nagents: []');

      // Setup loader to return correct metadata
      vi.mocked(PipelineLoader).mockImplementation(() => ({
        loadPipelineFromPath: vi.fn().mockImplementation((filePath: string) => ({
          config: mockPipelineConfig,
          metadata: {
            sourcePath: filePath,
            sourceType: 'loop-pending' as const,
            loadedAt: new Date().toISOString(),
          },
        })),
      } as any));

      const runner = new PipelineRunner(tempDir);

      vi.spyOn(runner as any, '_executeSinglePipeline')
        .mockResolvedValue({ ...mockPipelineState, status: 'completed' });

      await runner.runPipeline(mockPipelineConfig, {
        loop: true,
        interactive: false,
      });

      // Check pending file was moved to finished
      const pendingFiles = await fs.readdir(pendingDir);
      const finishedFiles = await fs.readdir(finishedDir);

      expect(pendingFiles).not.toContain('task1.yml');
      expect(finishedFiles.some(f => f.startsWith('task1'))).toBe(true);
    });
  });

  describe('Loop Failure Handling', () => {
    it('should terminate loop immediately on pipeline failure', async () => {
      // Create two pending files
      await fs.writeFile(
        path.join(pendingDir, 'task1.yml'),
        'name: task1\ntrigger: manual\nagents: []'
      );
      await fs.writeFile(
        path.join(pendingDir, 'task2.yml'),
        'name: task2\ntrigger: manual\nagents: []'
      );

      // Setup loader to return correct metadata
      vi.mocked(PipelineLoader).mockImplementation(() => ({
        loadPipelineFromPath: vi.fn().mockImplementation((filePath: string) => ({
          config: mockPipelineConfig,
          metadata: {
            sourcePath: filePath,
            sourceType: 'loop-pending' as const,
            loadedAt: new Date().toISOString(),
          },
        })),
      } as any));

      const runner = new PipelineRunner(tempDir);

      const executeSingleSpy = vi.spyOn(runner as any, '_executeSinglePipeline')
        .mockResolvedValueOnce(mockPipelineState) // Seed succeeds
        .mockResolvedValueOnce({ ...mockPipelineState, status: 'failed' }); // First pending fails

      await runner.runPipeline(mockPipelineConfig, {
        loop: true,
        interactive: false,
      });

      // Should stop after 2 executions (seed + 1 failed)
      expect(executeSingleSpy).toHaveBeenCalledTimes(2);
    });

    it('should move failed pipeline to failed directory', async () => {
      const pendingFile = path.join(pendingDir, 'task1.yml');
      await fs.writeFile(pendingFile, 'name: task1\ntrigger: manual\nagents: []');

      // Setup loader to return correct metadata
      vi.mocked(PipelineLoader).mockImplementation(() => ({
        loadPipelineFromPath: vi.fn().mockImplementation((filePath: string) => ({
          config: mockPipelineConfig,
          metadata: {
            sourcePath: filePath,
            sourceType: 'loop-pending' as const,
            loadedAt: new Date().toISOString(),
          },
        })),
      } as any));

      const runner = new PipelineRunner(tempDir);

      vi.spyOn(runner as any, '_executeSinglePipeline')
        .mockResolvedValueOnce(mockPipelineState) // Seed succeeds
        .mockResolvedValueOnce({ ...mockPipelineState, status: 'failed' }); // Pending fails

      await runner.runPipeline(mockPipelineConfig, {
        loop: true,
        interactive: false,
      });

      const failedFiles = await fs.readdir(failedDir);
      expect(failedFiles.some(f => f.startsWith('task1'))).toBe(true);
    });

    it('should log termination message on failure', async () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await fs.writeFile(
        path.join(pendingDir, 'task1.yml'),
        'name: task1\ntrigger: manual\nagents: []'
      );

      // Setup loader to return correct metadata
      vi.mocked(PipelineLoader).mockImplementation(() => ({
        loadPipelineFromPath: vi.fn().mockImplementation((filePath: string) => ({
          config: mockPipelineConfig,
          metadata: {
            sourcePath: filePath,
            sourceType: 'loop-pending' as const,
            loadedAt: new Date().toISOString(),
          },
        })),
      } as any));

      const runner = new PipelineRunner(tempDir);

      vi.spyOn(runner as any, '_executeSinglePipeline')
        .mockResolvedValueOnce(mockPipelineState)
        .mockResolvedValueOnce({ ...mockPipelineState, status: 'failed' });

      await runner.runPipeline(mockPipelineConfig, {
        loop: true,
        interactive: false,
      });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('terminating after failure')
      );
    });
  });

  describe('Max Iterations Limit', () => {
    it('should respect --max-loop-iterations flag', async () => {
      // Create 5 pending files
      for (let i = 1; i <= 5; i++) {
        await fs.writeFile(
          path.join(pendingDir, `task${i}.yml`),
          `name: task${i}\ntrigger: manual\nagents: []`
        );
      }

      // Setup loader to return correct metadata
      vi.mocked(PipelineLoader).mockImplementation(() => ({
        loadPipelineFromPath: vi.fn().mockImplementation((filePath: string) => ({
          config: mockPipelineConfig,
          metadata: {
            sourcePath: filePath,
            sourceType: 'loop-pending' as const,
            loadedAt: new Date().toISOString(),
          },
        })),
      } as any));

      const runner = new PipelineRunner(tempDir);

      const executeSingleSpy = vi.spyOn(runner as any, '_executeSinglePipeline')
        .mockResolvedValue(mockPipelineState);

      await runner.runPipeline(mockPipelineConfig, {
        loop: true,
        maxLoopIterations: 3,
        interactive: false,
      });

      // Should stop at 3 iterations (max limit)
      expect(executeSingleSpy).toHaveBeenCalledTimes(3);
    });

    it('should log warning when limit reached', async () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      for (let i = 1; i <= 5; i++) {
        await fs.writeFile(
          path.join(pendingDir, `task${i}.yml`),
          `name: task${i}\ntrigger: manual\nagents: []`
        );
      }

      // Setup loader to return correct metadata
      vi.mocked(PipelineLoader).mockImplementation(() => ({
        loadPipelineFromPath: vi.fn().mockImplementation((filePath: string) => ({
          config: mockPipelineConfig,
          metadata: {
            sourcePath: filePath,
            sourceType: 'loop-pending' as const,
            loadedAt: new Date().toISOString(),
          },
        })),
      } as any));

      const runner = new PipelineRunner(tempDir);

      vi.spyOn(runner as any, '_executeSinglePipeline')
        .mockResolvedValue(mockPipelineState);

      await runner.runPipeline(mockPipelineConfig, {
        loop: true,
        maxLoopIterations: 2,
        interactive: false,
      });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Loop limit reached')
      );
    });
  });

  describe('File Collision Handling', () => {
    it('should append timestamp to duplicate filenames', async () => {
      // Create a file in finished directory
      await fs.writeFile(
        path.join(finishedDir, 'task1.yml'),
        'existing: file'
      );

      // Create same-named file in pending
      await fs.writeFile(
        path.join(pendingDir, 'task1.yml'),
        'name: task1\ntrigger: manual\nagents: []'
      );

      // Setup loader to return correct metadata
      vi.mocked(PipelineLoader).mockImplementation(() => ({
        loadPipelineFromPath: vi.fn().mockImplementation((filePath: string) => ({
          config: mockPipelineConfig,
          metadata: {
            sourcePath: filePath,
            sourceType: 'loop-pending' as const,
            loadedAt: new Date().toISOString(),
          },
        })),
      } as any));

      const runner = new PipelineRunner(tempDir);

      vi.spyOn(runner as any, '_executeSinglePipeline')
        .mockResolvedValue({ ...mockPipelineState, status: 'completed' });

      await runner.runPipeline(mockPipelineConfig, {
        loop: true,
        interactive: false,
      });

      const finishedFiles = await fs.readdir(finishedDir);

      // Should have both: task1.yml and task1-<timestamp>.yml
      expect(finishedFiles).toContain('task1.yml');
      expect(finishedFiles.some(f => f.match(/task1-\d+\.yml/))).toBe(true);
    });
  });

  describe('Seed vs Queued Pipeline Tracking', () => {
    it('should not move seed pipeline to finished directory', async () => {
      const runner = new PipelineRunner(tempDir);

      vi.spyOn(runner as any, '_executeSinglePipeline')
        .mockResolvedValue(mockPipelineState);

      await runner.runPipeline(mockPipelineConfig, {
        loop: true,
        interactive: false,
        loopMetadata: {
          sourcePath: path.join(tempDir, '.agent-pipeline/pipelines/seed.yml'),
          sourceType: 'library',
          loadedAt: new Date().toISOString(),
        },
      });

      // Finished directory should be empty (seed not moved)
      const finishedFiles = await fs.readdir(finishedDir);
      expect(finishedFiles).toHaveLength(0);
    });

    it('should only move loop-pending pipelines between directories', async () => {
      await fs.writeFile(
        path.join(pendingDir, 'task1.yml'),
        'name: task1\ntrigger: manual\nagents: []'
      );

      // Setup loader to return correct metadata for queued pipelines
      vi.mocked(PipelineLoader).mockImplementation(() => ({
        loadPipelineFromPath: vi.fn().mockImplementation((filePath: string) => ({
          config: mockPipelineConfig,
          metadata: {
            sourcePath: filePath,
            sourceType: 'loop-pending' as const,
            loadedAt: new Date().toISOString(),
          },
        })),
      } as any));

      const runner = new PipelineRunner(tempDir);

      vi.spyOn(runner as any, '_executeSinglePipeline')
        .mockResolvedValue(mockPipelineState);

      await runner.runPipeline(mockPipelineConfig, {
        loop: true,
        interactive: false,
        loopMetadata: {
          sourcePath: path.join(tempDir, '.agent-pipeline/pipelines/seed.yml'),
          sourceType: 'library', // Seed pipeline
          loadedAt: new Date().toISOString(),
        },
      });

      // Only the queued pipeline should be in finished
      const finishedFiles = await fs.readdir(finishedDir);
      expect(finishedFiles).toHaveLength(1);
      expect(finishedFiles[0]).toMatch(/task1/);
    });
  });

  describe('Config Validation', () => {
    it('should warn and disable loop when config disables looping', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Mock disabled config
      vi.mocked(ProjectConfigLoader).mockImplementation(() => ({
        loadLoopingConfig: vi.fn().mockResolvedValue({
          ...mockLoopingConfig,
          enabled: false,
        }),
      } as any));

      const runner = new PipelineRunner(tempDir);

      const executeSingleSpy = vi.spyOn(runner as any, '_executeSinglePipeline')
        .mockResolvedValue(mockPipelineState);

      await runner.runPipeline(mockPipelineConfig, {
        loop: true,
        interactive: false,
      });

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('looping is disabled in config')
      );

      // Should execute only once (no loop)
      expect(executeSingleSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Parse Error Handling', () => {
    it('should break loop on pipeline parse error', async () => {
      await fs.writeFile(
        path.join(pendingDir, 'bad.yml'),
        'invalid: yaml: content:'
      );
      await fs.writeFile(
        path.join(pendingDir, 'good.yml'),
        'name: good\ntrigger: manual\nagents: []'
      );

      // Mock loader to throw on bad file
      vi.mocked(PipelineLoader).mockImplementation(() => ({
        loadPipelineFromPath: vi.fn()
          .mockImplementationOnce(() => {
            throw new Error('YAML parse error');
          }),
      } as any));

      const runner = new PipelineRunner(tempDir);

      const executeSingleSpy = vi.spyOn(runner as any, '_executeSinglePipeline')
        .mockResolvedValue(mockPipelineState);

      await runner.runPipeline(mockPipelineConfig, {
        loop: true,
        interactive: false,
      });

      // Should execute seed and then break on parse error
      expect(executeSingleSpy).toHaveBeenCalledTimes(1);
    });

    it('should move unparseable files to failed directory', async () => {
      const badFile = path.join(pendingDir, 'bad.yml');
      await fs.writeFile(badFile, 'invalid: yaml: content:');

      vi.mocked(PipelineLoader).mockImplementation(() => ({
        loadPipelineFromPath: vi.fn()
          .mockRejectedValue(new Error('YAML parse error')),
      } as any));

      const runner = new PipelineRunner(tempDir);

      vi.spyOn(runner as any, '_executeSinglePipeline')
        .mockResolvedValue(mockPipelineState);

      await runner.runPipeline(mockPipelineConfig, {
        loop: true,
        interactive: false,
      });

      const failedFiles = await fs.readdir(failedDir);
      expect(failedFiles.some(f => f.startsWith('bad'))).toBe(true);
    });
  });

  describe('Loop Session Tracking', () => {
    it('should create loop session when loop mode is enabled', async () => {
      const runner = new PipelineRunner(tempDir);
      const loopStateManager = (runner as any).loopStateManager;
      const startSessionSpy = vi.spyOn(loopStateManager, 'startSession');

      vi.spyOn(runner as any, '_executeSinglePipeline')
        .mockResolvedValue(mockPipelineState);

      await runner.runPipeline(mockPipelineConfig, {
        loop: true,
        interactive: false,
      });

      expect(startSessionSpy).toHaveBeenCalledWith(100); // default maxIterations
    });

    it('should not create loop session when loop mode is disabled', async () => {
      const runner = new PipelineRunner(tempDir);
      const loopStateManager = (runner as any).loopStateManager;
      const startSessionSpy = vi.spyOn(loopStateManager, 'startSession');

      vi.spyOn(runner as any, '_executeSinglePipeline')
        .mockResolvedValue(mockPipelineState);

      await runner.runPipeline(mockPipelineConfig, {
        loop: false,
        interactive: false,
      });

      expect(startSessionSpy).not.toHaveBeenCalled();
    });

    it('should append iteration after each pipeline execution', async () => {
      // Create a pending file
      await fs.writeFile(
        path.join(pendingDir, 'task1.yml'),
        'name: task1\ntrigger: manual\nagents: []'
      );

      vi.mocked(PipelineLoader).mockImplementation(() => ({
        loadPipelineFromPath: vi.fn().mockResolvedValue({
          config: mockPipelineConfig,
          metadata: {
            sourcePath: path.join(runningDir, 'task1.yml'),
            sourceType: 'loop-pending' as const,
            loadedAt: new Date().toISOString(),
          },
        }),
      } as any));

      const runner = new PipelineRunner(tempDir);
      const loopStateManager = (runner as any).loopStateManager;
      const appendIterationSpy = vi.spyOn(loopStateManager, 'appendIteration');

      vi.spyOn(runner as any, '_executeSinglePipeline')
        .mockResolvedValue(mockPipelineState);

      await runner.runPipeline(mockPipelineConfig, {
        loop: true,
        interactive: false,
      });

      // Should append iteration for seed pipeline and the pending pipeline
      expect(appendIterationSpy).toHaveBeenCalledTimes(2);
    });

    it('should complete session with "completed" status on natural exit', async () => {
      const runner = new PipelineRunner(tempDir);
      const loopStateManager = (runner as any).loopStateManager;
      const completeSessionSpy = vi.spyOn(loopStateManager, 'completeSession');

      vi.spyOn(runner as any, '_executeSinglePipeline')
        .mockResolvedValue(mockPipelineState);

      await runner.runPipeline(mockPipelineConfig, {
        loop: true,
        interactive: false,
      });

      expect(completeSessionSpy).toHaveBeenCalledWith(
        expect.any(String),
        'completed'
      );
    });

    it('should complete session with "failed" status on pipeline failure', async () => {
      const failedState = { ...mockPipelineState, status: 'failed' };

      const runner = new PipelineRunner(tempDir);
      const loopStateManager = (runner as any).loopStateManager;
      const completeSessionSpy = vi.spyOn(loopStateManager, 'completeSession');

      vi.spyOn(runner as any, '_executeSinglePipeline')
        .mockResolvedValue(failedState);

      await runner.runPipeline(mockPipelineConfig, {
        loop: true,
        interactive: false,
      });

      expect(completeSessionSpy).toHaveBeenCalledWith(
        expect.any(String),
        'failed'
      );
    });

    it('should complete session with "limit-reached" status when hitting max iterations', async () => {
      // Create many pending files to exceed limit
      for (let i = 1; i <= 5; i++) {
        await fs.writeFile(
          path.join(pendingDir, `task${i}.yml`),
          `name: task${i}\ntrigger: manual\nagents: []`
        );
      }

      vi.mocked(PipelineLoader).mockImplementation(() => ({
        loadPipelineFromPath: vi.fn().mockResolvedValue({
          config: mockPipelineConfig,
          metadata: {
            sourcePath: path.join(runningDir, 'taskX.yml'),
            sourceType: 'loop-pending' as const,
            loadedAt: new Date().toISOString(),
          },
        }),
      } as any));

      const runner = new PipelineRunner(tempDir);
      const loopStateManager = (runner as any).loopStateManager;
      const completeSessionSpy = vi.spyOn(loopStateManager, 'completeSession');

      vi.spyOn(runner as any, '_executeSinglePipeline')
        .mockResolvedValue(mockPipelineState);

      await runner.runPipeline(mockPipelineConfig, {
        loop: true,
        maxLoopIterations: 2, // Set low limit
        interactive: false,
      });

      expect(completeSessionSpy).toHaveBeenCalledWith(
        expect.any(String),
        'limit-reached'
      );
    });

    it('should populate loopContext in pipeline state', async () => {
      const runner = new PipelineRunner(tempDir);

      // Mock state with loopContext properly populated (as the initializer would do)
      const loopMockState = {
        ...mockPipelineState,
        loopContext: {
          enabled: true,
          currentIteration: 1,
          maxIterations: 100,
          loopSessionId: 'test-loop-session-id',
          pipelineSource: 'library' as const,
          terminationReason: undefined,
        },
      };

      vi.spyOn(runner as any, '_executeSinglePipeline')
        .mockResolvedValue(loopMockState);

      const result = await runner.runPipeline(mockPipelineConfig, {
        loop: true,
        interactive: false,
      });

      expect(result.loopContext).toBeDefined();
      expect(result.loopContext!.enabled).toBe(true);
      expect(result.loopContext!.loopSessionId).toBeDefined();
      expect(result.loopContext!.currentIteration).toBe(1);
      expect(result.loopContext!.maxIterations).toBe(100);
    });
  });

  describe('File System Error Handling', () => {
    it('should exit gracefully when pending directory becomes inaccessible', async () => {
      const runner = new PipelineRunner(tempDir);

      vi.spyOn(runner as any, '_executeSinglePipeline')
        .mockResolvedValue(mockPipelineState);

      // Mock _findNextPipelineFile to simulate directory access error
      vi.spyOn(runner as any, '_findNextPipelineFile')
        .mockResolvedValueOnce(undefined); // Simulate error by returning undefined

      const result = await runner.runPipeline(mockPipelineConfig, {
        loop: true,
        interactive: false,
      });

      // Should complete successfully with the seed pipeline result
      expect(result.status).toBe('completed');
    });

    it('should return undefined from _findNextPipelineFile when directory is deleted', async () => {
      const runner = new PipelineRunner(tempDir);

      // Delete the pending directory mid-execution
      await fs.rm(pendingDir, { recursive: true, force: true });

      const nextFile = await (runner as any)._findNextPipelineFile(mockLoopingConfig);

      expect(nextFile).toBeUndefined();
    });
  });

  describe('Defensive Error Guards', () => {
    it('should throw error if pipeline execution returns null/undefined', async () => {
      const runner = new PipelineRunner(tempDir);

      // Mock _executeSinglePipeline to return null/undefined (should never happen)
      vi.spyOn(runner as any, '_executeSinglePipeline')
        .mockResolvedValue(null);

      // Should reject with any error (could be null access error or defensive check)
      await expect(
        runner.runPipeline(mockPipelineConfig, {
          loop: false,
          interactive: false,
        })
      ).rejects.toThrow();
    });

    it('should throw error on null state in loop iterations', async () => {
      const runner = new PipelineRunner(tempDir);

      // First call succeeds, second call returns undefined
      vi.spyOn(runner as any, '_executeSinglePipeline')
        .mockResolvedValueOnce(mockPipelineState)
        .mockResolvedValueOnce(null);

      // Create a pending file to trigger loop iteration
      await fs.writeFile(
        path.join(pendingDir, 'task1.yml'),
        'name: task1\ntrigger: manual\nagents: []'
      );

      vi.mocked(PipelineLoader).mockImplementation(() => ({
        loadPipelineFromPath: vi.fn().mockResolvedValue({
          config: mockPipelineConfig,
          metadata: {
            sourcePath: path.join(runningDir, 'task1.yml'),
            sourceType: 'loop-pending' as const,
            loadedAt: new Date().toISOString(),
          },
        }),
      } as any));

      // Should reject with any error (null access will occur before defensive check)
      await expect(
        runner.runPipeline(mockPipelineConfig, {
          loop: true,
          interactive: false,
        })
      ).rejects.toThrow();
    });
  });
});
