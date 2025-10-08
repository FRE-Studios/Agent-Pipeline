import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanupCommand } from '../../../cli/commands/cleanup.js';
import { BranchManager } from '../../../core/branch-manager.js';
import { createTempDir, cleanupTempDir } from '../../setup.js';

// Mock dependencies
vi.mock('../../../core/branch-manager.js');

describe('cleanupCommand', () => {
  let tempDir: string;
  let mockBranchManager: any;

  beforeEach(async () => {
    tempDir = await createTempDir('cleanup-test-');

    // Setup BranchManager mock
    mockBranchManager = {
      listPipelineBranches: vi.fn(),
      deleteLocalBranch: vi.fn(),
    };
    vi.mocked(BranchManager).mockImplementation(() => mockBranchManager);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
    vi.clearAllMocks();
  });

  describe('Branch Listing', () => {
    it('should list all pipeline branches', async () => {
      mockBranchManager.listPipelineBranches.mockResolvedValue([
        'pipeline/feature-1',
        'pipeline/feature-2',
      ]);

      await cleanupCommand(tempDir);

      expect(mockBranchManager.listPipelineBranches).toHaveBeenCalledWith('pipeline');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Pipeline branches to delete:'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('pipeline/feature-1'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('pipeline/feature-2'));
    });

    it('should filter by pipeline name', async () => {
      mockBranchManager.listPipelineBranches.mockResolvedValue([
        'pipeline/test-pipeline-run-1',
        'pipeline/test-pipeline-run-2',
        'pipeline/other-pipeline-run-1',
      ]);

      await cleanupCommand(tempDir, { pipeline: 'test-pipeline' });

      const logs = vi.mocked(console.log).mock.calls.map((call) => call[0]);
      const branchLogs = logs.filter((log) => log && log.includes('pipeline/'));

      expect(branchLogs.some((log) => log.includes('test-pipeline-run-1'))).toBe(true);
      expect(branchLogs.some((log) => log.includes('test-pipeline-run-2'))).toBe(true);
      expect(branchLogs.some((log) => log.includes('other-pipeline-run-1'))).toBe(false);
    });

    it('should handle no branches found', async () => {
      mockBranchManager.listPipelineBranches.mockResolvedValue([]);

      await cleanupCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith('No pipeline branches found to clean up');
      expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('Pipeline branches to delete:'));
    });

    it('should handle multiple matching branches', async () => {
      mockBranchManager.listPipelineBranches.mockResolvedValue([
        'pipeline/build-123',
        'pipeline/build-456',
        'pipeline/build-789',
      ]);

      await cleanupCommand(tempDir, { pipeline: 'build' });

      const logs = vi.mocked(console.log).mock.calls.map((call) => call[0]);
      const branchLogs = logs.filter((log) => log && log.includes('pipeline/build-'));

      expect(branchLogs).toHaveLength(3);
    });

    it('should handle no matching branches after filter', async () => {
      mockBranchManager.listPipelineBranches.mockResolvedValue([
        'pipeline/feature-1',
        'pipeline/feature-2',
      ]);

      await cleanupCommand(tempDir, { pipeline: 'nonexistent' });

      expect(console.log).toHaveBeenCalledWith('No pipeline branches found to clean up');
    });
  });

  describe('Force Flag Behavior', () => {
    it('should show dry run without --force', async () => {
      mockBranchManager.listPipelineBranches.mockResolvedValue([
        'pipeline/test-1',
      ]);

      await cleanupCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Run with --force to delete these branches'));
      expect(mockBranchManager.deleteLocalBranch).not.toHaveBeenCalled();
    });

    it('should display branches to delete', async () => {
      mockBranchManager.listPipelineBranches.mockResolvedValue([
        'pipeline/branch-1',
        'pipeline/branch-2',
      ]);

      await cleanupCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith('Pipeline branches to delete:');
      expect(console.log).toHaveBeenCalledWith('  - pipeline/branch-1');
      expect(console.log).toHaveBeenCalledWith('  - pipeline/branch-2');
    });

    it('should show example command', async () => {
      mockBranchManager.listPipelineBranches.mockResolvedValue([
        'pipeline/test',
      ]);

      await cleanupCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Example: agent-pipeline cleanup --force'));
    });

    it('should actually delete with --force', async () => {
      mockBranchManager.listPipelineBranches.mockResolvedValue([
        'pipeline/test-1',
        'pipeline/test-2',
      ]);
      mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);

      await cleanupCommand(tempDir, { force: true });

      expect(mockBranchManager.deleteLocalBranch).toHaveBeenCalledWith('pipeline/test-1', true);
      expect(mockBranchManager.deleteLocalBranch).toHaveBeenCalledWith('pipeline/test-2', true);
    });

    it('should skip deletion without --force', async () => {
      mockBranchManager.listPipelineBranches.mockResolvedValue([
        'pipeline/test',
      ]);

      await cleanupCommand(tempDir, { force: false });

      expect(mockBranchManager.deleteLocalBranch).not.toHaveBeenCalled();
    });

    it('should display cleanup message with force', async () => {
      mockBranchManager.listPipelineBranches.mockResolvedValue([
        'pipeline/test',
      ]);
      mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);

      await cleanupCommand(tempDir, { force: true });

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('🧹 Cleaning up pipeline branches...'));
    });
  });

  describe('Branch Deletion', () => {
    it('should successfully delete single branch', async () => {
      mockBranchManager.listPipelineBranches.mockResolvedValue([
        'pipeline/old-feature',
      ]);
      mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);

      await cleanupCommand(tempDir, { force: true });

      expect(mockBranchManager.deleteLocalBranch).toHaveBeenCalledWith('pipeline/old-feature', true);
      expect(console.log).toHaveBeenCalledWith('✅ Deleted pipeline/old-feature');
    });

    it('should successfully delete multiple branches', async () => {
      mockBranchManager.listPipelineBranches.mockResolvedValue([
        'pipeline/branch-1',
        'pipeline/branch-2',
        'pipeline/branch-3',
      ]);
      mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);

      await cleanupCommand(tempDir, { force: true });

      expect(mockBranchManager.deleteLocalBranch).toHaveBeenCalledTimes(3);
      expect(console.log).toHaveBeenCalledWith('✅ Deleted pipeline/branch-1');
      expect(console.log).toHaveBeenCalledWith('✅ Deleted pipeline/branch-2');
      expect(console.log).toHaveBeenCalledWith('✅ Deleted pipeline/branch-3');
    });

    it('should handle deletion failure', async () => {
      mockBranchManager.listPipelineBranches.mockResolvedValue([
        'pipeline/protected',
      ]);
      mockBranchManager.deleteLocalBranch.mockRejectedValue(new Error('Cannot delete protected branch'));

      await cleanupCommand(tempDir, { force: true });

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('❌ Failed to delete pipeline/protected: Cannot delete protected branch')
      );
    });

    it('should continue on partial failures', async () => {
      mockBranchManager.listPipelineBranches.mockResolvedValue([
        'pipeline/branch-1',
        'pipeline/branch-2',
        'pipeline/branch-3',
      ]);
      mockBranchManager.deleteLocalBranch
        .mockResolvedValueOnce(undefined) // branch-1 succeeds
        .mockRejectedValueOnce(new Error('Failed')) // branch-2 fails
        .mockResolvedValueOnce(undefined); // branch-3 succeeds

      await cleanupCommand(tempDir, { force: true });

      expect(console.log).toHaveBeenCalledWith('✅ Deleted pipeline/branch-1');
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('❌ Failed to delete pipeline/branch-2'));
      expect(console.log).toHaveBeenCalledWith('✅ Deleted pipeline/branch-3');
    });

    it('should call deleteLocalBranch with force=true', async () => {
      mockBranchManager.listPipelineBranches.mockResolvedValue([
        'pipeline/test',
      ]);
      mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);

      await cleanupCommand(tempDir, { force: true });

      expect(mockBranchManager.deleteLocalBranch).toHaveBeenCalledWith('pipeline/test', true);
    });

    it('should display success message per branch', async () => {
      mockBranchManager.listPipelineBranches.mockResolvedValue([
        'pipeline/feature-a',
        'pipeline/feature-b',
      ]);
      mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);

      await cleanupCommand(tempDir, { force: true });

      expect(console.log).toHaveBeenCalledWith('✅ Deleted pipeline/feature-a');
      expect(console.log).toHaveBeenCalledWith('✅ Deleted pipeline/feature-b');
    });

    it('should display error message per branch', async () => {
      mockBranchManager.listPipelineBranches.mockResolvedValue([
        'pipeline/error-1',
        'pipeline/error-2',
      ]);
      mockBranchManager.deleteLocalBranch
        .mockRejectedValueOnce(new Error('Error 1'))
        .mockRejectedValueOnce(new Error('Error 2'));

      await cleanupCommand(tempDir, { force: true });

      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('❌ Failed to delete pipeline/error-1: Error 1'));
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('❌ Failed to delete pipeline/error-2: Error 2'));
    });

    it('should format error messages correctly', async () => {
      mockBranchManager.listPipelineBranches.mockResolvedValue([
        'pipeline/test',
      ]);
      mockBranchManager.deleteLocalBranch.mockRejectedValue(new Error('Permission denied'));

      await cleanupCommand(tempDir, { force: true });

      expect(console.error).toHaveBeenCalledWith('❌ Failed to delete pipeline/test: Permission denied');
    });

    it('should handle non-Error thrown values', async () => {
      mockBranchManager.listPipelineBranches.mockResolvedValue([
        'pipeline/test',
      ]);
      mockBranchManager.deleteLocalBranch.mockRejectedValue('String error');

      await cleanupCommand(tempDir, { force: true });

      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('❌ Failed to delete pipeline/test: String error'));
    });
  });

  describe('Console Output', () => {
    it('should display branches to delete list', async () => {
      mockBranchManager.listPipelineBranches.mockResolvedValue([
        'pipeline/feature-x',
      ]);

      await cleanupCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith('Pipeline branches to delete:');
      expect(console.log).toHaveBeenCalledWith('  - pipeline/feature-x');
    });

    it('should show force flag instruction', async () => {
      mockBranchManager.listPipelineBranches.mockResolvedValue([
        'pipeline/test',
      ]);

      await cleanupCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Run with --force to delete these branches'));
    });

    it('should show cleanup progress message', async () => {
      mockBranchManager.listPipelineBranches.mockResolvedValue([
        'pipeline/test',
      ]);
      mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);

      await cleanupCommand(tempDir, { force: true });

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('🧹 Cleaning up pipeline branches...'));
    });

    it('should show completion message', async () => {
      mockBranchManager.listPipelineBranches.mockResolvedValue([
        'pipeline/test',
      ]);
      mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);

      await cleanupCommand(tempDir, { force: true });

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✨ Cleanup complete!'));
    });

    it('should handle no branches message', async () => {
      mockBranchManager.listPipelineBranches.mockResolvedValue([]);

      await cleanupCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith('No pipeline branches found to clean up');
    });

    it('should display branch names correctly', async () => {
      mockBranchManager.listPipelineBranches.mockResolvedValue([
        'pipeline/feature-with-dashes',
        'pipeline/feature_with_underscores',
        'pipeline/feature123',
      ]);

      await cleanupCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith('  - pipeline/feature-with-dashes');
      expect(console.log).toHaveBeenCalledWith('  - pipeline/feature_with_underscores');
      expect(console.log).toHaveBeenCalledWith('  - pipeline/feature123');
    });
  });

  describe('Integration', () => {
    it('should complete workflow without force', async () => {
      mockBranchManager.listPipelineBranches.mockResolvedValue([
        'pipeline/test-1',
        'pipeline/test-2',
      ]);

      await cleanupCommand(tempDir);

      expect(mockBranchManager.listPipelineBranches).toHaveBeenCalledWith('pipeline');
      expect(console.log).toHaveBeenCalledWith('Pipeline branches to delete:');
      expect(console.log).toHaveBeenCalledWith('  - pipeline/test-1');
      expect(console.log).toHaveBeenCalledWith('  - pipeline/test-2');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Run with --force to delete these branches'));
      expect(mockBranchManager.deleteLocalBranch).not.toHaveBeenCalled();
    });

    it('should complete workflow with force', async () => {
      mockBranchManager.listPipelineBranches.mockResolvedValue([
        'pipeline/old-1',
        'pipeline/old-2',
      ]);
      mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);

      await cleanupCommand(tempDir, { force: true });

      expect(mockBranchManager.listPipelineBranches).toHaveBeenCalledWith('pipeline');
      expect(console.log).toHaveBeenCalledWith('Pipeline branches to delete:');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('🧹 Cleaning up pipeline branches...'));
      expect(mockBranchManager.deleteLocalBranch).toHaveBeenCalledTimes(2);
      expect(console.log).toHaveBeenCalledWith('✅ Deleted pipeline/old-1');
      expect(console.log).toHaveBeenCalledWith('✅ Deleted pipeline/old-2');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✨ Cleanup complete!'));
    });

    it('should handle mixed success/failure scenario', async () => {
      mockBranchManager.listPipelineBranches.mockResolvedValue([
        'pipeline/success',
        'pipeline/failure',
      ]);
      mockBranchManager.deleteLocalBranch
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Failed'));

      await cleanupCommand(tempDir, { force: true });

      expect(console.log).toHaveBeenCalledWith('✅ Deleted pipeline/success');
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('❌ Failed to delete pipeline/failure'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✨ Cleanup complete!'));
    });

    it('should handle filter + force combination', async () => {
      mockBranchManager.listPipelineBranches.mockResolvedValue([
        'pipeline/my-pipeline-run-1',
        'pipeline/my-pipeline-run-2',
        'pipeline/other-run-1',
      ]);
      mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);

      await cleanupCommand(tempDir, { pipeline: 'my-pipeline', force: true });

      expect(mockBranchManager.deleteLocalBranch).toHaveBeenCalledTimes(2);
      expect(mockBranchManager.deleteLocalBranch).toHaveBeenCalledWith('pipeline/my-pipeline-run-1', true);
      expect(mockBranchManager.deleteLocalBranch).toHaveBeenCalledWith('pipeline/my-pipeline-run-2', true);
      expect(mockBranchManager.deleteLocalBranch).not.toHaveBeenCalledWith('pipeline/other-run-1', true);
    });

    it('should handle empty result set', async () => {
      mockBranchManager.listPipelineBranches.mockResolvedValue([]);

      await cleanupCommand(tempDir, { force: true });

      expect(console.log).toHaveBeenCalledWith('No pipeline branches found to clean up');
      expect(mockBranchManager.deleteLocalBranch).not.toHaveBeenCalled();
    });
  });
});
