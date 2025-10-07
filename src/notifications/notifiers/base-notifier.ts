// src/notifications/notifiers/base-notifier.ts

import { NotificationContext, NotificationResult } from '../types.js';

export abstract class BaseNotifier {
  abstract readonly channel: string;

  /**
   * Send a notification for the given context
   */
  abstract send(context: NotificationContext): Promise<NotificationResult>;

  /**
   * Check if this notifier is properly configured and ready
   */
  abstract isConfigured(): Promise<boolean>;

  /**
   * Format duration in human-readable format
   */
  protected formatDuration(seconds: number): string {
    if (seconds < 60) {
      return `${seconds.toFixed(1)}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}m ${secs}s`;
  }

  /**
   * Get emoji for status
   */
  protected getStatusEmoji(status: string): string {
    switch (status) {
      case 'completed':
        return '✅';
      case 'success':
        return '✅';
      case 'failed':
        return '❌';
      case 'running':
        return '🔄';
      case 'skipped':
        return '⏭️';
      default:
        return '📋';
    }
  }
}
