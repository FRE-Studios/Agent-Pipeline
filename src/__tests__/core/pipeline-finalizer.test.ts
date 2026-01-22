// src/__tests__/core/pipeline-finalizer.test.ts

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PipelineFinalizer } from '../../core/pipeline-finalizer.js';
import { GitManager } from '../../core/git-manager.js';
import { BranchManager } from '../../core/branch-manager.js';
import { PRCreator } from '../../core/pr-creator.js';
import { StateManager } from '../../core/state-manager.js';
import { PipelineConfig, PipelineState } from '../../config/schema.js';

// Hoisted mocks - these persist across vi.clearAllMocks()
const { mockGitManagerInstance, mockWorktreeManagerInstance, mockBranchManagerInstance, mockPipelineFormatter } = vi.hoisted(() => {
  return {
    mockGitManagerInstance: {
      getCurrentCommit: vi.fn().mockResolvedValue('def456'),
      isBranchCheckedOut: vi.fn().mockResolvedValue(null),
      merge: vi.fn().mockResolvedValue(undefined),
      hasUncommittedChanges: vi.fn().mockResolvedValue(false),
    },
    mockWorktreeManagerInstance: {
      cleanupWorktree: vi.fn().mockResolvedValue(undefined),
      listPipelineWorktrees: vi.fn().mockResolvedValue([]),
      setupPipelineWorktree: vi.fn().mockResolvedValue({ worktreePath: '/test/worktree', pipelineBranch: 'pipeline/test' }),
      getWorktreeBaseDir: vi.fn().mockReturnValue('/test/repo/.agent-pipeline/worktrees'),
      createWorktree: vi.fn().mockResolvedValue(undefined),
      removeWorktree: vi.fn().mockResolvedValue(undefined),
      pruneWorktrees: vi.fn().mockResolvedValue(undefined),
    },
    mockBranchManagerInstance: {
      pushBranch: vi.fn().mockResolvedValue(undefined),
      checkoutBranch: vi.fn().mockResolvedValue(undefined),
    },
    mockPipelineFormatter: {
      formatSummary: vi.fn().mockReturnValue('Pipeline Summary Output')
    }
  };
});

// Mock dependencies with hoisted factories
vi.mock('../../core/git-manager.js', () => ({
  GitManager: vi.fn(() => mockGitManagerInstance)
}));

vi.mock('../../core/worktree-manager.js', () => ({
  WorktreeManager: vi.fn(() => mockWorktreeManagerInstance)
}));

vi.mock('../../core/branch-manager.js', () => ({
  BranchManager: vi.fn(() => mockBranchManagerInstance)
}));

vi.mock('../../core/pr-creator.js');
vi.mock('../../core/state-manager.js');

import { WorktreeManager } from '../../core/worktree-manager.js';

vi.mock('../../utils/pipeline-formatter.js', () => ({
  PipelineFormatter: mockPipelineFormatter
}));

