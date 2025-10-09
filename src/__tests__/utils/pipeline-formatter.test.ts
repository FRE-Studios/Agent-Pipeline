// src/__tests__/utils/pipeline-formatter.test.ts

import { describe, it, expect } from 'vitest';
import { PipelineFormatter } from '../../utils/pipeline-formatter.js';
import {
  completedPipelineState,
  failedPipelineState,
  pipelineStateWithPR,
  runningPipelineState,
  successfulStageExecution,
  failedStageExecution,
  skippedStageExecution,
  parallelPipelineState,
} from '../fixtures/pipeline-states.js';
import { PipelineState, StageExecution } from '../../config/schema.js';

describe('PipelineFormatter', () => {
  describe('getStatusEmoji', () => {
    it('should return ⏳ for running status', () => {
      expect(PipelineFormatter.getStatusEmoji('running')).toBe('⏳');
    });

    it('should return ✅ for success status', () => {
      expect(PipelineFormatter.getStatusEmoji('success')).toBe('✅');
    });

    it('should return ✅ for completed status', () => {
      expect(PipelineFormatter.getStatusEmoji('completed')).toBe('✅');
    });

    it('should return ❌ for failed status', () => {
      expect(PipelineFormatter.getStatusEmoji('failed')).toBe('❌');
    });

    it('should return ⏭️ for skipped status', () => {
      expect(PipelineFormatter.getStatusEmoji('skipped')).toBe('⏭️');
    });

    it('should return ⏸️ for pending status', () => {
      expect(PipelineFormatter.getStatusEmoji('pending')).toBe('⏸️');
    });

    it('should return ⚠️ for partial status', () => {
      expect(PipelineFormatter.getStatusEmoji('partial')).toBe('⚠️');
    });

    it('should return ❓ for unknown status', () => {
      expect(PipelineFormatter.getStatusEmoji('unknown-status')).toBe('❓');
      expect(PipelineFormatter.getStatusEmoji('')).toBe('❓');
    });
  });

  describe('formatSummary', () => {
    describe('Basic Formatting', () => {
      it('should format completed pipeline with all fields', () => {
        const result = PipelineFormatter.formatSummary(completedPipelineState);

        expect(result).toContain('Pipeline Summary: simple-test');
        expect(result).toContain('Status: ✅ COMPLETED');
        expect(result).toContain('Duration: 120.00s');
        expect(result).toContain('initial → stage-2');
        expect(result).toContain('Stages:');
        expect(result).toContain('stage-1');
        expect(result).toContain('stage-2');
      });

      it('should format running pipeline without finalCommit', () => {
        const result = PipelineFormatter.formatSummary(runningPipelineState);

        expect(result).toContain('Status: ⏳ RUNNING');
        expect(result).toContain('Duration: 60.00s');
        expect(result).toContain('Commits: initial → undefined');
      });

      it('should format failed pipeline with error information', () => {
        const result = PipelineFormatter.formatSummary(failedPipelineState);

        expect(result).toContain('Status: ❌ FAILED');
        expect(result).toContain('stage-2');
        expect(result).toContain('Error: Agent execution failed');
      });

      it('should include PR URL when present', () => {
        const result = PipelineFormatter.formatSummary(pipelineStateWithPR);

        expect(result).toContain('Pull Request: https://github.com/test/repo/pull/123');
      });

      it('should omit PR section when no PR exists', () => {
        const result = PipelineFormatter.formatSummary(completedPipelineState);

        expect(result).not.toContain('Pull Request:');
      });
    });

    describe('Structure Validation', () => {
      it('should include header separator with 60 equals signs', () => {
        const result = PipelineFormatter.formatSummary(completedPipelineState);
        const separator = '='.repeat(60);

        expect(result).toContain(separator);
        // Should appear at least twice (top and bottom)
        const count = (result.match(/={60}/g) || []).length;
        expect(count).toBeGreaterThanOrEqual(2);
      });

      it('should include pipeline name in header', () => {
        const result = PipelineFormatter.formatSummary(completedPipelineState);

        expect(result).toContain('Pipeline Summary: simple-test');
      });

      it('should include status with emoji and uppercase', () => {
        const result = PipelineFormatter.formatSummary(completedPipelineState);

        expect(result).toContain('Status: ✅ COMPLETED');
        expect(result).toMatch(/Status: .+ [A-Z]+/);
      });

      it('should format duration with 2 decimal places', () => {
        const result = PipelineFormatter.formatSummary(completedPipelineState);

        expect(result).toMatch(/Duration: \d+\.\d{2}s/);
        expect(result).toContain('120.00s');
      });

      it('should truncate commit SHAs to 7 characters', () => {
        const result = PipelineFormatter.formatSummary(completedPipelineState);

        // Initial commit truncated
        expect(result).toContain('initial');
        // Final commit truncated
        expect(result).toContain('stage-2');
        // Should not contain full SHA
        expect(result).not.toContain('initial-commit-sha');
      });
    });

    describe('Stage Listing', () => {
      it('should format multiple stages correctly', () => {
        const result = PipelineFormatter.formatSummary(completedPipelineState);

        expect(result).toContain('stage-1');
        expect(result).toContain('stage-2');
        expect(result).toContain('✅');
      });

      it('should handle empty stages array', () => {
        const emptyState: PipelineState = {
          ...completedPipelineState,
          stages: [],
        };

        const result = PipelineFormatter.formatSummary(emptyState);

        expect(result).toContain('Stages:');
        // Should still have structure but no stage entries
        expect(result).toContain('='.repeat(60));
      });

      it('should handle pipeline with mix of success and failed stages', () => {
        const result = PipelineFormatter.formatSummary(failedPipelineState);

        // Should show both stages with different status
        expect(result).toContain('✅ stage-1');
        expect(result).toContain('❌ stage-2');
        expect(result).toContain('Error: Agent execution failed');
      });
    });

    describe('Edge Cases', () => {
      it('should handle very long pipeline names', () => {
        const longNameState: PipelineState = {
          ...completedPipelineState,
          pipelineConfig: {
            ...completedPipelineState.pipelineConfig,
            name: 'super-long-pipeline-name-with-many-characters-that-goes-on-and-on',
          },
        };

        const result = PipelineFormatter.formatSummary(longNameState);

        expect(result).toContain('super-long-pipeline-name-with-many-characters-that-goes-on-and-on');
      });

      it('should handle zero duration', () => {
        const zeroDurationState: PipelineState = {
          ...completedPipelineState,
          artifacts: {
            ...completedPipelineState.artifacts,
            totalDuration: 0,
          },
        };

        const result = PipelineFormatter.formatSummary(zeroDurationState);

        expect(result).toContain('Duration: 0.00s');
      });
    });
  });

  describe('formatStageInfo', () => {
    describe('Complete Information', () => {
      it('should format stage with all fields', () => {
        const result = PipelineFormatter.formatStageInfo(successfulStageExecution);

        expect(result).toContain('✅ test-stage (60.0s)');
        expect(result).toContain('└─ Commit: abc123d');
      });

      it('should format duration with 1 decimal place', () => {
        const result = PipelineFormatter.formatStageInfo(successfulStageExecution);

        expect(result).toMatch(/\(\d+\.\d{1}s\)/);
        expect(result).toContain('(60.0s)');
      });

      it('should truncate commit SHA to 7 characters', () => {
        const result = PipelineFormatter.formatStageInfo(successfulStageExecution);

        expect(result).toContain('abc123d');
        expect(result).not.toContain('abc123def456');
      });

      it('should include tree structure symbols', () => {
        const result = PipelineFormatter.formatStageInfo(successfulStageExecution);

        expect(result).toContain('└─');
        expect(result).toContain('└─ Commit:');
      });
    });

    describe('Optional Fields', () => {
      it('should handle stage without duration', () => {
        const stageWithoutDuration: StageExecution = {
          ...successfulStageExecution,
          duration: undefined,
        };

        const result = PipelineFormatter.formatStageInfo(stageWithoutDuration);

        expect(result).toContain('✅ test-stage');
        expect(result).not.toContain('(');
        expect(result).not.toContain('s)');
      });

      it('should handle stage without commit', () => {
        const stageWithoutCommit: StageExecution = {
          ...successfulStageExecution,
          commitSha: undefined,
        };

        const result = PipelineFormatter.formatStageInfo(stageWithoutCommit);

        expect(result).toContain('✅ test-stage');
        expect(result).not.toContain('└─ Commit:');
      });

      it('should handle stage with error message', () => {
        const result = PipelineFormatter.formatStageInfo(failedStageExecution);

        expect(result).toContain('└─ Error: Test error');
        expect(result).toContain('❌ test-stage');
      });

      it('should format multi-line error messages correctly', () => {
        const stageWithMultilineError: StageExecution = {
          ...failedStageExecution,
          error: {
            message: 'Connection timeout\nRetry failed after 3 attempts',
            suggestion: 'Check network',
          },
        };

        const result = PipelineFormatter.formatStageInfo(stageWithMultilineError);

        expect(result).toContain('└─ Error: Connection timeout\nRetry failed after 3 attempts');
      });
    });

    describe('Status Variations', () => {
      it('should show correct emoji for success status', () => {
        const result = PipelineFormatter.formatStageInfo(successfulStageExecution);

        expect(result).toContain('✅');
      });

      it('should show correct emoji for failed status', () => {
        const result = PipelineFormatter.formatStageInfo(failedStageExecution);

        expect(result).toContain('❌');
      });

      it('should show correct emoji for skipped status', () => {
        const result = PipelineFormatter.formatStageInfo(skippedStageExecution);

        expect(result).toContain('⏭️');
      });
    });

    describe('Edge Cases', () => {
      it('should handle stage with both commit and error', () => {
        const stageWithBoth: StageExecution = {
          ...failedStageExecution,
          commitSha: 'abc123def',
        };

        const result = PipelineFormatter.formatStageInfo(stageWithBoth);

        expect(result).toContain('└─ Commit: abc123d');
        expect(result).toContain('└─ Error: Test error');
      });

      it('should handle very short stage names', () => {
        const shortNameStage: StageExecution = {
          ...successfulStageExecution,
          stageName: 'a',
        };

        const result = PipelineFormatter.formatStageInfo(shortNameStage);

        expect(result).toContain('✅ a');
      });

      it('should handle zero duration as no duration shown', () => {
        const zeroDurationStage: StageExecution = {
          ...successfulStageExecution,
          duration: 0,
        };

        const result = PipelineFormatter.formatStageInfo(zeroDurationStage);

        // Zero is falsy, so duration is not shown
        expect(result).toContain('✅ test-stage');
        expect(result).not.toContain('(0.0s)');
        expect(result).not.toContain('(');
      });
    });
  });

  describe('formatRetryInfo', () => {
    describe('With Retry Attempts', () => {
      it('should format retry 1/3 for first retry', () => {
        const result = PipelineFormatter.formatRetryInfo(1, 3);

        expect(result).toBe(' (retry 1/3)');
      });

      it('should format retry 2/3 for second retry', () => {
        const result = PipelineFormatter.formatRetryInfo(2, 3);

        expect(result).toBe(' (retry 2/3)');
      });

      it('should format retry 3/3 for final retry', () => {
        const result = PipelineFormatter.formatRetryInfo(3, 3);

        expect(result).toBe(' (retry 3/3)');
      });

      it('should include leading space in retry string', () => {
        const result = PipelineFormatter.formatRetryInfo(1, 3);

        expect(result).toMatch(/^ \(retry/);
        expect(result.startsWith(' ')).toBe(true);
      });
    });

    describe('No Retry Scenarios', () => {
      it('should return empty string when retryAttempt is undefined', () => {
        const result = PipelineFormatter.formatRetryInfo(undefined, 3);

        expect(result).toBe('');
      });

      it('should return empty string when retryAttempt is 0', () => {
        const result = PipelineFormatter.formatRetryInfo(0, 3);

        expect(result).toBe('');
      });

      it('should return empty string when maxRetries is undefined', () => {
        const result = PipelineFormatter.formatRetryInfo(1, undefined);

        expect(result).toBe(' (retry 1/undefined)');
      });

      it('should return empty string when both are undefined', () => {
        const result = PipelineFormatter.formatRetryInfo(undefined, undefined);

        expect(result).toBe('');
      });
    });

    describe('Edge Cases', () => {
      it('should handle large retry numbers', () => {
        const result = PipelineFormatter.formatRetryInfo(10, 20);

        expect(result).toBe(' (retry 10/20)');
      });

      it('should handle single retry attempt', () => {
        const result = PipelineFormatter.formatRetryInfo(1, 1);

        expect(result).toBe(' (retry 1/1)');
      });

      it('should return empty string for negative retry attempt', () => {
        const result = PipelineFormatter.formatRetryInfo(-1, 3);

        // -1 fails the > 0 check, so returns empty string
        expect(result).toBe('');
      });
    });
  });
});
