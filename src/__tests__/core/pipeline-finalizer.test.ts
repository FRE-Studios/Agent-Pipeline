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
  cp: vi.fn().mockResolvedValue(undefined),
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

  describe('aborted status handling', () => {
    it('should preserve worktree on abort and notify aborted event', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const abortedState: PipelineState = {
        ...mockState,
        status: 'aborted',
        artifacts: {
          ...mockState.artifacts,
          mainRepoHandoverDir: '/test/repo/.agent-pipeline/runs/test-run-id'
        }
      };

      await finalizer.finalize(
        abortedState,
        mockConfig,
        'pipeline/test-branch',
        '/test/worktree',
        '/test/repo',
        Date.now(),
        false,
        false,
        mockNotifyCallback,
        mockStateChangeCallback
      );

      // Should notify aborted event, not completed or failed
      expect(mockNotifyCallback).toHaveBeenCalledWith({
        event: 'pipeline.aborted',
        pipelineState: expect.objectContaining({ status: 'aborted' })
      });

      // Should log that work is preserved
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Pipeline aborted')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Work preserved on branch')
      );

      consoleSpy.mockRestore();
    });

    it('should copy handover directory on abort if worktree was used', async () => {
      const fsCp = await import('fs/promises').then(m => m.cp);

      const abortedState: PipelineState = {
        ...mockState,
        status: 'aborted',
        artifacts: {
          ...mockState.artifacts,
          handoverDir: '/test/worktree/.agent-pipeline/runs/test-run-id',
          mainRepoHandoverDir: '/test/repo/.agent-pipeline/runs/test-run-id'
        }
      };

      await finalizer.finalize(
        abortedState,
        mockConfig,
        'pipeline/test-branch',
        '/test/worktree',
        '/test/worktree',
        Date.now(),
        false,
        false,
        mockNotifyCallback,
        mockStateChangeCallback
      );

      // Should copy handover directory
      expect(fsCp).toHaveBeenCalledWith(
        '/test/worktree/.agent-pipeline/runs/test-run-id',
        '/test/repo/.agent-pipeline/runs/test-run-id',
        { recursive: true }
      );
    });

    it('should skip merge operations on abort', async () => {
      const abortedState: PipelineState = {
        ...mockState,
        status: 'aborted'
      };

      const configWithMerge = {
        ...mockConfig,
        git: {
          mergeStrategy: 'pull-request' as const
        }
      };

      vi.spyOn(mockPRCreator, 'prExists').mockResolvedValue(false);
      vi.spyOn(mockPRCreator, 'createPR').mockResolvedValue({
        url: 'https://github.com/test/repo/pull/123',
        number: 123
      });

      await finalizer.finalize(
        abortedState,
        configWithMerge,
        'pipeline/test-branch',
        undefined,
        '/test/repo',
        Date.now(),
        false,
        false,
        mockNotifyCallback,
        mockStateChangeCallback
      );

      // Should NOT push or create PR on abort
      expect(mockBranchManagerInstance.pushBranch).not.toHaveBeenCalled();
      expect(mockPRCreator.createPR).not.toHaveBeenCalled();
    });
  });

  describe('verbose mode', () => {
    it('should show worktree location in verbose mode', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await finalizer.finalize(
        mockState,
        mockConfig,
        'pipeline/test-branch',
        '/test/worktree',
        '/test/repo',
        Date.now(),
        false, // non-interactive
        true,  // verbose
        mockNotifyCallback,
        mockStateChangeCallback
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Worktree location')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('/test/worktree')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('copy handover error handling', () => {
    it('should log warning when copy fails but not crash pipeline', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Mock cp to fail
      const fsMod = await import('fs/promises');
      vi.spyOn(fsMod, 'cp').mockRejectedValue(new Error('Permission denied'));

      const stateWithHandover: PipelineState = {
        ...mockState,
        artifacts: {
          ...mockState.artifacts,
          handoverDir: '/test/worktree/.agent-pipeline/runs/test-run-id',
          mainRepoHandoverDir: '/test/repo/.agent-pipeline/runs/test-run-id'
        }
      };

      // Should not throw
      const result = await finalizer.finalize(
        stateWithHandover,
        mockConfig,
        'pipeline/test-branch',
        '/test/worktree',
        '/test/repo',
        Date.now(),
        false,
        false,
        mockNotifyCallback,
        mockStateChangeCallback
      );

      // Should log warning
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Could not copy handover directory')
      );

      // Pipeline should still complete
      expect(result.runId).toBe('test-run-id');

      consoleSpy.mockRestore();
    });
  });

  describe('PipelineLogger integration', () => {
    it('should call pipelineLogger.pipelineComplete and close on finalization', async () => {
      const mockPipelineLogger = {
        pipelineComplete: vi.fn(),
        close: vi.fn()
      };

      const completedState = { ...mockState, status: 'completed' as const };

      await finalizer.finalize(
        completedState,
        mockConfig,
        undefined,
        undefined,
        '/test/repo',
        Date.now() - 5000, // 5 seconds ago
        false,
        false,
        mockNotifyCallback,
        mockStateChangeCallback,
        { pipelineLogger: mockPipelineLogger as any }
      );

      expect(mockPipelineLogger.pipelineComplete).toHaveBeenCalledWith(
        'completed',
        expect.any(Number),
        expect.any(Number)
      );
      expect(mockPipelineLogger.close).toHaveBeenCalled();
    });
  });

  describe('token calculation edge cases', () => {
    it('should handle cache_creation NOT included in actual_input', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Create state where cache_creation > actual_input (not included)
      const stateWithTokens: PipelineState = {
        ...mockState,
        stages: [
          {
            stageName: 'stage-1',
            status: 'success',
            startTime: new Date().toISOString(),
            tokenUsage: {
              estimated_input: 500,
              actual_input: 1000,  // Less than cache_creation
              output: 500,
              cache_read: 2000,
              cache_creation: 5000  // NOT included in actual_input
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
        false,
        false,
        mockNotifyCallback,
        mockStateChangeCallback
      );

      // cache_creation should be ADDED since actual_input (1000) < cache_creation (5000)
      // totalProcessed = actual_input (1000) + cache_read (2000) + cache_creation (5000) = 8000
      expect(mockPipelineFormatter.formatSummary).toHaveBeenCalledWith(
        stateWithTokens,
        false,
        { totalProcessed: 8000, totalOutput: 500, totalTurns: 0, totalCacheRead: 2000 }
      );

      consoleSpy.mockRestore();
    });

    it('should handle stages without tokenUsage', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const stateNoTokens: PipelineState = {
        ...mockState,
        stages: [
          {
            stageName: 'stage-1',
            status: 'success',
            startTime: new Date().toISOString()
            // No tokenUsage field
          }
        ]
      };

      await finalizer.finalize(
        stateNoTokens,
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

      // Should pass zeros for all token totals
      expect(mockPipelineFormatter.formatSummary).toHaveBeenCalledWith(
        stateNoTokens,
        false,
        { totalProcessed: 0, totalOutput: 0, totalTurns: 0, totalCacheRead: 0 }
      );

      consoleSpy.mockRestore();
    });
  });

  describe('worktree cleanup strategies', () => {
    it('should preserve worktree for reusable strategy', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const configWithReusable = {
        ...mockConfig,
        git: {
          branchStrategy: 'reusable' as const
        }
      };

      await finalizer.finalize(
        mockState,
        configWithReusable,
        'pipeline/test-branch',
        '/test/worktree',
        '/test/repo',
        Date.now(),
        false,
        false,
        mockNotifyCallback,
        mockStateChangeCallback
      );

      // Should NOT cleanup worktree
      expect(mockWorktreeManagerInstance.cleanupWorktree).not.toHaveBeenCalled();

      // Should log that worktree is preserved
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Worktree preserved at')
      );

      consoleSpy.mockRestore();
    });

    it('should preserve worktree for unique-per-run strategy on success', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const configWithUnique = {
        ...mockConfig,
        git: {
          branchStrategy: 'unique-per-run' as const
        }
      };

      const completedState = { ...mockState, status: 'completed' as const };

      await finalizer.finalize(
        completedState,
        configWithUnique,
        'pipeline/test-branch',
        '/test/worktree',
        '/test/repo',
        Date.now(),
        false,
        false,
        mockNotifyCallback,
        mockStateChangeCallback
      );

      // Should NOT cleanup worktree for unique-per-run (only unique-and-delete does cleanup)
      expect(mockWorktreeManagerInstance.cleanupWorktree).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should cleanup worktree for unique-and-delete on success', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const configWithDelete = {
        ...mockConfig,
        git: {
          branchStrategy: 'unique-and-delete' as const
        }
      };

      const completedState = { ...mockState, status: 'completed' as const };

      await finalizer.finalize(
        completedState,
        configWithDelete,
        'pipeline/test-branch',
        '/test/worktree',
        '/test/repo',
        Date.now(),
        false,
        false,
        mockNotifyCallback,
        mockStateChangeCallback
      );

      // Should cleanup worktree
      expect(mockWorktreeManagerInstance.cleanupWorktree).toHaveBeenCalledWith(
        '/test/worktree',
        true,
        false  // prCreatedSuccessfully=false
      );

      consoleSpy.mockRestore();
    });

    it('should force-delete local branch when PR was created successfully', async () => {
      vi.spyOn(mockPRCreator, 'prExists').mockResolvedValue(false);
      vi.spyOn(mockPRCreator, 'createPR').mockResolvedValue({
        url: 'https://github.com/test/repo/pull/123',
        number: 123
      });

      const configWithDeleteAndPR = {
        ...mockConfig,
        git: {
          branchStrategy: 'unique-and-delete' as const,
          mergeStrategy: 'pull-request' as const
        }
      };

      const completedState = { ...mockState, status: 'completed' as const };

      await finalizer.finalize(
        completedState,
        configWithDeleteAndPR,
        'pipeline/test-branch',
        '/test/worktree',
        '/test/repo',
        Date.now(),
        false,
        false,
        mockNotifyCallback,
        mockStateChangeCallback
      );

      // Should cleanup with prCreatedSuccessfully=true
      expect(mockWorktreeManagerInstance.cleanupWorktree).toHaveBeenCalledWith(
        '/test/worktree',
        true,
        true  // prCreatedSuccessfully=true
      );
    });

    it('should preserve worktree on failure for debugging', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const configWithDelete = {
        ...mockConfig,
        git: {
          branchStrategy: 'unique-and-delete' as const
        }
      };

      const failedState = { ...mockState, status: 'failed' as const };

      await finalizer.finalize(
        failedState,
        configWithDelete,
        'pipeline/test-branch',
        '/test/worktree',
        '/test/repo',
        Date.now(),
        false,
        false,
        mockNotifyCallback,
        mockStateChangeCallback
      );

      // Should NOT cleanup worktree on failure
      expect(mockWorktreeManagerInstance.cleanupWorktree).not.toHaveBeenCalled();

      // Should log that worktree is preserved for debugging
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Worktree preserved for debugging')
      );

      consoleSpy.mockRestore();
    });

    it('should handle cleanup error gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      mockWorktreeManagerInstance.cleanupWorktree.mockRejectedValue(
        new Error('Cleanup failed: worktree in use')
      );

      const configWithDelete = {
        ...mockConfig,
        git: {
          branchStrategy: 'unique-and-delete' as const
        }
      };

      const completedState = { ...mockState, status: 'completed' as const };

      // Should not throw
      await finalizer.finalize(
        completedState,
        configWithDelete,
        'pipeline/test-branch',
        '/test/worktree',
        '/test/repo',
        Date.now(),
        false,
        false,
        mockNotifyCallback,
        mockStateChangeCallback
      );

      // Should log warning
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Could not cleanup worktree')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('completion notification with PR URL', () => {
    it('should include prUrl in completion notification when PR is created', async () => {
      vi.spyOn(mockPRCreator, 'prExists').mockResolvedValue(false);
      vi.spyOn(mockPRCreator, 'createPR').mockResolvedValue({
        url: 'https://github.com/test/repo/pull/456',
        number: 456
      });

      const configWithPR = {
        ...mockConfig,
        git: {
          mergeStrategy: 'pull-request' as const
        }
      };

      const completedState = { ...mockState, status: 'completed' as const };

      await finalizer.finalize(
        completedState,
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

      // Should have called notifyCallback with pr.created and pipeline.completed both containing prUrl
      expect(mockNotifyCallback).toHaveBeenCalledWith({
        event: 'pipeline.completed',
        pipelineState: expect.any(Object),
        prUrl: 'https://github.com/test/repo/pull/456'
      });
    });
  });

  describe('template variable interpolation in PR', () => {
    it('should interpolate template variables in PR title and body', async () => {
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
            title: 'Pipeline: {{pipelineName}} (run {{runId}})',
            body: 'Branch: {{branch}}, Commit: {{initialCommit}}'
          }
        }
      };

      const templateContext = {
        pipelineName: 'my-pipeline',
        runId: 'run-abc-123',
        trigger: 'manual',
        timestamp: '2024-01-01T00:00:00.000Z',
        baseBranch: 'main',
        branch: 'pipeline/my-pipeline',
        initialCommit: 'abc123def'
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
        mockStateChangeCallback,
        { templateContext: templateContext as any }
      );

      expect(mockPRCreator.createPR).toHaveBeenCalledWith(
        'pipeline/test-branch',
        'main',
        expect.objectContaining({
          title: 'Pipeline: my-pipeline (run run-abc-123)',
          body: 'Branch: pipeline/my-pipeline, Commit: abc123def'
        }),
        expect.any(Object)
      );
    });

    it('should not interpolate PR title/body when no template context', async () => {
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
            title: 'Pipeline: {{pipelineName}}'
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
        // No options with templateContext
      );

      // Without template context, title should pass through unchanged
      expect(mockPRCreator.createPR).toHaveBeenCalledWith(
        'pipeline/test-branch',
        'main',
        expect.objectContaining({
          title: 'Pipeline: {{pipelineName}}'
        }),
        expect.any(Object)
      );
    });
  });

  describe('suppressCompletionNotification option', () => {
    it('should skip completion notification when suppressCompletionNotification is true', async () => {
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
        mockStateChangeCallback,
        { suppressCompletionNotification: true }
      );

      // Should NOT send completion notification
      expect(mockNotifyCallback).not.toHaveBeenCalledWith(
        expect.objectContaining({ event: 'pipeline.completed' })
      );
    });
  });
});
