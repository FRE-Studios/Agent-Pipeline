// Global test setup for Vitest
import { vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';

// Mock console methods to reduce noise in test output
global.console = {
  ...console,
  log: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

// Clean up test artifacts after each test
afterEach(async () => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

// Helper function to create a temporary test directory
export async function createTempDir(prefix: string = 'test-'): Promise<string> {
  const tmpDir = path.join(process.cwd(), '.tmp', `${prefix}${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(tmpDir, { recursive: true });
  return tmpDir;
}

// Helper function to clean up temporary directory
export async function cleanupTempDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore errors during cleanup
  }
}

// Helper to wait for a specific amount of time
export function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Mock timer for testing retry logic
export function mockTimers() {
  vi.useFakeTimers();
  return {
    advance: (ms: number) => vi.advanceTimersByTime(ms),
    runAll: () => vi.runAllTimers(),
    restore: () => vi.useRealTimers(),
  };
}
