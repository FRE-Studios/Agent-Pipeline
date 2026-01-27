// src/notifications/notification-manager.ts

import { BaseNotifier } from './notifiers/base-notifier.js';
import { LocalNotifier } from './notifiers/local-notifier.js';
import { SlackNotifier } from './notifiers/slack-notifier.js';
import {
  NotificationConfig,
  NotificationContext,
  NotificationEvent,
  NotificationResult
} from './types.js';

export class NotificationManager {
  private notifiers: BaseNotifier[] = [];
  private enabledEvents: Set<NotificationEvent>;
  private warnedMisconfiguredChannels = new Set<string>();

  constructor(private config?: NotificationConfig) {
    this.enabledEvents = new Set<NotificationEvent>(
      config?.events || ['pipeline.completed', 'pipeline.failed', 'pipeline.aborted', 'pr.created']
    );

    this.initializeNotifiers();
  }

  private initializeNotifiers(): void {
    if (!this.config || this.config.enabled === false) {
      return;
    }

    // Local notifications
    if (this.config.channels?.local?.enabled !== false) {
      this.notifiers.push(new LocalNotifier(this.config.channels?.local));
    }

    // Slack notifications
    if (this.config.channels?.slack?.enabled) {
      this.notifiers.push(new SlackNotifier(this.config.channels.slack));
    }
  }

  /**
   * Send notifications to all configured channels
   */
  async notify(context: NotificationContext): Promise<NotificationResult[]> {
    // Check if this event should trigger notifications
    if (!this.enabledEvents.has(context.event)) {
      return [];
    }

    // Filter to only configured notifiers
    const configuredNotifiers = await this.getConfiguredNotifiers();

    if (configuredNotifiers.length === 0) {
      return [];
    }

    // Send to all notifiers in parallel
    const results = await Promise.all(
      configuredNotifiers.map(notifier =>
        notifier.send(context).catch(error => ({
          success: false,
          channel: notifier.channel,
          error: error instanceof Error ? error.message : String(error)
        }))
      )
    );

    return results;
  }

  /**
   * Get list of notifiers that are properly configured
   */
  private async getConfiguredNotifiers(): Promise<BaseNotifier[]> {
    const checks = await Promise.all(
      this.notifiers.map(async notifier => ({
        notifier,
        configured: await notifier.isConfigured()
      }))
    );

    const misconfigured = checks.filter(check => !check.configured);
    for (const { notifier } of misconfigured) {
      if (!this.warnedMisconfiguredChannels.has(notifier.channel)) {
        console.warn(
          `⚠️  Notification channel '${notifier.channel}' is enabled but not configured; skipping.`
        );
        this.warnedMisconfiguredChannels.add(notifier.channel);
      }
    }

    return checks.filter(check => check.configured).map(check => check.notifier);
  }

  /**
   * Test all configured notification channels
   */
  async test(): Promise<void> {
    console.log('\n🔔 Testing notification channels...\n');

    const configuredNotifiers = await this.getConfiguredNotifiers();

    if (configuredNotifiers.length === 0) {
      console.log('❌ No notification channels configured');
      return;
    }

    for (const notifier of configuredNotifiers) {
      const testContext: NotificationContext = {
        event: 'pipeline.completed',
        pipelineState: {
          runId: 'test-' + Date.now(),
          pipelineConfig: {
            name: 'test-pipeline',
            trigger: 'manual',
            agents: [],
            git: { autoCommit: true, commitPrefix: '[pipeline:{{stage}}]' },
            execution: { failureStrategy: 'stop' }
          },
          trigger: { type: 'manual', commitSha: 'abc123', timestamp: new Date().toISOString() },
          stages: [],
          status: 'completed',
          artifacts: { handoverDir: '.agent-pipeline/runs/test-run', initialCommit: 'abc123', totalDuration: 42.5, changedFiles: [] as string[] }
        }
      };

      const result = await notifier.send(testContext);

      if (result.success) {
        console.log(`✅ ${notifier.channel}: Test notification sent`);
      } else {
        console.log(`❌ ${notifier.channel}: ${result.error}`);
      }
    }
  }
}
