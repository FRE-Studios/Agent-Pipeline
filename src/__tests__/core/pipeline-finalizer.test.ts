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
vi.mock('../../core/pr-creator.js');
vi.mock('../../core/state-manager.js');

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
      totalDuration: 0
    };

    mockGitManager = new GitManager('/test/repo');
    mockBranchManager = new BranchManager('/test/repo');
    mockPRCreator = new PRCreator();
    mockStateManager = new StateManager('/test/repo');
    mockShouldLog = vi.fn().mockReturnValue(true);
    mockNotifyCallback = vi.fn().mockResolvedValue(undefined);
    mockStateChangeCallback = vi.fn();

    // Setup common mocks
    vi.spyOn(mockGitManager, 'getCurrentCommit').mockResolvedValue('def456');
    vi.spyOn(mockStateManager, 'saveState').mockResolvedValue();
    vi.spyOn(mockBranchManager, 'checkoutBranch').mockResolvedValue();

    finalizer = new PipelineFinalizer(
      mockGitManager,
      mockBranchManager,
      mockPRCreator,
      mockStateManager,
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
        'main',
        startTime,
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
          pullRequest: {
            autoCreate: true,
            title: 'Test PR'
          }
        }
      };

      await finalizer.finalize(
        mockState,
        configWithPR,
        'pipeline/test-branch',
        'main',
        Date.now(),
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
          pullRequest: {
            autoCreate: true
          }
        }
      };

      await finalizer.finalize(
        mockState,
        configWithPR,
        'pipeline/test-branch',
        'main',
        Date.now(),
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
          pullRequest: {
            autoCreate: true
          }
        }
      };

      await finalizer.finalize(
        mockState,
        configWithPR,
        'pipeline/test-branch',
        'main',
        Date.now(),
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
        'main',
        Date.now(),
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
        'main',
        Date.now(),
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
        'main',
        Date.now(),
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
        'main',
        Date.now(),
        false,
        mockNotifyCallback,
        mockStateChangeCallback
      );

      expect(mockStateChangeCallback).toHaveBeenCalled();
    });

    it('should return to original branch when pipeline branch was used', async () => {
      await finalizer.finalize(
        mockState,
        mockConfig,
        'pipeline/test-branch',
        'main',
        Date.now(),
        false,
        mockNotifyCallback,
        mockStateChangeCallback
      );

      expect(mockBranchManager.checkoutBranch).toHaveBeenCalledWith('main');
    });

    it('should not return to original branch when no pipeline branch', async () => {
      await finalizer.finalize(
        mockState,
        mockConfig,
        undefined,
        'main',
        Date.now(),
        false,
        mockNotifyCallback,
        mockStateChangeCallback
      );

      expect(mockBranchManager.checkoutBranch).not.toHaveBeenCalled();
    });

    it('should not return to original branch in dry run mode', async () => {
      const dryRunFinalizer = new PipelineFinalizer(
        mockGitManager,
        mockBranchManager,
        mockPRCreator,
        mockStateManager,
        true, // dry run
        mockShouldLog
      );

      await dryRunFinalizer.finalize(
        mockState,
        mockConfig,
        'pipeline/test-branch',
        'main',
        Date.now(),
        false,
        mockNotifyCallback,
        mockStateChangeCallback
      );

      expect(mockBranchManager.checkoutBranch).not.toHaveBeenCalled();
    });

    it('should print summary in non-interactive mode', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await finalizer.finalize(
        mockState,
        mockConfig,
        undefined,
        'main',
        Date.now(),
        false, // non-interactive
        mockNotifyCallback,
        mockStateChangeCallback
      );

      expect(mockPipelineFormatter.formatSummary).toHaveBeenCalledWith(mockState);
      expect(consoleSpy).toHaveBeenCalledWith('Pipeline Summary Output');

      consoleSpy.mockRestore();
    });

    it('should not print summary in interactive mode', async () => {
      mockShouldLog.mockReturnValue(false); // Interactive mode

      await finalizer.finalize(
        mockState,
        mockConfig,
        undefined,
        'main',
        Date.now(),
        true, // interactive
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
          pullRequest: {
            autoCreate: true
          }
        }
      };

      await finalizer.finalize(
        mockState,
        configWithPR,
        'pipeline/test-branch',
        'main',
        Date.now(),
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
