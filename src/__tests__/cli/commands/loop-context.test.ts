// src/__tests__/cli/commands/loop-context.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { loopContextCommand } from '../../../cli/commands/loop-context.js';
import { createTempDir, cleanupTempDir } from '../../setup.js';
import { LoopStateManager, LoopSession } from '../../../core/loop-state-manager.js';

// Mock LoopStateManager
vi.mock('../../../core/loop-state-manager.js', () => ({
  LoopStateManager: vi.fn(),
}));

describe('loopContextCommand', () => {
  let tempDir: string;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let mockGetAllSessions: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    tempDir = await createTempDir('loop-context-');
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Setup mock LoopStateManager
    mockGetAllSessions = vi.fn();
    vi.mocked(LoopStateManager).mockImplementation(() => ({
      getAllSessions: mockGetAllSessions,
    }) as unknown as LoopStateManager);
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await cleanupTempDir(tempDir);
  });

  describe('no running sessions', () => {
    it('should display message when no sessions exist', async () => {
      mockGetAllSessions.mockResolvedValue([]);

      await loopContextCommand(tempDir);

      expect(consoleLogSpy).toHaveBeenCalledWith('No active loop sessions found.');
      expect(consoleLogSpy).toHaveBeenCalledWith('This command is only useful during loop mode execution.');
    });

    it('should display message when all sessions are completed', async () => {
      mockGetAllSessions.mockResolvedValue([
        { sessionId: 'session-1', status: 'completed' },
        { sessionId: 'session-2', status: 'failed' },
      ]);

      await loopContextCommand(tempDir);

      expect(consoleLogSpy).toHaveBeenCalledWith('No active loop sessions found.');
    });
  });

  describe('single running session', () => {
    it('should display context for running session', async () => {
      const session: LoopSession = {
        sessionId: 'session-abc123',
        status: 'running',
        startTime: new Date().toISOString(),
        maxIterations: 10,
        iterations: [
          {
            iterationNumber: 1,
            pipelineName: 'test-pipeline',
            runId: 'run-1',
            status: 'completed',
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
          },
        ],
      };
      mockGetAllSessions.mockResolvedValue([session]);

      // Create running directory with pipeline YAML
      const runningDir = path.join(tempDir, '.agent-pipeline', 'loops', 'session-abc123', 'running');
      await fs.mkdir(runningDir, { recursive: true });
      await fs.writeFile(
        path.join(runningDir, 'test-pipeline.yml'),
        'name: test-pipeline\ntrigger: manual\nagents:\n  - name: test\n    agent: test.md'
      );

      await loopContextCommand(tempDir);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('LOOP CONTEXT'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Loop Status: Iteration 1/10'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Session ID: session-abc123'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Pipeline Source: running'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Pipeline Name: test-pipeline'));
    });

    it('should display pipeline YAML content', async () => {
      const pipelineYaml = 'name: my-pipeline\ntrigger: manual';
      const session: LoopSession = {
        sessionId: 'session-123',
        status: 'running',
        startTime: new Date().toISOString(),
        maxIterations: 5,
        iterations: [],
      };
      mockGetAllSessions.mockResolvedValue([session]);

      const runningDir = path.join(tempDir, '.agent-pipeline', 'loops', 'session-123', 'running');
      await fs.mkdir(runningDir, { recursive: true });
      await fs.writeFile(path.join(runningDir, 'my-pipeline.yml'), pipelineYaml);

      await loopContextCommand(tempDir);

      expect(consoleLogSpy).toHaveBeenCalledWith(pipelineYaml);
    });

    it('should display pending directory path', async () => {
      const session: LoopSession = {
        sessionId: 'session-xyz',
        status: 'running',
        startTime: new Date().toISOString(),
        maxIterations: 3,
        iterations: [],
      };
      mockGetAllSessions.mockResolvedValue([session]);

      const runningDir = path.join(tempDir, '.agent-pipeline', 'loops', 'session-xyz', 'running');
      await fs.mkdir(runningDir, { recursive: true });
      await fs.writeFile(path.join(runningDir, 'test.yml'), 'name: test');

      await loopContextCommand(tempDir);

      const pendingDir = path.join(tempDir, '.agent-pipeline', 'loops', 'session-xyz', 'pending');
      expect(consoleLogSpy).toHaveBeenCalledWith(`  ${pendingDir}/`);
    });
  });

  describe('multiple running sessions', () => {
    it('should warn about multiple sessions and use most recent', async () => {
      const session1: LoopSession = {
        sessionId: 'session-old',
        status: 'running',
        startTime: '2024-01-01T10:00:00.000Z',
        maxIterations: 5,
        iterations: [],
      };
      const session2: LoopSession = {
        sessionId: 'session-new',
        status: 'running',
        startTime: '2024-01-02T10:00:00.000Z',
        maxIterations: 10,
        iterations: [],
      };
      mockGetAllSessions.mockResolvedValue([session1, session2]);

      // Create running directory for the newer session
      const runningDir = path.join(tempDir, '.agent-pipeline', 'loops', 'session-new', 'running');
      await fs.mkdir(runningDir, { recursive: true });
      await fs.writeFile(path.join(runningDir, 'new-pipeline.yml'), 'name: new-pipeline');

      await loopContextCommand(tempDir);

      expect(consoleLogSpy).toHaveBeenCalledWith('Warning: 2 loop sessions are running concurrently.');
      expect(consoleLogSpy).toHaveBeenCalledWith('Using the most recently started session.\n');
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Session ID: session-new'));
    });
  });

  describe('pipeline file handling', () => {
    it('should handle .yaml extension', async () => {
      const session: LoopSession = {
        sessionId: 'session-yaml',
        status: 'running',
        startTime: new Date().toISOString(),
        maxIterations: 5,
        iterations: [],
      };
      mockGetAllSessions.mockResolvedValue([session]);

      const runningDir = path.join(tempDir, '.agent-pipeline', 'loops', 'session-yaml', 'running');
      await fs.mkdir(runningDir, { recursive: true });
      await fs.writeFile(path.join(runningDir, 'my-pipeline.yaml'), 'name: yaml-pipeline');

      await loopContextCommand(tempDir);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Pipeline Name: my-pipeline'));
    });

    it('should fallback to library when running directory is empty', async () => {
      const session: LoopSession = {
        sessionId: 'session-fallback',
        status: 'running',
        startTime: new Date().toISOString(),
        maxIterations: 5,
        iterations: [
          {
            iterationNumber: 1,
            pipelineName: 'library-pipeline',
            runId: 'run-1',
            status: 'completed',
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
          },
        ],
      };
      mockGetAllSessions.mockResolvedValue([session]);

      // Create empty running directory
      const runningDir = path.join(tempDir, '.agent-pipeline', 'loops', 'session-fallback', 'running');
      await fs.mkdir(runningDir, { recursive: true });

      // Create library pipeline
      const pipelinesDir = path.join(tempDir, '.agent-pipeline', 'pipelines');
      await fs.mkdir(pipelinesDir, { recursive: true });
      await fs.writeFile(
        path.join(pipelinesDir, 'library-pipeline.yml'),
        'name: library-pipeline\nfrom: library'
      );

      await loopContextCommand(tempDir);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Pipeline Source: library'));
      expect(consoleLogSpy).toHaveBeenCalledWith('name: library-pipeline\nfrom: library');
    });

    it('should handle missing running directory', async () => {
      const session: LoopSession = {
        sessionId: 'session-missing',
        status: 'running',
        startTime: new Date().toISOString(),
        maxIterations: 5,
        iterations: [
          {
            iterationNumber: 1,
            pipelineName: 'fallback-pipeline',
            runId: 'run-1',
            status: 'completed',
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
          },
        ],
      };
      mockGetAllSessions.mockResolvedValue([session]);

      // Create library pipeline (no running dir)
      const pipelinesDir = path.join(tempDir, '.agent-pipeline', 'pipelines');
      await fs.mkdir(pipelinesDir, { recursive: true });
      await fs.writeFile(
        path.join(pipelinesDir, 'fallback-pipeline.yml'),
        'name: fallback-pipeline'
      );

      await loopContextCommand(tempDir);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Pipeline Source: library'));
    });

    it('should display error when pipeline not found anywhere', async () => {
      const session: LoopSession = {
        sessionId: 'session-notfound',
        status: 'running',
        startTime: new Date().toISOString(),
        maxIterations: 5,
        iterations: [],
      };
      mockGetAllSessions.mockResolvedValue([session]);

      // Don't create any pipeline files

      await loopContextCommand(tempDir);

      expect(consoleLogSpy).toHaveBeenCalledWith('Could not find current pipeline file.');
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Session ID: session-notfound'));
    });
  });

  describe('iteration info', () => {
    it('should calculate current iteration from last iteration', async () => {
      const session: LoopSession = {
        sessionId: 'session-iter',
        status: 'running',
        startTime: new Date().toISOString(),
        maxIterations: 10,
        iterations: [
          { iterationNumber: 1, pipelineName: 'p', runId: 'r1', status: 'completed', startTime: '', endTime: '' },
          { iterationNumber: 2, pipelineName: 'p', runId: 'r2', status: 'completed', startTime: '', endTime: '' },
          { iterationNumber: 3, pipelineName: 'p', runId: 'r3', status: 'completed', startTime: '', endTime: '' },
        ],
      };
      mockGetAllSessions.mockResolvedValue([session]);

      const runningDir = path.join(tempDir, '.agent-pipeline', 'loops', 'session-iter', 'running');
      await fs.mkdir(runningDir, { recursive: true });
      await fs.writeFile(path.join(runningDir, 'test.yml'), 'name: test');

      await loopContextCommand(tempDir);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Loop Status: Iteration 3/10'));
    });

    it('should default to iteration 1 when no iterations exist', async () => {
      const session: LoopSession = {
        sessionId: 'session-first',
        status: 'running',
        startTime: new Date().toISOString(),
        maxIterations: 5,
        iterations: [],
      };
      mockGetAllSessions.mockResolvedValue([session]);

      const runningDir = path.join(tempDir, '.agent-pipeline', 'loops', 'session-first', 'running');
      await fs.mkdir(runningDir, { recursive: true });
      await fs.writeFile(path.join(runningDir, 'test.yml'), 'name: test');

      await loopContextCommand(tempDir);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Loop Status: Iteration 1/5'));
    });
  });

  describe('output formatting', () => {
    it('should display section separators', async () => {
      const session: LoopSession = {
        sessionId: 'session-fmt',
        status: 'running',
        startTime: new Date().toISOString(),
        maxIterations: 5,
        iterations: [],
      };
      mockGetAllSessions.mockResolvedValue([session]);

      const runningDir = path.join(tempDir, '.agent-pipeline', 'loops', 'session-fmt', 'running');
      await fs.mkdir(runningDir, { recursive: true });
      await fs.writeFile(path.join(runningDir, 'test.yml'), 'name: test');

      await loopContextCommand(tempDir);

      // Check for section headers
      expect(consoleLogSpy).toHaveBeenCalledWith('='.repeat(60));
      expect(consoleLogSpy).toHaveBeenCalledWith('-'.repeat(60));
      expect(consoleLogSpy).toHaveBeenCalledWith('CURRENT PIPELINE YAML');
      expect(consoleLogSpy).toHaveBeenCalledWith('RECOMMENDATIONS FOR NEXT PIPELINE');
      expect(consoleLogSpy).toHaveBeenCalledWith('PENDING DIRECTORY');
    });

    it('should display recommendations', async () => {
      const session: LoopSession = {
        sessionId: 'session-rec',
        status: 'running',
        startTime: new Date().toISOString(),
        maxIterations: 5,
        iterations: [],
      };
      mockGetAllSessions.mockResolvedValue([session]);

      const runningDir = path.join(tempDir, '.agent-pipeline', 'loops', 'session-rec', 'running');
      await fs.mkdir(runningDir, { recursive: true });
      await fs.writeFile(path.join(runningDir, 'test.yml'), 'name: test');

      await loopContextCommand(tempDir);

      expect(consoleLogSpy).toHaveBeenCalledWith('1. Keep structure identical unless another structure or file is given');
      expect(consoleLogSpy).toHaveBeenCalledWith('2. Looping config is saved from first pipeline - leave unchanged');
      expect(consoleLogSpy).toHaveBeenCalledWith('3. Only update customizations as needed (leave unchanged if no directions)');
    });
  });
});
