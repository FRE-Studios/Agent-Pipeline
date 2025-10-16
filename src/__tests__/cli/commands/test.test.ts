import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { testCommand } from '../../../cli/commands/test.js';
import { PipelineLoader } from '../../../config/pipeline-loader.js';
import { NotificationManager } from '../../../notifications/notification-manager.js';
import { createTempDir, cleanupTempDir } from '../../setup.js';

// Mock dependencies
vi.mock('../../../config/pipeline-loader.js');
vi.mock('../../../notifications/notification-manager.js');

describe('testCommand', () => {
  let tempDir: string;
  let mockLoader: any;
  let mockNotificationManager: any;
  let processExitSpy: any;

  beforeEach(async () => {
    tempDir = await createTempDir('test-command-test-');

    // Setup PipelineLoader mock
    mockLoader = {
      loadPipeline: vi.fn(),
    };
    vi.mocked(PipelineLoader).mockImplementation(() => mockLoader);

    // Setup NotificationManager mock
    mockNotificationManager = {
      test: vi.fn(),
    };
    vi.mocked(NotificationManager).mockImplementation(() => mockNotificationManager);

    // Spy on process.exit
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
    vi.clearAllMocks();
    processExitSpy.mockRestore();
  });

  describe('Notification Testing', () => {
    it('should test notifications when --notifications flag provided', async () => {
      const config = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
        notifications: {
          enabled: true,
          events: ['pipeline.completed'],
          channels: {
            local: { enabled: true },
          },
        },
      };
      mockLoader.loadPipeline.mockResolvedValue(config);
      mockNotificationManager.test.mockResolvedValue(undefined);

      await testCommand(tempDir, 'test-pipeline', { notifications: true });

      expect(mockLoader.loadPipeline).toHaveBeenCalledWith('test-pipeline');
      expect(NotificationManager).toHaveBeenCalledWith(config.notifications);
      expect(mockNotificationManager.test).toHaveBeenCalled();
    });

    it('should exit with code 1 when no notification config found', async () => {
      const config = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
        // No notifications config
      };
      mockLoader.loadPipeline.mockResolvedValue(config);

      await expect(
        testCommand(tempDir, 'test-pipeline', { notifications: true })
      ).rejects.toThrow('process.exit(1)');

      expect(console.log).toHaveBeenCalledWith('❌ No notification configuration found in pipeline');
      expect(mockNotificationManager.test).not.toHaveBeenCalled();
    });

    it('should exit with code 1 when notifications config is undefined', async () => {
      const config = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
        notifications: undefined,
      };
      mockLoader.loadPipeline.mockResolvedValue(config);

      await expect(
        testCommand(tempDir, 'test-pipeline', { notifications: true })
      ).rejects.toThrow('process.exit(1)');

      expect(console.log).toHaveBeenCalledWith('❌ No notification configuration found in pipeline');
    });

    it('should exit with code 1 when notifications config is null', async () => {
      const config = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
        notifications: null,
      };
      mockLoader.loadPipeline.mockResolvedValue(config);

      await expect(
        testCommand(tempDir, 'test-pipeline', { notifications: true })
      ).rejects.toThrow('process.exit(1)');

      expect(console.log).toHaveBeenCalledWith('❌ No notification configuration found in pipeline');
    });

    it('should call test method on NotificationManager', async () => {
      const notificationConfig = {
        enabled: true,
        events: ['pipeline.completed', 'pipeline.failed'],
        channels: {
          local: { enabled: true },
          slack: { enabled: false },
        },
      };
      const config = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
        notifications: notificationConfig,
      };
      mockLoader.loadPipeline.mockResolvedValue(config);
      mockNotificationManager.test.mockResolvedValue(undefined);

      await testCommand(tempDir, 'test-pipeline', { notifications: true });

      expect(NotificationManager).toHaveBeenCalledWith(notificationConfig);
      expect(mockNotificationManager.test).toHaveBeenCalledTimes(1);
    });
  });

  describe('Usage Message', () => {
    it('should show usage message when no options provided', async () => {
      await testCommand(tempDir, 'test-pipeline');

      expect(console.log).toHaveBeenCalledWith('Usage: agent-pipeline test <pipeline-name> --notifications');
      expect(mockLoader.loadPipeline).not.toHaveBeenCalled();
      expect(mockNotificationManager.test).not.toHaveBeenCalled();
    });

    it('should show usage message when options is empty object', async () => {
      await testCommand(tempDir, 'test-pipeline', {});

      expect(console.log).toHaveBeenCalledWith('Usage: agent-pipeline test <pipeline-name> --notifications');
      expect(mockLoader.loadPipeline).not.toHaveBeenCalled();
    });

    it('should show usage message when notifications is false', async () => {
      await testCommand(tempDir, 'test-pipeline', { notifications: false });

      expect(console.log).toHaveBeenCalledWith('Usage: agent-pipeline test <pipeline-name> --notifications');
      expect(mockLoader.loadPipeline).not.toHaveBeenCalled();
    });

    it('should not load pipeline when showing usage message', async () => {
      await testCommand(tempDir, 'test-pipeline');

      expect(mockLoader.loadPipeline).not.toHaveBeenCalled();
    });
  });

  describe('PipelineLoader Integration', () => {
    it('should load correct pipeline by name', async () => {
      const config = {
        name: 'my-pipeline',
        trigger: 'manual',
        agents: [],
        notifications: { enabled: true, events: [], channels: {} },
      };
      mockLoader.loadPipeline.mockResolvedValue(config);
      mockNotificationManager.test.mockResolvedValue(undefined);

      await testCommand(tempDir, 'my-pipeline', { notifications: true });

      expect(PipelineLoader).toHaveBeenCalledWith(tempDir);
      expect(mockLoader.loadPipeline).toHaveBeenCalledWith('my-pipeline');
    });

    it('should handle pipeline load errors', async () => {
      mockLoader.loadPipeline.mockRejectedValue(new Error('Pipeline not found'));

      await expect(
        testCommand(tempDir, 'nonexistent-pipeline', { notifications: true })
      ).rejects.toThrow('Pipeline not found');

      expect(mockNotificationManager.test).not.toHaveBeenCalled();
    });

    it('should propagate YAML parse errors', async () => {
      mockLoader.loadPipeline.mockRejectedValue(new Error('Invalid YAML'));

      await expect(
        testCommand(tempDir, 'bad-pipeline', { notifications: true })
      ).rejects.toThrow('Invalid YAML');
    });
  });

  describe('NotificationManager Integration', () => {
    it('should instantiate NotificationManager with correct config', async () => {
      const notificationConfig = {
        enabled: true,
        events: ['pipeline.started'],
        channels: {
          local: { enabled: true, sound: true },
        },
      };
      const config = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
        notifications: notificationConfig,
      };
      mockLoader.loadPipeline.mockResolvedValue(config);
      mockNotificationManager.test.mockResolvedValue(undefined);

      await testCommand(tempDir, 'test-pipeline', { notifications: true });

      expect(NotificationManager).toHaveBeenCalledWith(notificationConfig);
    });

    it('should handle test method errors', async () => {
      const config = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
        notifications: { enabled: true, events: [], channels: {} },
      };
      mockLoader.loadPipeline.mockResolvedValue(config);
      mockNotificationManager.test.mockRejectedValue(new Error('Slack webhook failed'));

      await expect(
        testCommand(tempDir, 'test-pipeline', { notifications: true })
      ).rejects.toThrow('Slack webhook failed');
    });

    it('should pass all notification channels to manager', async () => {
      const notificationConfig = {
        enabled: true,
        events: ['pipeline.completed'],
        channels: {
          local: { enabled: true, sound: true, openUrl: true },
          slack: {
            enabled: true,
            webhookUrl: 'https://hooks.slack.com/test',
            channel: '#ci',
          },
        },
      };
      const config = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
        notifications: notificationConfig,
      };
      mockLoader.loadPipeline.mockResolvedValue(config);
      mockNotificationManager.test.mockResolvedValue(undefined);

      await testCommand(tempDir, 'test-pipeline', { notifications: true });

      expect(NotificationManager).toHaveBeenCalledWith(notificationConfig);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty notifications config', async () => {
      const config = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
        notifications: {},
      };
      mockLoader.loadPipeline.mockResolvedValue(config);
      mockNotificationManager.test.mockResolvedValue(undefined);

      // Empty object is truthy, so it should not exit
      await testCommand(tempDir, 'test-pipeline', { notifications: true });

      expect(NotificationManager).toHaveBeenCalledWith({});
      expect(mockNotificationManager.test).toHaveBeenCalled();
    });

    it('should handle notification config with disabled channels', async () => {
      const config = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
        notifications: {
          enabled: false,
          events: [],
          channels: {
            local: { enabled: false },
            slack: { enabled: false },
          },
        },
      };
      mockLoader.loadPipeline.mockResolvedValue(config);
      mockNotificationManager.test.mockResolvedValue(undefined);

      await testCommand(tempDir, 'test-pipeline', { notifications: true });

      expect(mockNotificationManager.test).toHaveBeenCalled();
    });

    it('should handle very long pipeline names', async () => {
      const longName = 'very-long-pipeline-name-that-exceeds-normal-length-limits';
      const config = {
        name: longName,
        trigger: 'manual',
        agents: [],
        notifications: { enabled: true, events: [], channels: {} },
      };
      mockLoader.loadPipeline.mockResolvedValue(config);
      mockNotificationManager.test.mockResolvedValue(undefined);

      await testCommand(tempDir, longName, { notifications: true });

      expect(mockLoader.loadPipeline).toHaveBeenCalledWith(longName);
    });

    it('should handle pipeline names with special characters', async () => {
      const specialName = 'pipeline_with-special.chars';
      const config = {
        name: specialName,
        trigger: 'manual',
        agents: [],
        notifications: { enabled: true, events: [], channels: {} },
      };
      mockLoader.loadPipeline.mockResolvedValue(config);
      mockNotificationManager.test.mockResolvedValue(undefined);

      await testCommand(tempDir, specialName, { notifications: true });

      expect(mockLoader.loadPipeline).toHaveBeenCalledWith(specialName);
    });
  });

  describe('Integration', () => {
    it('should complete full test workflow successfully', async () => {
      const config = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
        notifications: {
          enabled: true,
          events: ['pipeline.completed'],
          channels: {
            local: { enabled: true },
          },
        },
      };
      mockLoader.loadPipeline.mockResolvedValue(config);
      mockNotificationManager.test.mockResolvedValue(undefined);

      await testCommand(tempDir, 'test-pipeline', { notifications: true });

      expect(PipelineLoader).toHaveBeenCalledWith(tempDir);
      expect(mockLoader.loadPipeline).toHaveBeenCalledWith('test-pipeline');
      expect(NotificationManager).toHaveBeenCalledWith(config.notifications);
      expect(mockNotificationManager.test).toHaveBeenCalled();
    });

    it('should handle complete workflow with error', async () => {
      const config = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
        notifications: null,
      };
      mockLoader.loadPipeline.mockResolvedValue(config);

      await expect(
        testCommand(tempDir, 'test-pipeline', { notifications: true })
      ).rejects.toThrow('process.exit(1)');

      expect(console.log).toHaveBeenCalledWith('❌ No notification configuration found in pipeline');
      expect(mockNotificationManager.test).not.toHaveBeenCalled();
    });

    it('should work with different repository paths', async () => {
      const customPath = '/custom/repo/path';
      const config = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
        notifications: { enabled: true, events: [], channels: {} },
      };
      mockLoader.loadPipeline.mockResolvedValue(config);
      mockNotificationManager.test.mockResolvedValue(undefined);

      await testCommand(customPath, 'test-pipeline', { notifications: true });

      expect(PipelineLoader).toHaveBeenCalledWith(customPath);
    });
  });
});
