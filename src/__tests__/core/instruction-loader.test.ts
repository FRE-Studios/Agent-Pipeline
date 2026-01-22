// src/__tests__/core/instruction-loader.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InstructionLoader, InstructionContext } from '../../core/instruction-loader.js';
import * as fs from 'fs/promises';
import * as path from 'path';

vi.mock('fs/promises');

describe('InstructionLoader', () => {
  const testRepoPath = '/test/repo';
  let loader: InstructionLoader;

  beforeEach(() => {
    vi.clearAllMocks();
    loader = new InstructionLoader(testRepoPath);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loadHandoverInstructions', () => {
    it('should load from custom path when provided', async () => {
      const customTemplate = '## Custom Handover\n\n**Dir:** `{{handoverDir}}`';
      vi.mocked(fs.readFile).mockResolvedValue(customTemplate);

      const result = await loader.loadHandoverInstructions(
        'custom/handover.md',
        { handoverDir: '/custom/dir' }
      );

      expect(fs.readFile).toHaveBeenCalledWith(
        path.join(testRepoPath, 'custom/handover.md'),
        'utf-8'
      );
      expect(result).toContain('## Custom Handover');
      expect(result).toContain('/custom/dir');
    });

    it('should load from absolute custom path', async () => {
      const customTemplate = '## Absolute Path Handover';
      vi.mocked(fs.readFile).mockResolvedValue(customTemplate);

      await loader.loadHandoverInstructions('/absolute/path/handover.md');

      expect(fs.readFile).toHaveBeenCalledWith('/absolute/path/handover.md', 'utf-8');
    });

    it('should fall back to default path when custom path fails', async () => {
      const defaultTemplate = '## Default Handover\n\n**Dir:** `{{handoverDir}}`';
      vi.mocked(fs.readFile)
        .mockRejectedValueOnce(new Error('Not found'))
        .mockResolvedValueOnce(defaultTemplate);

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await loader.loadHandoverInstructions(
        'missing/handover.md',
        { handoverDir: '/test/handover' }
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Custom instruction file not found')
      );
      expect(result).toContain('## Default Handover');
      expect(result).toContain('/test/handover');

      consoleSpy.mockRestore();
    });

    it('should fall back to default path when no custom path provided', async () => {
      const defaultTemplate = '## Default from file';
      vi.mocked(fs.readFile).mockResolvedValue(defaultTemplate);

      await loader.loadHandoverInstructions(undefined, {});

      expect(fs.readFile).toHaveBeenCalledWith(
        path.join(testRepoPath, '.agent-pipeline/instructions/handover.md'),
        'utf-8'
      );
    });

    it('should fall back to built-in template when no files exist', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

      const result = await loader.loadHandoverInstructions(undefined, {
        handoverDir: '/fallback/dir',
        stageName: 'test-stage',
        timestamp: '2025-01-01T00:00:00Z',
        previousStagesSection: '(none)'
      });

      expect(result).toContain('## Pipeline Handover Context');
      expect(result).toContain('/fallback/dir');
      expect(result).toContain('test-stage');
      // Note: timestamp is no longer used in the simplified template
      // (orchestrator now handles HANDOVER.md updates)
      expect(result).toContain('orchestrator will update HANDOVER.md');
    });

    it('should interpolate all handover variables', async () => {
      const template = `
Dir: {{handoverDir}}
Stage: {{stageName}}
Time: {{timestamp}}
Previous: {{previousStagesSection}}
`;
      vi.mocked(fs.readFile).mockResolvedValue(template);

      const context: InstructionContext = {
        handoverDir: '/my/handover',
        stageName: 'review-stage',
        timestamp: '2025-12-18T10:00:00Z',
        previousStagesSection: '- stage-1\n- stage-2'
      };

      const result = await loader.loadHandoverInstructions('template.md', context);

      expect(result).toContain('/my/handover');
      expect(result).toContain('review-stage');
      expect(result).toContain('2025-12-18T10:00:00Z');
      expect(result).toContain('- stage-1');
      expect(result).toContain('- stage-2');
    });
  });

  describe('loadLoopInstructions', () => {
    it('should load from custom path when provided', async () => {
      const customTemplate = '## Custom Loop\n\nPending: {{pendingDir}}';
      vi.mocked(fs.readFile).mockResolvedValue(customTemplate);

      const result = await loader.loadLoopInstructions(
        'custom/loop.md',
        { pendingDir: '/custom/pending' }
      );

      expect(fs.readFile).toHaveBeenCalledWith(
        path.join(testRepoPath, 'custom/loop.md'),
        'utf-8'
      );
      expect(result).toContain('/custom/pending');
    });

    it('should fall back to default path when no custom path provided', async () => {
      const defaultTemplate = '## Loop from default';
      vi.mocked(fs.readFile).mockResolvedValue(defaultTemplate);

      await loader.loadLoopInstructions(undefined, {});

      expect(fs.readFile).toHaveBeenCalledWith(
        path.join(testRepoPath, '.agent-pipeline/instructions/loop.md'),
        'utf-8'
      );
    });

    it('should fall back to built-in template when no files exist', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

      const result = await loader.loadLoopInstructions(undefined, {
        pendingDir: '/pending/dir',
        currentIteration: 5,
        maxIterations: 100
      });

      expect(result).toContain('## Pipeline Looping');
      expect(result).toContain('LOOP MODE');
      expect(result).toContain('FINAL stage group');
      expect(result).toContain('/pending/dir');
      expect(result).toContain('5/100');
    });

    it('should interpolate all loop variables', async () => {
      const template = `
Pending: {{pendingDir}}
Iteration: {{currentIteration}}/{{maxIterations}}
`;
      vi.mocked(fs.readFile).mockResolvedValue(template);

      const context: InstructionContext = {
        pendingDir: '/my/pending',
        currentIteration: 3,
        maxIterations: 50
      };

      const result = await loader.loadLoopInstructions('template.md', context);

      expect(result).toContain('/my/pending');
      expect(result).toContain('3/50');
    });
  });

  describe('interpolate', () => {
    it('should keep placeholders when no context value provided', async () => {
      const template = 'Value: {{unknownKey}}';
      vi.mocked(fs.readFile).mockResolvedValue(template);

      const result = await loader.loadHandoverInstructions('template.md', {});

      expect(result).toContain('{{unknownKey}}');
    });

    it('should handle empty context', async () => {
      const template = 'Stage: {{stageName}}';
      vi.mocked(fs.readFile).mockResolvedValue(template);

      const result = await loader.loadHandoverInstructions('template.md', {});

      expect(result).toContain('{{stageName}}');
    });

    it('should convert numeric values to strings', async () => {
      const template = 'Iteration: {{currentIteration}}';
      vi.mocked(fs.readFile).mockResolvedValue(template);

      const result = await loader.loadLoopInstructions('template.md', {
        currentIteration: 42
      });

      expect(result).toContain('Iteration: 42');
    });

    it('should handle null values by keeping placeholder', async () => {
      const template = 'Value: {{stageName}}';
      vi.mocked(fs.readFile).mockResolvedValue(template);

      const result = await loader.loadHandoverInstructions('template.md', {
        stageName: undefined
      });

      expect(result).toContain('{{stageName}}');
    });
  });

  describe('built-in templates', () => {
    beforeEach(() => {
      // Force fallback to built-in by rejecting all file reads
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
    });

    it('should have complete handover template structure', async () => {
      const result = await loader.loadHandoverInstructions(undefined, {
        handoverDir: '/handover',
        stageName: 'test',
        timestamp: '2025-01-01T00:00:00Z',
        previousStagesSection: '(none)'
      });

      expect(result).toContain('## Pipeline Handover Context');
      expect(result).toContain('### Required Reading');
      expect(result).toContain('HANDOVER.md');
      expect(result).toContain('execution-log.md');
      expect(result).toContain('### Previous Stage Outputs');
      expect(result).toContain('### Your Output Requirements');
    });

    it('should have complete loop template structure', async () => {
      const result = await loader.loadLoopInstructions(undefined, {
        pendingDir: '/pending',
        currentIteration: 1,
        maxIterations: 10
      });

      expect(result).toContain('## Pipeline Looping');
      expect(result).toContain('LOOP MODE');
      expect(result).toContain('To queue the next pipeline');
      expect(result).toContain('When to Create a Next Pipeline');
      expect(result).toContain('When NOT to Create a Next Pipeline');
      expect(result).toContain('Loop status');
    });
  });
});
