import { vi } from 'vitest';
import { NotificationManager } from '../../notifications/notification-manager.js';
import { NotificationContext, NotificationResult } from '../../notifications/types.js';

export interface MockNotificationManagerConfig {
  shouldFail?: boolean;
  notificationResults?: NotificationResult[];
}

export function createMockNotificationManager(config: MockNotificationManagerConfig = {}): NotificationManager {
  const {
    shouldFail = false,
    notificationResults = [{ success: true, channel: 'local' }],
  } = config;

  return {
    notify: vi.fn().mockImplementation(async (_context: NotificationContext) => {
      if (shouldFail) {
        throw new Error('Notification failed');
      }
      return notificationResults;
    }),
    test: vi.fn().mockResolvedValue(undefined),
  } as unknown as NotificationManager;
}
