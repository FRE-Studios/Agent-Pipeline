import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rollbackCommand } from '../../../cli/commands/rollback.js';
import { GitManager } from '../../../core/git-manager.js';
import { StateManager } from '../../../core/state-manager.js';
import { createTempDir, cleanupTempDir } from '../../setup.js';
import type { PipelineState } from '../../../config/schema.js';

// Mock dependencies
vi.mock('../../../core/git-manager.js');
vi.mock('../../../core/state-manager.js');
vi.mock('readline', () => ({
  createInterface: vi.fn(),
}));

describe('rollbackCommand', () => {
  let tempDir: string;
  let mockGitManager: any;
  let mockStateManager: any;
  let mockReadlineInterface: any;

  const createMockState = (overrides: Partial<PipelineState> = {}): PipelineState => ({
    runId: 'test-run-123',
    pipelineConfig: {
      name: 'test-pipeline',
      trigger: 'manual',
      agents: [],
    },
    trigger: {
      type: 'manual',
      commitSha: 'abc123def456',
      timestamp: new Date('2024-01-01T00:00:00Z'),
    },
    startTime: new Date('2024-01-01T00:00:00Z'),
    status: 'completed',
    stages: [],
    ...overrides,
  });

  beforeEach(async () => {
    tempDir = await createTempDir('rollback-test-');

    // Setup GitManager mock
    mockGitManager = {
      revertToCommit: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(GitManager).mockImplementation(() => mockGitManager);

    // Setup StateManager mock
    mockStateManager = {
      loadState: vi.fn(),
      getLatestRun: vi.fn(),
    };
    vi.mocked(StateManager).mockImplementation(() => mockStateManager);

    // Setup readline mock
    mockReadlineInterface = {
      question: vi.fn(),
      close: vi.fn(),
    };
    const readline = await import('readline');
    vi.mocked(readline.createInterface).mockReturnValue(mockReadlineInterface as any);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
    vi.clearAllMocks();
  });

  describe('State Loading', () => {
    it('should load state by runId when provided', async () => {
      const mockState = createMockState();
      mockStateManager.loadState.mockResolvedValue(mockState);
      mockReadlineInterface.question.mockImplementation((_q: string, cb: (answer: string) => void) => cb('y'));

      await rollbackCommand(tempDir, { runId: 'test-run-123' });

      expect(mockStateManager.loadState).toHaveBeenCalledWith('test-run-123');
      expect(mockStateManager.getLatestRun).not.toHaveBeenCalled();
    });

    it('should load latest run when no runId provided', async () => {
      const mockState = createMockState();
      mockStateManager.getLatestRun.mockResolvedValue(mockState);
      mockReadlineInterface.question.mockImplementation((_q: string, cb: (answer: string) => void) => cb('y'));

      await rollbackCommand(tempDir, {});

      expect(mockStateManager.getLatestRun).toHaveBeenCalled();
      expect(mockStateManager.loadState).not.toHaveBeenCalled();
    });

    it('should handle no run found by runId', async () => {
      mockStateManager.loadState.mockResolvedValue(null);

      await rollbackCommand(tempDir, { runId: 'nonexistent' });

      expect(console.error).toHaveBeenCalledWith('❌ No pipeline run found to rollback');
      expect(mockReadlineInterface.question).not.toHaveBeenCalled();
      expect(mockGitManager.revertToCommit).not.toHaveBeenCalled();
    });

    it('should handle no latest run found', async () => {
      mockStateManager.getLatestRun.mockResolvedValue(null);

      await rollbackCommand(tempDir, {});

      expect(console.error).toHaveBeenCalledWith('❌ No pipeline run found to rollback');
      expect(mockReadlineInterface.question).not.toHaveBeenCalled();
      expect(mockGitManager.revertToCommit).not.toHaveBeenCalled();
    });

    it('should display pipeline name and runId', async () => {
      const mockState = createMockState();
      mockStateManager.getLatestRun.mockResolvedValue(mockState);
      mockReadlineInterface.question.mockImplementation((_q: string, cb: (answer: string) => void) => cb('y'));

      await rollbackCommand(tempDir, {});

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('🔄 Rolling back pipeline: test-pipeline'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Run ID: test-run-123'));
    });
  });

  describe('Target Commit Calculation', () => {
    it('should rollback to trigger commit when no stages option', async () => {
      const mockState = createMockState();
      mockStateManager.getLatestRun.mockResolvedValue(mockState);
      mockReadlineInterface.question.mockImplementation((_q: string, cb: (answer: string) => void) => cb('y'));

      await rollbackCommand(tempDir, {});

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Rolling back to initial commit'));
      expect(mockGitManager.revertToCommit).toHaveBeenCalledWith('abc123def456');
    });

    it('should rollback N stages with successful stages', async () => {
      const mockState = createMockState({
        stages: [
          {
            name: 'stage1',
            status: 'completed',
            startTime: new Date(),
            commitSha: 'commit1',
          },
          {
            name: 'stage2',
            status: 'completed',
            startTime: new Date(),
            commitSha: 'commit2',
          },
          {
            name: 'stage3',
            status: 'completed',
            startTime: new Date(),
            commitSha: 'commit3',
          },
        ],
      });
      mockStateManager.getLatestRun.mockResolvedValue(mockState);
      mockReadlineInterface.question.mockImplementation((_q: string, cb: (answer: string) => void) => cb('y'));

      await rollbackCommand(tempDir, { stages: 2 });

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Rolling back 2 stage(s)'));
      expect(mockGitManager.revertToCommit).toHaveBeenCalledWith('commit1');
    });

    it('should rollback 1 stage correctly', async () => {
      const mockState = createMockState({
        stages: [
          {
            name: 'stage1',
            status: 'completed',
            startTime: new Date(),
            commitSha: 'commit1',
          },
          {
            name: 'stage2',
            status: 'completed',
            startTime: new Date(),
            commitSha: 'commit2',
          },
        ],
      });
      mockStateManager.getLatestRun.mockResolvedValue(mockState);
      mockReadlineInterface.question.mockImplementation((_q: string, cb: (answer: string) => void) => cb('y'));

      await rollbackCommand(tempDir, { stages: 1 });

      expect(mockGitManager.revertToCommit).toHaveBeenCalledWith('commit1');
    });

    it('should rollback all stages to trigger commit', async () => {
      const mockState = createMockState({
        stages: [
          {
            name: 'stage1',
            status: 'completed',
            startTime: new Date(),
            commitSha: 'commit1',
          },
          {
            name: 'stage2',
            status: 'completed',
            startTime: new Date(),
            commitSha: 'commit2',
          },
        ],
      });
      mockStateManager.getLatestRun.mockResolvedValue(mockState);
      mockReadlineInterface.question.mockImplementation((_q: string, cb: (answer: string) => void) => cb('y'));

      await rollbackCommand(tempDir, { stages: 2 });

      expect(mockGitManager.revertToCommit).toHaveBeenCalledWith('abc123def456');
    });

    it('should error when rolling back more stages than available', async () => {
      const mockState = createMockState({
        stages: [
          {
            name: 'stage1',
            status: 'completed',
            startTime: new Date(),
            commitSha: 'commit1',
          },
        ],
      });
      mockStateManager.getLatestRun.mockResolvedValue(mockState);

      await rollbackCommand(tempDir, { stages: 5 });

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Cannot rollback 5 stages, only 1 commits found')
      );
      expect(mockReadlineInterface.question).not.toHaveBeenCalled();
      expect(mockGitManager.revertToCommit).not.toHaveBeenCalled();
    });

    it('should calculate target from successful stages only', async () => {
      const mockState = createMockState({
        stages: [
          {
            name: 'stage1',
            status: 'completed',
            startTime: new Date(),
            commitSha: 'commit1',
          },
          {
            name: 'stage2',
            status: 'failed',
            startTime: new Date(),
            // No commitSha
          },
          {
            name: 'stage3',
            status: 'completed',
            startTime: new Date(),
            commitSha: 'commit3',
          },
        ],
      });
      mockStateManager.getLatestRun.mockResolvedValue(mockState);
      mockReadlineInterface.question.mockImplementation((_q: string, cb: (answer: string) => void) => cb('y'));

      await rollbackCommand(tempDir, { stages: 1 });

      // Should only count stages with commitSha
      expect(mockGitManager.revertToCommit).toHaveBeenCalledWith('commit1');
    });

    it('should display target commit (truncated to 7 chars)', async () => {
      const mockState = createMockState();
      mockStateManager.getLatestRun.mockResolvedValue(mockState);
      mockReadlineInterface.question.mockImplementation((_q: string, cb: (answer: string) => void) => cb('y'));

      await rollbackCommand(tempDir, {});

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Target: abc123d'));
    });

    it('should show stage count in output', async () => {
      const mockState = createMockState({
        stages: [
          {
            name: 'stage1',
            status: 'completed',
            startTime: new Date(),
            commitSha: 'commit1',
          },
        ],
      });
      mockStateManager.getLatestRun.mockResolvedValue(mockState);
      mockReadlineInterface.question.mockImplementation((_q: string, cb: (answer: string) => void) => cb('y'));

      await rollbackCommand(tempDir, { stages: 1 });

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Rolling back 1 stage(s)'));
    });
  });

  describe('User Interaction', () => {
    it('should confirm rollback with "y"', async () => {
      const mockState = createMockState();
      mockStateManager.getLatestRun.mockResolvedValue(mockState);
      mockReadlineInterface.question.mockImplementation((_q: string, cb: (answer: string) => void) => cb('y'));

      await rollbackCommand(tempDir, {});

      expect(mockGitManager.revertToCommit).toHaveBeenCalledWith('abc123def456');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✅ Rolled back successfully'));
    });

    it('should confirm rollback with "Y"', async () => {
      const mockState = createMockState();
      mockStateManager.getLatestRun.mockResolvedValue(mockState);
      mockReadlineInterface.question.mockImplementation((_q: string, cb: (answer: string) => void) => cb('Y'));

      await rollbackCommand(tempDir, {});

      expect(mockGitManager.revertToCommit).toHaveBeenCalledWith('abc123def456');
    });

    it('should cancel rollback with "n"', async () => {
      const mockState = createMockState();
      mockStateManager.getLatestRun.mockResolvedValue(mockState);
      mockReadlineInterface.question.mockImplementation((_q: string, cb: (answer: string) => void) => cb('n'));

      await rollbackCommand(tempDir, {});

      expect(mockGitManager.revertToCommit).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith('Cancelled.');
    });

    it('should cancel rollback with "N"', async () => {
      const mockState = createMockState();
      mockStateManager.getLatestRun.mockResolvedValue(mockState);
      mockReadlineInterface.question.mockImplementation((_q: string, cb: (answer: string) => void) => cb('N'));

      await rollbackCommand(tempDir, {});

      expect(mockGitManager.revertToCommit).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith('Cancelled.');
    });

    it('should cancel with any other input', async () => {
      const mockState = createMockState();
      mockStateManager.getLatestRun.mockResolvedValue(mockState);
      mockReadlineInterface.question.mockImplementation((_q: string, cb: (answer: string) => void) => cb('maybe'));

      await rollbackCommand(tempDir, {});

      expect(mockGitManager.revertToCommit).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith('Cancelled.');
    });

    it('should close readline interface after prompt', async () => {
      const mockState = createMockState();
      mockStateManager.getLatestRun.mockResolvedValue(mockState);
      mockReadlineInterface.question.mockImplementation((_q: string, cb: (answer: string) => void) => cb('y'));

      await rollbackCommand(tempDir, {});

      expect(mockReadlineInterface.close).toHaveBeenCalled();
    });

    it('should display confirmation prompt', async () => {
      const mockState = createMockState();
      mockStateManager.getLatestRun.mockResolvedValue(mockState);
      mockReadlineInterface.question.mockImplementation((_q: string, cb: (answer: string) => void) => cb('y'));

      await rollbackCommand(tempDir, {});

      expect(mockReadlineInterface.question).toHaveBeenCalledWith(
        expect.stringContaining('⚠️  This will reset your branch. Continue? (y/N):'),
        expect.any(Function)
      );
    });
  });

  describe('Git Integration', () => {
    it('should call revertToCommit with correct SHA', async () => {
      const mockState = createMockState({
        trigger: {
          type: 'manual',
          commitSha: 'custom-commit-sha',
          timestamp: new Date(),
        },
      });
      mockStateManager.getLatestRun.mockResolvedValue(mockState);
      mockReadlineInterface.question.mockImplementation((_q: string, cb: (answer: string) => void) => cb('y'));

      await rollbackCommand(tempDir, {});

      expect(mockGitManager.revertToCommit).toHaveBeenCalledWith('custom-commit-sha');
    });

    it('should handle git revert failure', async () => {
      const mockState = createMockState();
      mockStateManager.getLatestRun.mockResolvedValue(mockState);
      mockReadlineInterface.question.mockImplementation((_q: string, cb: (answer: string) => void) => cb('y'));
      mockGitManager.revertToCommit.mockRejectedValue(new Error('Git error'));

      await expect(rollbackCommand(tempDir, {})).rejects.toThrow('Git error');
    });

    it('should display success message after rollback', async () => {
      const mockState = createMockState();
      mockStateManager.getLatestRun.mockResolvedValue(mockState);
      mockReadlineInterface.question.mockImplementation((_q: string, cb: (answer: string) => void) => cb('y'));

      await rollbackCommand(tempDir, {});

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✅ Rolled back successfully'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Current HEAD: abc123d'));
    });

    it('should show helpful tip about reflog', async () => {
      const mockState = createMockState();
      mockStateManager.getLatestRun.mockResolvedValue(mockState);
      mockReadlineInterface.question.mockImplementation((_q: string, cb: (answer: string) => void) => cb('y'));

      await rollbackCommand(tempDir, {});

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining("💡 Tip: Use 'git reflog'"));
    });
  });

  describe('Edge Cases', () => {
    it('should handle pipeline with no successful stages', async () => {
      const mockState = createMockState({
        stages: [
          {
            name: 'stage1',
            status: 'failed',
            startTime: new Date(),
          },
          {
            name: 'stage2',
            status: 'skipped',
            startTime: new Date(),
          },
        ],
      });
      mockStateManager.getLatestRun.mockResolvedValue(mockState);
      mockReadlineInterface.question.mockImplementation((_q: string, cb: (answer: string) => void) => cb('y'));

      await rollbackCommand(tempDir, {});

      expect(mockGitManager.revertToCommit).toHaveBeenCalledWith('abc123def456');
    });

    it('should handle pipeline with one successful stage', async () => {
      const mockState = createMockState({
        stages: [
          {
            name: 'stage1',
            status: 'completed',
            startTime: new Date(),
            commitSha: 'commit1',
          },
        ],
      });
      mockStateManager.getLatestRun.mockResolvedValue(mockState);
      mockReadlineInterface.question.mockImplementation((_q: string, cb: (answer: string) => void) => cb('y'));

      await rollbackCommand(tempDir, { stages: 1 });

      expect(mockGitManager.revertToCommit).toHaveBeenCalledWith('abc123def456');
    });

    it('should handle state with undefined commitSha in stage', async () => {
      const mockState = createMockState({
        stages: [
          {
            name: 'stage1',
            status: 'completed',
            startTime: new Date(),
            commitSha: 'commit1',
          },
          {
            name: 'stage2',
            status: 'completed',
            startTime: new Date(),
            commitSha: undefined,
          },
        ],
      });
      mockStateManager.getLatestRun.mockResolvedValue(mockState);
      mockReadlineInterface.question.mockImplementation((_q: string, cb: (answer: string) => void) => cb('y'));

      await rollbackCommand(tempDir, { stages: 1 });

      // Should only count stages with truthy commitSha
      expect(mockGitManager.revertToCommit).toHaveBeenCalledWith('abc123def456');
    });

    it('should handle empty stages array', async () => {
      const mockState = createMockState({
        stages: [],
      });
      mockStateManager.getLatestRun.mockResolvedValue(mockState);
      mockReadlineInterface.question.mockImplementation((_q: string, cb: (answer: string) => void) => cb('y'));

      await rollbackCommand(tempDir, {});

      expect(mockGitManager.revertToCommit).toHaveBeenCalledWith('abc123def456');
    });
  });
});
