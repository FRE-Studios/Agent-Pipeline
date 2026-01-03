
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PipelineFinalizer } from '../../core/pipeline-finalizer.js';
import { GitManager } from '../../core/git-manager.js';
import { BranchManager } from '../../core/branch-manager.js';
import { PRCreator } from '../../core/pr-creator.js';
import { StateManager } from '../../core/state-manager.js';
import { PipelineConfig, PipelineState } from '../../config/schema.js';
import { WorktreeManager } from '../../core/worktree-manager.js';

// Hoisted mocks
const { mockGitManagerInstance, mockWorktreeManagerInstance, mockBranchManagerInstance, mockPipelineFormatter } = vi.hoisted(() => {
  return {
    mockGitManagerInstance: {
      getCurrentCommit: vi.fn().mockResolvedValue('def456'),
      isBranchCheckedOut: vi.fn().mockResolvedValue(null),
      merge: vi.fn().mockResolvedValue(undefined),
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

// Mock dependencies
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
vi.mock('../../utils/pipeline-formatter.js', () => ({
  PipelineFormatter: mockPipelineFormatter
}));

vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

describe('PipelineFinalizer Integration', () => {
  let finalizer: PipelineFinalizer;
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
    stages: [{
      stageName: 'test-stage',
      status: 'success',
      duration: 1.5,
      commitSha: 'stage-commit-abc123'
    }],
    status: 'completed', // Important: status must be completed for cleanup
    artifacts: {
      initialCommit: 'abc123',
      changedFiles: ['file1.ts'],
      totalDuration: 0,
      handoverDir: '.agent-pipeline/runs/test-run-id'
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset mocks
    mockGitManagerInstance.isBranchCheckedOut.mockResolvedValue(null);
    mockGitManagerInstance.merge.mockResolvedValue(undefined);
    
    mockStateManager = new StateManager('/test/repo');
    mockShouldLog = vi.fn().mockReturnValue(true);
    mockNotifyCallback = vi.fn().mockResolvedValue(undefined);
    mockStateChangeCallback = vi.fn();

    vi.spyOn(mockStateManager, 'saveState').mockResolvedValue();

    finalizer = new PipelineFinalizer(
      new GitManager('/test/repo'),
      new BranchManager('/test/repo'),
      new PRCreator(),
      mockStateManager,
      '/test/repo',
      false,
      mockShouldLog
    );
  });

  it('should merge locally and then delete branch when using unique-and-delete strategy', async () => {
    const config: PipelineConfig = {
      ...mockConfig,
      git: {
        branchStrategy: 'unique-and-delete',
        mergeStrategy: 'local-merge',
        baseBranch: 'main'
      }
    };

    const branchName = 'pipeline/test-pipeline/abc12345';
    const worktreePath = '/test/repo/.agent-pipeline/worktrees/test-pipeline-abc12345';

    await finalizer.finalize(
      mockState,
      config,
      branchName,
      worktreePath,
      '/test/repo',
      Date.now(),
      false,
      false,
      mockNotifyCallback,
      mockStateChangeCallback
    );

    // 1. Verify Merge Happened
    expect(mockGitManagerInstance.merge).toHaveBeenCalledWith(branchName);
    
    // 2. Verify Worktree Cleanup with Delete Branch
    // cleanupWorktree(worktreePath, deleteBranch, force)
    // For unique-and-delete, deleteBranch should be true
    expect(mockWorktreeManagerInstance.cleanupWorktree).toHaveBeenCalledWith(
      worktreePath,
      true, // deleteBranch
      false // force
    );

    // 3. Verify Order (Merge before Cleanup)
    const mergeCallOrder = mockGitManagerInstance.merge.mock.invocationCallOrder[0];
    const cleanupCallOrder = mockWorktreeManagerInstance.cleanupWorktree.mock.invocationCallOrder[0];
    
    expect(mergeCallOrder).toBeLessThan(cleanupCallOrder);
  });

  it('should delete branch even if merge was skipped due to no commits, if strategy is unique-and-delete', async () => {
    const config: PipelineConfig = {
      ...mockConfig,
      git: {
        branchStrategy: 'unique-and-delete',
        mergeStrategy: 'local-merge',
        baseBranch: 'main'
      }
    };

    const stateNoCommits = {
      ...mockState,
      stages: [] // No commits
    };

    const branchName = 'pipeline/test-pipeline/abc12345';
    const worktreePath = '/test/repo/.agent-pipeline/worktrees/test-pipeline-abc12345';

    await finalizer.finalize(
      stateNoCommits,
      config,
      branchName,
      worktreePath,
      '/test/repo',
      Date.now(),
      false,
      false,
      mockNotifyCallback,
      mockStateChangeCallback
    );

    // 1. Verify Merge SKIPPED
    expect(mockGitManagerInstance.merge).not.toHaveBeenCalled();
    
    // 2. Verify Worktree Cleanup with Delete Branch
    expect(mockWorktreeManagerInstance.cleanupWorktree).toHaveBeenCalledWith(
      worktreePath,
      true, // deleteBranch
      false // force
    );
  });
});
