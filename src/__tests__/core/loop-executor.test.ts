// src/__tests__/core/loop-executor.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';
import type { PipelineConfig, PipelineState, LoopContext, ResolvedLoopingConfig } from '../../config/schema.js';

// Hoisted mocks
const {
  mockFsReadFile,
  mockFsReaddir,
  mockFsStat,
  mockFsAccess,
  mockFsRename,
  mockFsCp,
  mockFsMkdir,
  mockRuntimeExecute,
  mockLoadLoopInstructions,
  mockUpdateIteration,
  mockAppendIteration,
} = vi.hoisted(() => ({
  mockFsReadFile: vi.fn(),
  mockFsReaddir: vi.fn(),
  mockFsStat: vi.fn(),
  mockFsAccess: vi.fn(),
  mockFsRename: vi.fn(),
  mockFsCp: vi.fn(),
  mockFsMkdir: vi.fn(),
  mockRuntimeExecute: vi.fn(),
  mockLoadLoopInstructions: vi.fn(),
  mockUpdateIteration: vi.fn(),
  mockAppendIteration: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  readFile: mockFsReadFile,
  readdir: mockFsReaddir,
  stat: mockFsStat,
  access: mockFsAccess,
  rename: mockFsRename,
  cp: mockFsCp,
  mkdir: mockFsMkdir,
}));

vi.mock('../../core/agent-runtime-registry.js', () => ({
  AgentRuntimeRegistry: {
    getRuntime: vi.fn(() => ({
      type: 'mock-runtime',
      name: 'Mock Runtime',
      execute: mockRuntimeExecute,
    })),
  },
}));

vi.mock('../../core/instruction-loader.js', () => ({
  InstructionLoader: vi.fn(() => ({
    loadLoopInstructions: mockLoadLoopInstructions,
  })),
}));

import { LoopExecutor } from '../../core/loop-executor.js';

// --- Shared fixtures ---

const simplePipelineConfig: PipelineConfig = {
  name: 'test-pipeline',
  trigger: 'manual',
  agents: [{ name: 'stage-1', agent: 'test.md' }],
};

const createMockState = (): PipelineState => ({
  runId: 'test-run-123',
  pipelineConfig: simplePipelineConfig,
  trigger: { type: 'manual', commitSha: 'abc123', timestamp: new Date().toISOString() },
  stages: [],
  status: 'running',
  artifacts: { initialCommit: 'abc123', changedFiles: [], totalDuration: 0, handoverDir: '.agent-pipeline/runs/test-run-123' },
});

const defaultLoopDirs: ResolvedLoopingConfig['directories'] = {
  pending: '/repo/.agent-pipeline/loops/default/pending',
  running: '/repo/.agent-pipeline/loops/default/running',
  finished: '/repo/.agent-pipeline/loops/default/finished',
  failed: '/repo/.agent-pipeline/loops/default/failed',
};

const createLoopContext = (overrides?: Partial<LoopContext>): LoopContext => ({
  enabled: true,
  directories: defaultLoopDirs,
  currentIteration: 1,
  maxIterations: 10,
  sessionId: 'session-abc',
  ...overrides,
});

// --- Tests ---

