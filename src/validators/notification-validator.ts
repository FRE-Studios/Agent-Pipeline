// src/validators/notification-validator.ts

import { Validator, ValidationContext } from './types.js';

/**
 * Validates notification configuration: Slack webhook URL format.
 */
export class NotificationValidator implements Validator {
  readonly name = 'notifications';
  readonly priority = 1 as const; // P1 - conditional feature

  shouldRun(context: ValidationContext): boolean {
    return !!context.config.notifications?.channels?.slack?.enabled;
  }

  async validate(context: ValidationContext): Promise<void> {
    const { config, errors } = context;
    const webhookUrl = config.notifications?.channels?.slack?.webhookUrl;

    if (!webhookUrl) {
      errors.push({
        field: 'notifications.channels.slack.webhookUrl',
        message:
          'Slack webhook URL is required when Slack notifications are enabled. Get webhook: https://api.slack.com/messaging/webhooks',
        severity: 'error',
      });
      return;
    }

    if (!webhookUrl.startsWith('https://hooks.slack.com/')) {
      errors.push({
        field: 'notifications.channels.slack.webhookUrl',
        message:
          'Invalid Slack webhook URL. Must start with https://hooks.slack.com/. Get webhook: https://api.slack.com/messaging/webhooks',
        severity: 'error',
      });
    }
  }
}
