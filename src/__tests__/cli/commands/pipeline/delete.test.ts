import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { deletePipelineCommand } from '../../../../cli/commands/pipeline/delete.js';
import { PipelineLoader } from '../../../../config/pipeline-loader.js';
import { InteractivePrompts } from '../../../../cli/utils/interactive-prompts.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createTempDir, cleanupTempDir } from '../../../setup.js';

// Mock dependencies
vi.mock('fs/promises');
vi.mock('../../../../config/pipeline-loader.js');
vi.mock('../../../../cli/utils/interactive-prompts.js');

describe('deletePipelineCommand', () => {
  let tempDir: string;
  let mockLoader: any;
  let processExitSpy: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;

  beforeEach(async () => {
    tempDir = await createTempDir('delete-pipeline-test-');

    // Setup PipelineLoader mock
    mockLoader = {
      loadPipeline: vi.fn(),
    };
    vi.mocked(PipelineLoader).mockImplementation(() => mockLoader);

    // Spy on process.exit
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
      throw new Error(`process.exit(${code})`);
    });

    // Spy on console methods
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
    vi.clearAllMocks();
    processExitSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('Basic Execution', () => {
    it('should load pipeline to verify it exists', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [{ name: 'agent1', agent: 'agent1.md' }],
      };
      mockLoader.loadPipeline.mockResolvedValue(mockConfig);
      vi.mocked(InteractivePrompts.confirm).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      vi.mocked(fs.unlink).mockResolvedValue(undefined);

      try {
        await deletePipelineCommand(tempDir, 'test-pipeline');
      } catch (error) {
        // Expected
      }

      expect(mockLoader.loadPipeline).toHaveBeenCalledWith('test-pipeline');
    });

    it('should show pipeline details before deletion', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'post-commit',
        agents: [
          { name: 'agent1', agent: 'agent1.md' },
          { name: 'agent2', agent: 'agent2.md' },
        ],
      };
      mockLoader.loadPipeline.mockResolvedValue(mockConfig);
      vi.mocked(InteractivePrompts.confirm).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      vi.mocked(fs.unlink).mockResolvedValue(undefined);

      try {
        await deletePipelineCommand(tempDir, 'test-pipeline');
      } catch (error) {
        // Expected
      }

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Trigger: post-commit'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Agents: 2'));
    });

    it('should prompt for confirmation by default', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue(mockConfig);
      vi.mocked(InteractivePrompts.confirm).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      vi.mocked(fs.unlink).mockResolvedValue(undefined);

      try {
        await deletePipelineCommand(tempDir, 'test-pipeline');
      } catch (error) {
        // Expected
      }

      expect(InteractivePrompts.confirm).toHaveBeenCalledWith(
        expect.stringContaining('Are you sure you want to delete'),
        false
      );
    });

    it('should delete pipeline file when confirmed', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue(mockConfig);
      vi.mocked(InteractivePrompts.confirm).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      vi.mocked(fs.unlink).mockResolvedValue(undefined);

      try {
        await deletePipelineCommand(tempDir, 'test-pipeline');
      } catch (error) {
        // Expected
      }

      expect(fs.unlink).toHaveBeenCalledWith(
        path.join(tempDir, '.agent-pipeline', 'pipelines', 'test-pipeline.yml')
      );
    });

    it('should show success message after deletion', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue(mockConfig);
      vi.mocked(InteractivePrompts.confirm).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      vi.mocked(fs.unlink).mockResolvedValue(undefined);

      try {
        await deletePipelineCommand(tempDir, 'test-pipeline');
      } catch (error) {
        // Expected
      }

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Deleted pipeline: test-pipeline'));
    });

    it('should cancel when user declines confirmation', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue(mockConfig);
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(false);
      vi.mocked(fs.unlink).mockResolvedValue(undefined);

      await deletePipelineCommand(tempDir, 'test-pipeline');

      expect(fs.unlink).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith('Cancelled.');
    });
  });

  describe('Force Flag', () => {
    it('should skip confirmation when --force flag set', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue(mockConfig);
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(false); // For log deletion
      vi.mocked(fs.unlink).mockResolvedValue(undefined);

      try {
        await deletePipelineCommand(tempDir, 'test-pipeline', { force: true });
      } catch (error) {
        // Expected
      }

      // Confirmation should only be called once (for log deletion)
      expect(InteractivePrompts.confirm).toHaveBeenCalledTimes(1);
      expect(fs.unlink).toHaveBeenCalled();
    });

    it('should delete immediately with --force flag', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue(mockConfig);
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(false);
      vi.mocked(fs.unlink).mockResolvedValue(undefined);

      try {
        await deletePipelineCommand(tempDir, 'test-pipeline', { force: true });
      } catch (error) {
        // Expected
      }

      expect(fs.unlink).toHaveBeenCalledWith(
        path.join(tempDir, '.agent-pipeline', 'pipelines', 'test-pipeline.yml')
      );
    });
  });

  describe('Log Deletion', () => {
    it('should prompt for log deletion by default', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue(mockConfig);
      vi.mocked(InteractivePrompts.confirm).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      vi.mocked(fs.unlink).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue([]);

      try {
        await deletePipelineCommand(tempDir, 'test-pipeline');
      } catch (error) {
        // Expected
      }

      expect(InteractivePrompts.confirm).toHaveBeenCalledWith(
        expect.stringContaining('Delete associated history files?'),
        false
      );
    });

    it('should delete logs when --delete-logs flag set', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue(mockConfig);
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(true); // For delete confirmation
      vi.mocked(fs.unlink).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue(['run1.json', 'run2.json'] as any);
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ pipelineConfig: { name: 'test-pipeline' } })
      );

      try {
        await deletePipelineCommand(tempDir, 'test-pipeline', { deleteLogs: true });
      } catch (error) {
        // Expected
      }

      expect(fs.readdir).toHaveBeenCalledWith(
        path.join(tempDir, '.agent-pipeline', 'state', 'runs')
      );
    });

    it('should only delete logs for the specific pipeline', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue(mockConfig);
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(true); // For delete confirmation
      vi.mocked(fs.unlink).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue(['run1.json', 'run2.json', 'run3.json'] as any);

      // Mock readFile to return different pipeline names
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(JSON.stringify({ pipelineConfig: { name: 'test-pipeline' } }))
        .mockResolvedValueOnce(JSON.stringify({ pipelineConfig: { name: 'other-pipeline' } }))
        .mockResolvedValueOnce(JSON.stringify({ pipelineConfig: { name: 'test-pipeline' } }));

      try {
        await deletePipelineCommand(tempDir, 'test-pipeline', { deleteLogs: true });
      } catch (error) {
        // Expected
      }

      // Should delete 2 files (run1.json and run3.json)
      expect(fs.unlink).toHaveBeenCalledTimes(3); // 1 for pipeline file + 2 for state files
    });

    it('should show count of deleted log files', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue(mockConfig);
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(true); // For delete confirmation
      vi.mocked(fs.unlink).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue(['run1.json', 'run2.json'] as any);
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ pipelineConfig: { name: 'test-pipeline' } })
      );

      try {
        await deletePipelineCommand(tempDir, 'test-pipeline', { deleteLogs: true });
      } catch (error) {
        // Expected
      }

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Deleted 2 history file(s)'));
    });

    it('should skip log deletion when user declines', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue(mockConfig);
      vi.mocked(InteractivePrompts.confirm).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      vi.mocked(fs.unlink).mockResolvedValue(undefined);

      try {
        await deletePipelineCommand(tempDir, 'test-pipeline');
      } catch (error) {
        // Expected
      }

      // Only pipeline file should be deleted
      expect(fs.unlink).toHaveBeenCalledTimes(1);
    });

    it('should handle missing state directory gracefully', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue(mockConfig);
      vi.mocked(InteractivePrompts.confirm).mockResolvedValueOnce(true).mockResolvedValueOnce(true);
      vi.mocked(fs.unlink).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockRejectedValue(new Error('Directory not found'));

      try {
        await deletePipelineCommand(tempDir, 'test-pipeline');
      } catch (error) {
        // Expected
      }

      // Should not crash
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Could not delete history files')
      );
    });

    it('should filter out non-JSON files when scanning logs', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue(mockConfig);
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(true); // For delete confirmation
      vi.mocked(fs.unlink).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue(['run1.json', '.DS_Store', 'readme.txt'] as any);
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ pipelineConfig: { name: 'test-pipeline' } })
      );

      try {
        await deletePipelineCommand(tempDir, 'test-pipeline', { deleteLogs: true });
      } catch (error) {
        // Expected
      }

      // Should only read the JSON file
      expect(fs.readFile).toHaveBeenCalledTimes(1);
    });

    it('should handle JSON parse errors in state files', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue(mockConfig);
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(true); // For delete confirmation
      vi.mocked(fs.unlink).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue(['corrupted.json'] as any);
      vi.mocked(fs.readFile).mockResolvedValue('invalid json{{{');

      try {
        await deletePipelineCommand(tempDir, 'test-pipeline', { deleteLogs: true });
      } catch (error) {
        // Expected - should handle gracefully
      }

      // Should still delete the pipeline file
      expect(fs.unlink).toHaveBeenCalledWith(
        path.join(tempDir, '.agent-pipeline', 'pipelines', 'test-pipeline.yml')
      );
    });
  });

  describe('Error Handling', () => {
    it('should exit when pipeline not found', async () => {
      mockLoader.loadPipeline.mockRejectedValue(new Error('Pipeline not found'));

      await expect(
        deletePipelineCommand(tempDir, 'nonexistent-pipeline')
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Pipeline "nonexistent-pipeline" not found')
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle file deletion errors', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue(mockConfig);
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(true);
      vi.mocked(fs.unlink).mockRejectedValue(new Error('Permission denied'));

      await expect(
        deletePipelineCommand(tempDir, 'test-pipeline')
      ).rejects.toThrow('process.exit(1)');

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle generic errors', async () => {
      mockLoader.loadPipeline.mockRejectedValue(new Error('Some random error'));

      await expect(
        deletePipelineCommand(tempDir, 'test-pipeline')
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to delete pipeline')
      );
    });
  });

  describe('Integration', () => {
    it('should work with both --force and --delete-logs flags', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue(mockConfig);
      vi.mocked(fs.unlink).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue(['run1.json'] as any);
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ pipelineConfig: { name: 'test-pipeline' } })
      );

      try {
        await deletePipelineCommand(tempDir, 'test-pipeline', {
          force: true,
          deleteLogs: true,
        });
      } catch (error) {
        // Expected
      }

      // Should not prompt at all
      expect(InteractivePrompts.confirm).not.toHaveBeenCalled();

      // Should delete both pipeline and log files
      expect(fs.unlink).toHaveBeenCalledWith(
        path.join(tempDir, '.agent-pipeline', 'pipelines', 'test-pipeline.yml')
      );
      expect(fs.readdir).toHaveBeenCalled();
    });

    it('should complete full workflow with confirmations', async () => {
      const mockConfig = {
        name: 'full-pipeline',
        trigger: 'post-commit',
        agents: [{ name: 'agent1', agent: 'agent1.md' }],
      };
      mockLoader.loadPipeline.mockResolvedValue(mockConfig);
      vi.mocked(InteractivePrompts.confirm).mockResolvedValueOnce(true).mockResolvedValueOnce(true);
      vi.mocked(fs.unlink).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue([]);

      try {
        await deletePipelineCommand(tempDir, 'full-pipeline');
      } catch (error) {
        // Expected
      }

      expect(PipelineLoader).toHaveBeenCalledWith(tempDir);
      expect(mockLoader.loadPipeline).toHaveBeenCalledWith('full-pipeline');
      expect(InteractivePrompts.confirm).toHaveBeenCalledTimes(2);
      expect(fs.unlink).toHaveBeenCalled();
    });
  });
});
