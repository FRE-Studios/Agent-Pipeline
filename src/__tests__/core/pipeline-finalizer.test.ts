// src/__tests__/core/pipeline-finalizer.test.ts

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PipelineFinalizer } from '../../core/pipeline-finalizer.js';
import { GitManager } from '../../core/git-manager.js';
import { BranchManager } from '../../core/branch-manager.js';
import { PRCreator } from '../../core/pr-creator.js';
import { StateManager } from '../../core/state-manager.js';
import { PipelineConfig, PipelineState } from '../../config/schema.js';

// Mock dependencies
vi.mock('../../core/git-manager.js');
vi.mock('../../core/branch-manager.js');
vi.mock('../../core/worktree-manager.js');
vi.mock('../../core/pr-creator.js');
vi.mock('../../core/state-manager.js');

import { WorktreeManager } from '../../core/worktree-manager.js';

// Hoisted mocks for PipelineFormatter
const { mockPipelineFormatter } = vi.hoisted(() => {
  return {
    mockPipelineFormatter: {
      formatSummary: vi.fn().mockReturnValue('Pipeline Summary Output')
    }
  };
});

vi.mock('../../utils/pipeline-formatter.js', () => ({
  PipelineFormatter: mockPipelineFormatter
}));

describe('PipelineFinalizer', () => {
  let finalizer: PipelineFinalizer;
  let mockGitManager: GitManager;
  let mockBranchManager: BranchManager;
  let mockPRCreator: PRCreator;
  let mockStateManager: StateManager;
  let mockShouldLog: ReturnType<typeof vi.fn>;
  let mockNotifyCallback: ReturnType<typeof vi.fn>;
  let mockStateChangeCallback: ReturnType<typeof vi.fn>;

  const mockConfig: PipelineConfig = {
    name: 'test-pipeline',
    trigger: 'manual',
    agents: []
  };

  const mockState: PipelineState = {
    runId: 'test-run-id',
    pipelineConfig: mockConfig,
    trigger: {
      type: 'manual',
      commitSha: 'abc123',
      timestamp: new Date().toISOString()
    },
    stages: [],
    status: 'running',
    artifacts: {
      initialCommit: 'abc123',
      changedFiles: ['file1.ts'],
      totalDuration: 0
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Re-setup hoisted mock return values after clearAllMocks
    mockPipelineFormatter.formatSummary.mockReturnValue('Pipeline Summary Output');

    // Reset mockState to fresh state (remove any modifications from previous tests)
    mockState.artifacts = {
      initialCommit: 'abc123',
      changedFiles: ['file1.ts'],
      totalDuration: 0,
      handoverDir: '.agent-pipeline/runs/test-run-id'
    };

    mockGitManager = new GitManager('/test/repo');
    mockBranchManager = new BranchManager('/test/repo');
    mockPRCreator = new PRCreator();
    mockStateManager = new StateManager('/test/repo');
    mockShouldLog = vi.fn().mockReturnValue(true);
    mockNotifyCallback = vi.fn().mockResolvedValue(undefined);
    mockStateChangeCallback = vi.fn();

    // Setup WorktreeManager mock
    vi.mocked(WorktreeManager).mockImplementation(() => ({
      cleanupWorktree: vi.fn().mockResolvedValue(undefined),
      listPipelineWorktrees: vi.fn().mockResolvedValue([]),
      setupPipelineWorktree: vi.fn().mockResolvedValue({ worktreePath: '/test/worktree', pipelineBranch: 'pipeline/test' }),
    } as unknown as WorktreeManager));

    // Setup GitManager mock - returns mocked instance for any path
    vi.mocked(GitManager).mockImplementation(() => ({
      getCurrentCommit: vi.fn().mockResolvedValue('def456'),
    } as unknown as GitManager));

    // Setup BranchManager mock - returns mocked instance for any path
    vi.mocked(BranchManager).mockImplementation(() => ({
      pushBranch: vi.fn().mockResolvedValue(undefined),
      checkoutBranch: vi.fn().mockResolvedValue(undefined),
    } as unknown as BranchManager));

    // Setup common mocks
    vi.spyOn(mockGitManager, 'getCurrentCommit').mockResolvedValue('def456');
    vi.spyOn(mockStateManager, 'saveState').mockResolvedValue();
    vi.spyOn(mockBranchManager, 'checkoutBranch').mockResolvedValue();
    vi.spyOn(mockBranchManager, 'pushBranch').mockResolvedValue();

    finalizer = new PipelineFinalizer(
      mockGitManager,
      mockBranchManager,
      mockPRCreator,
      mockStateManager,
      '/test/repo',
      false,
      mockShouldLog
    );
  });

  describe('finalize', () => {
    it('should calculate metrics correctly', async () => {
      const startTime = Date.now() - 5000; // 5 seconds ago

      await finalizer.finalize(
        mockState,
        mockConfig,
        undefined,
        undefined,
        '/test/repo',
        startTime,
        false,
        false,
        mockNotifyCallback,
        mockStateChangeCallback
      );

      expect(mockState.artifacts.totalDuration).toBeGreaterThan(4);
      expect(mockState.artifacts.totalDuration).toBeLessThan(6);
      expect(mockState.artifacts.finalCommit).toBe('def456');
    });

    it('should create PR when configured', async () => {
      vi.spyOn(mockBranchManager, 'pushBranch').mockResolvedValue();
      vi.spyOn(mockPRCreator, 'prExists').mockResolvedValue(false);
      vi.spyOn(mockPRCreator, 'createPR').mockResolvedValue({
        url: 'https://github.com/test/repo/pull/123',
        number: 123
      });

      const configWithPR = {
        ...mockConfig,
        git: {
          baseBranch: 'main',
          mergeStrategy: 'pull-request' as const,
          pullRequest: {
            title: 'Test PR'
          }
        }
      };

      await finalizer.finalize(
        mockState,
        configWithPR,
        'pipeline/test-branch',
        undefined,
        '/test/repo',
        Date.now(),
        false,
        false,
        mockNotifyCallback,
        mockStateChangeCallback
      );

      expect(mockBranchManager.pushBranch).toHaveBeenCalledWith('pipeline/test-branch');
      expect(mockPRCreator.createPR).toHaveBeenCalled();
      expect(mockState.artifacts.pullRequest).toEqual({
        url: 'https://github.com/test/repo/pull/123',
        number: 123,
        branch: 'pipeline/test-branch'
      });
    });

    it('should not create PR if already exists', async () => {
      vi.spyOn(mockBranchManager, 'pushBranch').mockResolvedValue();
      vi.spyOn(mockPRCreator, 'prExists').mockResolvedValue(true);
      vi.spyOn(mockPRCreator, 'createPR').mockResolvedValue({
        url: 'https://github.com/test/repo/pull/123',
        number: 123
      });

      const configWithPR = {
        ...mockConfig,
        git: {
          mergeStrategy: 'pull-request' as const
        }
      };

      await finalizer.finalize(
        mockState,
        configWithPR,
        'pipeline/test-branch',
        undefined,
        '/test/repo',
        Date.now(),
        false,
        false,
        mockNotifyCallback,
        mockStateChangeCallback
      );

      expect(mockPRCreator.createPR).not.toHaveBeenCalled();
    });

    it('should handle PR creation failure gracefully', async () => {
      vi.spyOn(mockBranchManager, 'pushBranch').mockResolvedValue();
      vi.spyOn(mockPRCreator, 'prExists').mockResolvedValue(false);
      vi.spyOn(mockPRCreator, 'createPR').mockRejectedValue(
        new Error('gh command not found')
      );

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const configWithPR = {
        ...mockConfig,
        git: {
          mergeStrategy: 'pull-request' as const
        }
      };

      await finalizer.finalize(
        mockState,
        configWithPR,
        'pipeline/test-branch',
        undefined,
        '/test/repo',
        Date.now(),
        false,
        false,
        mockNotifyCallback,
        mockStateChangeCallback
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to create PR')
      );

      consoleSpy.mockRestore();
    });

    it('should notify completion for completed pipeline', async () => {
      const completedState = { ...mockState, status: 'completed' as const };

      await finalizer.finalize(
        completedState,
        mockConfig,
        undefined,
        undefined,
        '/test/repo',
        Date.now(),
        false,
        false,
        mockNotifyCallback,
        mockStateChangeCallback
      );

      expect(mockNotifyCallback).toHaveBeenCalledWith({
        event: 'pipeline.completed',
        pipelineState: expect.objectContaining({ status: 'completed' }),
        prUrl: undefined
      });
    });

    it('should notify failure for failed pipeline', async () => {
      const failedState = { ...mockState, status: 'failed' as const };

      await finalizer.finalize(
        failedState,
        mockConfig,
        undefined,
        undefined,
        '/test/repo',
        Date.now(),
        false,
        false,
        mockNotifyCallback,
        mockStateChangeCallback
      );

      expect(mockNotifyCallback).toHaveBeenCalledWith({
        event: 'pipeline.failed',
        pipelineState: expect.objectContaining({ status: 'failed' }),
        prUrl: undefined
      });
    });

    it('should save final state', async () => {
      await finalizer.finalize(
        mockState,
        mockConfig,
        undefined,
        undefined,
        '/test/repo',
        Date.now(),
        false,
        false,
        mockNotifyCallback,
        mockStateChangeCallback
      );

      expect(mockStateManager.saveState).toHaveBeenCalled();
    });

    it('should call state change callback', async () => {
      await finalizer.finalize(
        mockState,
        mockConfig,
        undefined,
        undefined,
        '/test/repo',
        Date.now(),
        false,
        false,
        mockNotifyCallback,
        mockStateChangeCallback
      );

      expect(mockStateChangeCallback).toHaveBeenCalled();
    });

    it('should cleanup worktree when worktree was used', async () => {
      await finalizer.finalize(
        mockState,
        mockConfig,
        'pipeline/test-branch',
        '/test/repo/worktree',
        '/test/repo',
        Date.now(),
        false,
        false,
        mockNotifyCallback,
        mockStateChangeCallback
      );

      // Worktree cleanup is now handled internally by the finalizer
      // No need to check for branch checkout anymore
    });

    it('should not cleanup worktree when no worktree was used', async () => {
      await finalizer.finalize(
        mockState,
        mockConfig,
        undefined,
        undefined,
        '/test/repo',
        Date.now(),
        false,
        false,
        mockNotifyCallback,
        mockStateChangeCallback
      );

      // No worktree cleanup needed
    });

    it('should not cleanup worktree in dry run mode', async () => {
      const dryRunFinalizer = new PipelineFinalizer(
        mockGitManager,
        mockBranchManager,
        mockPRCreator,
        mockStateManager,
        '/test/repo',
        true, // dry run
        mockShouldLog
      );

      await dryRunFinalizer.finalize(
        mockState,
        mockConfig,
        'pipeline/test-branch',
        '/test/repo/worktree',
        '/test/repo',
        Date.now(),
        false,
        false,
        mockNotifyCallback,
        mockStateChangeCallback
      );

      // In dry run mode, worktree cleanup is skipped
    });

    it('should print summary in non-interactive mode', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await finalizer.finalize(
        mockState,
        mockConfig,
        undefined,
        undefined,
        '/test/repo',
        Date.now(),
        false, // non-interactive
        false, // verbose
        mockNotifyCallback,
        mockStateChangeCallback
      );

      expect(mockPipelineFormatter.formatSummary).toHaveBeenCalledWith(
        mockState,
        false, // verbose
        { totalProcessed: 0, totalOutput: 0 }
      );
      expect(consoleSpy).toHaveBeenCalledWith('Pipeline Summary Output');

      consoleSpy.mockRestore();
    });

    it('should calculate total tokens including cache_read tokens', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Create state with stages that have token usage including cache_read
      const stateWithTokens: PipelineState = {
        ...mockState,
        stages: [
          {
            stageName: 'stage-1',
            status: 'success',
            startTime: new Date().toISOString(),
            tokenUsage: {
              estimated_input: 1000,
              actual_input: 5000,  // New tokens
              output: 2000,
              cache_read: 10000,  // Cached tokens (should be included in total)
              cache_creation: 3000
            }
          },
          {
            stageName: 'stage-2',
            status: 'success',
            startTime: new Date().toISOString(),
            tokenUsage: {
              estimated_input: 500,
              actual_input: 8000,
              output: 3000,
              cache_read: 5000
            }
          }
        ]
      };

      await finalizer.finalize(
        stateWithTokens,
        mockConfig,
        undefined,
        undefined,
        '/test/repo',
        Date.now(),
        false, // non-interactive
        false, // verbose
        mockNotifyCallback,
        mockStateChangeCallback
      );

      // Stage 1: actual_input (5000) + cache_read (10000) + cache_creation (3000, not included since 5000 < 3000 is false) = 18000
      // Wait, cache_creation check: cacheCreation > 0 && actualInput >= cacheCreation => 3000 > 0 && 5000 >= 3000 = true, so cache_creation IS included
      // So stage 1 = 5000 + 10000 + 0 = 15000
      // Stage 2: actual_input (8000) + cache_read (5000) = 13000
      // Total processed = 15000 + 13000 = 28000
      // Total output = 2000 + 3000 = 5000
      expect(mockPipelineFormatter.formatSummary).toHaveBeenCalledWith(
        stateWithTokens,
        false,
        { totalProcessed: 28000, totalOutput: 5000 }
      );

      consoleSpy.mockRestore();
    });

    it('should not print summary in interactive mode', async () => {
      mockShouldLog.mockReturnValue(false); // Interactive mode

      await finalizer.finalize(
        mockState,
        mockConfig,
        undefined,
        undefined,
        '/test/repo',
        Date.now(),
        true, // interactive
        false, // verbose
        mockNotifyCallback,
        mockStateChangeCallback
      );

      expect(mockPipelineFormatter.formatSummary).not.toHaveBeenCalled();
    });

    it('should notify PR created event when PR is created', async () => {
      vi.spyOn(mockBranchManager, 'pushBranch').mockResolvedValue();
      vi.spyOn(mockPRCreator, 'prExists').mockResolvedValue(false);
      vi.spyOn(mockPRCreator, 'createPR').mockResolvedValue({
        url: 'https://github.com/test/repo/pull/123',
        number: 123
      });

      const configWithPR = {
        ...mockConfig,
        git: {
          mergeStrategy: 'pull-request' as const
        }
      };

      await finalizer.finalize(
        mockState,
        configWithPR,
        'pipeline/test-branch',
        undefined,
        '/test/repo',
        Date.now(),
        false,
        false,
        mockNotifyCallback,
        mockStateChangeCallback
      );

      // Should be called twice: once for pr.created, once for pipeline.completed/failed
      expect(mockNotifyCallback).toHaveBeenCalledWith({
        event: 'pr.created',
        pipelineState: expect.any(Object),
        prUrl: 'https://github.com/test/repo/pull/123'
      });
    });
  });
});
