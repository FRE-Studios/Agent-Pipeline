// src/notifications/types.ts

import { PipelineState, StageExecution } from '../config/schema.js';

export type NotificationEvent =
  | 'pipeline.started'
  | 'pipeline.completed'
  | 'pipeline.failed'
  | 'pipeline.aborted'
  | 'stage.completed'
  | 'stage.failed'
  | 'pr.created';

export interface NotificationContext {
  event: NotificationEvent;
  pipelineState: PipelineState;
  stage?: StageExecution;
  prUrl?: string;
  metadata?: Record<string, any>;
}

export interface NotificationConfig {
  enabled?: boolean;
  events?: NotificationEvent[];  // Which events to notify on
  channels?: {
    local?: LocalNotificationConfig;
    slack?: SlackNotificationConfig;
  };
}

export interface LocalNotificationConfig {
  enabled?: boolean;
  sound?: boolean;
  openUrl?: boolean;  // Open PR or logs on click
}

export interface SlackNotificationConfig {
  enabled?: boolean;
  webhookUrl?: string;  // Can also use env var SLACK_WEBHOOK_URL
  channel?: string;     // Override default channel
  mentionOnFailure?: string[];  // @user or @channel
}

export interface NotificationResult {
  success: boolean;
  channel: string;
  error?: string;
}
