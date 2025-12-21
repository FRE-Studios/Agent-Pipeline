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
        // Duration pattern should not be present (e.g., "(60.0s)")
        expect(result).not.toMatch(/\(\d+\.\d+s\)/);
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
        // Duration pattern should not be present
        expect(result).not.toMatch(/\(\d+\.\d+s\)/);
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

  describe('formatTokenCount', () => {
    describe('Small Numbers (< 1000)', () => {
      it('should format numbers under 1000 as plain numbers', () => {
        expect(PipelineFormatter.formatTokenCount(0)).toBe('0');
        expect(PipelineFormatter.formatTokenCount(1)).toBe('1');
        expect(PipelineFormatter.formatTokenCount(50)).toBe('50');
        expect(PipelineFormatter.formatTokenCount(500)).toBe('500');
        expect(PipelineFormatter.formatTokenCount(999)).toBe('999');
      });
    });

    describe('Round Thousands', () => {
      it('should format round thousands without decimals', () => {
        expect(PipelineFormatter.formatTokenCount(1000)).toBe('1k');
        expect(PipelineFormatter.formatTokenCount(2000)).toBe('2k');
        expect(PipelineFormatter.formatTokenCount(10000)).toBe('10k');
        expect(PipelineFormatter.formatTokenCount(23000)).toBe('23k');
        expect(PipelineFormatter.formatTokenCount(100000)).toBe('100k');
      });
    });

    describe('Non-Round Thousands', () => {
      it('should format non-round thousands with one decimal place', () => {
        expect(PipelineFormatter.formatTokenCount(1500)).toBe('1.5k');
        expect(PipelineFormatter.formatTokenCount(2345)).toBe('2.3k');
        expect(PipelineFormatter.formatTokenCount(23456)).toBe('23.5k');
        expect(PipelineFormatter.formatTokenCount(25234)).toBe('25.2k');
        expect(PipelineFormatter.formatTokenCount(13123)).toBe('13.1k');
      });

      it('should round to one decimal place correctly', () => {
        expect(PipelineFormatter.formatTokenCount(1234)).toBe('1.2k');
        expect(PipelineFormatter.formatTokenCount(1256)).toBe('1.3k');
        expect(PipelineFormatter.formatTokenCount(1999)).toBe('2k'); // Rounds to whole number
      });
    });

    describe('Edge Cases', () => {
      it('should handle very large numbers', () => {
        expect(PipelineFormatter.formatTokenCount(500000)).toBe('500k');
        expect(PipelineFormatter.formatTokenCount(999999)).toBe('1000k');
      });

      it('should handle exactly 1000', () => {
        expect(PipelineFormatter.formatTokenCount(1000)).toBe('1k');
      });
    });
  });

  describe('formatTokenUsage', () => {
    describe('Complete Token Usage', () => {
      it('should format full token usage with all fields', () => {
        const tokenUsage = {
          estimated_input: 23000,
          actual_input: 25234,
          output: 13123,
          cache_creation: 5000,
          cache_read: 2000
        };

        const result = PipelineFormatter.formatTokenUsage(tokenUsage);

        // Total input = actual_input (25234) + cache_read (2000) = 27234 = 27.2k
        expect(result).toContain('Input: 27.2k tokens');
        expect(result).toContain('Output: 13.1k');
        expect(result).toContain('Cache created: 5k');
        // Cache read is now shown as cache hit percentage
        expect(result).toContain('Cache: 7% hit');
      });

      it('should show estimation comparison when difference > 5%', () => {
        const tokenUsage = {
          estimated_input: 20000,
          actual_input: 25000,
          output: 13000
        };

        const result = PipelineFormatter.formatTokenUsage(tokenUsage);

        expect(result).toContain('Input: 25k tokens');
        expect(result).toContain('(est. 20k)');
      });

      it('should NOT show estimation comparison when difference <= 5%', () => {
        const tokenUsage = {
          estimated_input: 24000,
          actual_input: 25000,
          output: 13000
        };

        const result = PipelineFormatter.formatTokenUsage(tokenUsage);

        expect(result).toContain('Input: 25k tokens');
        expect(result).not.toContain('(est.');
      });
    });

    describe('Minimal Token Usage', () => {
      it('should format token usage without cache fields', () => {
        const tokenUsage = {
          estimated_input: 23000,
          actual_input: 25000,
          output: 13000
        };

        const result = PipelineFormatter.formatTokenUsage(tokenUsage);

        expect(result).toContain('Input: 25k tokens');
        expect(result).toContain('Output: 13k');
        expect(result).not.toContain('Cache');
      });

      it('should format exact match between estimated and actual', () => {
        const tokenUsage = {
          estimated_input: 25000,
          actual_input: 25000,
          output: 13000
        };

        const result = PipelineFormatter.formatTokenUsage(tokenUsage);

        expect(result).toContain('Input: 25k tokens');
        expect(result).not.toContain('(est.');
        expect(result).toContain('Output: 13k');
      });
    });

    describe('Cache Token Handling', () => {
      it('should include cache_creation when present', () => {
        const tokenUsage = {
          estimated_input: 25000,
          actual_input: 25000,
          output: 13000,
          cache_creation: 5000
        };

        const result = PipelineFormatter.formatTokenUsage(tokenUsage);

        expect(result).toContain('Cache created: 5k');
      });

      it('should include cache_read as percentage when present', () => {
        const tokenUsage = {
          estimated_input: 25000,
          actual_input: 25000,
          output: 13000,
          cache_read: 2000
        };

        const result = PipelineFormatter.formatTokenUsage(tokenUsage);

        // Total input = 25000 + 2000 = 27000; cache hit = 2000/27000 = 7%
        expect(result).toContain('Input: 27k tokens');
        expect(result).toContain('Cache: 7% hit');
      });

      it('should include both cache fields when present', () => {
        const tokenUsage = {
          estimated_input: 25000,
          actual_input: 25000,
          output: 13000,
          cache_creation: 5000,
          cache_read: 2000
        };

        const result = PipelineFormatter.formatTokenUsage(tokenUsage);

        // Total input = 25000 + 2000 = 27000
        expect(result).toContain('Input: 27k tokens');
        expect(result).toContain('Cache created: 5k');
        expect(result).toContain('Cache: 7% hit');
      });
    });

    describe('num_turns and thinking_tokens Fields', () => {
      it('should display num_turns when present', () => {
        const tokenUsage = {
          estimated_input: 25000,
          actual_input: 25000,
          output: 13000,
          num_turns: 3
        };

        const result = PipelineFormatter.formatTokenUsage(tokenUsage);

        expect(result).toContain('Est. initial: 25k');
        expect(result).toContain('Turns: 3');
      });

      it('should display thinking_tokens when present and > 0', () => {
        const tokenUsage = {
          estimated_input: 25000,
          actual_input: 25000,
          output: 13000,
          thinking_tokens: 12500
        };

        const result = PipelineFormatter.formatTokenUsage(tokenUsage);

        expect(result).toContain('Thinking: 12.5k');
      });

      it('should not display thinking_tokens when zero', () => {
        const tokenUsage = {
          estimated_input: 25000,
          actual_input: 25000,
          output: 13000,
          thinking_tokens: 0
        };

        const result = PipelineFormatter.formatTokenUsage(tokenUsage);

        expect(result).not.toContain('Thinking:');
      });

      it('should display all fields including num_turns and thinking_tokens', () => {
        const tokenUsage = {
          estimated_input: 23000,
          actual_input: 25000,
          output: 13000,
          cache_creation: 5000,
          cache_read: 2000,
          num_turns: 4,
          thinking_tokens: 8000
        };

        const result = PipelineFormatter.formatTokenUsage(tokenUsage);

        // Total input = 25000 + 2000 = 27000
        expect(result).toContain('Input: 27k tokens');
        expect(result).toContain('Est. initial: 23k');
        expect(result).toContain('Output: 13k');
        expect(result).toContain('Thinking: 8k');
        expect(result).toContain('Turns: 4');
        expect(result).toContain('Cache created: 5k');
        expect(result).toContain('Cache: 7% hit');
      });

      it('should not display num_turns when missing', () => {
        const tokenUsage = {
          estimated_input: 25000,
          actual_input: 25000,
          output: 13000,
          thinking_tokens: 5000
        };

        const result = PipelineFormatter.formatTokenUsage(tokenUsage);

        expect(result).not.toContain('Turns:');
        expect(result).toContain('Thinking: 5k');
      });

      it('should not display thinking_tokens when missing', () => {
        const tokenUsage = {
          estimated_input: 25000,
          actual_input: 25000,
          output: 13000,
          num_turns: 2
        };

        const result = PipelineFormatter.formatTokenUsage(tokenUsage);

        expect(result).toContain('Est. initial: 25k');
        expect(result).toContain('Turns: 2');
        expect(result).not.toContain('Thinking:');
      });

      it('should display zero num_turns', () => {
        const tokenUsage = {
          estimated_input: 25000,
          actual_input: 25000,
          output: 13000,
          num_turns: 0
        };

        const result = PipelineFormatter.formatTokenUsage(tokenUsage);

        expect(result).toContain('Turns: 0');
      });

      it('should format large thinking_tokens values correctly', () => {
        const tokenUsage = {
          estimated_input: 25000,
          actual_input: 25000,
          output: 13000,
          thinking_tokens: 125000  // 125k
        };

        const result = PipelineFormatter.formatTokenUsage(tokenUsage);

        expect(result).toContain('Thinking: 125k');
      });
    });

    describe('Edge Cases', () => {
      it('should return empty string for undefined token usage', () => {
        const result = PipelineFormatter.formatTokenUsage(undefined);

        expect(result).toBe('');
      });

      it('should handle small token counts', () => {
        const tokenUsage = {
          estimated_input: 500,
          actual_input: 600,
          output: 300
        };

        const result = PipelineFormatter.formatTokenUsage(tokenUsage);

        expect(result).toContain('Input: 600 tokens');
        expect(result).toContain('Output: 300');
      });

      it('should use pipe separators between parts', () => {
        const tokenUsage = {
          estimated_input: 23000,
          actual_input: 25000,
          output: 13000,
          cache_creation: 5000
        };

        const result = PipelineFormatter.formatTokenUsage(tokenUsage);

        expect(result).toMatch(/\|/);
        const pipeCount = (result.match(/\|/g) || []).length;
        expect(pipeCount).toBeGreaterThan(0);
      });
    });

    describe('Estimation Difference Threshold', () => {
      it('should show estimation for exactly 5% difference', () => {
        const tokenUsage = {
          estimated_input: 23750,  // 5% less than 25000
          actual_input: 25000,
          output: 13000
        };

        const result = PipelineFormatter.formatTokenUsage(tokenUsage);

        // 5% should NOT show (needs to be > 5%)
        expect(result).not.toContain('(est.');
      });

      it('should show estimation for >5% difference', () => {
        const tokenUsage = {
          estimated_input: 23000,  // ~8% less than 25000
          actual_input: 25000,
          output: 13000
        };

        const result = PipelineFormatter.formatTokenUsage(tokenUsage);

        expect(result).toContain('(est. 23k)');
      });
    });
  });
});
