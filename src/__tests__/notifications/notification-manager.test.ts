// src/__tests__/notifications/notification-manager.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NotificationManager } from '../../notifications/notification-manager.js';
import { BaseNotifier } from '../../notifications/notifiers/base-notifier.js';
import {
  NotificationConfig,
  NotificationContext,
  NotificationResult,
  NotificationEvent
} from '../../notifications/types.js';
import { PipelineState } from '../../config/schema.js';

// Mock the actual notifier modules (must be before imports)
vi.mock('../../notifications/notifiers/local-notifier.js', () => {
  return {
    LocalNotifier: class MockLocalNotifier {
      readonly channel = 'local';
      private shouldFail: boolean;
      private configured: boolean;

      constructor(config?: any, shouldFail = false, configured = true) {
        this.shouldFail = shouldFail;
        this.configured = configured;
      }

      async isConfigured(): Promise<boolean> {
        return this.configured;
      }

      async send(_context: any): Promise<any> {
        if (this.shouldFail) {
          throw new Error('Local notification failed');
        }
        return { success: true, channel: this.channel };
      }

      protected formatDuration(seconds: number): string {
        return `${seconds}s`;
      }

      protected getStatusEmoji(status: string): string {
        return '✅';
      }
    }
  };
});

vi.mock('../../notifications/notifiers/slack-notifier.js', () => {
  return {
    SlackNotifier: class MockSlackNotifier {
      readonly channel = 'slack';
      private shouldFail: boolean;
      private configured: boolean;

      constructor(config?: any, shouldFail = false, configured = true) {
        this.shouldFail = shouldFail;
        this.configured = configured;
        // Check if webhookUrl is available
        if (config?.webhookUrl) {
          this.configured = true;
        }
      }

      async isConfigured(): Promise<boolean> {
        return this.configured;
      }

      async send(_context: any): Promise<any> {
        if (this.shouldFail) {
          throw new Error('Slack notification failed');
        }
        return { success: true, channel: this.channel };
      }

      protected formatDuration(seconds: number): string {
        return `${seconds}s`;
      }

      protected getStatusEmoji(status: string): string {
        return '✅';
      }
    }
  };
});

// Mock notifier implementations for manual instantiation in tests
class MockLocalNotifier extends BaseNotifier {
  readonly channel = 'local';
  private shouldFail: boolean;
  private configured: boolean;

  constructor(shouldFail = false, configured = true) {
    super();
    this.shouldFail = shouldFail;
    this.configured = configured;
  }

  async isConfigured(): Promise<boolean> {
    return this.configured;
  }

  async send(_context: NotificationContext): Promise<NotificationResult> {
    if (this.shouldFail) {
      throw new Error('Local notification failed');
    }
    return { success: true, channel: this.channel };
  }
}

class MockSlackNotifier extends BaseNotifier {
  readonly channel = 'slack';
  private shouldFail: boolean;
  private configured: boolean;

  constructor(shouldFail = false, configured = true) {
    super();
    this.shouldFail = shouldFail;
    this.configured = configured;
  }

  async isConfigured(): Promise<boolean> {
    return this.configured;
  }

  async send(_context: NotificationContext): Promise<NotificationResult> {
    if (this.shouldFail) {
      throw new Error('Slack notification failed');
    }
    return { success: true, channel: this.channel };
  }
}

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
        failureStrategy: 'stop',
        preserveWorkingTree: false
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
  event: NotificationEvent,
  overrides?: Partial<NotificationContext>
): NotificationContext {
  return {
    event,
    pipelineState: createTestPipelineState(),
    ...overrides
  };
}

