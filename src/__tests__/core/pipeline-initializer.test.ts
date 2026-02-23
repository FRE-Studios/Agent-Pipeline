// src/__tests__/core/pipeline-initializer.test.ts

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PipelineInitializer } from '../../core/pipeline-initializer.js';
import { GitManager } from '../../core/git-manager.js';
import { BranchManager } from '../../core/branch-manager.js';
import { HandoverManager } from '../../core/handover-manager.js';
import { PipelineConfig } from '../../config/schema.js';
import { StageExecutor } from '../../core/stage-executor.js';
import { ParallelExecutor } from '../../core/parallel-executor.js';

// Mock dependencies
vi.mock('../../core/git-manager.js');
vi.mock('../../core/branch-manager.js');
vi.mock('../../core/worktree-manager.js');
vi.mock('../../core/handover-manager.js');
vi.mock('../../core/stage-executor.js');
vi.mock('../../core/parallel-executor.js');
vi.mock('../../notifications/notification-manager.js');
vi.mock('../../utils/pipeline-logger.js');

import { WorktreeManager } from '../../core/worktree-manager.js';
import { PipelineLogger } from '../../utils/pipeline-logger.js';

// Helper to create mock runtime
function createMockRuntime() {
  return {
    type: 'mock-runtime',
    name: 'Mock Runtime',
    execute: vi.fn(),
    getCapabilities: vi.fn().mockReturnValue({
      supportsStreaming: true,
      supportsTokenTracking: true,
      supportsMCP: true,
      supportsContextReduction: true,
      availableModels: ['haiku', 'sonnet', 'opus'],
      permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan']
    }),
    validate: vi.fn().mockResolvedValue({ valid: true, errors: [], warnings: [] })
  };
}

