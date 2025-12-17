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
vi.mock('../../core/handover-manager.js');
vi.mock('../../core/stage-executor.js');
vi.mock('../../core/parallel-executor.js');
vi.mock('../../notifications/notification-manager.js');

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

    initializer = new PipelineInitializer(
      mockGitManager,
      mockBranchManager,
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

    it('should save original branch', async () => {
      const result = await initializer.initialize(
        mockConfig,
        { interactive: false },
        mockNotifyCallback,
        mockStateChangeCallback
      );

      expect(result.originalBranch).toBe('main');
      expect(mockBranchManager.getCurrentBranch).toHaveBeenCalled();
    });

    it('should setup pipeline branch when git config exists', async () => {
      const configWithGit = {
        ...mockConfig,
        git: {
          baseBranch: 'develop',
          branchStrategy: 'reusable' as const,
          branchPrefix: 'pipeline'
        }
      };

      vi.spyOn(mockBranchManager, 'setupPipelineBranch').mockResolvedValue('pipeline/test-pipeline');

      const result = await initializer.initialize(
        configWithGit,
        { interactive: false },
        mockNotifyCallback,
        mockStateChangeCallback
      );

      expect(result.pipelineBranch).toBe('pipeline/test-pipeline');
      expect(mockBranchManager.setupPipelineBranch).toHaveBeenCalledWith(
        'test-pipeline',
        expect.any(String), // runId
        'develop',
        'reusable',
        'pipeline'
      );
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

    it('should not setup branch in dry run mode', async () => {
      const dryRunInitializer = new PipelineInitializer(
        mockGitManager,
        mockBranchManager,
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

      // StageExecutor constructor: (gitManager, dryRun, handoverManager, defaultRuntime?, loopContext?)
      expect(stageExecutorMock).toHaveBeenCalledWith(
        mockGitManager,
        false,  // dryRun
        expect.any(Object),  // handoverManager
        expect.any(Object),  // defaultRuntime (the runtime passed to PipelineInitializer)
        undefined  // loopContext (not provided in this test)
      );
      expect(result.stageExecutor).toBe(stageExecutorMock.mock.instances[0]);

      expect(parallelExecutorMock).toHaveBeenCalledWith(
        result.stageExecutor,
        mockStateChangeCallback
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

    it('should handle interactive mode (suppress logs)', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await initializer.initialize(
        mockConfig,
        { interactive: true },
        mockNotifyCallback,
        mockStateChangeCallback
      );

      // Should not log startup messages in interactive mode
      expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('🚀 Starting pipeline'));

      consoleSpy.mockRestore();
    });

    it('should log startup messages in non-interactive mode', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await initializer.initialize(
        mockConfig,
        { interactive: false },
        mockNotifyCallback,
        mockStateChangeCallback
      );

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('🚀 Starting pipeline: test-pipeline'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('📦 Run ID:'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('📝 Trigger commit:'));

      consoleSpy.mockRestore();
    });

    it('should log dry run message when enabled', async () => {
      const dryRunInitializer = new PipelineInitializer(
        mockGitManager,
        mockBranchManager,
        '/test/repo',
        true,
        mockRuntime as any
      );

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await dryRunInitializer.initialize(
        mockConfig,
        { interactive: false },
        mockNotifyCallback,
        mockStateChangeCallback
      );

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('🧪 DRY RUN MODE'));

      consoleSpy.mockRestore();
    });

    it('should use default git branch settings when not specified', async () => {
      const configWithGit = {
        ...mockConfig,
        git: {} // Empty git config
      };

      vi.spyOn(mockBranchManager, 'setupPipelineBranch').mockResolvedValue('pipeline/test-pipeline');

      await initializer.initialize(
        configWithGit,
        { interactive: false },
        mockNotifyCallback,
        mockStateChangeCallback
      );

      expect(mockBranchManager.setupPipelineBranch).toHaveBeenCalledWith(
        'test-pipeline',
        expect.any(String),
        'main', // default baseBranch
        'reusable', // default branchStrategy
        'pipeline' // default branchPrefix
      );
    });
  });
});