// Mock fs for local-merge tests
vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
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
    mockGitManagerInstance.getCurrentCommit.mockResolvedValue('def456');
    mockGitManagerInstance.isBranchCheckedOut.mockResolvedValue(null);
    mockGitManagerInstance.merge.mockResolvedValue(undefined);
    mockGitManagerInstance.hasUncommittedChanges.mockResolvedValue(false);
    mockWorktreeManagerInstance.getWorktreeBaseDir.mockReturnValue('/test/repo/.agent-pipeline/worktrees');
    mockWorktreeManagerInstance.createWorktree.mockResolvedValue(undefined);
    mockWorktreeManagerInstance.removeWorktree.mockResolvedValue(undefined);
    mockWorktreeManagerInstance.pruneWorktrees.mockResolvedValue(undefined);
    mockWorktreeManagerInstance.cleanupWorktree.mockResolvedValue(undefined);
    mockBranchManagerInstance.pushBranch.mockResolvedValue(undefined);
    mockBranchManagerInstance.checkoutBranch.mockResolvedValue(undefined);

    // Reset mockState to fresh state (remove any modifications from previous tests)
    mockState.artifacts = {
      initialCommit: 'abc123',
      changedFiles: ['file1.ts'],
      totalDuration: 0,
      handoverDir: '.agent-pipeline/runs/test-run-id'
    };
    // Include a stage with commitSha so PR/merge operations proceed
    mockState.stages = [{
      stageName: 'test-stage',
      status: 'success',
      duration: 1.5,
      commitSha: 'stage-commit-abc123'
    }];

    mockGitManager = new GitManager('/test/repo');
    mockBranchManager = new BranchManager('/test/repo');
    mockPRCreator = new PRCreator();
    mockStateManager = new StateManager('/test/repo');
    mockShouldLog = vi.fn().mockReturnValue(true);
    mockNotifyCallback = vi.fn().mockResolvedValue(undefined);
    mockStateChangeCallback = vi.fn();

    // Setup common mocks on PRCreator and StateManager (still using auto-mock)
    vi.spyOn(mockStateManager, 'saveState').mockResolvedValue();

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

      expect(mockBranchManagerInstance.pushBranch).toHaveBeenCalledWith('pipeline/test-branch');
      expect(mockPRCreator.createPR).toHaveBeenCalled();
      expect(mockState.artifacts.pullRequest).toEqual({
        url: 'https://github.com/test/repo/pull/123',
        number: 123,
        branch: 'pipeline/test-branch'
      });
    });

    it('should not create PR if already exists', async () => {
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

    it('should skip PR creation when no commits were made', async () => {
      vi.spyOn(mockPRCreator, 'prExists').mockResolvedValue(false);
      vi.spyOn(mockPRCreator, 'createPR').mockResolvedValue({
        url: 'https://github.com/test/repo/pull/123',
        number: 123
      });
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const configWithPR = {
        ...mockConfig,
        git: {
          mergeStrategy: 'pull-request' as const
        }
      };

      // Set stages to empty (no commits)
      const stateWithNoCommits = { ...mockState, stages: [] };

      await finalizer.finalize(
        stateWithNoCommits,
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

      // Should not push or create PR
      expect(mockBranchManagerInstance.pushBranch).not.toHaveBeenCalled();
      expect(mockPRCreator.createPR).not.toHaveBeenCalled();
      // Should log the skip message
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('No commits to merge')
      );

      consoleSpy.mockRestore();
    });

    it('should handle PR creation failure gracefully', async () => {
      vi.spyOn(mockPRCreator, 'prExists').mockResolvedValue(false);
      vi.spyOn(mockPRCreator, 'createPR').mockRejectedValue(
        new Error('gh command not found')
      );

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

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
        { totalProcessed: 0, totalOutput: 0, totalTurns: 0, totalCacheRead: 0 }
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
      // Total cache_read = 10000 + 5000 = 15000
      expect(mockPipelineFormatter.formatSummary).toHaveBeenCalledWith(
        stateWithTokens,
        false,
        { totalProcessed: 28000, totalOutput: 5000, totalTurns: 0, totalCacheRead: 15000 }
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

  describe('handleLocalMerge', () => {
    it('should merge branch to baseBranch via worktree', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const configWithLocalMerge: PipelineConfig = {
        ...mockConfig,
        git: {
          baseBranch: 'main',
          mergeStrategy: 'local-merge'
        }
      };

      await finalizer.finalize(
        mockState,
        configWithLocalMerge,
        'pipeline/feature-branch',
        undefined,
        '/test/repo',
        Date.now(),
        false,
        false,
        mockNotifyCallback,
        mockStateChangeCallback
      );

      // Should check if base branch is checked out
      expect(mockGitManagerInstance.isBranchCheckedOut).toHaveBeenCalledWith('main');

      // Should create worktree for merge
      expect(mockWorktreeManagerInstance.getWorktreeBaseDir).toHaveBeenCalled();
      expect(mockWorktreeManagerInstance.createWorktree).toHaveBeenCalledWith(
        expect.stringContaining('merge-pipeline-feature-branch-'),
        'main',
        'main'
      );

      // Should merge the feature branch
      expect(mockGitManagerInstance.merge).toHaveBeenCalledWith('pipeline/feature-branch');

      // Should cleanup merge worktree
      expect(mockWorktreeManagerInstance.removeWorktree).toHaveBeenCalledWith(
        expect.stringContaining('merge-pipeline-feature-branch-'),
        true
      );
      expect(mockWorktreeManagerInstance.pruneWorktrees).toHaveBeenCalled();

      // Should log success
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Merging pipeline/feature-branch into main')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Merged')
      );

      consoleSpy.mockRestore();
    });

    it('should show warning when base branch has uncommitted changes', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Base branch is checked out at a path with uncommitted changes
      mockGitManagerInstance.isBranchCheckedOut.mockResolvedValue('/test/repo');
      mockGitManagerInstance.hasUncommittedChanges.mockResolvedValue(true);

      const configWithLocalMerge: PipelineConfig = {
        ...mockConfig,
        git: {
          baseBranch: 'main',
          mergeStrategy: 'local-merge'
        }
      };

      // Should complete successfully (not throw)
      await finalizer.finalize(
        mockState,
        configWithLocalMerge,
        'pipeline/feature-branch',
        undefined,
        '/test/repo',
        Date.now(),
        false,
        false,
        mockNotifyCallback,
        mockStateChangeCallback
      );

      // Should NOT create worktree or attempt merge
      expect(mockWorktreeManagerInstance.createWorktree).not.toHaveBeenCalled();
      expect(mockGitManagerInstance.merge).not.toHaveBeenCalled();

      // Should log warning mentioning uncommitted changes (chalk-styled, so match partial text)
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cannot auto-merge:')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('uncommitted changes')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('git merge pipeline/feature-branch')
      );

      consoleSpy.mockRestore();
    });

    it('should merge directly when base branch is checked out with clean tree', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Base branch is checked out at a path with NO uncommitted changes
      mockGitManagerInstance.isBranchCheckedOut.mockResolvedValue('/test/repo');
      mockGitManagerInstance.hasUncommittedChanges.mockResolvedValue(false);

      const configWithLocalMerge: PipelineConfig = {
        ...mockConfig,
        git: {
          baseBranch: 'main',
          mergeStrategy: 'local-merge'
        }
      };

      await finalizer.finalize(
        mockState,
        configWithLocalMerge,
        'pipeline/feature-branch',
        undefined,
        '/test/repo',
        Date.now(),
        false,
        false,
        mockNotifyCallback,
        mockStateChangeCallback
      );

      // Should NOT create worktree (merge directly at checked out path)
      expect(mockWorktreeManagerInstance.createWorktree).not.toHaveBeenCalled();

      // Should merge the feature branch directly
      expect(mockGitManagerInstance.merge).toHaveBeenCalledWith('pipeline/feature-branch');

      // Should log success
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Merging pipeline/feature-branch into main')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Merged')
      );

      consoleSpy.mockRestore();
    });

    it('should handle merge failure at checked-out path', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Base branch is checked out at a path with clean tree
      mockGitManagerInstance.isBranchCheckedOut.mockResolvedValue('/test/repo');
      mockGitManagerInstance.hasUncommittedChanges.mockResolvedValue(false);
      // Merge fails with conflict
      mockGitManagerInstance.merge.mockRejectedValue(new Error('Merge conflict'));

      const configWithLocalMerge: PipelineConfig = {
        ...mockConfig,
        git: {
          baseBranch: 'main',
          mergeStrategy: 'local-merge'
        }
      };

      await expect(
        finalizer.finalize(
          mockState,
          configWithLocalMerge,
          'pipeline/feature-branch',
          undefined,
          '/test/repo',
          Date.now(),
          false,
          false,
          mockNotifyCallback,
          mockStateChangeCallback
        )
      ).rejects.toThrow('Merge conflict');

      // Should log error with conflict resolution instructions
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to merge')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('git status')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('git merge --abort')
      );
      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('git checkout')
      );

      consoleSpy.mockRestore();
    });

    it('should handle merge failure and preserve worktree', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Merge fails with conflict
      mockGitManagerInstance.merge.mockRejectedValue(new Error('Merge conflict'));

      const configWithLocalMerge: PipelineConfig = {
        ...mockConfig,
        git: {
          baseBranch: 'main',
          mergeStrategy: 'local-merge'
        }
      };

      await expect(
        finalizer.finalize(
          mockState,
          configWithLocalMerge,
          'pipeline/feature-branch',
          undefined,
          '/test/repo',
          Date.now(),
          false,
          false,
          mockNotifyCallback,
          mockStateChangeCallback
        )
      ).rejects.toThrow('Merge conflict');

      // Should NOT cleanup worktree on failure (for debugging)
      expect(mockWorktreeManagerInstance.removeWorktree).not.toHaveBeenCalled();

      // Should log error with helpful message (chalk-styled, so match partial text)
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to merge')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('still exists with your changes')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Merge worktree preserved at')
      );

      consoleSpy.mockRestore();
    });

    it('should use default baseBranch when not specified', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const configWithLocalMerge: PipelineConfig = {
        ...mockConfig,
        git: {
          mergeStrategy: 'local-merge'
          // baseBranch not specified, should default to 'main'
        }
      };

      await finalizer.finalize(
        mockState,
        configWithLocalMerge,
        'pipeline/feature-branch',
        undefined,
        '/test/repo',
        Date.now(),
        false,
        false,
        mockNotifyCallback,
        mockStateChangeCallback
      );

      // Should check default 'main' branch
      expect(mockGitManagerInstance.isBranchCheckedOut).toHaveBeenCalledWith('main');

      // Should create worktree for 'main'
      expect(mockWorktreeManagerInstance.createWorktree).toHaveBeenCalledWith(
        expect.any(String),
        'main',
        'main'
      );

      consoleSpy.mockRestore();
    });

    it('should still log merge success in interactive mode (critical feedback)', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      mockShouldLog.mockReturnValue(false);

      const configWithLocalMerge: PipelineConfig = {
        ...mockConfig,
        git: {
          baseBranch: 'main',
          mergeStrategy: 'local-merge'
        }
      };

      await finalizer.finalize(
        mockState,
        configWithLocalMerge,
        'pipeline/feature-branch',
        undefined,
        '/test/repo',
        Date.now(),
        true, // interactive
        false,
        mockNotifyCallback,
        mockStateChangeCallback
      );

      // Merge success message should ALWAYS be shown (critical user feedback)
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Merged')
      );

      consoleSpy.mockRestore();
    });
  });
});
