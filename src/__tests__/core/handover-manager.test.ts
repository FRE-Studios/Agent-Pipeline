// src/__tests__/core/handover-manager.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HandoverManager } from '../../core/handover-manager.js';
import { InstructionLoader } from '../../core/instruction-loader.js';
import * as fs from 'fs/promises';
import * as path from 'path';

vi.mock('fs/promises');
vi.mock('../../core/instruction-loader.js');

describe('HandoverManager', () => {
  const testRepoPath = '/test/repo';
  const testPipelineName = 'test-pipeline';
  const testRunId = 'run-12345678-abcd-1234-5678-abcdef123456';
  let manager: HandoverManager;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock InstructionLoader
    vi.mocked(InstructionLoader).mockImplementation(() => ({
      loadHandoverInstructions: vi.fn().mockResolvedValue('Loaded handover instructions'),
      loadLoopInstructions: vi.fn().mockResolvedValue('Loaded loop instructions'),
    } as unknown as InstructionLoader));

    manager = new HandoverManager(testRepoPath, testPipelineName, testRunId);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create handover directory with default path', () => {
      const mgr = new HandoverManager('/my/repo', 'my-pipeline', 'run-abcdefgh-1234');
      expect(mgr.getHandoverDir()).toBe('/my/repo/.agent-pipeline/runs/my-pipeline-run-abcd');
    });

    it('should truncate runId to 8 characters in default path', () => {
      const mgr = new HandoverManager('/repo', 'pipe', 'run-12345678901234567890');
      expect(mgr.getHandoverDir()).toBe('/repo/.agent-pipeline/runs/pipe-run-1234');
    });

    it('should append runId to custom absolute directory for isolation', () => {
      const mgr = new HandoverManager('/repo', 'pipe', 'run-12345678-abcd', {
        directory: '/custom/absolute/path',
      });
      expect(mgr.getHandoverDir()).toBe('/custom/absolute/path/run-1234');
    });

    it('should append runId to custom relative directory for isolation', () => {
      const mgr = new HandoverManager('/repo', 'pipe', 'run-12345678-abcd', {
        directory: 'custom/relative/path',
      });
      expect(mgr.getHandoverDir()).toBe('/repo/custom/relative/path/run-1234');
    });

    it('should isolate multiple runs with same custom directory', () => {
      const mgr1 = new HandoverManager('/repo', 'pipeline', 'run-aaaaaaaa-1234', {
        directory: '.shared-handover',
      });
      const mgr2 = new HandoverManager('/repo', 'pipeline', 'run-bbbbbbbb-5678', {
        directory: '.shared-handover',
      });

      expect(mgr1.getHandoverDir()).toBe('/repo/.shared-handover/run-aaaa');
      expect(mgr2.getHandoverDir()).toBe('/repo/.shared-handover/run-bbbb');
      expect(mgr1.getHandoverDir()).not.toBe(mgr2.getHandoverDir());
    });

    it('should isolate loop iterations with custom directory', () => {
      // Simulate two loop iterations with different runIds
      const iteration1 = new HandoverManager('/repo', 'loop-pipeline', 'iter-11111111', {
        directory: '.my-handover',
      });
      const iteration2 = new HandoverManager('/repo', 'loop-pipeline', 'iter-22222222', {
        directory: '.my-handover',
      });

      expect(iteration1.getHandoverDir()).not.toBe(iteration2.getHandoverDir());
      expect(iteration1.getHandoverDir()).toBe('/repo/.my-handover/iter-111');
      expect(iteration2.getHandoverDir()).toBe('/repo/.my-handover/iter-222');
    });

    it('should create InstructionLoader with repo path', () => {
      new HandoverManager('/my/repo', 'pipe', 'run-123');
      expect(InstructionLoader).toHaveBeenCalledWith('/my/repo');
    });
  });

  describe('getHandoverDir', () => {
    it('should return the handover directory path', () => {
      expect(manager.getHandoverDir()).toBe(
        '/test/repo/.agent-pipeline/runs/test-pipeline-run-1234'
      );
    });
  });

  describe('initialize', () => {
    beforeEach(() => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    });

    it('should create handover directory', async () => {
      await manager.initialize();

      expect(fs.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('.agent-pipeline/runs/test-pipeline-run-1234'),
        { recursive: true }
      );
    });

    it('should create stages subdirectory', async () => {
      await manager.initialize();

      expect(fs.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('stages'),
        { recursive: true }
      );
    });

    it('should create initial HANDOVER.md file', async () => {
      await manager.initialize();

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('HANDOVER.md'),
        expect.stringContaining('# Pipeline Handover')
      );
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('Pipeline "test-pipeline" is starting')
      );
    });

    it('should create initial execution-log.md file', async () => {
      await manager.initialize();

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('execution-log.md'),
        expect.stringContaining('# Pipeline Execution Log')
      );
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('**Pipeline:** test-pipeline')
      );
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining(`**Run ID:** ${testRunId}`)
      );
    });

    it('should include timestamp in initial files', async () => {
      await manager.initialize();

      // HANDOVER.md should have timestamp
      const handoverCall = vi.mocked(fs.writeFile).mock.calls.find(
        call => (call[0] as string).includes('HANDOVER.md')
      );
      expect(handoverCall?.[1]).toContain('Timestamp:');

      // execution-log.md should have Started timestamp
      const logCall = vi.mocked(fs.writeFile).mock.calls.find(
        call => (call[0] as string).includes('execution-log.md')
      );
      expect(logCall?.[1]).toContain('**Started:**');
    });

    it('should include initial status sections in HANDOVER.md', async () => {
      await manager.initialize();

      const handoverCall = vi.mocked(fs.writeFile).mock.calls.find(
        call => (call[0] as string).includes('HANDOVER.md')
      );
      const content = handoverCall?.[1] as string;

      expect(content).toContain('## Current Status');
      expect(content).toContain('Stage: (none - pipeline starting)');
      expect(content).toContain('Status: initializing');
      expect(content).toContain('## Key Outputs');
      expect(content).toContain('(none yet)');
      expect(content).toContain('## Notes for Next Stage');
    });
  });

  describe('createStageDirectory', () => {
    beforeEach(() => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    });

    it('should create stage directory and return path', async () => {
      const result = await manager.createStageDirectory('my-stage');

      expect(fs.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('stages/my-stage'),
        { recursive: true }
      );
      expect(result).toContain('stages/my-stage');
    });

    it('should handle stage names with special characters', async () => {
      const result = await manager.createStageDirectory('stage-v2.0_test');

      expect(result).toContain('stages/stage-v2.0_test');
    });
  });

  describe('saveAgentOutput', () => {
    beforeEach(() => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    });

    it('should create stage directory and save output', async () => {
      const output = '# Stage Output\n\nThis is the output.';
      await manager.saveAgentOutput('my-stage', output);

      expect(fs.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('stages/my-stage'),
        { recursive: true }
      );
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('stages/my-stage/output.md'),
        output
      );
    });

    it('should handle empty output', async () => {
      await manager.saveAgentOutput('empty-stage', '');

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('stages/empty-stage/output.md'),
        ''
      );
    });

    it('should handle multiline output with special characters', async () => {
      const complexOutput = `# Stage: test

## Summary
Fixed issue with \`code\` and **markdown**.

\`\`\`typescript
const x = 1;
\`\`\`
`;
      await manager.saveAgentOutput('complex', complexOutput);

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        complexOutput
      );
    });
  });

  describe('appendToLog', () => {
    beforeEach(() => {
      vi.mocked(fs.appendFile).mockResolvedValue(undefined);
    });

    it('should append success log entry', async () => {
      await manager.appendToLog('my-stage', 'success', 45.5, 'Completed successfully');

      expect(fs.appendFile).toHaveBeenCalledWith(
        expect.stringContaining('execution-log.md'),
        expect.stringContaining('Stage: my-stage')
      );
      expect(fs.appendFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('**Status:** success')
      );
      expect(fs.appendFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('**Duration:** 45.5s')
      );
      expect(fs.appendFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('Completed successfully')
      );
    });

    it('should append failed log entry', async () => {
      await manager.appendToLog('failed-stage', 'failed', 10.2, 'Agent error occurred');

      expect(fs.appendFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('**Status:** failed')
      );
    });

    it('should append skipped log entry', async () => {
      await manager.appendToLog('skipped-stage', 'skipped', 0, 'Condition not met');

      expect(fs.appendFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('**Status:** skipped')
      );
      expect(fs.appendFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('**Duration:** 0.0s')
      );
    });

    it('should include timestamp in log entry', async () => {
      await manager.appendToLog('stage', 'success', 1, 'Done');

      const call = vi.mocked(fs.appendFile).mock.calls[0];
      const content = call[1] as string;

      // Should contain ISO timestamp format
      expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should include separator between entries', async () => {
      await manager.appendToLog('stage', 'success', 1, 'Done');

      const call = vi.mocked(fs.appendFile).mock.calls[0];
      const content = call[1] as string;

      expect(content).toContain('---');
    });

    it('should format duration to 1 decimal place', async () => {
      await manager.appendToLog('stage', 'success', 123.456, 'Done');

      expect(fs.appendFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('123.5s')
      );
    });
  });

  describe('getPreviousStages', () => {
    it('should return list of stage directories', async () => {
      vi.mocked(fs.readdir).mockResolvedValue([
        { name: 'stage1', isDirectory: () => true },
        { name: 'stage2', isDirectory: () => true },
        { name: 'stage3', isDirectory: () => true },
      ] as any);

      const result = await manager.getPreviousStages();

      expect(result).toEqual(['stage1', 'stage2', 'stage3']);
      expect(fs.readdir).toHaveBeenCalledWith(
        expect.stringContaining('stages'),
        { withFileTypes: true }
      );
    });

    it('should filter out non-directory entries', async () => {
      vi.mocked(fs.readdir).mockResolvedValue([
        { name: 'stage1', isDirectory: () => true },
        { name: 'readme.md', isDirectory: () => false },
        { name: 'stage2', isDirectory: () => true },
      ] as any);

      const result = await manager.getPreviousStages();

      expect(result).toEqual(['stage1', 'stage2']);
    });

    it('should return empty array when stages directory does not exist', async () => {
      vi.mocked(fs.readdir).mockRejectedValue(new Error('ENOENT'));

      const result = await manager.getPreviousStages();

      expect(result).toEqual([]);
    });

    it('should return empty array when stages directory is empty', async () => {
      vi.mocked(fs.readdir).mockResolvedValue([]);

      const result = await manager.getPreviousStages();

      expect(result).toEqual([]);
    });

    it('should handle permission errors gracefully', async () => {
      vi.mocked(fs.readdir).mockRejectedValue(new Error('EACCES'));

      const result = await manager.getPreviousStages();

      expect(result).toEqual([]);
    });
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

    it('should include success status', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('Output');
      vi.mocked(fs.writeFile).mockResolvedValue();

      await manager.copyStageToHandover('test');

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('Status: success')
      );
    });
  });

  describe('mergeParallelOutputs', () => {
    it('should merge multiple stage outputs into HANDOVER.md', async () => {
      const outputs: Record<string, string> = {
        lint: '# Stage: lint\n\n## Summary\nNo issues.',
        test: '# Stage: test\n\n## Summary\nAll tests pass.',
        build: '# Stage: build\n\n## Summary\nBuild successful.',
      };

      vi.mocked(fs.readFile).mockImplementation(async filePath => {
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

    it('should include separators between stage outputs', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('Output');
      vi.mocked(fs.writeFile).mockResolvedValue();

      await manager.mergeParallelOutputs(['stage1', 'stage2']);

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('---')
      );
    });

    it('should include Parallel Stage Outputs section', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('Output');
      vi.mocked(fs.writeFile).mockResolvedValue();

      await manager.mergeParallelOutputs(['stage1']);

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('## Parallel Stage Outputs')
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

    it('should include handover directory path', () => {
      const result = manager.buildContextMessage('stage', []);

      expect(result).toContain(manager.getHandoverDir());
    });

    it('should include required reading section', () => {
      const result = manager.buildContextMessage('stage', []);

      expect(result).toContain('### Required Reading');
      expect(result).toContain('HANDOVER.md');
      expect(result).toContain('execution-log.md');
    });

    it('should include output format template', () => {
      const result = manager.buildContextMessage('my-stage', []);

      expect(result).toContain('# Stage: my-stage');
      expect(result).toContain('## Summary');
      expect(result).toContain('## Files Changed');
      expect(result).toContain('## Reference Files');
      expect(result).toContain('## Next Stage Context');
    });

    it('should include guidelines', () => {
      const result = manager.buildContextMessage('stage', []);

      expect(result).toContain('**Guidelines:**');
      expect(result).toContain('Be ruthlessly concise');
    });
  });

  describe('buildContextMessageAsync', () => {
    it('should call InstructionLoader with correct context', async () => {
      const mockLoadHandover = vi.fn().mockResolvedValue('Loaded instructions');
      vi.mocked(InstructionLoader).mockImplementation(
        () =>
          ({
            loadHandoverInstructions: mockLoadHandover,
          }) as unknown as InstructionLoader
      );

      const mgr = new HandoverManager(testRepoPath, testPipelineName, testRunId);
      await mgr.buildContextMessageAsync('test-stage', ['prev1', 'prev2']);

      expect(mockLoadHandover).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({
          handoverDir: mgr.getHandoverDir(),
          stageName: 'test-stage',
          previousStagesSection: expect.stringContaining('prev1'),
        })
      );
    });

    it('should pass custom instruction path', async () => {
      const mockLoadHandover = vi.fn().mockResolvedValue('Custom instructions');
      vi.mocked(InstructionLoader).mockImplementation(
        () =>
          ({
            loadHandoverInstructions: mockLoadHandover,
          }) as unknown as InstructionLoader
      );

      const mgr = new HandoverManager(testRepoPath, testPipelineName, testRunId);
      await mgr.buildContextMessageAsync('stage', [], '/custom/instructions.md');

      expect(mockLoadHandover).toHaveBeenCalledWith(
        '/custom/instructions.md',
        expect.any(Object)
      );
    });

    it('should include timestamp in context', async () => {
      const mockLoadHandover = vi.fn().mockResolvedValue('Instructions');
      vi.mocked(InstructionLoader).mockImplementation(
        () =>
          ({
            loadHandoverInstructions: mockLoadHandover,
          }) as unknown as InstructionLoader
      );

      const mgr = new HandoverManager(testRepoPath, testPipelineName, testRunId);
      await mgr.buildContextMessageAsync('stage', []);

      expect(mockLoadHandover).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({
          timestamp: expect.stringMatching(/\d{4}-\d{2}-\d{2}T/),
        })
      );
    });

    it('should format previous stages section correctly for empty list', async () => {
      const mockLoadHandover = vi.fn().mockResolvedValue('Instructions');
      vi.mocked(InstructionLoader).mockImplementation(
        () =>
          ({
            loadHandoverInstructions: mockLoadHandover,
          }) as unknown as InstructionLoader
      );

      const mgr = new HandoverManager(testRepoPath, testPipelineName, testRunId);
      await mgr.buildContextMessageAsync('first-stage', []);

      expect(mockLoadHandover).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({
          previousStagesSection: '(none - this is the first stage)',
        })
      );
    });

    it('should format previous stages section with stage paths', async () => {
      const mockLoadHandover = vi.fn().mockResolvedValue('Instructions');
      vi.mocked(InstructionLoader).mockImplementation(
        () =>
          ({
            loadHandoverInstructions: mockLoadHandover,
          }) as unknown as InstructionLoader
      );

      const mgr = new HandoverManager(testRepoPath, testPipelineName, testRunId);
      await mgr.buildContextMessageAsync('current', ['stage1', 'stage2']);

      const call = mockLoadHandover.mock.calls[0];
      const context = call[1];

      expect(context.previousStagesSection).toContain('stages/stage1/output.md');
      expect(context.previousStagesSection).toContain('stages/stage2/output.md');
    });

    it('should return loaded instructions', async () => {
      const expectedInstructions = 'These are the loaded handover instructions';
      const mockLoadHandover = vi.fn().mockResolvedValue(expectedInstructions);
      vi.mocked(InstructionLoader).mockImplementation(
        () =>
          ({
            loadHandoverInstructions: mockLoadHandover,
          }) as unknown as InstructionLoader
      );

      const mgr = new HandoverManager(testRepoPath, testPipelineName, testRunId);
      const result = await mgr.buildContextMessageAsync('stage', []);

      expect(result).toBe(expectedInstructions);
    });
  });

  describe('edge cases', () => {
    it('should handle pipeline name with special characters', () => {
      const mgr = new HandoverManager('/repo', 'my-pipe_v2.0', 'run-123');
      expect(mgr.getHandoverDir()).toContain('my-pipe_v2.0');
    });

    it('should handle very short runId', () => {
      const mgr = new HandoverManager('/repo', 'pipe', 'abc');
      expect(mgr.getHandoverDir()).toBe('/repo/.agent-pipeline/runs/pipe-abc');
    });

    it('should handle empty stage list in buildContextMessage', () => {
      const result = manager.buildContextMessage('stage', []);
      expect(result).toContain('none - this is the first stage');
    });

    it('should handle many previous stages', () => {
      const manyStages = Array.from({ length: 10 }, (_, i) => `stage${i}`);
      const result = manager.buildContextMessage('current', manyStages);

      manyStages.forEach(stage => {
        expect(result).toContain(`stages/${stage}/output.md`);
      });
    });
  });
});
