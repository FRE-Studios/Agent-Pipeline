// src/__tests__/notifications/notifiers/base-notifier.test.ts

import { describe, it, expect } from 'vitest';
import { BaseNotifier } from '../../../notifications/notifiers/base-notifier.js';
import { NotificationContext, NotificationResult } from '../../../notifications/types.js';

// Create a concrete test implementation to access protected methods
class TestNotifier extends BaseNotifier {
  readonly channel = 'test';

  async send(_context: NotificationContext): Promise<NotificationResult> {
    return { success: true, channel: this.channel };
  }

  async isConfigured(): Promise<boolean> {
    return true;
  }

  // Expose protected methods for testing
  public testFormatDuration(seconds: number): string {
    return this.formatDuration(seconds);
  }

  public testGetStatusEmoji(status: string): string {
    return this.getStatusEmoji(status);
  }
}

describe('BaseNotifier', () => {
  let notifier: TestNotifier;

  beforeEach(() => {
    notifier = new TestNotifier();
  });

  describe('formatDuration()', () => {
    it('should format duration less than 60 seconds with one decimal', () => {
      expect(notifier.testFormatDuration(5.5)).toBe('5.5s');
    });

    it('should format duration of 30 seconds', () => {
      expect(notifier.testFormatDuration(30.0)).toBe('30.0s');
    });

    it('should format exactly 60 seconds as 1 minute', () => {
      expect(notifier.testFormatDuration(60)).toBe('1m 0s');
    });

    it('should format duration with minutes and seconds', () => {
      expect(notifier.testFormatDuration(150)).toBe('2m 30s');
    });

    it('should format large durations correctly', () => {
      expect(notifier.testFormatDuration(645)).toBe('10m 45s');
    });

    it('should handle very large durations', () => {
      expect(notifier.testFormatDuration(7215)).toBe('120m 15s');
    });

    it('should format zero seconds', () => {
      expect(notifier.testFormatDuration(0)).toBe('0.0s');
    });

    it('should format fractional seconds', () => {
      expect(notifier.testFormatDuration(1.234)).toBe('1.2s');
    });

    it('should round seconds in minute format', () => {
      // 90.7 seconds = 1 minute 30.7 seconds, but should floor to 30s
      expect(notifier.testFormatDuration(90.7)).toBe('1m 30s');
    });
  });

  describe('getStatusEmoji()', () => {
    it('should return checkmark emoji for "completed" status', () => {
      expect(notifier.testGetStatusEmoji('completed')).toBe('✅');
    });

    it('should return checkmark emoji for "success" status', () => {
      expect(notifier.testGetStatusEmoji('success')).toBe('✅');
    });

    it('should return X emoji for "failed" status', () => {
      expect(notifier.testGetStatusEmoji('failed')).toBe('❌');
    });

    it('should return refresh emoji for "running" status', () => {
      expect(notifier.testGetStatusEmoji('running')).toBe('🔄');
    });

    it('should return skip emoji for "skipped" status', () => {
      expect(notifier.testGetStatusEmoji('skipped')).toBe('⏭️');
    });

    it('should return default clipboard emoji for unknown status', () => {
      expect(notifier.testGetStatusEmoji('unknown')).toBe('📋');
    });

    it('should return default emoji for empty string', () => {
      expect(notifier.testGetStatusEmoji('')).toBe('📋');
    });

    it('should return default emoji for random string', () => {
      expect(notifier.testGetStatusEmoji('random-status')).toBe('📋');
    });
  });

  describe('abstract methods', () => {
    it('should have channel property defined', () => {
      expect(notifier.channel).toBe('test');
    });

    it('should implement send method', async () => {
      const context: NotificationContext = {
        event: 'pipeline.completed',
        pipelineState: {
          runId: 'test-123',
          pipelineConfig: {
            name: 'test',
            trigger: 'manual',
            agents: [],
            settings: {
              autoCommit: true,
              commitPrefix: '[test]',
              failureStrategy: 'stop',
              preserveWorkingTree: false
            }
          },
          trigger: { type: 'manual', commitSha: 'abc', timestamp: new Date().toISOString() },
          stages: [],
          status: 'completed',
          artifacts: { initialCommit: 'abc', totalDuration: 10, changedFiles: [] }
        }
      };

      const result = await notifier.send(context);
      expect(result.success).toBe(true);
      expect(result.channel).toBe('test');
    });

    it('should implement isConfigured method', async () => {
      const result = await notifier.isConfigured();
      expect(result).toBe(true);
    });
  });
});