describe('PipelineInitializer', () => {
  let initializer: PipelineInitializer;
  let mockGitManager: GitManager;
  let mockBranchManager: BranchManager;
  let mockRuntime: ReturnType<typeof createMockRuntime>;
  let mockNotifyCallback: ReturnType<typeof vi.fn>;
  let mockStateChangeCallback: ReturnType<typeof vi.fn>;

  const mockConfig: PipelineConfig = {
    name: 'test-pipeline',
    trigger: 'manual',
    agents: [
      {
        name: 'test-agent',
        agent: '.agent-pipeline/agents/test.md'
      }
    ]
  };

  beforeEach(() => {
    mockGitManager = new GitManager('/test/repo');
    mockBranchManager = new BranchManager('/test/repo');
    mockRuntime = createMockRuntime();
    mockNotifyCallback = vi.fn().mockResolvedValue(undefined);
    mockStateChangeCallback = vi.fn();

    // Setup common mocks
    vi.spyOn(mockGitManager, 'getCurrentCommit').mockResolvedValue('abc123');
    vi.spyOn(mockGitManager, 'getChangedFiles').mockResolvedValue(['file1.ts', 'file2.ts']);
    vi.spyOn(mockGitManager, 'getCurrentBranch').mockResolvedValue('main');
    vi.spyOn(mockBranchManager, 'getCurrentBranch').mockResolvedValue('main');

    // Setup HandoverManager mock
    const handoverManagerMock = HandoverManager as unknown as vi.Mock;
    handoverManagerMock.mockImplementation(() => ({
      initialize: vi.fn().mockResolvedValue(undefined),
      getHandoverDir: vi.fn().mockReturnValue('/test/repo/test-pipeline-abc123'),
      saveAgentOutput: vi.fn().mockResolvedValue(undefined),
      appendToLog: vi.fn().mockResolvedValue(undefined),
      getPreviousStages: vi.fn().mockResolvedValue([]),
      buildContextMessage: vi.fn().mockReturnValue('')
    }));

    // Setup WorktreeManager mock
    vi.mocked(WorktreeManager).mockImplementation(() => ({
      setupPipelineWorktree: vi.fn().mockResolvedValue({
        worktreePath: '/test/repo/.agent-pipeline/worktrees/test-pipeline',
        branchName: 'pipeline/test-pipeline'
      }),
      cleanupWorktree: vi.fn().mockResolvedValue(undefined),
      listPipelineWorktrees: vi.fn().mockResolvedValue([]),
    } as unknown as WorktreeManager));

    // Setup PipelineLogger mock
    vi.mocked(PipelineLogger).mockImplementation(() => ({
      getLogPath: vi.fn().mockReturnValue('/test/repo/.agent-pipeline/logs/test-pipeline.log'),
      log: vi.fn(),
      logRaw: vi.fn(),
      error: vi.fn(),
      section: vi.fn(),
      stageStart: vi.fn(),
      stageComplete: vi.fn(),
      stageFailed: vi.fn(),
      stageSkipped: vi.fn(),
      pipelineStart: vi.fn(),
      pipelineComplete: vi.fn(),
      close: vi.fn(),
    } as unknown as PipelineLogger));

    initializer = new PipelineInitializer(
      mockGitManager,
      '/test/repo',
      false,
      mockRuntime as any
    );
  });

  describe('initialize', () => {
    it('should create initial state with correct structure', async () => {
      const result = await initializer.initialize(
        mockConfig,
        { interactive: false },
        mockNotifyCallback,
        mockStateChangeCallback
      );

      expect(result.state).toMatchObject({
        pipelineConfig: mockConfig,
        trigger: {
          type: 'manual',
          commitSha: 'abc123'
        },
        stages: [],
        status: 'running',
        artifacts: {
          initialCommit: 'abc123',
          changedFiles: ['file1.ts', 'file2.ts'],
          totalDuration: 0
        }
      });
      expect(result.state.runId).toBeDefined();
      expect(result.state.trigger.timestamp).toBeDefined();
      expect(mockGitManager.getChangedFiles).toHaveBeenCalledWith('abc123');
    });

    it('should create notification manager when configured', async () => {
      const configWithNotifications = {
        ...mockConfig,
        notifications: {
          enabled: true,
          events: ['pipeline.started' as const],
          channels: {
            local: { enabled: true }
          }
        }
      };

      const result = await initializer.initialize(
        configWithNotifications,
        { interactive: false },
        mockNotifyCallback,
        mockStateChangeCallback
      );

      expect(result.notificationManager).toBeDefined();
    });

    it('should not create notification manager when not configured', async () => {
      const result = await initializer.initialize(
        mockConfig,
        { interactive: false },
        mockNotifyCallback,
        mockStateChangeCallback
      );

      expect(result.notificationManager).toBeUndefined();
    });

    it('should reuse provided notification manager instance', async () => {
      const providedManager = { notify: vi.fn() } as any;

      const result = await initializer.initialize(
        mockConfig,
        { interactive: false, notificationManager: providedManager },
        mockNotifyCallback,
        mockStateChangeCallback
      );

      expect(result.notificationManager).toBe(providedManager);
    });

    it('should return execution repo path', async () => {
      const result = await initializer.initialize(
        mockConfig,
        { interactive: false },
        mockNotifyCallback,
        mockStateChangeCallback
      );

      // When no git config, executes in main repo
      expect(result.executionRepoPath).toBe('/test/repo');
    });

    it('should setup worktree when git config exists', async () => {
      const configWithGit = {
        ...mockConfig,
        git: {
          baseBranch: 'develop',
          branchStrategy: 'reusable' as const,
          branchPrefix: 'pipeline'
        }
      };

      const result = await initializer.initialize(
        configWithGit,
        { interactive: false },
        mockNotifyCallback,
        mockStateChangeCallback
      );

      expect(result.pipelineBranch).toBe('pipeline/test-pipeline');
      expect(result.worktreePath).toBe('/test/repo/.agent-pipeline/worktrees/test-pipeline');
      expect(result.executionRepoPath).toBe('/test/repo/.agent-pipeline/worktrees/test-pipeline');
    });

    it('should not setup branch when git config is missing', async () => {
      const result = await initializer.initialize(
        mockConfig,
        { interactive: false },
        mockNotifyCallback,
        mockStateChangeCallback
      );

      expect(result.pipelineBranch).toBeUndefined();
    });

    it('should use current checked-out branch in template context when no worktree branch exists', async () => {
      const result = await initializer.initialize(
        mockConfig,
        { interactive: false },
        mockNotifyCallback,
        mockStateChangeCallback
      );

      expect(result.templateContext.branch).toBe('main');
      expect(mockGitManager.getCurrentBranch).toHaveBeenCalled();
    });

    it('should use pipeline branch in template context when worktree branch exists', async () => {
      const configWithGit = {
        ...mockConfig,
        git: {
          baseBranch: 'main'
        }
      };

      const result = await initializer.initialize(
        configWithGit,
        { interactive: false },
        mockNotifyCallback,
        mockStateChangeCallback
      );

      expect(result.templateContext.branch).toBe('pipeline/test-pipeline');
      expect(mockGitManager.getCurrentBranch).not.toHaveBeenCalled();
    });

    it('should not setup branch in dry run mode', async () => {
      const dryRunInitializer = new PipelineInitializer(
        mockGitManager,
        '/test/repo',
        true, // dryRun = true
        mockRuntime as any
      );

      const configWithGit = {
        ...mockConfig,
        git: {
          baseBranch: 'main'
        }
      };

      const result = await dryRunInitializer.initialize(
        configWithGit,
        { interactive: false },
        mockNotifyCallback,
        mockStateChangeCallback
      );

      expect(result.pipelineBranch).toBeUndefined();
    });

    it('should create stage executor and parallel executor with correct arguments', async () => {
      const stageExecutorMock = StageExecutor as unknown as vi.Mock;
      const parallelExecutorMock = ParallelExecutor as unknown as vi.Mock;
      stageExecutorMock.mockClear();
      parallelExecutorMock.mockClear();

      const result = await initializer.initialize(
        mockConfig,
        { interactive: false },
        mockNotifyCallback,
        mockStateChangeCallback
      );

      // StageExecutor constructor: (gitManager, dryRun, handoverManager, defaultRuntime, repoPath, executionRepoPath, loggingContext, abortController, pipelineLogger)
      expect(stageExecutorMock).toHaveBeenCalledWith(
        mockGitManager,
        false,  // dryRun
        expect.any(Object),  // handoverManager
        expect.any(Object),  // defaultRuntime (the runtime passed to PipelineInitializer)
        '/test/repo',  // repoPath (for file-driven instruction loading)
        '/test/repo',  // executionRepoPath (where agents execute)
        { interactive: false, verbose: false },  // loggingContext
        undefined,  // abortController
        expect.any(Object)  // pipelineLogger
      );
      expect(result.stageExecutor).toBe(stageExecutorMock.mock.instances[0]);

      expect(parallelExecutorMock).toHaveBeenCalledWith(
        result.stageExecutor,
        mockStateChangeCallback,
        undefined  // abortController
      );
      expect(result.parallelExecutor).toBe(parallelExecutorMock.mock.instances[0]);
    });

    it('should call state change callback', async () => {
      await initializer.initialize(
        mockConfig,
        { interactive: false },
        mockNotifyCallback,
        mockStateChangeCallback
      );

      expect(mockStateChangeCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'running',
          stages: []
        })
      );
    });

    it('should call notify callback with pipeline.started event', async () => {
      await initializer.initialize(
        mockConfig,
        { interactive: false },
        mockNotifyCallback,
        mockStateChangeCallback
      );

      expect(mockNotifyCallback).toHaveBeenCalledWith({
        event: 'pipeline.started',
        pipelineState: expect.objectContaining({
          status: 'running'
        })
      });
    });

    it('should return start time', async () => {
      const beforeTime = Date.now();
      const result = await initializer.initialize(
        mockConfig,
        { interactive: false },
        mockNotifyCallback,
        mockStateChangeCallback
      );
      const afterTime = Date.now();

      expect(result.startTime).toBeGreaterThanOrEqual(beforeTime);
      expect(result.startTime).toBeLessThanOrEqual(afterTime);
    });

    it('should create pipeline logger with interactive=true', async () => {
      const result = await initializer.initialize(
        mockConfig,
        { interactive: true },
        mockNotifyCallback,
        mockStateChangeCallback
      );

      // Should create pipeline logger even in interactive mode (it logs to file)
      expect(result.pipelineLogger).toBeDefined();
      expect(PipelineLogger).toHaveBeenCalledWith('/test/repo', 'test-pipeline', true);
    });

    it('should create pipeline logger with interactive=false', async () => {
      const result = await initializer.initialize(
        mockConfig,
        { interactive: false },
        mockNotifyCallback,
        mockStateChangeCallback
      );

      expect(result.pipelineLogger).toBeDefined();
      expect(PipelineLogger).toHaveBeenCalledWith('/test/repo', 'test-pipeline', false);
    });

    it('should log dry run message via pipeline logger', async () => {
      const dryRunInitializer = new PipelineInitializer(
        mockGitManager,
        '/test/repo',
        true,
        mockRuntime as any
      );

      const result = await dryRunInitializer.initialize(
        mockConfig,
        { interactive: false },
        mockNotifyCallback,
        mockStateChangeCallback
      );

      // Verify pipelineStart was called (dry run message is logged via logger)
      expect(result.pipelineLogger.pipelineStart).toHaveBeenCalled();
      expect(result.pipelineLogger.log).toHaveBeenCalledWith('DRY RUN MODE - No commits will be created');
    });

    it('should store log path in state artifacts', async () => {
      const result = await initializer.initialize(
        mockConfig,
        { interactive: false },
        mockNotifyCallback,
        mockStateChangeCallback
      );

      expect(result.state.artifacts.logPath).toBe('/test/repo/.agent-pipeline/logs/test-pipeline.log');
    });

    it('should use default git branch settings when not specified', async () => {
      const configWithGit = {
        ...mockConfig,
        git: {} // Empty git config - should use defaults
      };

      const result = await initializer.initialize(
        configWithGit,
        { interactive: false },
        mockNotifyCallback,
        mockStateChangeCallback
      );

      // With empty git config, worktree is still set up with default values
      expect(result.worktreePath).toBeDefined();
      expect(result.pipelineBranch).toBe('pipeline/test-pipeline');
    });

    it('should use custom worktree directory when configured', async () => {
      // When a custom worktree directory is configured, a new WorktreeManager instance
      // should be created with that directory. We verify this by checking that
      // setupPipelineWorktree is called (which only happens when worktree isolation is used).
      const setupPipelineWorktreeMock = vi.fn().mockResolvedValue({
        worktreePath: '/custom/worktrees/test-pipeline',
        branchName: 'pipeline/test-pipeline'
      });

      vi.mocked(WorktreeManager).mockImplementation(() => ({
        setupPipelineWorktree: setupPipelineWorktreeMock,
        cleanupWorktree: vi.fn().mockResolvedValue(undefined),
        listPipelineWorktrees: vi.fn().mockResolvedValue([]),
      } as unknown as WorktreeManager));

      const configWithCustomWorktree = {
        ...mockConfig,
        git: {
          baseBranch: 'main',
          branchStrategy: 'reusable' as const,
          worktree: {
            directory: '/custom/worktrees'
          }
        }
      };

      const result = await initializer.initialize(
        configWithCustomWorktree,
        { interactive: false },
        mockNotifyCallback,
        mockStateChangeCallback
      );

      // Verify that setupPipelineWorktree was called (worktree isolation was used)
      expect(setupPipelineWorktreeMock).toHaveBeenCalledWith(
        'test-pipeline',
        expect.any(String), // runId
        'main',
        'reusable',
        'pipeline'
      );
      // Verify the result uses the custom worktree path
      expect(result.worktreePath).toBe('/custom/worktrees/test-pipeline');
    });

    it('should populate loop context in state when loopContext is provided', async () => {
      const loopContext = {
        enabled: true,
        currentIteration: 3,
        maxIterations: 10,
        loopSessionId: 'session-123',
        pipelineSource: 'loop-pending' as const
      };

      const result = await initializer.initialize(
        mockConfig,
        {
          interactive: false,
          loopContext,
          loopSessionId: 'session-123',
          metadata: { sourceType: 'loop-pending' }
        },
        mockNotifyCallback,
        mockStateChangeCallback
      );

      expect(result.state.loopContext).toEqual({
        enabled: true,
        currentIteration: 3,
        maxIterations: 10,
        loopSessionId: 'session-123',
        pipelineSource: 'loop-pending',
        terminationReason: undefined
      });
    });

    it('should use default values for loop context fields when not provided', async () => {
      // Provide minimal loopContext to trigger the enabled: true branch
      const loopContext = {
        enabled: true
      };

      const result = await initializer.initialize(
        mockConfig,
        {
          interactive: false,
          loopContext
        },
        mockNotifyCallback,
        mockStateChangeCallback
      );

      // Should use defaults for missing fields
      expect(result.state.loopContext).toEqual({
        enabled: true,
        currentIteration: 1,  // default
        maxIterations: 100,   // default
        loopSessionId: '',    // default (no loopSessionId passed)
        pipelineSource: 'library',  // default (no metadata passed)
        terminationReason: undefined
      });
    });

    it('should set disabled loop context when loopContext is not provided', async () => {
      const result = await initializer.initialize(
        mockConfig,
        { interactive: false },
        mockNotifyCallback,
        mockStateChangeCallback
      );

      expect(result.state.loopContext).toEqual({
        enabled: false,
        currentIteration: 1,
        maxIterations: 100,
        loopSessionId: '',
        pipelineSource: 'library',
        terminationReason: undefined
      });
    });

    it('should log worktree info in verbose mode', async () => {
      const configWithGit = {
        ...mockConfig,
        git: {
          baseBranch: 'main',
          branchStrategy: 'reusable' as const
        }
      };

      const result = await initializer.initialize(
        configWithGit,
        { interactive: false, verbose: true },
        mockNotifyCallback,
        mockStateChangeCallback
      );

      // Verify verbose logging of worktree info
      expect(result.pipelineLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('Worktree:')
      );
      expect(result.pipelineLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('Branch:')
      );
    });
  });
});