describe('LoopExecutor', () => {
  const repoPath = '/repo';
  let executor: LoopExecutor;
  let mockShouldLog: ReturnType<typeof vi.fn>;
  let mockStateChangeCallback: ReturnType<typeof vi.fn>;
  let mockLoopStateManager: { updateIteration: typeof mockUpdateIteration; appendIteration: typeof mockAppendIteration };

  beforeEach(() => {
    vi.clearAllMocks();

    mockShouldLog = vi.fn().mockReturnValue(false);
    mockStateChangeCallback = vi.fn();
    mockLoopStateManager = {
      updateIteration: mockUpdateIteration,
      appendIteration: mockAppendIteration,
    };

    executor = new LoopExecutor(
      repoPath,
      mockShouldLog,
      mockStateChangeCallback,
      mockLoopStateManager as any,
    );

    // Default happy-path mocks
    mockFsReadFile.mockResolvedValue('name: test-pipeline\ntrigger: manual\n');
    mockLoadLoopInstructions.mockResolvedValue('You are a loop agent.');
    mockRuntimeExecute.mockResolvedValue({ textOutput: 'Loop done.' });
    mockFsMkdir.mockResolvedValue(undefined);
    mockFsRename.mockResolvedValue(undefined);
    mockFsCp.mockResolvedValue(undefined);
    mockUpdateIteration.mockResolvedValue(true);
    mockAppendIteration.mockResolvedValue(undefined);
  });

  // -----------------------------------------------------------
  // injectLoopStageIntoConfig
  // -----------------------------------------------------------
  describe('injectLoopStageIntoConfig', () => {
    it('should inject loop agent with dependsOn listing all existing agents', () => {
      const config: PipelineConfig = {
        name: 'multi',
        trigger: 'manual',
        agents: [
          { name: 'a', agent: 'a.md' },
          { name: 'b', agent: 'b.md' },
        ],
      };
      const state = createMockState();

      const { modifiedConfig, loopStageName } = executor.injectLoopStageIntoConfig(config, state);

      expect(loopStageName).toBe('loop-agent');
      expect(modifiedConfig.agents).toHaveLength(3);

      const injected = modifiedConfig.agents[2];
      expect(injected.name).toBe('loop-agent');
      expect(injected.agent).toBe('__inline__');
      expect(injected.onFail).toBe('warn');
      expect(injected.dependsOn).toEqual(['a', 'b']);
    });

    it('should not mutate the original config', () => {
      const config: PipelineConfig = { ...simplePipelineConfig };
      const state = createMockState();
      executor.injectLoopStageIntoConfig(config, state);

      expect(config.agents).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------
  // getUniqueLoopStageName
  // -----------------------------------------------------------
  describe('getUniqueLoopStageName', () => {
    it('should return "loop-agent" when name is available', () => {
      const state = createMockState();
      const name = executor.getUniqueLoopStageName(simplePipelineConfig, state);
      expect(name).toBe('loop-agent');
    });

    it('should use runId suffix when "loop-agent" is taken by a config agent', () => {
      const config: PipelineConfig = {
        name: 'test',
        trigger: 'manual',
        agents: [{ name: 'loop-agent', agent: 'x.md' }],
      };
      const state = createMockState();
      const name = executor.getUniqueLoopStageName(config, state);
      expect(name).toBe('loop-agent-test-run');
    });

    it('should use runId suffix when "loop-agent" is taken by a stage execution', () => {
      const state = createMockState();
      state.stages.push({
        stageName: 'loop-agent',
        status: 'success',
        startTime: new Date().toISOString(),
        retryAttempt: 0,
        maxRetries: 0,
      });
      const name = executor.getUniqueLoopStageName(simplePipelineConfig, state);
      expect(name).toBe('loop-agent-test-run');
    });

    it('should append counter when runId suffix is also taken', () => {
      const config: PipelineConfig = {
        name: 'test',
        trigger: 'manual',
        agents: [
          { name: 'loop-agent', agent: 'x.md' },
          { name: 'loop-agent-test-run', agent: 'y.md' },
        ],
      };
      const state = createMockState();
      const name = executor.getUniqueLoopStageName(config, state);
      expect(name).toBe('loop-agent-test-run-1');
    });
  });

  // -----------------------------------------------------------
  // getDefaultLoopingConfig
  // -----------------------------------------------------------
  describe('getDefaultLoopingConfig', () => {
    it('should return config with default directories when no sessionId', () => {
      const config = executor.getDefaultLoopingConfig();

      expect(config.enabled).toBe(true);
      expect(config.maxIterations).toBe(100);
      expect(config.directories.pending).toBe(path.resolve(repoPath, '.agent-pipeline/loops/default/pending'));
      expect(config.directories.running).toBe(path.resolve(repoPath, '.agent-pipeline/loops/default/running'));
      expect(config.directories.finished).toBe(path.resolve(repoPath, '.agent-pipeline/loops/default/finished'));
      expect(config.directories.failed).toBe(path.resolve(repoPath, '.agent-pipeline/loops/default/failed'));
    });

    it('should return session-scoped directories when sessionId provided', () => {
      const config = executor.getDefaultLoopingConfig('my-session');

      expect(config.directories.pending).toBe(path.resolve(repoPath, '.agent-pipeline/loops/my-session/pending'));
      expect(config.directories.finished).toBe(path.resolve(repoPath, '.agent-pipeline/loops/my-session/finished'));
    });
  });

  // -----------------------------------------------------------
  // resolveLoopDirectories
  // -----------------------------------------------------------
  describe('resolveLoopDirectories', () => {
    it('should resolve directories without worktree (executionDirs === mainDirs)', () => {
      const loopContext = createLoopContext();
      const result = executor.resolveLoopDirectories(loopContext, repoPath);

      expect(result.executionDirs).toEqual(result.mainDirs);
    });

    it('should map to execution dirs with worktree', () => {
      const loopContext = createLoopContext({
        directories: {
          pending: path.resolve(repoPath, '.agent-pipeline/loops/session-abc/pending'),
          running: path.resolve(repoPath, '.agent-pipeline/loops/session-abc/running'),
          finished: path.resolve(repoPath, '.agent-pipeline/loops/session-abc/finished'),
          failed: path.resolve(repoPath, '.agent-pipeline/loops/session-abc/failed'),
        },
      });
      const worktreePath = '/worktrees/test';
      const executionRepoPath = worktreePath;

      const result = executor.resolveLoopDirectories(loopContext, executionRepoPath, worktreePath);

      // executionDirs should be under the worktree path
      expect(result.executionDirs.pending).toBe(
        path.resolve(executionRepoPath, '.agent-pipeline/loops/session-abc/pending'),
      );
      expect(result.executionDirs.running).toBe(
        path.resolve(executionRepoPath, '.agent-pipeline/loops/session-abc/running'),
      );
      // mainDirs should use the original repo path dirs
      expect(result.mainDirs.pending).toBe(path.resolve(repoPath, '.agent-pipeline/loops/session-abc/pending'));
    });
  });

  // -----------------------------------------------------------
  // areSameLoopDirs
  // -----------------------------------------------------------
  describe('areSameLoopDirs', () => {
    it('should return true for matching dirs', () => {
      expect(executor.areSameLoopDirs(defaultLoopDirs, { ...defaultLoopDirs })).toBe(true);
    });

    it('should return false for different dirs', () => {
      const other = { ...defaultLoopDirs, pending: '/other/pending' };
      expect(executor.areSameLoopDirs(defaultLoopDirs, other)).toBe(false);
    });
  });

  // -----------------------------------------------------------
  // findNextPipelineFile
  // -----------------------------------------------------------
  describe('findNextPipelineFile', () => {
    it('should return oldest YAML file by mtime', async () => {
      mockFsReaddir.mockResolvedValue(['newer.yml', 'older.yml', 'readme.txt']);
      mockFsStat.mockImplementation(async (filePath: string) => {
        if (String(filePath).includes('newer.yml')) return { mtime: new Date('2025-02-01') };
        if (String(filePath).includes('older.yml')) return { mtime: new Date('2025-01-01') };
        return { mtime: new Date() };
      });

      const result = await executor.findNextPipelineFile(defaultLoopDirs);

      expect(result).toContain('older.yml');
    });

    it('should return undefined for empty directory', async () => {
      mockFsReaddir.mockResolvedValue([]);
      const result = await executor.findNextPipelineFile(defaultLoopDirs);
      expect(result).toBeUndefined();
    });

    it('should return undefined when directory does not exist', async () => {
      mockFsReaddir.mockRejectedValue(new Error('ENOENT'));
      const result = await executor.findNextPipelineFile(defaultLoopDirs);
      expect(result).toBeUndefined();
    });

    it('should ignore non-YAML files', async () => {
      mockFsReaddir.mockResolvedValue(['notes.txt', 'data.json']);
      const result = await executor.findNextPipelineFile(defaultLoopDirs);
      expect(result).toBeUndefined();
    });
  });

  // -----------------------------------------------------------
  // getUniqueFilePath
  // -----------------------------------------------------------
  describe('getUniqueFilePath', () => {
    it('should return original path when file does not exist', async () => {
      mockFsAccess.mockRejectedValue(new Error('ENOENT'));
      const result = await executor.getUniqueFilePath('/dest', 'task.yml');
      expect(result).toBe(path.join('/dest', 'task.yml'));
    });

    it('should return timestamped path when file exists', async () => {
      mockFsAccess.mockResolvedValue(undefined);
      const before = Date.now();
      const result = await executor.getUniqueFilePath('/dest', 'task.yml');
      const after = Date.now();

      expect(result).toMatch(/^\/dest\/task-\d+\.yml$/);
      // Verify timestamp is reasonable
      const match = result.match(/task-(\d+)\.yml/);
      const ts = Number(match![1]);
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });
  });

  // -----------------------------------------------------------
  // moveFile
  // -----------------------------------------------------------
  describe('moveFile', () => {
    it('should rename file to destination', async () => {
      mockFsAccess.mockRejectedValue(new Error('ENOENT'));
      const result = await executor.moveFile('/src/file.yml', '/dest', 'file.yml');

      expect(mockFsRename).toHaveBeenCalledWith('/src/file.yml', path.join('/dest', 'file.yml'));
      expect(result).toBe(path.join('/dest', 'file.yml'));
    });
  });

  // -----------------------------------------------------------
  // executeLoopAgent
  // -----------------------------------------------------------
  describe('executeLoopAgent', () => {
    const loopContext = createLoopContext();

    it('should add running entry then call stateChangeCallback', async () => {
      // Capture status at each callback invocation (state is mutated in-place)
      const statusAtCall: string[] = [];
      mockStateChangeCallback.mockImplementation((s: PipelineState) => {
        statusAtCall.push(s.stages[s.stages.length - 1]?.status);
      });
      const state = createMockState();
      await executor.executeLoopAgent(simplePipelineConfig, state, loopContext, 'loop-agent', repoPath, false);

      expect(mockStateChangeCallback).toHaveBeenCalledTimes(2);
      expect(statusAtCall[0]).toBe('running');
      expect(statusAtCall[1]).toBe('success');
      expect(state.stages[0].stageName).toBe('loop-agent');
    });

    it('should update to success and call stateChangeCallback', async () => {
      mockRuntimeExecute.mockResolvedValue({
        textOutput: 'Done.',
        tokenUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        numTurns: 3,
      });
      const state = createMockState();
      await executor.executeLoopAgent(simplePipelineConfig, state, loopContext, 'loop-agent', repoPath, false);

      // Second callback: success status
      const secondCallState = mockStateChangeCallback.mock.calls[1][0] as PipelineState;
      const execution = secondCallState.stages[0];
      expect(execution.status).toBe('success');
      expect(execution.agentOutput).toBe('Done.');
      expect(execution.tokenUsage?.actual_input).toBe(100);
      expect(execution.tokenUsage?.output).toBe(50);
      expect(execution.tokenUsage?.num_turns).toBe(3);
    });

    it('should update to failed and call stateChangeCallback on error', async () => {
      mockRuntimeExecute.mockRejectedValue(new Error('Runtime crashed'));
      const state = createMockState();
      await executor.executeLoopAgent(simplePipelineConfig, state, loopContext, 'loop-agent', repoPath, false);

      const lastCallState = mockStateChangeCallback.mock.calls[1][0] as PipelineState;
      const execution = lastCallState.stages[0];
      expect(execution.status).toBe('failed');
      expect(execution.error?.message).toBe('Runtime crashed');
    });

    it('should call runtime.execute with correct prompts', async () => {
      const state = createMockState();
      await executor.executeLoopAgent(simplePipelineConfig, state, loopContext, 'loop-agent', repoPath, false);

      expect(mockRuntimeExecute).toHaveBeenCalledTimes(1);
      const callArg = mockRuntimeExecute.mock.calls[0][0];
      expect(callArg.systemPrompt).toBe('You are a loop agent.');
      expect(callArg.userPrompt).toContain('Loop Agent Task');
      expect(callArg.userPrompt).toContain(defaultLoopDirs.pending);
      expect(callArg.options.permissionMode).toBe('acceptEdits');
      expect(callArg.options.runtimeOptions.cwd).toBe(repoPath);
    });

    it('should log when shouldLog returns true', async () => {
      mockShouldLog.mockReturnValue(true);
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const state = createMockState();
      await executor.executeLoopAgent(simplePipelineConfig, state, loopContext, 'loop-agent', repoPath, true);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Running loop agent'));
      consoleSpy.mockRestore();
    });
  });

  // -----------------------------------------------------------
  // readPipelineYaml
  // -----------------------------------------------------------
  describe('readPipelineYaml', () => {
    it('should try metadata.sourcePath first', async () => {
      mockFsReadFile.mockResolvedValue('yaml-from-source');
      const result = await executor.readPipelineYaml(
        simplePipelineConfig,
        { sourcePath: '/source/pipe.yml', sourceType: 'library', loadedAt: '' },
        repoPath,
      );

      expect(result).toBe('yaml-from-source');
      expect(mockFsReadFile).toHaveBeenCalledWith('/source/pipe.yml', 'utf-8');
    });

    it('should try conventional path when sourcePath fails', async () => {
      mockFsReadFile
        .mockRejectedValueOnce(new Error('ENOENT'))
        .mockResolvedValueOnce('yaml-from-conventional');

      const result = await executor.readPipelineYaml(
        simplePipelineConfig,
        { sourcePath: '/bad/path.yml', sourceType: 'library', loadedAt: '' },
        repoPath,
      );

      expect(result).toBe('yaml-from-conventional');
      expect(mockFsReadFile).toHaveBeenCalledWith(
        path.join(repoPath, '.agent-pipeline/pipelines/test-pipeline.yml'),
        'utf-8',
      );
    });

    it('should fall back to YAML.stringify when both reads fail', async () => {
      mockFsReadFile.mockRejectedValue(new Error('ENOENT'));
      const result = await executor.readPipelineYaml(simplePipelineConfig, undefined, repoPath);

      // YAML.stringify produces a string containing the config name
      expect(result).toContain('test-pipeline');
      expect(result).toContain('manual');
    });
  });

  // -----------------------------------------------------------
  // buildLoopAgentPrompt
  // -----------------------------------------------------------
  describe('buildLoopAgentPrompt', () => {
    it('should include pipeline YAML, pending dir, and iteration status', () => {
      const loopContext = createLoopContext({ currentIteration: 3, maxIterations: 10 });
      const result = executor.buildLoopAgentPrompt(simplePipelineConfig, loopContext, 'name: test\n');

      expect(result).toContain('name: test');
      expect(result).toContain(defaultLoopDirs.pending);
      expect(result).toContain('Iteration 3/10');
      expect(result).toContain('test-pipeline');
    });
  });

  // -----------------------------------------------------------
  // recordIteration
  // -----------------------------------------------------------
  describe('recordIteration', () => {
    it('should call updateIteration with correct args', async () => {
      mockUpdateIteration.mockResolvedValue(true);
      const state = createMockState();
      state.status = 'completed';
      state.loopContext = {
        enabled: true,
        currentIteration: 2,
        maxIterations: 10,
        loopSessionId: 'session-abc',
        pipelineSource: 'library',
      };

      await executor.recordIteration('session-abc', state, undefined, true);

      expect(mockUpdateIteration).toHaveBeenCalledWith('session-abc', 2, {
        pipelineName: 'test-pipeline',
        runId: 'test-run-123',
        status: 'completed',
        duration: 0,
        triggeredNext: true,
      });
      expect(mockAppendIteration).not.toHaveBeenCalled();
    });

    it('should fallback to appendIteration when updateIteration returns false', async () => {
      mockUpdateIteration.mockResolvedValue(false);
      const state = createMockState();
      state.status = 'failed';
      state.loopContext = {
        enabled: true,
        currentIteration: 1,
        maxIterations: 10,
        loopSessionId: 'session-abc',
        pipelineSource: 'library',
      };

      await executor.recordIteration('session-abc', state, undefined, false);

      expect(mockAppendIteration).toHaveBeenCalledWith('session-abc', {
        iterationNumber: 1,
        pipelineName: 'test-pipeline',
        runId: 'test-run-123',
        status: 'failed',
        duration: 0,
        triggeredNext: false,
      });
    });

    it('should map aborted status correctly', async () => {
      mockUpdateIteration.mockResolvedValue(true);
      const state = createMockState();
      state.status = 'aborted';

      await executor.recordIteration('session-abc', state, undefined, false);

      expect(mockUpdateIteration).toHaveBeenCalledWith(
        'session-abc',
        1,
        expect.objectContaining({ status: 'aborted' }),
      );
    });
  });

  // -----------------------------------------------------------
  // getPipelineName
  // -----------------------------------------------------------
  describe('getPipelineName', () => {
    it('should use metadata.sourcePath when available', () => {
      const result = executor.getPipelineName(simplePipelineConfig, {
        sourcePath: '/pipelines/my-cool-pipeline.yml',
        sourceType: 'library',
        loadedAt: '',
      });
      expect(result).toBe('my-cool-pipeline');
    });

    it('should use config.name when no metadata', () => {
      const result = executor.getPipelineName(simplePipelineConfig);
      expect(result).toBe('test-pipeline');
    });

    it('should use config.name when metadata has no sourcePath', () => {
      const result = executor.getPipelineName(simplePipelineConfig, undefined);
      expect(result).toBe('test-pipeline');
    });
  });

  // -----------------------------------------------------------
  // ensureLoopDirectoriesExist
  // -----------------------------------------------------------
  describe('ensureLoopDirectoriesExist', () => {
    it('should create all four directories', async () => {
      await executor.ensureLoopDirectoriesExist(defaultLoopDirs);

      expect(mockFsMkdir).toHaveBeenCalledTimes(4);
      expect(mockFsMkdir).toHaveBeenCalledWith(defaultLoopDirs.pending, { recursive: true });
      expect(mockFsMkdir).toHaveBeenCalledWith(defaultLoopDirs.running, { recursive: true });
      expect(mockFsMkdir).toHaveBeenCalledWith(defaultLoopDirs.finished, { recursive: true });
      expect(mockFsMkdir).toHaveBeenCalledWith(defaultLoopDirs.failed, { recursive: true });
    });
  });

  // -----------------------------------------------------------
  // copyLoopDirectories
  // -----------------------------------------------------------
  describe('copyLoopDirectories', () => {
    it('should copy each directory pair', async () => {
      const execDirs: ResolvedLoopingConfig['directories'] = {
        pending: '/worktree/pending',
        running: '/worktree/running',
        finished: '/worktree/finished',
        failed: '/worktree/failed',
      };

      await executor.copyLoopDirectories(execDirs, defaultLoopDirs);

      expect(mockFsCp).toHaveBeenCalledTimes(4);
      expect(mockFsCp).toHaveBeenCalledWith('/worktree/pending', defaultLoopDirs.pending, { recursive: true, force: true });
      expect(mockFsCp).toHaveBeenCalledWith('/worktree/finished', defaultLoopDirs.finished, { recursive: true, force: true });
    });
  });
});
