import { vi } from 'vitest';

export function createMockNotifier() {
  return {
    notify: vi.fn((options, callback) => {
      if (callback) {
        callback(null, 'activated');
      }
    }),
    on: vi.fn(),
  };
}

export function mockNodeNotifier() {
  const mockNotifier = createMockNotifier();

  vi.mock('node-notifier', () => ({
    default: mockNotifier,
    NotificationCenter: vi.fn(() => mockNotifier),
  }));

  return mockNotifier;
}
