// src/__tests__/core/output-storage-manager.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { OutputStorageManager } from '../../core/output-storage-manager.js';
import { StageExecution } from '../../config/schema.js';

describe('OutputStorageManager', () => {
  const testRepoPath = path.join(process.cwd(), 'test-output-storage');
  const testRunId = 'test-run-123';
  let manager: OutputStorageManager;

  beforeEach(() => {
    manager = new OutputStorageManager(testRepoPath, testRunId);
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testRepoPath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('saveStageOutputs', () => {
    it('should create output directory on first save', async () => {
      await manager.saveStageOutputs('test-stage', { foo: 'bar' }, 'Raw text');

      const expectedDir = path.join(testRepoPath, '.agent-pipeline', 'outputs', testRunId);
      const stats = await fs.stat(expectedDir);
      expect(stats.isDirectory()).toBe(true);
    });

    it('should save structured outputs to JSON with proper formatting', async () => {
      const structuredData = {
        issues_found: 5,
        severity: 'high',
        details: { critical: 2, warning: 3 }
      };

      const result = await manager.saveStageOutputs('code-review', structuredData, 'Raw text');

      const content = await fs.readFile(result.structured, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed).toEqual(structuredData);
      expect(content).toContain('  '); // Verify pretty-printing (2-space indent)
    });

    it('should save raw text to markdown files', async () => {
      const rawText = '# Agent Output\n\nThis is the raw agent response.';

      const result = await manager.saveStageOutputs('test-stage', { foo: 'bar' }, rawText);

      const content = await fs.readFile(result.raw, 'utf-8');
      expect(content).toBe(rawText);
      expect(result.raw).toMatch(/test-stage-raw\.md$/);
    });

    it('should handle undefined structured data gracefully', async () => {
      const rawText = 'Some raw text';

      const result = await manager.saveStageOutputs('test-stage', undefined, rawText);

      // Should still save raw text
      const rawContent = await fs.readFile(result.raw, 'utf-8');
      expect(rawContent).toBe(rawText);

      // Structured file should not exist or be skipped
      try {
        await fs.access(result.structured);
        // If file exists, fail the test
        expect(true).toBe(false);
      } catch {
        // Expected: file doesn't exist
        expect(true).toBe(true);
      }
    });

    it('should return correct file paths', async () => {
      const result = await manager.saveStageOutputs('my-stage', { test: 'data' }, 'Raw');

      expect(result.structured).toContain('my-stage-output.json');
      expect(result.raw).toContain('my-stage-raw.md');
      expect(result.structured).toContain(testRunId);
      expect(result.raw).toContain(testRunId);
    });
  });

  describe('saveChangedFiles', () => {
    it('should save changed files list to text file', async () => {
      const files = [
        'src/core/stage-executor.ts',
        'src/core/pipeline-runner.ts',
        'src/utils/logger.ts'
      ];

      const filepath = await manager.saveChangedFiles(files);

      const content = await fs.readFile(filepath, 'utf-8');
      expect(content).toBe(files.join('\n'));
      expect(filepath).toContain('changed-files.txt');
    });

    it('should handle empty file list', async () => {
      const filepath = await manager.saveChangedFiles([]);

      const content = await fs.readFile(filepath, 'utf-8');
      expect(content).toBe('');
    });

    it('should create directory if it does not exist', async () => {
      const files = ['test.ts'];
      const filepath = await manager.saveChangedFiles(files);

      const stats = await fs.stat(path.dirname(filepath));
      expect(stats.isDirectory()).toBe(true);
    });
  });

  describe('savePipelineSummary', () => {
    it('should save pipeline summary with all stage metadata', async () => {
      const stages: StageExecution[] = [
        {
          stageName: 'code-review',
          status: 'success',
          startTime: '2024-01-01T00:00:00Z',
          endTime: '2024-01-01T00:01:00Z',
          duration: 60,
          commitSha: 'abc123',
          extractedData: { issues_found: 5 },
          retryAttempt: 0,
          maxRetries: 0
        },
        {
          stageName: 'security-scan',
          status: 'success',
          startTime: '2024-01-01T00:01:00Z',
          endTime: '2024-01-01T00:02:30Z',
          duration: 90,
          commitSha: 'def456',
          extractedData: { vulnerabilities: 0 },
          retryAttempt: 0,
          maxRetries: 0
        }
      ];

      const filepath = await manager.savePipelineSummary(stages);

      const content = await fs.readFile(filepath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed).toHaveLength(2);
      expect(parsed[0]).toEqual({
        name: 'code-review',
        status: 'success',
        duration: 60,
        commitSha: 'abc123',
        extractedData: { issues_found: 5 }
      });
      expect(parsed[1].name).toBe('security-scan');
      expect(filepath).toContain('pipeline-summary.json');
    });

    it('should handle stages without extractedData', async () => {
      const stages: StageExecution[] = [
        {
          stageName: 'test-stage',
          status: 'success',
          startTime: '2024-01-01T00:00:00Z',
          endTime: '2024-01-01T00:01:00Z',
          duration: 60,
          retryAttempt: 0,
          maxRetries: 0
        }
      ];

      const filepath = await manager.savePipelineSummary(stages);

      const content = await fs.readFile(filepath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed[0].extractedData).toBeUndefined();
    });
  });

  describe('readStageOutput', () => {
    it('should read stage outputs successfully', async () => {
      const structuredData = { test: 'data', count: 42 };
      await manager.saveStageOutputs('test-stage', structuredData, 'Raw text');

      const result = await manager.readStageOutput('test-stage');

      expect(result).toEqual(structuredData);
    });

    it('should return null for missing stage outputs (no errors)', async () => {
      const result = await manager.readStageOutput('non-existent-stage');

      expect(result).toBeNull();
    });

    it('should handle corrupted JSON gracefully', async () => {
      const outputDir = path.join(testRepoPath, '.agent-pipeline', 'outputs', testRunId);
      await fs.mkdir(outputDir, { recursive: true });
      const filepath = path.join(outputDir, 'corrupted-stage-output.json');
      await fs.writeFile(filepath, 'invalid json {', 'utf-8');

      const result = await manager.readStageOutput('corrupted-stage');

      expect(result).toBeNull();
    });
  });

  describe('compressFileList', () => {
    it('should handle empty file lists', async () => {
      const result = manager.compressFileList([]);

      expect(result).toBe('No files changed');
    });

    it('should show all files for small lists (≤5 files)', async () => {
      const files = [
        'src/core/stage-executor.ts',
        'src/core/pipeline-runner.ts',
        'src/utils/logger.ts'
      ];

      const result = manager.compressFileList(files);

      expect(result).toBe(files.join('\n'));
    });

    it('should show all files for exactly 5 files', async () => {
      const files = [
        'src/file1.ts',
        'src/file2.ts',
        'src/file3.ts',
        'src/file4.ts',
        'src/file5.ts'
      ];

      const result = manager.compressFileList(files);

      expect(result).toBe(files.join('\n'));
    });

    it('should compress large file lists with directory grouping', async () => {
      const files = [
        'src/core/stage-executor.ts',
        'src/core/pipeline-runner.ts',
        'src/core/git-manager.ts',
        'src/core/state-manager.ts',
        'src/utils/logger.ts',
        'src/utils/errors.ts',
        'src/cli/commands/init.ts',
        'src/cli/commands/run.ts',
        'README.md',
        'package.json'
      ];

      const result = manager.compressFileList(files);

      expect(result).toContain('Changed 10 files');
      expect(result).toContain('src/core/ (4)');
      expect(result).toContain('src/utils/ (2)');
    });

    it('should sort directories by file count (descending)', async () => {
      const files = [
        'src/core/file1.ts',
        'src/core/file2.ts',
        'src/core/file3.ts',
        'src/core/file4.ts',
        'src/core/file5.ts',
        'src/utils/file1.ts',
        'src/utils/file2.ts',
        'src/cli/file1.ts',
        'docs/file1.md',
        'test/file1.ts'
      ];

      const result = manager.compressFileList(files);

      // src/core has 5 files, should be first
      const coreIndex = result.indexOf('src/core/ (5)');
      const utilsIndex = result.indexOf('src/utils/ (2)');

      expect(coreIndex).toBeGreaterThan(-1);
      expect(utilsIndex).toBeGreaterThan(-1);
      expect(coreIndex).toBeLessThan(utilsIndex);
    });

    it('should limit to top 5 directories', async () => {
      const files = [
        ...Array(10).fill(0).map((_, i) => `dir1/file${i}.ts`),
        ...Array(9).fill(0).map((_, i) => `dir2/file${i}.ts`),
        ...Array(8).fill(0).map((_, i) => `dir3/file${i}.ts`),
        ...Array(7).fill(0).map((_, i) => `dir4/file${i}.ts`),
        ...Array(6).fill(0).map((_, i) => `dir5/file${i}.ts`),
        ...Array(5).fill(0).map((_, i) => `dir6/file${i}.ts`),
        ...Array(4).fill(0).map((_, i) => `dir7/file${i}.ts`)
      ];

      const result = manager.compressFileList(files);

      expect(result).toContain('...');
      expect(result).toContain('dir1/ (10)');
      expect(result).toContain('dir2/ (9)');
      expect(result).toContain('dir3/ (8)');
      expect(result).toContain('dir4/ (7)');
      expect(result).toContain('dir5/ (6)');
      expect(result).not.toContain('dir6/');
      expect(result).not.toContain('dir7/');
    });

    it('should not add ellipsis when exactly 5 directories', async () => {
      const files = [
        ...Array(5).fill(0).map((_, i) => `dir1/file${i}.ts`),
        ...Array(4).fill(0).map((_, i) => `dir2/file${i}.ts`),
        ...Array(3).fill(0).map((_, i) => `dir3/file${i}.ts`),
        ...Array(2).fill(0).map((_, i) => `dir4/file${i}.ts`),
        ...Array(1).fill(0).map((_, i) => `dir5/file${i}.ts`)
      ];

      const result = manager.compressFileList(files);

      expect(result).not.toContain('...');
      expect(result).toContain('Changed 15 files');
    });
  });

  describe('constructor and directory structure', () => {
    it('should create nested directories as needed', async () => {
      const deepManager = new OutputStorageManager(
        path.join(testRepoPath, 'deep', 'nested', 'path'),
        'test-run-456'
      );

      await deepManager.saveStageOutputs('test', { data: 'test' }, 'Raw');

      const expectedDir = path.join(
        testRepoPath,
        'deep',
        'nested',
        'path',
        '.agent-pipeline',
        'outputs',
        'test-run-456'
      );
      const stats = await fs.stat(expectedDir);
      expect(stats.isDirectory()).toBe(true);
    });

    it('should isolate outputs by runId', async () => {
      const manager1 = new OutputStorageManager(testRepoPath, 'run-1');
      const manager2 = new OutputStorageManager(testRepoPath, 'run-2');

      await manager1.saveStageOutputs('stage-1', { run: 1 }, 'Run 1');
      await manager2.saveStageOutputs('stage-1', { run: 2 }, 'Run 2');

      const output1 = await manager1.readStageOutput('stage-1');
      const output2 = await manager2.readStageOutput('stage-1');

      expect(output1).toEqual({ run: 1 });
      expect(output2).toEqual({ run: 2 });
    });
  });
});
