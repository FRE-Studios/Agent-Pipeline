// src/__tests__/notifications/notifiers/slack-notifier.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SlackNotifier } from '../../../notifications/notifiers/slack-notifier.js';
import {
  NotificationContext,
  NotificationResult,
  SlackNotificationConfig
} from '../../../notifications/types.js';
import { PipelineState } from '../../../config/schema.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

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

describe('SlackNotifier', () => {
  const testWebhookUrl = 'https://hooks.slack.com/services/TEST/WEBHOOK/URL';
  const originalEnv = process.env.SLACK_WEBHOOK_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock: successful fetch response
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK'
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    // Restore environment variable
    if (originalEnv !== undefined) {
      process.env.SLACK_WEBHOOK_URL = originalEnv;
    } else {
      delete process.env.SLACK_WEBHOOK_URL;
    }
  });

  describe('constructor and configuration', () => {
    it('should use webhook URL from config when sending', async () => {
      const notifier = new SlackNotifier({ webhookUrl: testWebhookUrl });
      const context = createNotificationContext('pipeline.started');

      await notifier.send(context);

      expect(mockFetch).toHaveBeenCalledWith(
        testWebhookUrl,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
      );
    });

    it('should fall back to webhook URL from environment variable', async () => {
      process.env.SLACK_WEBHOOK_URL = testWebhookUrl;
      const notifier = new SlackNotifier({});
      const context = createNotificationContext('pipeline.started');

      await notifier.send(context);

      expect(mockFetch).toHaveBeenCalledWith(
        testWebhookUrl,
        expect.any(Object)
      );
    });

    it('should prefer config webhookUrl over environment variable', async () => {
      process.env.SLACK_WEBHOOK_URL = 'https://env-webhook.com';
      const configUrl = 'https://config-webhook.com';
      const notifier = new SlackNotifier({ webhookUrl: configUrl });
      const context = createNotificationContext('pipeline.started');

      await notifier.send(context);

      expect(mockFetch).toHaveBeenCalledWith(
        configUrl,
        expect.any(Object)
      );
    });

    it('should report not configured when webhook URL missing', async () => {
      delete process.env.SLACK_WEBHOOK_URL;
      const notifier = new SlackNotifier({});
      const context = createNotificationContext('pipeline.started');

      const result = await notifier.send(context);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Slack webhook URL not configured');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should include channel override in payload', async () => {
      const notifier = new SlackNotifier({
        webhookUrl: testWebhookUrl,
        channel: '#custom-channel'
      });
      const context = createNotificationContext('pipeline.started');

      await notifier.send(context);

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.channel).toBe('#custom-channel');
    });

    it('should include mentionOnFailure users when pipeline fails', async () => {
      const notifier = new SlackNotifier({
        webhookUrl: testWebhookUrl,
        mentionOnFailure: ['channel', 'U12345']
      });
      const pipelineState = createTestPipelineState({
        status: 'failed',
        stages: [
          {
            stageName: 'lint',
            status: 'failed',
            error: { message: 'Stage failed', timestamp: new Date().toISOString() },
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString()
          }
        ]
      });
      const context = createNotificationContext('pipeline.failed', { pipelineState });

      await notifier.send(context);

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      const mentionBlock = payload.attachments[0].blocks.find(
        (block: any) => block.text?.text?.startsWith('CC:')
      );
      expect(mentionBlock?.text?.text).toBe('CC: <!channel> <@U12345>');
    });
  });

  describe('isConfigured()', () => {
    it('should return true when webhook URL is configured via config', async () => {
      const notifier = new SlackNotifier({ webhookUrl: testWebhookUrl });
      const result = await notifier.isConfigured();
      expect(result).toBe(true);
    });

    it('should return true when webhook URL is configured via environment', async () => {
      process.env.SLACK_WEBHOOK_URL = testWebhookUrl;
      const notifier = new SlackNotifier({});
      const result = await notifier.isConfigured();
      expect(result).toBe(true);
    });

    it('should return false when webhook URL is not configured', async () => {
      delete process.env.SLACK_WEBHOOK_URL;
      const notifier = new SlackNotifier({});
      const result = await notifier.isConfigured();
      expect(result).toBe(false);
    });

    it('should return false when webhook URL is empty string', async () => {
      const notifier = new SlackNotifier({ webhookUrl: '' });
      const result = await notifier.isConfigured();
      expect(result).toBe(false);
    });
  });

  describe('send() - error handling', () => {
    it('should return error when webhook URL is not configured', async () => {
      delete process.env.SLACK_WEBHOOK_URL;
      const notifier = new SlackNotifier({});
      const context = createNotificationContext('pipeline.started');
      const result = await notifier.send(context);

      expect(result.success).toBe(false);
      expect(result.channel).toBe('slack');
      expect(result.error).toBe('Slack webhook URL not configured');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should return error when fetch fails with non-ok response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request'
      });

      const notifier = new SlackNotifier({ webhookUrl: testWebhookUrl });
      const context = createNotificationContext('pipeline.started');
      const result = await notifier.send(context);

      expect(result.success).toBe(false);
      expect(result.channel).toBe('slack');
      expect(result.error).toBe('Slack API error: 400 Bad Request');
    });

    it('should return error when fetch throws exception', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const notifier = new SlackNotifier({ webhookUrl: testWebhookUrl });
      const context = createNotificationContext('pipeline.started');
      const result = await notifier.send(context);

      expect(result.success).toBe(false);
      expect(result.channel).toBe('slack');
      expect(result.error).toBe('Network error');
    });

    it('should handle non-Error exceptions', async () => {
      mockFetch.mockRejectedValue('String error');

      const notifier = new SlackNotifier({ webhookUrl: testWebhookUrl });
      const context = createNotificationContext('pipeline.started');
      const result = await notifier.send(context);

      expect(result.success).toBe(false);
      expect(result.error).toBe('String error');
    });
  });

  describe('send() - pipeline.started event', () => {
    it('should send notification for pipeline.started', async () => {
      const notifier = new SlackNotifier({ webhookUrl: testWebhookUrl });
      const context = createNotificationContext('pipeline.started');
      const result = await notifier.send(context);

      expect(result.success).toBe(true);
      expect(result.channel).toBe('slack');
      expect(mockFetch).toHaveBeenCalledWith(
        testWebhookUrl,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
      );
    });

    it('should build correct payload for pipeline.started', async () => {
      const notifier = new SlackNotifier({ webhookUrl: testWebhookUrl });
      const pipelineState = createTestPipelineState({
        stages: [
          {
            stageName: 'stage-1',
            status: 'pending',
            startTime: new Date().toISOString()
          },
          {
            stageName: 'stage-2',
            status: 'pending',
            startTime: new Date().toISOString()
          }
        ]
      });
      const context = createNotificationContext('pipeline.started', { pipelineState });
      await notifier.send(context);

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.attachments[0].color).toBe('good');
      expect(payload.attachments[0].blocks).toContainEqual(
        expect.objectContaining({
          type: 'header',
          text: {
            type: 'plain_text',
            text: '🚀 Pipeline Started: test-pipeline'
          }
        })
      );
      expect(payload.attachments[0].blocks).toContainEqual(
        expect.objectContaining({
          type: 'section',
          fields: expect.arrayContaining([
            { type: 'mrkdwn', text: `*Run ID:*\n\`test-run-123\`` },
            { type: 'mrkdwn', text: `*Stages:*\n2` }
          ])
        })
      );
    });
  });

  describe('send() - pipeline.completed event', () => {
    it('should send notification for pipeline.completed', async () => {
      const notifier = new SlackNotifier({ webhookUrl: testWebhookUrl });
      const context = createNotificationContext('pipeline.completed');
      const result = await notifier.send(context);

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should build correct payload for pipeline.completed with PR URL', async () => {
      const notifier = new SlackNotifier({ webhookUrl: testWebhookUrl });
      const pipelineState = createTestPipelineState({
        stages: [
          {
            stageName: 'stage-1',
            status: 'success',
            duration: 10.0,
            commitSha: 'abc123',
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString()
          },
          {
            stageName: 'stage-2',
            status: 'success',
            duration: 15.0,
            commitSha: 'def456',
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString()
          }
        ],
        artifacts: {
          initialCommit: 'abc',
          totalDuration: 125.5,
          changedFiles: []
        }
      });
      const context = createNotificationContext('pipeline.completed', {
        pipelineState,
        prUrl: 'https://github.com/test/repo/pull/123'
      });
      await notifier.send(context);

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.attachments[0].color).toBe('good');
      expect(payload.attachments[0].blocks).toContainEqual(
        expect.objectContaining({
          type: 'header',
          text: {
            type: 'plain_text',
            text: '✅ Pipeline Completed: test-pipeline'
          }
        })
      );
      expect(payload.attachments[0].blocks).toContainEqual(
        expect.objectContaining({
          type: 'section',
          fields: expect.arrayContaining([
            { type: 'mrkdwn', text: '*Duration:*\n2m 5s' },
            { type: 'mrkdwn', text: '*Stages:*\n2/2 successful' },
            { type: 'mrkdwn', text: '*Commits:*\n2' }
          ])
        })
      );
      expect(payload.attachments[0].blocks).toContainEqual(
        expect.objectContaining({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*Pull Request:*\n<https://github.com/test/repo/pull/123|View PR>'
          }
        })
      );
    });

    it('should not include PR block when prUrl is not provided', async () => {
      const notifier = new SlackNotifier({ webhookUrl: testWebhookUrl });
      const context = createNotificationContext('pipeline.completed');
      await notifier.send(context);

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      const prBlock = payload.attachments[0].blocks.find(
        (block: any) => block.text?.text?.includes('Pull Request')
      );
      expect(prBlock).toBeUndefined();
    });
  });

  describe('send() - pipeline.failed event', () => {
    it('should send notification for pipeline.failed with failed stages', async () => {
      const notifier = new SlackNotifier({ webhookUrl: testWebhookUrl });
      const pipelineState = createTestPipelineState({
        status: 'failed',
        stages: [
          {
            stageName: 'stage-1',
            status: 'failed',
            duration: 5.0,
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
      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.attachments[0].color).toBe('danger');
      expect(payload.attachments[0].blocks).toContainEqual(
        expect.objectContaining({
          type: 'header',
          text: {
            type: 'plain_text',
            text: '❌ Pipeline Failed: test-pipeline'
          }
        })
      );
      expect(payload.attachments[0].blocks).toContainEqual(
        expect.objectContaining({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*Failed Stages:*\n• *stage-1*: Test error'
          }
        })
      );
    });

    it('should handle multiple failed stages', async () => {
      const notifier = new SlackNotifier({ webhookUrl: testWebhookUrl });
      const pipelineState = createTestPipelineState({
        status: 'failed',
        stages: [
          {
            stageName: 'stage-1',
            status: 'failed',
            duration: 5.0,
            error: { message: 'Error 1', timestamp: new Date().toISOString() },
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString()
          },
          {
            stageName: 'stage-2',
            status: 'failed',
            duration: 3.0,
            error: { message: 'Error 2', timestamp: new Date().toISOString() },
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString()
          }
        ]
      });
      const context = createNotificationContext('pipeline.failed', { pipelineState });
      await notifier.send(context);

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.attachments[0].blocks).toContainEqual(
        expect.objectContaining({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*Failed Stages:*\n• *stage-1*: Error 1\n• *stage-2*: Error 2'
          }
        })
      );
    });

    it('should show "Unknown error" when error message not provided', async () => {
      const notifier = new SlackNotifier({ webhookUrl: testWebhookUrl });
      const pipelineState = createTestPipelineState({
        status: 'failed',
        stages: [
          {
            stageName: 'stage-1',
            status: 'failed',
            duration: 5.0,
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString()
          }
        ]
      });
      const context = createNotificationContext('pipeline.failed', { pipelineState });
      await notifier.send(context);

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.attachments[0].blocks).toContainEqual(
        expect.objectContaining({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*Failed Stages:*\n• *stage-1*: Unknown error'
          }
        })
      );
    });

    it('should include mentions on failure when configured', async () => {
      const notifier = new SlackNotifier({
        webhookUrl: testWebhookUrl,
        mentionOnFailure: ['channel', 'U12345']
      });
      const pipelineState = createTestPipelineState({
        status: 'failed',
        stages: [
          {
            stageName: 'stage-1',
            status: 'failed',
            duration: 5.0,
            error: { message: 'Error', timestamp: new Date().toISOString() },
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString()
          }
        ]
      });
      const context = createNotificationContext('pipeline.failed', { pipelineState });
      await notifier.send(context);

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.attachments[0].blocks).toContainEqual(
        expect.objectContaining({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'CC: <!channel> <@U12345>'
          }
        })
      );
    });

    it('should not include mention block when mentionOnFailure is empty', async () => {
      const notifier = new SlackNotifier({
        webhookUrl: testWebhookUrl,
        mentionOnFailure: []
      });
      const pipelineState = createTestPipelineState({
        status: 'failed',
        stages: [
          {
            stageName: 'stage-1',
            status: 'failed',
            duration: 5.0,
            error: { message: 'Error', timestamp: new Date().toISOString() },
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString()
          }
        ]
      });
      const context = createNotificationContext('pipeline.failed', { pipelineState });
      await notifier.send(context);

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      const mentionBlock = payload.attachments[0].blocks.find(
        (block: any) => block.text?.text?.includes('CC:')
      );
      expect(mentionBlock).toBeUndefined();
    });

    it('should filter out invalid mentions', async () => {
      const notifier = new SlackNotifier({
        webhookUrl: testWebhookUrl,
        mentionOnFailure: ['', '   ', 'U12345']
      });
      const pipelineState = createTestPipelineState({
        status: 'failed',
        stages: [
          {
            stageName: 'stage-1',
            status: 'failed',
            duration: 5.0,
            error: { message: 'Error', timestamp: new Date().toISOString() },
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString()
          }
        ]
      });
      const context = createNotificationContext('pipeline.failed', { pipelineState });
      await notifier.send(context);

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.attachments[0].blocks).toContainEqual(
        expect.objectContaining({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'CC: <@U12345>'
          }
        })
      );
    });

    it('should not include mention block when all mentions are invalid', async () => {
      const notifier = new SlackNotifier({
        webhookUrl: testWebhookUrl,
        mentionOnFailure: ['', '   ']
      });
      const pipelineState = createTestPipelineState({
        status: 'failed',
        stages: [
          {
            stageName: 'stage-1',
            status: 'failed',
            duration: 5.0,
            error: { message: 'Error', timestamp: new Date().toISOString() },
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString()
          }
        ]
      });
      const context = createNotificationContext('pipeline.failed', { pipelineState });
      await notifier.send(context);

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      const mentionBlock = payload.attachments[0].blocks.find(
        (block: any) => block.text?.text?.includes('CC:')
      );
      expect(mentionBlock).toBeUndefined();
    });

    it('should show fallback text when no failed stages are provided', async () => {
      const notifier = new SlackNotifier({ webhookUrl: testWebhookUrl });
      const pipelineState = createTestPipelineState({
        status: 'failed',
        stages: []
      });
      const context = createNotificationContext('pipeline.failed', { pipelineState });
      await notifier.send(context);

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.attachments[0].blocks).toContainEqual(
        expect.objectContaining({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*Failed Stages:*\n• Unknown stage (no error details)'
          }
        })
      );
    });
  });

  describe('send() - stage.completed event', () => {
    it('should send notification for stage.completed', async () => {
      const notifier = new SlackNotifier({ webhookUrl: testWebhookUrl });
      const context = createNotificationContext('stage.completed', {
        stage: {
          stageName: 'code-review',
          status: 'success',
          duration: 15.8,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString()
        }
      });
      const result = await notifier.send(context);

      expect(result.success).toBe(true);
      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.attachments[0].color).toBe('good');
      expect(payload.attachments[0].blocks).toContainEqual(
        expect.objectContaining({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '✅ *code-review* completed in 15.8s'
          }
        })
      );
    });

    it('should format duration correctly for long-running stages', async () => {
      const notifier = new SlackNotifier({ webhookUrl: testWebhookUrl });
      const context = createNotificationContext('stage.completed', {
        stage: {
          stageName: 'long-stage',
          status: 'success',
          duration: 135.0, // 2m 15s
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString()
        }
      });
      await notifier.send(context);

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.attachments[0].blocks).toContainEqual(
        expect.objectContaining({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '✅ *long-stage* completed in 2m 15s'
          }
        })
      );
    });

    it('should handle stage with zero duration', async () => {
      const notifier = new SlackNotifier({ webhookUrl: testWebhookUrl });
      const context = createNotificationContext('stage.completed', {
        stage: {
          stageName: 'fast-stage',
          status: 'success',
          duration: 0,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString()
        }
      });
      await notifier.send(context);

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.attachments[0].blocks).toContainEqual(
        expect.objectContaining({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '✅ *fast-stage* completed in 0.0s'
          }
        })
      );
    });
  });

  describe('send() - stage.failed event', () => {
    it('should send notification for stage.failed', async () => {
      const notifier = new SlackNotifier({ webhookUrl: testWebhookUrl });
      const context = createNotificationContext('stage.failed', {
        stage: {
          stageName: 'security-scan',
          status: 'failed',
          duration: 10.2,
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
      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.attachments[0].color).toBe('danger');
      expect(payload.attachments[0].blocks).toContainEqual(
        expect.objectContaining({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '❌ *security-scan* failed\n```Security vulnerabilities found```'
          }
        })
      );
    });

    it('should show "Unknown error" when error message not provided', async () => {
      const notifier = new SlackNotifier({ webhookUrl: testWebhookUrl });
      const context = createNotificationContext('stage.failed', {
        stage: {
          stageName: 'test-stage',
          status: 'failed',
          duration: 5.0,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString()
        }
      });
      await notifier.send(context);

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.attachments[0].blocks).toContainEqual(
        expect.objectContaining({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '❌ *test-stage* failed\n```Unknown error```'
          }
        })
      );
    });
  });

  describe('send() - pr.created event', () => {
    it('should send notification for pr.created', async () => {
      const notifier = new SlackNotifier({ webhookUrl: testWebhookUrl });
      const context = createNotificationContext('pr.created', {
        prUrl: 'https://github.com/test/repo/pull/456'
      });
      const result = await notifier.send(context);

      expect(result.success).toBe(true);
      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.attachments[0].color).toBe('good');
      expect(payload.attachments[0].blocks).toContainEqual(
        expect.objectContaining({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '🔀 *Pull Request Created*\n<https://github.com/test/repo/pull/456|View PR> for test-pipeline'
          }
        })
      );
    });

    it('should omit PR link when prUrl is not provided', async () => {
      const notifier = new SlackNotifier({ webhookUrl: testWebhookUrl });
      const context = createNotificationContext('pr.created');
      await notifier.send(context);

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      const prBlock = payload.attachments[0].blocks.find(
        (block: any) => block.text?.text?.includes('Pull Request Created')
      );
      expect(prBlock).toBeDefined();
      expect(prBlock.text.text).toBe('🔀 *Pull Request Created*\nfor test-pipeline');
    });
  });

  describe('payload structure', () => {
    it('should include footer and timestamp in all messages', async () => {
      const notifier = new SlackNotifier({ webhookUrl: testWebhookUrl });
      const context = createNotificationContext('pipeline.started');
      await notifier.send(context);

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.attachments[0].footer).toBe('Agent Pipeline');
      expect(payload.attachments[0].footer_icon).toBe(
        'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png'
      );
      expect(payload.attachments[0].ts).toBeGreaterThan(0);
      expect(typeof payload.attachments[0].ts).toBe('number');
    });

    it('should not include channel when not configured', async () => {
      const notifier = new SlackNotifier({ webhookUrl: testWebhookUrl });
      const context = createNotificationContext('pipeline.started');
      await notifier.send(context);

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.channel).toBeUndefined();
    });

    it('should include channel override when configured', async () => {
      const notifier = new SlackNotifier({
        webhookUrl: testWebhookUrl,
        channel: '#custom-channel'
      });
      const context = createNotificationContext('pipeline.started');
      await notifier.send(context);

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.channel).toBe('#custom-channel');
    });
  });

  describe('formatMention() - mention formatting', () => {
    it('should format broadcast mention for "channel"', async () => {
      const notifier = new SlackNotifier({
        webhookUrl: testWebhookUrl,
        mentionOnFailure: ['channel']
      });
      const pipelineState = createTestPipelineState({
        status: 'failed',
        stages: [
          {
            stageName: 'stage-1',
            status: 'failed',
            duration: 5.0,
            error: { message: 'Error', timestamp: new Date().toISOString() },
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString()
          }
        ]
      });
      const context = createNotificationContext('pipeline.failed', { pipelineState });
      await notifier.send(context);

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.attachments[0].blocks).toContainEqual(
        expect.objectContaining({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'CC: <!channel>'
          }
        })
      );
    });

    it('should format broadcast mention for "here"', async () => {
      const notifier = new SlackNotifier({
        webhookUrl: testWebhookUrl,
        mentionOnFailure: ['here']
      });
      const pipelineState = createTestPipelineState({
        status: 'failed',
        stages: [
          {
            stageName: 'stage-1',
            status: 'failed',
            duration: 5.0,
            error: { message: 'Error', timestamp: new Date().toISOString() },
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString()
          }
        ]
      });
      const context = createNotificationContext('pipeline.failed', { pipelineState });
      await notifier.send(context);

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.attachments[0].blocks).toContainEqual(
        expect.objectContaining({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'CC: <!here>'
          }
        })
      );
    });

    it('should format broadcast mention for "everyone"', async () => {
      const notifier = new SlackNotifier({
        webhookUrl: testWebhookUrl,
        mentionOnFailure: ['everyone']
      });
      const pipelineState = createTestPipelineState({
        status: 'failed',
        stages: [
          {
            stageName: 'stage-1',
            status: 'failed',
            duration: 5.0,
            error: { message: 'Error', timestamp: new Date().toISOString() },
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString()
          }
        ]
      });
      const context = createNotificationContext('pipeline.failed', { pipelineState });
      await notifier.send(context);

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.attachments[0].blocks).toContainEqual(
        expect.objectContaining({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'CC: <!everyone>'
          }
        })
      );
    });

    it('should format user mention with @ prefix', async () => {
      const notifier = new SlackNotifier({
        webhookUrl: testWebhookUrl,
        mentionOnFailure: ['@U12345']
      });
      const pipelineState = createTestPipelineState({
        status: 'failed',
        stages: [
          {
            stageName: 'stage-1',
            status: 'failed',
            duration: 5.0,
            error: { message: 'Error', timestamp: new Date().toISOString() },
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString()
          }
        ]
      });
      const context = createNotificationContext('pipeline.failed', { pipelineState });
      await notifier.send(context);

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.attachments[0].blocks).toContainEqual(
        expect.objectContaining({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'CC: <@U12345>'
          }
        })
      );
    });

    it('should format user mention without @ prefix', async () => {
      const notifier = new SlackNotifier({
        webhookUrl: testWebhookUrl,
        mentionOnFailure: ['U67890']
      });
      const pipelineState = createTestPipelineState({
        status: 'failed',
        stages: [
          {
            stageName: 'stage-1',
            status: 'failed',
            duration: 5.0,
            error: { message: 'Error', timestamp: new Date().toISOString() },
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString()
          }
        ]
      });
      const context = createNotificationContext('pipeline.failed', { pipelineState });
      await notifier.send(context);

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.attachments[0].blocks).toContainEqual(
        expect.objectContaining({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'CC: <@U67890>'
          }
        })
      );
    });

    it('should preserve already-formatted mentions', async () => {
      const notifier = new SlackNotifier({
        webhookUrl: testWebhookUrl,
        mentionOnFailure: ['<@U12345>', '<!channel>']
      });
      const pipelineState = createTestPipelineState({
        status: 'failed',
        stages: [
          {
            stageName: 'stage-1',
            status: 'failed',
            duration: 5.0,
            error: { message: 'Error', timestamp: new Date().toISOString() },
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString()
          }
        ]
      });
      const context = createNotificationContext('pipeline.failed', { pipelineState });
      await notifier.send(context);

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.attachments[0].blocks).toContainEqual(
        expect.objectContaining({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'CC: <@U12345> <!channel>'
          }
        })
      );
    });

    it('should format mention with ! prefix as broadcast', async () => {
      const notifier = new SlackNotifier({
        webhookUrl: testWebhookUrl,
        mentionOnFailure: ['!channel']
      });
      const pipelineState = createTestPipelineState({
        status: 'failed',
        stages: [
          {
            stageName: 'stage-1',
            status: 'failed',
            duration: 5.0,
            error: { message: 'Error', timestamp: new Date().toISOString() },
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString()
          }
        ]
      });
      const context = createNotificationContext('pipeline.failed', { pipelineState });
      await notifier.send(context);

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.attachments[0].blocks).toContainEqual(
        expect.objectContaining({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'CC: <!channel>'
          }
        })
      );
    });

    it('should format @channel as broadcast', async () => {
      const notifier = new SlackNotifier({
        webhookUrl: testWebhookUrl,
        mentionOnFailure: ['@channel']
      });
      const pipelineState = createTestPipelineState({
        status: 'failed',
        stages: [
          {
            stageName: 'stage-1',
            status: 'failed',
            duration: 5.0,
            error: { message: 'Error', timestamp: new Date().toISOString() },
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString()
          }
        ]
      });
      const context = createNotificationContext('pipeline.failed', { pipelineState });
      await notifier.send(context);

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.attachments[0].blocks).toContainEqual(
        expect.objectContaining({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'CC: <!channel>'
          }
        })
      );
    });
  });

  describe('integration with BaseNotifier', () => {
    it('should use formatDuration from BaseNotifier', async () => {
      const notifier = new SlackNotifier({ webhookUrl: testWebhookUrl });
      const pipelineState = createTestPipelineState({
        artifacts: {
          initialCommit: 'abc',
          totalDuration: 90.5, // 1m 30s
          changedFiles: []
        }
      });
      const context = createNotificationContext('pipeline.completed', { pipelineState });
      await notifier.send(context);

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.attachments[0].blocks).toContainEqual(
        expect.objectContaining({
          type: 'section',
          fields: expect.arrayContaining([
            { type: 'mrkdwn', text: '*Duration:*\n1m 30s' }
          ])
        })
      );
    });
  });
});
