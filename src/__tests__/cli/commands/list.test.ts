import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { listCommand } from '../../../cli/commands/list.js';
import { PipelineLoader } from '../../../config/pipeline-loader.js';
import { createTempDir, cleanupTempDir } from '../../setup.js';
import * as fs from 'fs/promises';
import * as path from 'path';

// Mock PipelineLoader
vi.mock('../../../config/pipeline-loader.js');

describe('listCommand', () => {
  let tempDir: string;
  let mockLoader: any;

  beforeEach(async () => {
    tempDir = await createTempDir('list-command-test-');

    // Setup PipelineLoader mock
    mockLoader = {
      listPipelines: vi.fn(),
    };
    vi.mocked(PipelineLoader).mockImplementation(() => mockLoader);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
    vi.clearAllMocks();
  });

  describe('Pipeline Listing', () => {
    it('should list all pipelines when pipelines exist', async () => {
      mockLoader.listPipelines.mockResolvedValue([
        'pipeline1',
        'pipeline2',
        'pipeline3',
      ]);

      await listCommand(tempDir);

      expect(mockLoader.listPipelines).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith('Available pipelines:');
      expect(console.log).toHaveBeenCalledWith('  - pipeline1');
      expect(console.log).toHaveBeenCalledWith('  - pipeline2');
      expect(console.log).toHaveBeenCalledWith('  - pipeline3');
    });

    it('should show message when no pipelines found', async () => {
      mockLoader.listPipelines.mockResolvedValue([]);

      await listCommand(tempDir);

      expect(mockLoader.listPipelines).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith('No pipelines found in .agent-pipeline/pipelines/');
      expect(console.log).not.toHaveBeenCalledWith('Available pipelines:');
    });

    it('should list single pipeline', async () => {
      mockLoader.listPipelines.mockResolvedValue(['single-pipeline']);

      await listCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith('Available pipelines:');
      expect(console.log).toHaveBeenCalledWith('  - single-pipeline');
    });

    it('should list pipelines in order returned by loader', async () => {
      mockLoader.listPipelines.mockResolvedValue([
        'z-pipeline',
        'a-pipeline',
        'm-pipeline',
      ]);

      await listCommand(tempDir);

      const logCalls = vi.mocked(console.log).mock.calls;
      const pipelineLogIndex1 = logCalls.findIndex(call => call[0] === '  - z-pipeline');
      const pipelineLogIndex2 = logCalls.findIndex(call => call[0] === '  - a-pipeline');
      const pipelineLogIndex3 = logCalls.findIndex(call => call[0] === '  - m-pipeline');

      expect(pipelineLogIndex1).toBeLessThan(pipelineLogIndex2);
      expect(pipelineLogIndex2).toBeLessThan(pipelineLogIndex3);
    });

    it('should handle pipelines with special characters in names', async () => {
      mockLoader.listPipelines.mockResolvedValue([
        'pipeline-with-dashes',
        'pipeline_with_underscores',
        'pipeline123',
      ]);

      await listCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith('  - pipeline-with-dashes');
      expect(console.log).toHaveBeenCalledWith('  - pipeline_with_underscores');
      expect(console.log).toHaveBeenCalledWith('  - pipeline123');
    });

    it('should handle long pipeline names', async () => {
      const longName = 'very-long-pipeline-name-that-exceeds-normal-length';
      mockLoader.listPipelines.mockResolvedValue([longName]);

      await listCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(`  - ${longName}`);
    });
  });

  describe('PipelineLoader Integration', () => {
    it('should instantiate PipelineLoader with correct path', async () => {
      mockLoader.listPipelines.mockResolvedValue([]);

      await listCommand(tempDir);

      expect(PipelineLoader).toHaveBeenCalledWith(tempDir);
    });

    it('should call listPipelines method', async () => {
      mockLoader.listPipelines.mockResolvedValue(['test']);

      await listCommand(tempDir);

      expect(mockLoader.listPipelines).toHaveBeenCalledTimes(1);
    });

    it('should handle loader errors gracefully', async () => {
      mockLoader.listPipelines.mockRejectedValue(new Error('Directory not found'));

      await expect(listCommand(tempDir)).rejects.toThrow('Directory not found');
    });
  });

  describe('Console Output Format', () => {
    it('should display header before pipeline names', async () => {
      mockLoader.listPipelines.mockResolvedValue(['pipeline1', 'pipeline2']);

      await listCommand(tempDir);

      const logCalls = vi.mocked(console.log).mock.calls.map(call => call[0]);
      const headerIndex = logCalls.indexOf('Available pipelines:');
      const firstPipelineIndex = logCalls.indexOf('  - pipeline1');

      expect(headerIndex).toBeGreaterThanOrEqual(0);
      expect(firstPipelineIndex).toBeGreaterThan(headerIndex);
    });

    it('should indent pipeline names with two spaces and dash', async () => {
      mockLoader.listPipelines.mockResolvedValue(['test-pipeline']);

      await listCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith('  - test-pipeline');
      expect(console.log).not.toHaveBeenCalledWith('test-pipeline');
      expect(console.log).not.toHaveBeenCalledWith('- test-pipeline');
    });

    it('should not display header when no pipelines', async () => {
      mockLoader.listPipelines.mockResolvedValue([]);

      await listCommand(tempDir);

      expect(console.log).not.toHaveBeenCalledWith('Available pipelines:');
    });

    it('should show correct message format for empty directory', async () => {
      mockLoader.listPipelines.mockResolvedValue([]);

      await listCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith('No pipelines found in .agent-pipeline/pipelines/');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty array from loader', async () => {
      mockLoader.listPipelines.mockResolvedValue([]);

      await listCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith('No pipelines found in .agent-pipeline/pipelines/');
    });

    it('should handle undefined from loader gracefully', async () => {
      mockLoader.listPipelines.mockResolvedValue(undefined as any);

      // Since the code does .length check, undefined will throw
      await expect(listCommand(tempDir)).rejects.toThrow();
    });

    it('should handle very large number of pipelines', async () => {
      const manyPipelines = Array.from({ length: 100 }, (_, i) => `pipeline-${i}`);
      mockLoader.listPipelines.mockResolvedValue(manyPipelines);

      await listCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith('Available pipelines:');
      expect(vi.mocked(console.log)).toHaveBeenCalledTimes(101); // Header + 100 pipelines
    });

    it('should handle pipeline names with .yml extension', async () => {
      mockLoader.listPipelines.mockResolvedValue(['pipeline.yml', 'another.yml']);

      await listCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith('  - pipeline.yml');
      expect(console.log).toHaveBeenCalledWith('  - another.yml');
    });
  });

  describe('Integration', () => {
    it('should complete full workflow for non-empty directory', async () => {
      mockLoader.listPipelines.mockResolvedValue(['pipeline1', 'pipeline2']);

      await listCommand(tempDir);

      expect(PipelineLoader).toHaveBeenCalledWith(tempDir);
      expect(mockLoader.listPipelines).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith('Available pipelines:');
      expect(console.log).toHaveBeenCalledWith('  - pipeline1');
      expect(console.log).toHaveBeenCalledWith('  - pipeline2');
    });

    it('should complete full workflow for empty directory', async () => {
      mockLoader.listPipelines.mockResolvedValue([]);

      await listCommand(tempDir);

      expect(PipelineLoader).toHaveBeenCalledWith(tempDir);
      expect(mockLoader.listPipelines).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith('No pipelines found in .agent-pipeline/pipelines/');
      expect(console.log).not.toHaveBeenCalledWith('Available pipelines:');
    });

    it('should work with different repository paths', async () => {
      const customPath = path.join(tempDir, 'custom-repo');
      await fs.mkdir(customPath, { recursive: true });
      mockLoader.listPipelines.mockResolvedValue(['test']);

      await listCommand(customPath);

      expect(PipelineLoader).toHaveBeenCalledWith(customPath);
    });
  });
});
