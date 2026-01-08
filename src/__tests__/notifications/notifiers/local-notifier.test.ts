// src/__tests__/notifications/notifiers/local-notifier.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LocalNotifier } from '../../../notifications/notifiers/local-notifier.js';
import {
  NotificationContext,
  NotificationResult,
  LocalNotificationConfig
} from '../../../notifications/types.js';
import { PipelineState } from '../../../config/schema.js';

// Mock node-notifier
vi.mock('node-notifier', () => ({
  default: {
    notify: vi.fn()
  }
}));

// Import after mocking
import notifier from 'node-notifier';
const mockNotify = notifier.notify as any;

// Test fixtures
function createTestPipelineState(overrides?: Partial<PipelineState>): PipelineState {
  return {
    runId: 'test-run-123',
    pipelineConfig: {
      name: 'test-pipeline',
      trigger: 'manual',
      agents: [],
      settings: {
        autoCommit: true,
        commitPrefix: '[pipeline:{{stage}}]',
        failureStrategy: 'stop'
      }
    },
    trigger: {
      type: 'manual',
      commitSha: 'abc123',
      timestamp: new Date().toISOString()
    },
    stages: [],
    status: 'completed',
    artifacts: {
      initialCommit: 'abc123',
      totalDuration: 42.5,
      changedFiles: []
    },
    ...overrides
  };
}

function createNotificationContext(
  event: string,
  overrides?: Partial<NotificationContext>
): NotificationContext {
  return {
    event: event as any,
    pipelineState: createTestPipelineState(),
    ...overrides
  };
}

