// src/notifications/notifiers/slack-notifier.ts

import { BaseNotifier } from './base-notifier.js';
import {
  NotificationContext,
  NotificationResult,
  SlackNotificationConfig
} from '../types.js';

const BROADCAST_MENTIONS = new Set(['channel', 'here', 'everyone']);
const SLACK_REQUEST_TIMEOUT_MS = 10000;

interface SlackBlock {
  type: string;
  [key: string]: any;
}

export class SlackNotifier extends BaseNotifier {
  readonly channel = 'slack';
  private webhookUrl: string;

  constructor(private config: SlackNotificationConfig) {
    super();
    this.webhookUrl = config.webhookUrl || process.env.SLACK_WEBHOOK_URL || '';
  }

  async isConfigured(): Promise<boolean> {
    return this.webhookUrl.length > 0;
  }

  async send(context: NotificationContext): Promise<NotificationResult> {
    if (!this.webhookUrl) {
      return {
        success: false,
        channel: this.channel,
        error: 'Slack webhook URL not configured'
      };
    }

    try {
      const payload = this.buildSlackPayload(context);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SLACK_REQUEST_TIMEOUT_MS);

      try {
        const response = await fetch(this.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error(`Slack API error: ${response.status} ${response.statusText}`);
        }
      } finally {
        clearTimeout(timeoutId);
      }


      return { success: true, channel: this.channel };
    } catch (error) {
      const message =
        error instanceof Error && error.name === 'AbortError'
          ? `Slack request timed out after ${SLACK_REQUEST_TIMEOUT_MS}ms`
          : error instanceof Error
            ? error.message
            : String(error);

      return {
        success: false,
        channel: this.channel,
        error: message
      };
    }
  }

  private buildSlackPayload(context: NotificationContext): any {
    const { event, pipelineState, stage, prUrl } = context;

    const blocks: SlackBlock[] = [];
    let color: 'good' | 'warning' | 'danger' = 'good';

    switch (event) {
      case 'pipeline.started':
        blocks.push({
          type: 'header',
          text: {
            type: 'plain_text',
            text: `🚀 Pipeline Started: ${pipelineState.pipelineConfig.name}`
          }
        });
        blocks.push({
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Run ID:*\n\`${pipelineState.runId}\`` },
            { type: 'mrkdwn', text: `*Stages:*\n${pipelineState.stages.length}` }
          ]
        });
        color = 'good';
        break;

      case 'pipeline.completed':
        blocks.push({
          type: 'header',
          text: {
            type: 'plain_text',
            text: `✅ Pipeline Completed: ${pipelineState.pipelineConfig.name}`
          }
        });

        const successCount = pipelineState.stages.filter(
          s => s.status === 'success'
        ).length;
        blocks.push({
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Duration:*\n${this.formatDuration(pipelineState.artifacts.totalDuration || 0)}`
            },
            {
              type: 'mrkdwn',
              text: `*Stages:*\n${successCount}/${pipelineState.stages.length} successful`
            },
            {
              type: 'mrkdwn',
              text: `*Commits:*\n${pipelineState.stages.filter(s => s.commitSha).length}`
            }
          ]
        });

        if (prUrl) {
          blocks.push({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Pull Request:*\n<${prUrl}|View PR>`
            }
          });
        }
        color = 'good';
        break;

      case 'pipeline.failed':
        blocks.push({
          type: 'header',
          text: {
            type: 'plain_text',
            text: `❌ Pipeline Failed: ${pipelineState.pipelineConfig.name}`
          }
        });

        const failedStages = pipelineState.stages.filter(s => s.status === 'failed');
        const failedStageLines =
          failedStages.length > 0
            ? failedStages.map(
                s => `• *${s.stageName}*: ${s.error?.message || 'Unknown error'}`
              )
            : ['• Unknown stage (no error details)'];
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Failed Stages:*\n${failedStageLines.join('\n')}`
          }
        });

        // Mention users on failure if configured
        if (this.config.mentionOnFailure && this.config.mentionOnFailure.length > 0) {
          const mentions = this.config.mentionOnFailure
            .map(user => this.formatMention(user))
            .filter((mention): mention is string => Boolean(mention))
            .join(' ');
          if (mentions.length > 0) {
            blocks.push({
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `CC: ${mentions}`
              }
            });
          }
        }
        color = 'danger';
        break;

      case 'stage.completed':
        if (stage) {
          blocks.push({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `✅ *${stage.stageName}* completed in ${this.formatDuration(stage.duration || 0)}`
            }
          });
        }
        color = 'good';
        break;

      case 'stage.failed':
        if (stage) {
          blocks.push({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `❌ *${stage.stageName}* failed\n\`\`\`${stage.error?.message || 'Unknown error'}\`\`\``
            }
          });
        }
        color = 'danger';
        break;

      case 'pr.created':
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `🔀 *Pull Request Created*\n${
              prUrl
                ? `<${prUrl}|View PR> for ${pipelineState.pipelineConfig.name}`
                : `for ${pipelineState.pipelineConfig.name}`
            }`
          }
        });
        color = 'good';
        break;
    }

    const payload: any = {
      attachments: [
        {
          color,
          blocks,
          footer: 'Agent Pipeline',
          footer_icon:
            'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png',
          ts: Math.floor(Date.now() / 1000)
        }
      ]
    };

    if (this.config.channel) {
      payload.channel = this.config.channel;
    }

    return payload;
  }

  /**
   * Normalize mention tokens to Slack's special mention syntax.
   */
  private formatMention(rawMention: string): string | null {
    const mention = rawMention?.trim();
    if (!mention) {
      return null;
    }

    // Respect already-formatted mentions like <@U12345> or <!channel>
    if (mention.startsWith('<') && mention.endsWith('>')) {
      return mention;
    }

    const normalized = mention.replace(/^@/, '');
    if (!normalized) {
      return null;
    }

    if (normalized.startsWith('!') || BROADCAST_MENTIONS.has(normalized)) {
      return `<!${normalized.replace(/^!/, '')}>`;
    }

    return `<@${normalized}>`;
  }
}