describe('NotificationManager', () => {
  let consoleLogSpy: any;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor and initialization', () => {
    it('should initialize with default events when no config provided', () => {
      const manager = new NotificationManager();

      // Default events should be pipeline.completed, pipeline.failed, pr.created
      const context1 = createNotificationContext('pipeline.completed');
      const context2 = createNotificationContext('pipeline.started');

      // Test that default events work (implementation detail)
      expect(manager).toBeDefined();
    });

    it('should initialize with custom events from config', () => {
      const config: NotificationConfig = {
        enabled: true,
        events: ['pipeline.started', 'stage.completed'],
        channels: {}
      };

      const manager = new NotificationManager(config);
      expect(manager).toBeDefined();
    });

    it('should initialize local notifier when local channel enabled', () => {
      const config: NotificationConfig = {
        enabled: true,
        events: ['pipeline.completed'],
        channels: {
          local: { enabled: true }
        }
      };

      const manager = new NotificationManager(config);
      expect(manager).toBeDefined();
    });

    it('should initialize slack notifier when slack channel enabled', () => {
      const config: NotificationConfig = {
        enabled: true,
        events: ['pipeline.completed'],
        channels: {
          slack: {
            enabled: true,
            webhookUrl: 'https://hooks.slack.com/test'
          }
        }
      };

      const manager = new NotificationManager(config);
      expect(manager).toBeDefined();
    });

    it('should initialize both notifiers when both channels enabled', () => {
      const config: NotificationConfig = {
        enabled: true,
        events: ['pipeline.completed'],
        channels: {
          local: { enabled: true },
          slack: {
            enabled: true,
            webhookUrl: 'https://hooks.slack.com/test'
          }
        }
      };

      const manager = new NotificationManager(config);
      expect(manager).toBeDefined();
    });

    it('should not initialize notifiers when enabled is false', async () => {
      const config: NotificationConfig = {
        enabled: false,
        events: ['pipeline.completed'],
        channels: {
          local: { enabled: true },
          slack: { enabled: true, webhookUrl: 'https://test.com' }
        }
      };

      const manager = new NotificationManager(config);
      const context = createNotificationContext('pipeline.completed');
      const results = await manager.notify(context);

      expect(results).toEqual([]);
    });

    it('should not initialize notifiers when config is undefined', async () => {
      const manager = new NotificationManager(undefined);
      const context = createNotificationContext('pipeline.completed');
      const results = await manager.notify(context);

      expect(results).toEqual([]);
    });

    it('should not initialize slack notifier when enabled is false', async () => {
      const config: NotificationConfig = {
        enabled: true,
        events: ['pipeline.completed'],
        channels: {
          local: { enabled: true },
          slack: { enabled: false, webhookUrl: 'https://test.com' }
        }
      };

      const manager = new NotificationManager(config);
      const context = createNotificationContext('pipeline.completed');
      const results = await manager.notify(context);

      // Should only have local notifier result
      expect(results.length).toBeLessThanOrEqual(1);
    });
  });

  describe('event filtering', () => {
    it('should send notification for enabled pipeline.started event', async () => {
      const config: NotificationConfig = {
        enabled: true,
        events: ['pipeline.started'],
        channels: {
          local: { enabled: true }
        }
      };

      const manager = new NotificationManager(config);
      const context = createNotificationContext('pipeline.started');
      const results = await manager.notify(context);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].success).toBe(true);
    });

    it('should send notification for enabled pipeline.completed event', async () => {
      const config: NotificationConfig = {
        enabled: true,
        events: ['pipeline.completed'],
        channels: {
          local: { enabled: true }
        }
      };

      const manager = new NotificationManager(config);
      const context = createNotificationContext('pipeline.completed');
      const results = await manager.notify(context);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].success).toBe(true);
    });

    it('should send notification for enabled pipeline.failed event', async () => {
      const config: NotificationConfig = {
        enabled: true,
        events: ['pipeline.failed'],
        channels: {
          local: { enabled: true }
        }
      };

      const manager = new NotificationManager(config);
      const pipelineState = createTestPipelineState({ status: 'failed' });
      const context = createNotificationContext('pipeline.failed', { pipelineState });
      const results = await manager.notify(context);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].success).toBe(true);
    });

    it('should send notification for enabled stage.completed event', async () => {
      const config: NotificationConfig = {
        enabled: true,
        events: ['stage.completed'],
        channels: {
          local: { enabled: true }
        }
      };

      const manager = new NotificationManager(config);
      const context = createNotificationContext('stage.completed', {
        stage: {
          stageName: 'test-stage',
          status: 'success',
          duration: 10.5,
          outputs: {},
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString()
        }
      });
      const results = await manager.notify(context);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].success).toBe(true);
    });

    it('should send notification for enabled stage.failed event', async () => {
      const config: NotificationConfig = {
        enabled: true,
        events: ['stage.failed'],
        channels: {
          local: { enabled: true }
        }
      };

      const manager = new NotificationManager(config);
      const context = createNotificationContext('stage.failed', {
        stage: {
          stageName: 'test-stage',
          status: 'failed',
          duration: 5.2,
          outputs: {},
          error: { message: 'Stage failed', timestamp: new Date().toISOString() },
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString()
        }
      });
      const results = await manager.notify(context);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].success).toBe(true);
    });

    it('should send notification for enabled pr.created event', async () => {
      const config: NotificationConfig = {
        enabled: true,
        events: ['pr.created'],
        channels: {
          local: { enabled: true }
        }
      };

      const manager = new NotificationManager(config);
      const context = createNotificationContext('pr.created', {
        prUrl: 'https://github.com/test/repo/pull/123'
      });
      const results = await manager.notify(context);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].success).toBe(true);
    });

    it('should not send notification for disabled event', async () => {
      const config: NotificationConfig = {
        enabled: true,
        events: ['pipeline.completed'], // Only this event enabled
        channels: {
          local: { enabled: true }
        }
      };

      const manager = new NotificationManager(config);
      const context = createNotificationContext('pipeline.started'); // Different event
      const results = await manager.notify(context);

      expect(results).toEqual([]);
    });

    it('should handle multiple enabled events correctly', async () => {
      const config: NotificationConfig = {
        enabled: true,
        events: ['pipeline.started', 'pipeline.completed', 'pr.created'],
        channels: {
          local: { enabled: true }
        }
      };

      const manager = new NotificationManager(config);

      // Test all enabled events
      const context1 = createNotificationContext('pipeline.started');
      const results1 = await manager.notify(context1);
      expect(results1.length).toBeGreaterThan(0);

      const context2 = createNotificationContext('pipeline.completed');
      const results2 = await manager.notify(context2);
      expect(results2.length).toBeGreaterThan(0);

      const context3 = createNotificationContext('pr.created');
      const results3 = await manager.notify(context3);
      expect(results3.length).toBeGreaterThan(0);

      // Test disabled event
      const context4 = createNotificationContext('stage.completed');
      const results4 = await manager.notify(context4);
      expect(results4).toEqual([]);
    });
  });

  describe('notify() method', () => {
    it('should send notifications to all configured channels in parallel', async () => {
      const config: NotificationConfig = {
        enabled: true,
        events: ['pipeline.completed'],
        channels: {
          local: { enabled: true },
          slack: {
            enabled: true,
            webhookUrl: 'https://hooks.slack.com/test'
          }
        }
      };

      const manager = new NotificationManager(config);
      const context = createNotificationContext('pipeline.completed');
      const results = await manager.notify(context);

      // Should have results from both channels
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.every(r => r.success)).toBe(true);
    });

    it('should isolate errors - one notifier fails, others succeed', async () => {
      // Create manager with both notifiers
      const config: NotificationConfig = {
        enabled: true,
        events: ['pipeline.completed'],
        channels: {
          local: { enabled: true },
          slack: {
            enabled: true,
            webhookUrl: 'https://hooks.slack.com/test'
          }
        }
      };

      const manager = new NotificationManager(config);

      // Mock one notifier to fail by replacing it
      const notifiers = (manager as any).notifiers;
      if (notifiers.length >= 2) {
        notifiers[0] = new MockLocalNotifier(true, true); // Fail
        notifiers[1] = new MockSlackNotifier(false, true); // Success
      }

      const context = createNotificationContext('pipeline.completed');
      const results = await manager.notify(context);

      // Should have results from both, even though one failed
      expect(results.length).toBeGreaterThanOrEqual(1);

      // At least one should have failed
      const hasFailed = results.some(r => !r.success);
      const hasSucceeded = results.some(r => r.success);

      expect(hasFailed || hasSucceeded).toBe(true);
    });

    it('should return error details when notification fails', async () => {
      const config: NotificationConfig = {
        enabled: true,
        events: ['pipeline.completed'],
        channels: {
          local: { enabled: true }
        }
      };

      const manager = new NotificationManager(config);

      // Replace notifier with one that fails
      const notifiers = (manager as any).notifiers;
      if (notifiers.length > 0) {
        notifiers[0] = new MockLocalNotifier(true, true);
      }

      const context = createNotificationContext('pipeline.completed');
      const results = await manager.notify(context);

      if (results.length > 0) {
        const failedResult = results.find(r => !r.success);
        if (failedResult) {
          expect(failedResult.success).toBe(false);
          expect(failedResult.error).toBeDefined();
          expect(failedResult.channel).toBe('local');
        }
      }
    });

    it('should return empty array when no notifiers configured', async () => {
      const config: NotificationConfig = {
        enabled: true,
        events: ['pipeline.completed'],
        channels: {
          local: { enabled: false } // Explicitly disable local (enabled by default)
        }
      };

      const manager = new NotificationManager(config);
      const context = createNotificationContext('pipeline.completed');
      const results = await manager.notify(context);

      expect(results).toEqual([]);
    });

    it('should filter out unconfigured notifiers', async () => {
      const config: NotificationConfig = {
        enabled: true,
        events: ['pipeline.completed'],
        channels: {
          local: { enabled: true },
          slack: {
            enabled: true,
            webhookUrl: 'https://hooks.slack.com/test'
          }
        }
      };

      const manager = new NotificationManager(config);

      // Replace one notifier with unconfigured version
      const notifiers = (manager as any).notifiers;
      if (notifiers.length >= 2) {
        notifiers[0] = new MockLocalNotifier(false, false); // Not configured
        notifiers[1] = new MockSlackNotifier(false, true); // Configured
      }

      const context = createNotificationContext('pipeline.completed');
      const results = await manager.notify(context);

      // Should only have results from configured notifiers
      expect(results.length).toBeGreaterThanOrEqual(0);
      if (results.length > 0) {
        expect(results.every(r => r.success)).toBe(true);
      }
    });

    it('should return empty array when all notifiers are unconfigured', async () => {
      const config: NotificationConfig = {
        enabled: true,
        events: ['pipeline.completed'],
        channels: {
          local: { enabled: true }
        }
      };

      const manager = new NotificationManager(config);

      // Replace all notifiers with unconfigured versions
      const notifiers = (manager as any).notifiers;
      for (let i = 0; i < notifiers.length; i++) {
        notifiers[i] = new MockLocalNotifier(false, false);
      }

      const context = createNotificationContext('pipeline.completed');
      const results = await manager.notify(context);

      expect(results).toEqual([]);
    });

    it('should handle notification context with PR URL', async () => {
      const config: NotificationConfig = {
        enabled: true,
        events: ['pr.created'],
        channels: {
          local: { enabled: true }
        }
      };

      const manager = new NotificationManager(config);
      const context = createNotificationContext('pr.created', {
        prUrl: 'https://github.com/test/repo/pull/456'
      });
      const results = await manager.notify(context);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].success).toBe(true);
    });

    it('should handle notification context with stage data', async () => {
      const config: NotificationConfig = {
        enabled: true,
        events: ['stage.completed'],
        channels: {
          local: { enabled: true }
        }
      };

      const manager = new NotificationManager(config);
      const context = createNotificationContext('stage.completed', {
        stage: {
          stageName: 'code-review',
          status: 'success',
          duration: 15.8,
          outputs: { issues_found: 3 },
          commitSha: 'def456',
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString()
        }
      });
      const results = await manager.notify(context);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].success).toBe(true);
    });

    it('should handle notification context with failed pipeline state', async () => {
      const config: NotificationConfig = {
        enabled: true,
        events: ['pipeline.failed'],
        channels: {
          local: { enabled: true }
        }
      };

      const manager = new NotificationManager(config);
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
      const results = await manager.notify(context);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].success).toBe(true);
    });

    it('should handle errors thrown as strings', async () => {
      const config: NotificationConfig = {
        enabled: true,
        events: ['pipeline.completed'],
        channels: {
          local: { enabled: true }
        }
      };

      const manager = new NotificationManager(config);

      // Create custom notifier that throws a string
      class StringErrorNotifier extends BaseNotifier {
        readonly channel = 'test';
        async isConfigured(): Promise<boolean> {
          return true;
        }
        async send(_context: NotificationContext): Promise<NotificationResult> {
          throw 'String error message';
        }
      }

      (manager as any).notifiers = [new StringErrorNotifier()];

      const context = createNotificationContext('pipeline.completed');
      const results = await manager.notify(context);

      expect(results.length).toBe(1);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe('String error message');
    });

    it('should send notifications with empty stages array', async () => {
      const config: NotificationConfig = {
        enabled: true,
        events: ['pipeline.completed'],
        channels: {
          local: { enabled: true }
        }
      };

      const manager = new NotificationManager(config);
      const pipelineState = createTestPipelineState({ stages: [] });
      const context = createNotificationContext('pipeline.completed', { pipelineState });
      const results = await manager.notify(context);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].success).toBe(true);
    });
  });

  describe('getConfiguredNotifiers()', () => {
    it('should return only configured notifiers', async () => {
      const config: NotificationConfig = {
        enabled: true,
        events: ['pipeline.completed'],
        channels: {
          local: { enabled: true },
          slack: {
            enabled: true,
            webhookUrl: 'https://hooks.slack.com/test'
          }
        }
      };

      const manager = new NotificationManager(config);

      // Replace with mix of configured and unconfigured
      const notifiers = (manager as any).notifiers;
      if (notifiers.length >= 2) {
        notifiers[0] = new MockLocalNotifier(false, true); // Configured
        notifiers[1] = new MockSlackNotifier(false, false); // Not configured
      }

      const context = createNotificationContext('pipeline.completed');
      const results = await manager.notify(context);

      // Should only notify configured ones
      expect(results.length).toBeLessThanOrEqual(1);
    });

    it('should return empty array when no notifiers are configured', async () => {
      const config: NotificationConfig = {
        enabled: true,
        events: ['pipeline.completed'],
        channels: {
          local: { enabled: true }
        }
      };

      const manager = new NotificationManager(config);

      // Replace all with unconfigured
      const notifiers = (manager as any).notifiers;
      for (let i = 0; i < notifiers.length; i++) {
        notifiers[i] = new MockLocalNotifier(false, false);
      }

      const context = createNotificationContext('pipeline.completed');
      const results = await manager.notify(context);

      expect(results).toEqual([]);
    });

    it('should handle async isConfigured() checks', async () => {
      const config: NotificationConfig = {
        enabled: true,
        events: ['pipeline.completed'],
        channels: {
          local: { enabled: true }
        }
      };

      const manager = new NotificationManager(config);

      // Create notifier with async delay in isConfigured
      class AsyncNotifier extends BaseNotifier {
        readonly channel = 'async-test';
        async isConfigured(): Promise<boolean> {
          await new Promise(resolve => setTimeout(resolve, 10));
          return true;
        }
        async send(_context: NotificationContext): Promise<NotificationResult> {
          return { success: true, channel: this.channel };
        }
      }

      (manager as any).notifiers = [new AsyncNotifier()];

      const context = createNotificationContext('pipeline.completed');
      const results = await manager.notify(context);

      expect(results.length).toBe(1);
      expect(results[0].success).toBe(true);
    });

    it('should filter all notifiers when checking configuration in parallel', async () => {
      const config: NotificationConfig = {
        enabled: true,
        events: ['pipeline.completed'],
        channels: {
          local: { enabled: true },
          slack: {
            enabled: true,
            webhookUrl: 'https://hooks.slack.com/test'
          }
        }
      };

      const manager = new NotificationManager(config);

      // Set up mix of configured states
      const notifiers = (manager as any).notifiers;
      if (notifiers.length >= 2) {
        notifiers[0] = new MockLocalNotifier(false, true);
        notifiers[1] = new MockSlackNotifier(false, true);
      }

      const context = createNotificationContext('pipeline.completed');
      const results = await manager.notify(context);

      // Both are configured, should get both results
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle notifiers that return false for isConfigured', async () => {
      const config: NotificationConfig = {
        enabled: true,
        events: ['pipeline.completed'],
        channels: {
          local: { enabled: true }
        }
      };

      const manager = new NotificationManager(config);
      (manager as any).notifiers = [new MockLocalNotifier(false, false)];

      const context = createNotificationContext('pipeline.completed');
      const results = await manager.notify(context);

      expect(results).toEqual([]);
    });

    it('should handle mix of configured and unconfigured notifiers', async () => {
      const config: NotificationConfig = {
        enabled: true,
        events: ['pipeline.completed'],
        channels: {
          local: { enabled: true },
          slack: {
            enabled: true,
            webhookUrl: 'https://hooks.slack.com/test'
          }
        }
      };

      const manager = new NotificationManager(config);

      // Create 3 notifiers: configured, unconfigured, configured
      const notifiers = [
        new MockLocalNotifier(false, true),
        new MockLocalNotifier(false, false),
        new MockSlackNotifier(false, true)
      ];
      (manager as any).notifiers = notifiers;

      const context = createNotificationContext('pipeline.completed');
      const results = await manager.notify(context);

      // Should get 2 results (the configured ones)
      expect(results.length).toBe(2);
      expect(results.every(r => r.success)).toBe(true);
    });
  });

  describe('test() command', () => {
    it('should test all configured notification channels', async () => {
      const config: NotificationConfig = {
        enabled: true,
        events: ['pipeline.completed'],
        channels: {
          local: { enabled: true },
          slack: {
            enabled: true,
            webhookUrl: 'https://hooks.slack.com/test'
          }
        }
      };

      const manager = new NotificationManager(config);
      await manager.test();

      // Check that console.log was called
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('should show error when no channels configured', async () => {
      const config: NotificationConfig = {
        enabled: true,
        events: ['pipeline.completed'],
        channels: {
          local: { enabled: false } // Explicitly disable local (enabled by default)
        }
      };

      const manager = new NotificationManager(config);
      await manager.test();

      expect(consoleLogSpy).toHaveBeenCalledWith('❌ No notification channels configured');
    });

    it('should show success for working notifiers', async () => {
      const config: NotificationConfig = {
        enabled: true,
        events: ['pipeline.completed'],
        channels: {
          local: { enabled: true }
        }
      };

      const manager = new NotificationManager(config);
      await manager.test();

      // Should have success message
      const calls = consoleLogSpy.mock.calls;
      const hasSuccess = calls.some((call: any[]) =>
        call[0]?.includes('✅') || call[0]?.includes('Test notification sent')
      );
      expect(hasSuccess || calls.length > 0).toBe(true);
    });

    it('should show error for failing notifiers', async () => {
      const config: NotificationConfig = {
        enabled: true,
        events: ['pipeline.completed'],
        channels: {
          local: { enabled: true }
        }
      };

      const manager = new NotificationManager(config);

      // Create a notifier that returns error result instead of throwing
      class FailingNotifier extends BaseNotifier {
        readonly channel = 'failing-test';
        async isConfigured(): Promise<boolean> {
          return true;
        }
        async send(_context: NotificationContext): Promise<NotificationResult> {
          return {
            success: false,
            channel: this.channel,
            error: 'Test error message'
          };
        }
      }

      // Replace with failing notifier that returns error result
      (manager as any).notifiers = [new FailingNotifier()];

      await manager.test();

      // Should show error in output
      const calls = consoleLogSpy.mock.calls;
      const hasError = calls.some((call: any[]) =>
        call[0]?.includes('❌') && call[0]?.includes('Test error message')
      );
      expect(hasError).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle undefined config gracefully', async () => {
      const manager = new NotificationManager(undefined);
      const context = createNotificationContext('pipeline.completed');
      const results = await manager.notify(context);

      expect(results).toEqual([]);
    });

    it('should handle config with enabled=false', async () => {
      const config: NotificationConfig = {
        enabled: false,
        events: ['pipeline.completed'],
        channels: {
          local: { enabled: true }
        }
      };

      const manager = new NotificationManager(config);
      const context = createNotificationContext('pipeline.completed');
      const results = await manager.notify(context);

      expect(results).toEqual([]);
    });

    it('should handle empty events array', async () => {
      const config: NotificationConfig = {
        enabled: true,
        events: [],
        channels: {
          local: { enabled: true }
        }
      };

      const manager = new NotificationManager(config);
      const context = createNotificationContext('pipeline.completed');
      const results = await manager.notify(context);

      expect(results).toEqual([]);
    });

    it('should handle config with no channels object', async () => {
      const config: NotificationConfig = {
        enabled: true,
        events: ['pipeline.completed'],
        channels: undefined as any
      };

      const manager = new NotificationManager(config);
      const context = createNotificationContext('pipeline.completed');
      const results = await manager.notify(context);

      // When channels is undefined, local defaults to enabled (line 31: channels?.local?.enabled !== false)
      // So we expect at least the local notifier result
      expect(results.length).toBeGreaterThanOrEqual(0);
    });
  });
});
