import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanupCommand } from '../../../cli/commands/cleanup.js';
import { BranchManager } from '../../../core/branch-manager.js';
import { createTempDir, cleanupTempDir } from '../../setup.js';
import * as fs from 'fs/promises';
import { InteractivePrompts } from '../../../cli/utils/interactive-prompts.js';

// Mock dependencies
vi.mock('../../../core/branch-manager.js');
vi.mock('../../../core/worktree-manager.js');
vi.mock('fs/promises');
vi.mock('../../../cli/utils/interactive-prompts.js');

import { WorktreeManager } from '../../../core/worktree-manager.js';

describe('cleanupCommand', () => {
  let tempDir: string;
  let mockBranchManager: any;
  let mockWorktreeManager: any;
  let mockFs: any;
  let mockPrompts: any;

  beforeEach(async () => {
    tempDir = await createTempDir('cleanup-test-');

    // Setup BranchManager mock
    mockBranchManager = {
      listPipelineBranches: vi.fn(),
      deleteLocalBranch: vi.fn(),
      listRemotePipelineBranches: vi.fn().mockResolvedValue([]),
      deleteRemoteBranch: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(BranchManager).mockImplementation(() => mockBranchManager);

    // Setup WorktreeManager mock
    mockWorktreeManager = {
      listPipelineWorktrees: vi.fn().mockResolvedValue([]),
      cleanupWorktree: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(WorktreeManager).mockImplementation(() => mockWorktreeManager);

    // Setup fs mock
    mockFs = vi.mocked(fs);
    mockFs.readdir = vi.fn().mockResolvedValue([]);
    mockFs.readFile = vi.fn().mockResolvedValue('{}');
    mockFs.unlink = vi.fn().mockResolvedValue(undefined);

    // Setup InteractivePrompts mock
    mockPrompts = vi.mocked(InteractivePrompts);
    mockPrompts.confirm = vi.fn().mockResolvedValue(false);
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

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Run with --force to delete these items'));
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

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('agent-pipeline cleanup --force'));
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

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('🧹 Cleaning up branches...'));
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
      expect(console.log).toHaveBeenCalledWith('✅ Deleted branch: pipeline/old-feature');
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
      expect(console.log).toHaveBeenCalledWith('✅ Deleted branch: pipeline/branch-1');
      expect(console.log).toHaveBeenCalledWith('✅ Deleted branch: pipeline/branch-2');
      expect(console.log).toHaveBeenCalledWith('✅ Deleted branch: pipeline/branch-3');
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

      expect(console.log).toHaveBeenCalledWith('✅ Deleted branch: pipeline/branch-1');
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('❌ Failed to delete pipeline/branch-2'));
      expect(console.log).toHaveBeenCalledWith('✅ Deleted branch: pipeline/branch-3');
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

      expect(console.log).toHaveBeenCalledWith('✅ Deleted branch: pipeline/feature-a');
      expect(console.log).toHaveBeenCalledWith('✅ Deleted branch: pipeline/feature-b');
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

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Run with --force to delete these items'));
    });

    it('should show cleanup progress message', async () => {
      mockBranchManager.listPipelineBranches.mockResolvedValue([
        'pipeline/test',
      ]);
      mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);

      await cleanupCommand(tempDir, { force: true });

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('🧹 Cleaning up branches...'));
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
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Run with --force to delete these items'));
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
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('🧹 Cleaning up branches...'));
      expect(mockBranchManager.deleteLocalBranch).toHaveBeenCalledTimes(2);
      expect(console.log).toHaveBeenCalledWith('✅ Deleted branch: pipeline/old-1');
      expect(console.log).toHaveBeenCalledWith('✅ Deleted branch: pipeline/old-2');
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

      expect(console.log).toHaveBeenCalledWith('✅ Deleted branch: pipeline/success');
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

  describe('Log Deletion', () => {
    describe('Basic Flag Behavior', () => {
      it('should delete all state files with --delete-logs flag', async () => {
        mockBranchManager.listPipelineBranches.mockResolvedValue(['pipeline/test']);
        mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);

        mockFs.readdir.mockResolvedValue(['run-1.json', 'run-2.json']);
        mockFs.readFile.mockResolvedValue(JSON.stringify({
          runId: 'test-run',
          pipelineConfig: { name: 'test-pipeline' },
        }));

        await cleanupCommand(tempDir, { force: true, deleteLogs: true });

        expect(mockFs.readdir).toHaveBeenCalled();
        expect(mockFs.unlink).toHaveBeenCalledTimes(2);
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('🗑️  Deleting history files...'));
      });

      it('should NOT prompt when deleteLogs is false', async () => {
        mockBranchManager.listPipelineBranches.mockResolvedValue(['pipeline/test']);
        mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);
        mockPrompts.confirm.mockResolvedValue(false);

        await cleanupCommand(tempDir, { force: true, deleteLogs: false });

        // New behavior: explicitly false means do NOT delete and do NOT prompt
        expect(mockPrompts.confirm).not.toHaveBeenCalled();
        expect(mockFs.readdir).not.toHaveBeenCalled();
        expect(mockFs.unlink).not.toHaveBeenCalled();
      });

      it('should skip deletion when no branches deleted', async () => {
        mockBranchManager.listPipelineBranches.mockResolvedValue([]);

        await cleanupCommand(tempDir, { force: true, deleteLogs: true });

        expect(mockFs.readdir).not.toHaveBeenCalled();
        expect(mockFs.unlink).not.toHaveBeenCalled();
      });
    });

    describe('Interactive Prompt Behavior', () => {
      it('should show interactive prompt when flag not provided', async () => {
        mockBranchManager.listPipelineBranches.mockResolvedValue(['pipeline/test']);
        mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);
        mockPrompts.confirm.mockResolvedValue(false);

        await cleanupCommand(tempDir, { force: true });

        expect(mockPrompts.confirm).toHaveBeenCalledWith(
          expect.stringContaining('Delete associated history files?'),
          false
        );
      });

      it('should delete logs when user confirms', async () => {
        mockBranchManager.listPipelineBranches.mockResolvedValue(['pipeline/test']);
        mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);
        mockPrompts.confirm.mockResolvedValue(true);
        mockFs.readdir.mockResolvedValue(['run-1.json']);
        mockFs.readFile.mockResolvedValue(JSON.stringify({
          runId: 'test-run',
          pipelineConfig: { name: 'test' },
        }));

        await cleanupCommand(tempDir, { force: true });

        expect(mockPrompts.confirm).toHaveBeenCalled();
        expect(mockFs.readdir).toHaveBeenCalled();
        expect(mockFs.unlink).toHaveBeenCalled();
      });

      it('should skip logs when user declines', async () => {
        mockBranchManager.listPipelineBranches.mockResolvedValue(['pipeline/test']);
        mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);
        mockPrompts.confirm.mockResolvedValue(false);

        await cleanupCommand(tempDir, { force: true });

        expect(mockPrompts.confirm).toHaveBeenCalled();
        expect(mockFs.readdir).not.toHaveBeenCalled();
        expect(mockFs.unlink).not.toHaveBeenCalled();
      });

      it('should not prompt when deleteLogs flag provided', async () => {
        mockBranchManager.listPipelineBranches.mockResolvedValue(['pipeline/test']);
        mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);
        mockFs.readdir.mockResolvedValue([]);

        await cleanupCommand(tempDir, { force: true, deleteLogs: true });

        expect(mockPrompts.confirm).not.toHaveBeenCalled();
      });
    });

    describe('Pipeline Filtering', () => {
      it('should delete only matching pipeline logs', async () => {
        mockBranchManager.listPipelineBranches.mockResolvedValue(['pipeline/test-pipeline']);
        mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);

        mockFs.readdir.mockResolvedValue(['run-1.json', 'run-2.json', 'run-3.json']);
        mockFs.readFile
          .mockResolvedValueOnce(JSON.stringify({ pipelineConfig: { name: 'test-pipeline' } }))
          .mockResolvedValueOnce(JSON.stringify({ pipelineConfig: { name: 'other-pipeline' } }))
          .mockResolvedValueOnce(JSON.stringify({ pipelineConfig: { name: 'test-pipeline' } }));

        await cleanupCommand(tempDir, { force: true, deleteLogs: true, pipeline: 'test-pipeline' });

        expect(mockFs.unlink).toHaveBeenCalledTimes(2);
      });

      it('should delete all logs when no pipeline filter', async () => {
        mockBranchManager.listPipelineBranches.mockResolvedValue(['pipeline/test']);
        mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);

        mockFs.readdir.mockResolvedValue(['run-1.json', 'run-2.json']);
        mockFs.readFile.mockResolvedValue(JSON.stringify({
          pipelineConfig: { name: 'any-pipeline' },
        }));

        await cleanupCommand(tempDir, { force: true, deleteLogs: true });

        expect(mockFs.unlink).toHaveBeenCalledTimes(2);
      });

      it('should handle multiple state files for same pipeline', async () => {
        mockBranchManager.listPipelineBranches.mockResolvedValue(['pipeline/build']);
        mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);

        mockFs.readdir.mockResolvedValue(['run-1.json', 'run-2.json', 'run-3.json']);
        mockFs.readFile.mockResolvedValue(JSON.stringify({
          pipelineConfig: { name: 'build' },
        }));

        await cleanupCommand(tempDir, { force: true, deleteLogs: true, pipeline: 'build' });

        expect(mockFs.unlink).toHaveBeenCalledTimes(3);
      });

      it('should filter mixed pipeline logs correctly', async () => {
        mockBranchManager.listPipelineBranches.mockResolvedValue(['pipeline/test']);
        mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);

        mockFs.readdir.mockResolvedValue(['run-1.json', 'run-2.json', 'run-3.json', 'run-4.json']);
        mockFs.readFile
          .mockResolvedValueOnce(JSON.stringify({ pipelineConfig: { name: 'test' } }))
          .mockResolvedValueOnce(JSON.stringify({ pipelineConfig: { name: 'other' } }))
          .mockResolvedValueOnce(JSON.stringify({ pipelineConfig: { name: 'test' } }))
          .mockResolvedValueOnce(JSON.stringify({ pipelineConfig: { name: 'different' } }));

        await cleanupCommand(tempDir, { force: true, deleteLogs: true, pipeline: 'test' });

        expect(mockFs.unlink).toHaveBeenCalledTimes(2);
      });
    });

    describe('File Operations & Error Handling', () => {
      it('should display deleted count', async () => {
        mockBranchManager.listPipelineBranches.mockResolvedValue(['pipeline/test']);
        mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);

        mockFs.readdir.mockResolvedValue(['run-1.json', 'run-2.json', 'run-3.json']);
        mockFs.readFile.mockResolvedValue(JSON.stringify({
          pipelineConfig: { name: 'test' },
        }));

        await cleanupCommand(tempDir, { force: true, deleteLogs: true });

        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('📊 Deleted 3 history file(s)'));
      });

      it('should skip non-.json files', async () => {
        mockBranchManager.listPipelineBranches.mockResolvedValue(['pipeline/test']);
        mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);

        mockFs.readdir.mockResolvedValue(['run-1.json', 'readme.txt', 'run-2.json', '.DS_Store']);
        mockFs.readFile.mockResolvedValue(JSON.stringify({
          pipelineConfig: { name: 'test' },
        }));

        await cleanupCommand(tempDir, { force: true, deleteLogs: true });

        expect(mockFs.readFile).toHaveBeenCalledTimes(2); // Only .json files
        expect(mockFs.unlink).toHaveBeenCalledTimes(2);
      });

      it('should handle missing state directory', async () => {
        mockBranchManager.listPipelineBranches.mockResolvedValue(['pipeline/test']);
        mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);

        mockFs.readdir.mockRejectedValue(new Error('ENOENT: no such file or directory'));

        await cleanupCommand(tempDir, { force: true, deleteLogs: true });

        expect(console.error).toHaveBeenCalledWith(expect.stringContaining('⚠️  Could not delete history files'));
      });

      it('should handle file read errors', async () => {
        mockBranchManager.listPipelineBranches.mockResolvedValue(['pipeline/test']);
        mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);

        mockFs.readdir.mockResolvedValue(['run-1.json', 'run-2.json']);
        mockFs.readFile.mockRejectedValueOnce(new Error('Permission denied'));

        await cleanupCommand(tempDir, { force: true, deleteLogs: true });

        // New behavior: continues processing other files after error
        expect(mockFs.readFile).toHaveBeenCalledTimes(2);
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('⚠️  Could not process run-1.json'));
      });

      it('should handle JSON parse errors', async () => {
        mockBranchManager.listPipelineBranches.mockResolvedValue(['pipeline/test']);
        mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);

        mockFs.readdir.mockResolvedValue(['run-1.json', 'run-2.json']);
        mockFs.readFile.mockResolvedValueOnce('invalid json{{}');
        mockFs.readFile.mockResolvedValueOnce(JSON.stringify({ pipelineConfig: { name: 'test' } }));

        await cleanupCommand(tempDir, { force: true, deleteLogs: true });

        // New behavior: continues processing other files after JSON error
        expect(mockFs.readFile).toHaveBeenCalledTimes(2);
        expect(mockFs.unlink).toHaveBeenCalledTimes(1); // Second file should still be deleted
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('⚠️  Could not process run-1.json'));
      });

      it('should show "no files found" message when directory empty', async () => {
        mockBranchManager.listPipelineBranches.mockResolvedValue(['pipeline/test']);
        mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);

        mockFs.readdir.mockResolvedValue([]);

        await cleanupCommand(tempDir, { force: true, deleteLogs: true });

        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No history files found to delete'));
      });

      it('should show "no files found" when no matches', async () => {
        mockBranchManager.listPipelineBranches.mockResolvedValue(['pipeline/test']);
        mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);

        mockFs.readdir.mockResolvedValue(['run-1.json', 'run-2.json']);
        mockFs.readFile.mockResolvedValue(JSON.stringify({
          pipelineConfig: { name: 'other-pipeline' },
        }));

        await cleanupCommand(tempDir, { force: true, deleteLogs: true, pipeline: 'test' });

        expect(mockFs.unlink).not.toHaveBeenCalled();
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No history files found to delete'));
      });
    });

    describe('Console Output', () => {
      it('should display deletion header', async () => {
        mockBranchManager.listPipelineBranches.mockResolvedValue(['pipeline/test']);
        mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);

        mockFs.readdir.mockResolvedValue(['run-1.json']);
        mockFs.readFile.mockResolvedValue(JSON.stringify({
          pipelineConfig: { name: 'test' },
        }));

        await cleanupCommand(tempDir, { force: true, deleteLogs: true });

        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('🗑️  Deleting history files...'));
      });

      it('should display each deleted file', async () => {
        mockBranchManager.listPipelineBranches.mockResolvedValue(['pipeline/test']);
        mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);

        mockFs.readdir.mockResolvedValue(['run-1.json', 'run-2.json']);
        mockFs.readFile.mockResolvedValue(JSON.stringify({
          pipelineConfig: { name: 'test' },
        }));

        await cleanupCommand(tempDir, { force: true, deleteLogs: true });

        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✅ Deleted run-1.json'));
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✅ Deleted run-2.json'));
      });

      it('should display completion message even on errors', async () => {
        mockBranchManager.listPipelineBranches.mockResolvedValue(['pipeline/test']);
        mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);

        mockFs.readdir.mockRejectedValue(new Error('Failed'));

        await cleanupCommand(tempDir, { force: true, deleteLogs: true });

        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✨ Cleanup complete!'));
      });
    });

    describe('Integration Workflows', () => {
      it('should complete full workflow: force + delete logs', async () => {
        mockBranchManager.listPipelineBranches.mockResolvedValue(['pipeline/test-1', 'pipeline/test-2']);
        mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);

        mockFs.readdir.mockResolvedValue(['run-1.json', 'run-2.json']);
        mockFs.readFile.mockResolvedValue(JSON.stringify({
          pipelineConfig: { name: 'test' },
        }));

        await cleanupCommand(tempDir, { force: true, deleteLogs: true });

        expect(mockBranchManager.deleteLocalBranch).toHaveBeenCalledTimes(2);
        expect(mockFs.unlink).toHaveBeenCalledTimes(2);
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✨ Cleanup complete!'));
      });

      it('should complete full workflow: filter + force + delete logs', async () => {
        mockBranchManager.listPipelineBranches.mockResolvedValue([
          'pipeline/my-pipeline-1',
          'pipeline/my-pipeline-2',
          'pipeline/other-1'
        ]);
        mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);

        mockFs.readdir.mockResolvedValue(['run-1.json', 'run-2.json', 'run-3.json']);
        mockFs.readFile
          .mockResolvedValueOnce(JSON.stringify({ pipelineConfig: { name: 'my-pipeline' } }))
          .mockResolvedValueOnce(JSON.stringify({ pipelineConfig: { name: 'other' } }))
          .mockResolvedValueOnce(JSON.stringify({ pipelineConfig: { name: 'my-pipeline' } }));

        await cleanupCommand(tempDir, { force: true, deleteLogs: true, pipeline: 'my-pipeline' });

        expect(mockBranchManager.deleteLocalBranch).toHaveBeenCalledTimes(2);
        expect(mockFs.unlink).toHaveBeenCalledTimes(2); // Only my-pipeline logs
      });

      it('should complete full workflow: force + interactive decline', async () => {
        mockBranchManager.listPipelineBranches.mockResolvedValue(['pipeline/test']);
        mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);
        mockPrompts.confirm.mockResolvedValue(false);

        await cleanupCommand(tempDir, { force: true });

        expect(mockBranchManager.deleteLocalBranch).toHaveBeenCalledTimes(1);
        expect(mockPrompts.confirm).toHaveBeenCalled();
        expect(mockFs.unlink).not.toHaveBeenCalled();
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✨ Cleanup complete!'));
      });

      it('should complete full workflow: force + interactive accept', async () => {
        mockBranchManager.listPipelineBranches.mockResolvedValue(['pipeline/test']);
        mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);
        mockPrompts.confirm.mockResolvedValue(true);

        mockFs.readdir.mockResolvedValue(['run-1.json']);
        mockFs.readFile.mockResolvedValue(JSON.stringify({
          pipelineConfig: { name: 'test' },
        }));

        await cleanupCommand(tempDir, { force: true });

        expect(mockBranchManager.deleteLocalBranch).toHaveBeenCalledTimes(1);
        expect(mockPrompts.confirm).toHaveBeenCalled();
        expect(mockFs.unlink).toHaveBeenCalledTimes(1);
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✨ Cleanup complete!'));
      });
    });
  });

  describe('Remote Branch Handling', () => {
    describe('Remote Branch Detection', () => {
      it('should detect remote pipeline branches after local cleanup', async () => {
        mockBranchManager.listPipelineBranches.mockResolvedValue(['pipeline/test']);
        mockBranchManager.listRemotePipelineBranches.mockResolvedValue([
          'pipeline/test',
          'pipeline/old-run',
        ]);
        mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);

        await cleanupCommand(tempDir, { force: true });

        expect(mockBranchManager.listRemotePipelineBranches).toHaveBeenCalledWith('pipeline');
        expect(console.log).toHaveBeenCalledWith(
          expect.stringContaining('2 remote pipeline branch(es) found')
        );
      });

      it('should show remote branch warning in dry run mode', async () => {
        mockBranchManager.listPipelineBranches.mockResolvedValue(['pipeline/test']);
        mockBranchManager.listRemotePipelineBranches.mockResolvedValue([
          'pipeline/remote-1',
        ]);

        await cleanupCommand(tempDir);

        expect(console.log).toHaveBeenCalledWith(
          expect.stringContaining('1 remote pipeline branch(es) found')
        );
        expect(console.log).toHaveBeenCalledWith(
          expect.stringContaining('--delete-remote')
        );
      });

      it('should not show remote warning when no remote branches exist', async () => {
        mockBranchManager.listPipelineBranches.mockResolvedValue(['pipeline/test']);
        mockBranchManager.listRemotePipelineBranches.mockResolvedValue([]);
        mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);

        await cleanupCommand(tempDir, { force: true });

        const logs = vi.mocked(console.log).mock.calls.map((call) => call[0]);
        const remoteWarnings = logs.filter(
          (log) => log && typeof log === 'string' && log.includes('remote pipeline branch')
        );
        expect(remoteWarnings).toHaveLength(0);
      });

      it('should filter remote branches by pipeline name', async () => {
        mockBranchManager.listPipelineBranches.mockResolvedValue(['pipeline/my-pipeline']);
        mockBranchManager.listRemotePipelineBranches.mockResolvedValue([
          'pipeline/my-pipeline/run-1',
          'pipeline/my-pipeline/run-2',
          'pipeline/other-pipeline/run-1',
        ]);
        mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);

        await cleanupCommand(tempDir, { force: true, pipeline: 'my-pipeline' });

        expect(console.log).toHaveBeenCalledWith(
          expect.stringContaining('2 remote pipeline branch(es) found')
        );
      });

      it('should handle remote listing errors gracefully', async () => {
        mockBranchManager.listPipelineBranches.mockResolvedValue(['pipeline/test']);
        mockBranchManager.listRemotePipelineBranches.mockRejectedValue(
          new Error('Network error')
        );
        mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);

        // Should not throw - just skip remote branch handling
        await expect(cleanupCommand(tempDir, { force: true })).resolves.not.toThrow();
      });
    });

    describe('Remote Branch Deletion with --delete-remote', () => {
      it('should delete remote branches when --delete-remote is provided', async () => {
        mockBranchManager.listPipelineBranches.mockResolvedValue(['pipeline/test']);
        mockBranchManager.listRemotePipelineBranches.mockResolvedValue([
          'pipeline/remote-1',
          'pipeline/remote-2',
        ]);
        mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);
        mockBranchManager.deleteRemoteBranch.mockResolvedValue(undefined);

        await cleanupCommand(tempDir, { force: true, deleteRemote: true });

        expect(mockBranchManager.deleteRemoteBranch).toHaveBeenCalledTimes(2);
        expect(mockBranchManager.deleteRemoteBranch).toHaveBeenCalledWith('pipeline/remote-1');
        expect(mockBranchManager.deleteRemoteBranch).toHaveBeenCalledWith('pipeline/remote-2');
      });

      it('should display success message for each deleted remote branch', async () => {
        mockBranchManager.listPipelineBranches.mockResolvedValue(['pipeline/test']);
        mockBranchManager.listRemotePipelineBranches.mockResolvedValue([
          'pipeline/remote-branch',
        ]);
        mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);
        mockBranchManager.deleteRemoteBranch.mockResolvedValue(undefined);

        await cleanupCommand(tempDir, { force: true, deleteRemote: true });

        expect(console.log).toHaveBeenCalledWith('✅ Deleted remote branch: pipeline/remote-branch');
      });

      it('should display cleanup header for remote branches', async () => {
        mockBranchManager.listPipelineBranches.mockResolvedValue(['pipeline/test']);
        mockBranchManager.listRemotePipelineBranches.mockResolvedValue([
          'pipeline/remote-1',
        ]);
        mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);
        mockBranchManager.deleteRemoteBranch.mockResolvedValue(undefined);

        await cleanupCommand(tempDir, { force: true, deleteRemote: true });

        expect(console.log).toHaveBeenCalledWith(
          expect.stringContaining('🌐 Cleaning up remote branches...')
        );
      });

      it('should handle remote deletion failures gracefully', async () => {
        mockBranchManager.listPipelineBranches.mockResolvedValue(['pipeline/test']);
        mockBranchManager.listRemotePipelineBranches.mockResolvedValue([
          'pipeline/protected',
        ]);
        mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);
        mockBranchManager.deleteRemoteBranch.mockRejectedValue(
          new Error('Permission denied')
        );

        await cleanupCommand(tempDir, { force: true, deleteRemote: true });

        expect(console.error).toHaveBeenCalledWith(
          expect.stringContaining('❌ Failed to delete remote pipeline/protected: Permission denied')
        );
      });

      it('should continue on partial remote deletion failures', async () => {
        mockBranchManager.listPipelineBranches.mockResolvedValue(['pipeline/test']);
        mockBranchManager.listRemotePipelineBranches.mockResolvedValue([
          'pipeline/branch-1',
          'pipeline/branch-2',
          'pipeline/branch-3',
        ]);
        mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);
        mockBranchManager.deleteRemoteBranch
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new Error('Failed'))
          .mockResolvedValueOnce(undefined);

        await cleanupCommand(tempDir, { force: true, deleteRemote: true });

        expect(console.log).toHaveBeenCalledWith('✅ Deleted remote branch: pipeline/branch-1');
        expect(console.error).toHaveBeenCalledWith(
          expect.stringContaining('❌ Failed to delete remote pipeline/branch-2')
        );
        expect(console.log).toHaveBeenCalledWith('✅ Deleted remote branch: pipeline/branch-3');
      });

      it('should not delete remote branches without --delete-remote flag', async () => {
        mockBranchManager.listPipelineBranches.mockResolvedValue(['pipeline/test']);
        mockBranchManager.listRemotePipelineBranches.mockResolvedValue([
          'pipeline/remote-1',
        ]);
        mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);

        await cleanupCommand(tempDir, { force: true });

        expect(mockBranchManager.deleteRemoteBranch).not.toHaveBeenCalled();
        expect(console.log).toHaveBeenCalledWith(
          expect.stringContaining('Use --delete-remote to delete them')
        );
      });

      it('should filter remote branches by pipeline when deleting', async () => {
        mockBranchManager.listPipelineBranches.mockResolvedValue(['pipeline/my-pipeline']);
        mockBranchManager.listRemotePipelineBranches.mockResolvedValue([
          'pipeline/my-pipeline/run-1',
          'pipeline/my-pipeline/run-2',
          'pipeline/other/run-1',
        ]);
        mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);
        mockBranchManager.deleteRemoteBranch.mockResolvedValue(undefined);

        await cleanupCommand(tempDir, { force: true, deleteRemote: true, pipeline: 'my-pipeline' });

        expect(mockBranchManager.deleteRemoteBranch).toHaveBeenCalledTimes(2);
        expect(mockBranchManager.deleteRemoteBranch).toHaveBeenCalledWith('pipeline/my-pipeline/run-1');
        expect(mockBranchManager.deleteRemoteBranch).toHaveBeenCalledWith('pipeline/my-pipeline/run-2');
        expect(mockBranchManager.deleteRemoteBranch).not.toHaveBeenCalledWith('pipeline/other/run-1');
      });

      it('should show completion message after remote cleanup', async () => {
        mockBranchManager.listPipelineBranches.mockResolvedValue(['pipeline/test']);
        mockBranchManager.listRemotePipelineBranches.mockResolvedValue([
          'pipeline/remote-1',
        ]);
        mockBranchManager.deleteLocalBranch.mockResolvedValue(undefined);
        mockBranchManager.deleteRemoteBranch.mockResolvedValue(undefined);

        await cleanupCommand(tempDir, { force: true, deleteRemote: true });

        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✨ Cleanup complete!'));
      });
    });

    describe('Remote Branch with No Local Branches', () => {
      it('should still detect remote branches when no local branches exist', async () => {
        mockBranchManager.listPipelineBranches.mockResolvedValue([]);
        mockBranchManager.listRemotePipelineBranches.mockResolvedValue([
          'pipeline/orphaned-remote',
        ]);

        await cleanupCommand(tempDir);

        // Should mention remote branches even with no local branches
        expect(mockBranchManager.listRemotePipelineBranches).toHaveBeenCalled();
      });

      it('should delete remote branches even when no local branches to delete', async () => {
        mockBranchManager.listPipelineBranches.mockResolvedValue([]);
        mockBranchManager.listRemotePipelineBranches.mockResolvedValue([
          'pipeline/orphaned-1',
          'pipeline/orphaned-2',
        ]);
        mockBranchManager.deleteRemoteBranch.mockResolvedValue(undefined);

        await cleanupCommand(tempDir, { force: true, deleteRemote: true });

        expect(mockBranchManager.deleteRemoteBranch).toHaveBeenCalledTimes(2);
        expect(console.log).toHaveBeenCalledWith('✅ Deleted remote branch: pipeline/orphaned-1');
        expect(console.log).toHaveBeenCalledWith('✅ Deleted remote branch: pipeline/orphaned-2');
      });
    });
  });
});
