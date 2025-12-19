// src/__tests__/core/handover-manager.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HandoverManager } from '../../core/handover-manager.js';
import * as fs from 'fs/promises';
import * as path from 'path';

vi.mock('fs/promises');

describe('HandoverManager', () => {
  const testRepoPath = '/test/repo';
  const testPipelineName = 'test-pipeline';
  const testRunId = 'run-12345678-abcd-1234-5678-abcdef123456';
  let manager: HandoverManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new HandoverManager(testRepoPath, testPipelineName, testRunId);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('readStageOutput', () => {
    it('should read stage output file', async () => {
      const stageOutput = '# Stage: review\n\n## Summary\nCompleted review.';
      vi.mocked(fs.readFile).mockResolvedValue(stageOutput);

      const result = await manager.readStageOutput('review');

      expect(fs.readFile).toHaveBeenCalledWith(
        expect.stringContaining('stages/review/output.md'),
        'utf-8'
      );
      expect(result).toBe(stageOutput);
    });

    it('should return fallback message when file does not exist', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

      const result = await manager.readStageOutput('missing-stage');

      expect(result).toContain('No output found for stage: missing-stage');
    });
  });

  describe('copyStageToHandover', () => {
    it('should copy stage output to HANDOVER.md', async () => {
      const stageOutput = '# Stage: review\n\n## Summary\nDone.';
      vi.mocked(fs.readFile).mockResolvedValue(stageOutput);
      vi.mocked(fs.writeFile).mockResolvedValue();

      await manager.copyStageToHandover('review');

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('HANDOVER.md'),
        expect.stringContaining('# Pipeline Handover')
      );
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('Stage: review')
      );
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining(stageOutput)
      );
    });

    it('should include timestamp in HANDOVER.md', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('Stage output');
      vi.mocked(fs.writeFile).mockResolvedValue();

      await manager.copyStageToHandover('test');

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('Timestamp:')
      );
    });
  });

  describe('mergeParallelOutputs', () => {
    it('should merge multiple stage outputs into HANDOVER.md', async () => {
      const outputs: Record<string, string> = {
        'lint': '# Stage: lint\n\n## Summary\nNo issues.',
        'test': '# Stage: test\n\n## Summary\nAll tests pass.',
        'build': '# Stage: build\n\n## Summary\nBuild successful.'
      };

      vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
        const stageName = (filePath as string).split('/stages/')[1]?.split('/')[0];
        return outputs[stageName] || 'No output';
      });
      vi.mocked(fs.writeFile).mockResolvedValue();

      await manager.mergeParallelOutputs(['lint', 'test', 'build']);

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('HANDOVER.md'),
        expect.stringContaining('parallel group completed')
      );
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('lint, test, build')
      );
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('### lint')
      );
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('### test')
      );
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('### build')
      );
    });

    it('should handle single stage in parallel group', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('Single stage output');
      vi.mocked(fs.writeFile).mockResolvedValue();

      await manager.mergeParallelOutputs(['only-stage']);

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('HANDOVER.md'),
        expect.stringContaining('only-stage')
      );
    });

    it('should handle missing stage outputs gracefully', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(fs.writeFile).mockResolvedValue();

      await manager.mergeParallelOutputs(['missing1', 'missing2']);

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('No output found')
      );
    });
  });

  describe('buildContextMessage', () => {
    it('should include simplified output requirements', () => {
      const result = manager.buildContextMessage('test-stage', []);

      expect(result).toContain('## Pipeline Handover Context');
      expect(result).toContain('stages/test-stage/output.md');
      expect(result).toContain('orchestrator will update HANDOVER.md');
    });

    it('should list previous stage outputs', () => {
      const result = manager.buildContextMessage('current', ['stage1', 'stage2']);

      expect(result).toContain('stages/stage1/output.md');
      expect(result).toContain('stages/stage2/output.md');
    });

    it('should indicate when no previous stages exist', () => {
      const result = manager.buildContextMessage('first-stage', []);

      expect(result).toContain('none - this is the first stage');
    });
  });
});
