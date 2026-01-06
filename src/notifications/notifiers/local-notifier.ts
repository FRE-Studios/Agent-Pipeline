// src/notifications/notifiers/local-notifier.ts

import notifier from 'node-notifier';
import { BaseNotifier } from './base-notifier.js';
import {
  NotificationContext,
  NotificationResult,
  LocalNotificationConfig
} from '../types.js';

export class LocalNotifier extends BaseNotifier {
  readonly channel = 'local';

  constructor(private config: LocalNotificationConfig = {}) {
    super();
  }

  async isConfigured(): Promise<boolean> {
    // Local notifications should always work
    return true;
  }

  async send(context: NotificationContext): Promise<NotificationResult> {
    try {
      const notification = this.buildNotification(context);

      await new Promise<void>((resolve, reject) => {
        notifier.notify(notification, (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });

      return { success: true, channel: this.channel };
    } catch (error) {
      return {
        success: false,
        channel: this.channel,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private buildNotification(context: NotificationContext): any {
    const { event, pipelineState, stage, prUrl } = context;

    let title: string;
    let message: string;
    let open: string | undefined;

    switch (event) {
      case 'pipeline.started':
        title = '🚀 Pipeline Started';
        message = `${pipelineState.pipelineConfig.name}`;
        break;

      case 'pipeline.completed':
        title = '✅ Pipeline Completed';
        message = `${pipelineState.pipelineConfig.name} completed in ${this.formatDuration(pipelineState.artifacts.totalDuration || 0)}`;
        if (prUrl && this.config.openUrl) {
          open = prUrl;
        }
        break;

      case 'pipeline.failed':
        title = '❌ Pipeline Failed';
        const failedStages = pipelineState.stages.filter(s => s.status === 'failed');
        message = `${pipelineState.pipelineConfig.name} failed at stage: ${failedStages[0]?.stageName || 'unknown'}`;
        break;

      case 'pipeline.aborted':
        title = '⚠️ Pipeline Aborted';
        message = `${pipelineState.pipelineConfig.name} was aborted by user`;
        break;

      case 'stage.completed':
        title = `✅ Stage Completed`;
        message = `${stage?.stageName} completed in ${this.formatDuration(stage?.duration || 0)}`;
        break;

      case 'stage.failed':
        title = `❌ Stage Failed`;
        message = `${stage?.stageName}: ${stage?.error?.message || 'Unknown error'}`;
        break;

      case 'pr.created':
        title = '🔀 Pull Request Created';
        message = `${pipelineState.pipelineConfig.name}`;
        if (prUrl && this.config.openUrl) {
          open = prUrl;
        }
        break;

      default:
        title = '📋 Pipeline Event';
        message = `${event} for ${pipelineState.pipelineConfig.name}`;
    }

    const notification: any = {
      title,
      message,
      sound: this.config.sound !== false, // Default to true
      wait: true,
      appName: 'Agent Pipeline'
    };

    if (open) {
      notification.open = open;
    }

    return notification;
  }
}