describe('LocalNotifier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock behavior: call callback with success
    mockNotify.mockImplementation((options: any, callback: any) => {
      if (callback) {
        callback(null, 'activated');
      }
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor and configuration', () => {
    it('should create notifier with default config', () => {
      const notifier = new LocalNotifier();
      expect(notifier.channel).toBe('local');
    });

    it('should create notifier with empty config object', () => {
      const notifier = new LocalNotifier({});
      expect(notifier.channel).toBe('local');
    });

    it('should create notifier with sound disabled', () => {
      const notifier = new LocalNotifier({ sound: false });
      expect(notifier.channel).toBe('local');
    });

    it('should create notifier with openUrl enabled', () => {
      const notifier = new LocalNotifier({ openUrl: true });
      expect(notifier.channel).toBe('local');
    });

    it('should create notifier with all options', () => {
      const notifier = new LocalNotifier({
        enabled: true,
        sound: true,
        openUrl: true
      });
      expect(notifier.channel).toBe('local');
    });
  });

  describe('isConfigured()', () => {
    it('should always return true', async () => {
      const notifier = new LocalNotifier();
      const result = await notifier.isConfigured();
      expect(result).toBe(true);
    });

    it('should return true regardless of config', async () => {
      const notifier = new LocalNotifier({ sound: false, openUrl: false });
      const result = await notifier.isConfigured();
      expect(result).toBe(true);
    });
  });

  describe('send() - pipeline.started event', () => {
    it('should send notification for pipeline.started', async () => {
      const notifier = new LocalNotifier();
      const context = createNotificationContext('pipeline.started');
      const result = await notifier.send(context);

      expect(result.success).toBe(true);
      expect(result.channel).toBe('local');
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '🚀 Pipeline Started',
          message: 'test-pipeline'
        }),
        expect.any(Function)
      );
    });

    it('should include sound and app name in notification', async () => {
      const notifier = new LocalNotifier();
      const context = createNotificationContext('pipeline.started');
      await notifier.send(context);

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          sound: true,
          appName: 'Agent Pipeline',
          wait: true
        }),
        expect.any(Function)
      );
    });
  });

  describe('send() - pipeline.completed event', () => {
    it('should send notification for pipeline.completed with duration', async () => {
      const notifier = new LocalNotifier();
      const pipelineState = createTestPipelineState({
        artifacts: {
          initialCommit: 'abc',
          totalDuration: 125.5,
          changedFiles: []
        }
      });
      const context = createNotificationContext('pipeline.completed', { pipelineState });
      const result = await notifier.send(context);

      expect(result.success).toBe(true);
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '✅ Pipeline Completed',
          message: expect.stringContaining('test-pipeline completed in')
        }),
        expect.any(Function)
      );
    });

    it('should format duration correctly for completed pipeline', async () => {
      const notifier = new LocalNotifier();
      const pipelineState = createTestPipelineState({
        artifacts: {
          initialCommit: 'abc',
          totalDuration: 125.5, // 2m 5s
          changedFiles: []
        }
      });
      const context = createNotificationContext('pipeline.completed', { pipelineState });
      await notifier.send(context);

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'test-pipeline completed in 2m 5s'
        }),
        expect.any(Function)
      );
    });

    it('should include PR URL when openUrl is true', async () => {
      const notifier = new LocalNotifier({ openUrl: true });
      const context = createNotificationContext('pipeline.completed', {
        prUrl: 'https://github.com/test/repo/pull/123'
      });
      await notifier.send(context);

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          open: 'https://github.com/test/repo/pull/123'
        }),
        expect.any(Function)
      );
    });

    it('should not include open URL when openUrl is false', async () => {
      const notifier = new LocalNotifier({ openUrl: false });
      const context = createNotificationContext('pipeline.completed', {
        prUrl: 'https://github.com/test/repo/pull/123'
      });
      await notifier.send(context);

      const callArgs = mockNotify.mock.calls[0][0];
      expect(callArgs.open).toBeUndefined();
    });

    it('should not include open URL when prUrl is not provided', async () => {
      const notifier = new LocalNotifier({ openUrl: true });
      const context = createNotificationContext('pipeline.completed');
      await notifier.send(context);

      const callArgs = mockNotify.mock.calls[0][0];
      expect(callArgs.open).toBeUndefined();
    });

    it('should handle zero duration', async () => {
      const notifier = new LocalNotifier();
      const pipelineState = createTestPipelineState({
        artifacts: {
          initialCommit: 'abc',
          totalDuration: 0,
          changedFiles: []
        }
      });
      const context = createNotificationContext('pipeline.completed', { pipelineState });
      await notifier.send(context);

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'test-pipeline completed in 0.0s'
        }),
        expect.any(Function)
      );
    });
  });

  describe('send() - async behavior', () => {
    it('should wait for node-notifier callback before resolving', async () => {
      const notifier = new LocalNotifier();
      const context = createNotificationContext('pipeline.completed');

      try {
        vi.useFakeTimers();
        mockNotify.mockImplementation((options: any, callback: any) => {
          setTimeout(() => {
            callback?.(null, 'activated');
          }, 1000);
        });

        const sendPromise = notifier.send(context);
        let settled = false;
        sendPromise.then(() => {
          settled = true;
        });

        await vi.advanceTimersByTimeAsync(999);
        expect(settled).toBe(false);

        await vi.advanceTimersByTimeAsync(1);
        await expect(sendPromise).resolves.toEqual({
          success: true,
          channel: 'local'
        });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('send() - pipeline.failed event', () => {
    it('should send notification for pipeline.failed with failed stage', async () => {
      const notifier = new LocalNotifier();
      const pipelineState = createTestPipelineState({
        status: 'failed',
        stages: [
          {
            stageName: 'test-stage',
            status: 'failed',
            duration: 5.0,
            outputs: {},
            error: {
              message: 'Test error',
              timestamp: new Date().toISOString()
            },
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString()
          }
        ]
      });
      const context = createNotificationContext('pipeline.failed', { pipelineState });
      const result = await notifier.send(context);

      expect(result.success).toBe(true);
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '❌ Pipeline Failed',
          message: 'test-pipeline failed at stage: test-stage'
        }),
        expect.any(Function)
      );
    });

    it('should handle pipeline failed with no failed stages (unknown)', async () => {
      const notifier = new LocalNotifier();
      const pipelineState = createTestPipelineState({
        status: 'failed',
        stages: []
      });
      const context = createNotificationContext('pipeline.failed', { pipelineState });
      await notifier.send(context);

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'test-pipeline failed at stage: unknown'
        }),
        expect.any(Function)
      );
    });

    it('should show first failed stage when multiple stages failed', async () => {
      const notifier = new LocalNotifier();
      const pipelineState = createTestPipelineState({
        status: 'failed',
        stages: [
          {
            stageName: 'stage-1',
            status: 'failed',
            duration: 5.0,
            outputs: {},
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString()
          },
          {
            stageName: 'stage-2',
            status: 'failed',
            duration: 3.0,
            outputs: {},
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString()
          }
        ]
      });
      const context = createNotificationContext('pipeline.failed', { pipelineState });
      await notifier.send(context);

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'test-pipeline failed at stage: stage-1'
        }),
        expect.any(Function)
      );
    });

    it('should find failed stage even if successful stages appear first', async () => {
      const notifier = new LocalNotifier();
      const pipelineState = createTestPipelineState({
        status: 'failed',
        stages: [
          {
            stageName: 'successful-stage',
            status: 'success',
            duration: 2.0,
            outputs: {},
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString()
          },
          {
            stageName: 'actual-failure',
            status: 'failed',
            duration: 4.0,
            outputs: {},
            error: {
              message: 'Boom',
              timestamp: new Date().toISOString()
            },
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString()
          }
        ]
      });
      const context = createNotificationContext('pipeline.failed', { pipelineState });
      await notifier.send(context);

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'test-pipeline failed at stage: actual-failure'
        }),
        expect.any(Function)
      );
    });

    it('should fall back to unknown when no stages are marked failed', async () => {
      const notifier = new LocalNotifier();
      const pipelineState = createTestPipelineState({
        status: 'failed',
        stages: [
          {
            stageName: 'lint',
            status: 'success',
            duration: 1.0,
            outputs: {},
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString()
          },
          {
            stageName: 'tests',
            status: 'skipped',
            duration: 0,
            outputs: {},
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString()
          }
        ]
      });
      const context = createNotificationContext('pipeline.failed', { pipelineState });
      await notifier.send(context);

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'test-pipeline failed at stage: unknown'
        }),
        expect.any(Function)
      );
    });
  });

  describe('send() - stage.completed event', () => {
    it('should send notification for stage.completed with duration', async () => {
      const notifier = new LocalNotifier();
      const context = createNotificationContext('stage.completed', {
        stage: {
          stageName: 'code-review',
          status: 'success',
          duration: 15.8,
          outputs: {},
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString()
        }
      });
      const result = await notifier.send(context);

      expect(result.success).toBe(true);
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '✅ Stage Completed',
          message: 'code-review completed in 15.8s'
        }),
        expect.any(Function)
      );
    });

    it('should format stage duration in minutes when applicable', async () => {
      const notifier = new LocalNotifier();
      const context = createNotificationContext('stage.completed', {
        stage: {
          stageName: 'long-stage',
          status: 'success',
          duration: 135.0, // 2m 15s
          outputs: {},
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString()
        }
      });
      await notifier.send(context);

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'long-stage completed in 2m 15s'
        }),
        expect.any(Function)
      );
    });

    it('should handle stage with zero duration', async () => {
      const notifier = new LocalNotifier();
      const context = createNotificationContext('stage.completed', {
        stage: {
          stageName: 'fast-stage',
          status: 'success',
          duration: 0,
          outputs: {},
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString()
        }
      });
      await notifier.send(context);

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'fast-stage completed in 0.0s'
        }),
        expect.any(Function)
      );
    });
  });

  describe('send() - stage.failed event', () => {
    it('should send notification for stage.failed with error message', async () => {
      const notifier = new LocalNotifier();
      const context = createNotificationContext('stage.failed', {
        stage: {
          stageName: 'security-scan',
          status: 'failed',
          duration: 10.2,
          outputs: {},
          error: {
            message: 'Security vulnerabilities found',
            timestamp: new Date().toISOString()
          },
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString()
        }
      });
      const result = await notifier.send(context);

      expect(result.success).toBe(true);
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '❌ Stage Failed',
          message: 'security-scan: Security vulnerabilities found'
        }),
        expect.any(Function)
      );
    });

    it('should show "Unknown error" when error message not provided', async () => {
      const notifier = new LocalNotifier();
      const context = createNotificationContext('stage.failed', {
        stage: {
          stageName: 'test-stage',
          status: 'failed',
          duration: 5.0,
          outputs: {},
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString()
        }
      });
      await notifier.send(context);

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'test-stage: Unknown error'
        }),
        expect.any(Function)
      );
    });
  });

  describe('send() - pr.created event', () => {
    it('should send notification for pr.created', async () => {
      const notifier = new LocalNotifier();
      const context = createNotificationContext('pr.created', {
        prUrl: 'https://github.com/test/repo/pull/456'
      });
      const result = await notifier.send(context);

      expect(result.success).toBe(true);
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '🔀 Pull Request Created',
          message: 'test-pipeline'
        }),
        expect.any(Function)
      );
    });

    it('should include PR URL when openUrl is true', async () => {
      const notifier = new LocalNotifier({ openUrl: true });
      const context = createNotificationContext('pr.created', {
        prUrl: 'https://github.com/test/repo/pull/789'
      });
      await notifier.send(context);

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          open: 'https://github.com/test/repo/pull/789'
        }),
        expect.any(Function)
      );
    });

    it('should not include open URL when openUrl is false for PR', async () => {
      const notifier = new LocalNotifier({ openUrl: false });
      const context = createNotificationContext('pr.created', {
        prUrl: 'https://github.com/test/repo/pull/999'
      });
      await notifier.send(context);

      const callArgs = mockNotify.mock.calls[0][0];
      expect(callArgs.open).toBeUndefined();
    });
  });

  describe('send() - unknown event type', () => {
    it('should handle unknown event type with default message', async () => {
      const notifier = new LocalNotifier();
      const context = createNotificationContext('unknown.event' as any);
      await notifier.send(context);

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '📋 Pipeline Event',
          message: 'unknown.event for test-pipeline'
        }),
        expect.any(Function)
      );
    });
  });

  describe('notification properties', () => {
    it('should set sound to true by default', async () => {
      const notifier = new LocalNotifier();
      const context = createNotificationContext('pipeline.completed');
      await notifier.send(context);

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({ sound: true }),
        expect.any(Function)
      );
    });

    it('should set sound to true when explicitly enabled', async () => {
      const notifier = new LocalNotifier({ sound: true });
      const context = createNotificationContext('pipeline.completed');
      await notifier.send(context);

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({ sound: true }),
        expect.any(Function)
      );
    });

    it('should set sound to false when explicitly disabled', async () => {
      const notifier = new LocalNotifier({ sound: false });
      const context = createNotificationContext('pipeline.completed');
      await notifier.send(context);

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({ sound: false }),
        expect.any(Function)
      );
    });

    it('should always set wait to true', async () => {
      const notifier = new LocalNotifier();
      const context = createNotificationContext('pipeline.completed');
      await notifier.send(context);

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({ wait: true }),
        expect.any(Function)
      );
    });

    it('should set appName to "Agent Pipeline"', async () => {
      const notifier = new LocalNotifier();
      const context = createNotificationContext('pipeline.completed');
      await notifier.send(context);

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({ appName: 'Agent Pipeline' }),
        expect.any(Function)
      );
    });
  });

  describe('error handling', () => {
    it('should return error result when node-notifier callback returns error', async () => {
      mockNotify.mockImplementation((options: any, callback: any) => {
        if (callback) {
          callback(new Error('Notification system error'));
        }
      });

      const notifier = new LocalNotifier();
      const context = createNotificationContext('pipeline.completed');
      const result = await notifier.send(context);

      expect(result.success).toBe(false);
      expect(result.channel).toBe('local');
      expect(result.error).toBe('Notification system error');
    });

    it('should extract error message from Error object', async () => {
      mockNotify.mockImplementation((options: any, callback: any) => {
        if (callback) {
          callback(new Error('Custom error message'));
        }
      });

      const notifier = new LocalNotifier();
      const context = createNotificationContext('pipeline.completed');
      const result = await notifier.send(context);

      expect(result.error).toBe('Custom error message');
    });

    it('should convert non-Error objects to strings', async () => {
      mockNotify.mockImplementation((options: any, callback: any) => {
        if (callback) {
          callback('String error');
        }
      });

      const notifier = new LocalNotifier();
      const context = createNotificationContext('pipeline.completed');
      const result = await notifier.send(context);

      expect(result.error).toBe('String error');
    });

    it('should handle errors thrown by node-notifier', async () => {
      mockNotify.mockImplementation(() => {
        throw new Error('Synchronous error');
      });

      const notifier = new LocalNotifier();
      const context = createNotificationContext('pipeline.completed');
      const result = await notifier.send(context);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Synchronous error');
    });
  });

  describe('integration with BaseNotifier', () => {
    it('should use formatDuration from BaseNotifier for pipeline completion', async () => {
      const notifier = new LocalNotifier();
      const pipelineState = createTestPipelineState({
        artifacts: {
          initialCommit: 'abc',
          totalDuration: 90.5,
          changedFiles: []
        }
      });
      const context = createNotificationContext('pipeline.completed', { pipelineState });
      await notifier.send(context);

      // 90.5 seconds should be formatted as "1m 30s"
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('1m 30s')
        }),
        expect.any(Function)
      );
    });

    it('should use formatDuration from BaseNotifier for stage completion', async () => {
      const notifier = new LocalNotifier();
      const context = createNotificationContext('stage.completed', {
        stage: {
          stageName: 'test-stage',
          status: 'success',
          duration: 185.0, // 3m 5s
          outputs: {},
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString()
        }
      });
      await notifier.send(context);

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'test-stage completed in 3m 5s'
        }),
        expect.any(Function)
      );
    });

    it('should format small durations as seconds only', async () => {
      const notifier = new LocalNotifier();
      const context = createNotificationContext('stage.completed', {
        stage: {
          stageName: 'quick-stage',
          status: 'success',
          duration: 5.7,
          outputs: {},
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString()
        }
      });
      await notifier.send(context);

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'quick-stage completed in 5.7s'
        }),
        expect.any(Function)
      );
    });
  });
});
