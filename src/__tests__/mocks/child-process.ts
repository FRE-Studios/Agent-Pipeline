import { vi } from 'vitest';

export interface ExecAsyncResponse {
  stdout: string;
  stderr?: string;
}

export interface MockExecConfig {
  version?: ExecAsyncResponse | Error;
  auth?: ExecAsyncResponse | Error;
  prCreate?: ExecAsyncResponse | Error;
  prView?: ExecAsyncResponse | Error;
  default?: ExecAsyncResponse | Error;
}

/**
 * Create a mock execAsync function for testing PRCreator
 */
export function createMockExecAsync(config: MockExecConfig = {}) {
  return vi.fn((command: string): Promise<ExecAsyncResponse> => {
    // gh --version
    if (command.includes('gh --version')) {
      if (config.version instanceof Error) {
        return Promise.reject(config.version);
      }
      return Promise.resolve(config.version || { stdout: 'gh version 2.40.0' });
    }

    // gh auth status
    if (command.includes('gh auth status')) {
      if (config.auth instanceof Error) {
        return Promise.reject(config.auth);
      }
      return Promise.resolve(config.auth || {
        stdout: '✓ Logged in to github.com as testuser'
      });
    }

    // gh pr create
    if (command.includes('gh pr create')) {
      if (config.prCreate instanceof Error) {
        return Promise.reject(config.prCreate);
      }
      return Promise.resolve(config.prCreate || {
        stdout: 'https://github.com/user/repo/pull/123\nCreated #123'
      });
    }

    // gh pr view
    if (command.includes('gh pr view')) {
      if (config.prView instanceof Error) {
        return Promise.reject(config.prView);
      }
      return Promise.resolve(config.prView || {
        stdout: 'PR #123 for branch'
      });
    }

    // Default response
    if (config.default instanceof Error) {
      return Promise.reject(config.default);
    }
    return Promise.resolve(config.default || { stdout: '' });
  });
}

/**
 * Setup vi.mock for child_process module
 */
export function mockChildProcess(config: MockExecConfig = {}) {
  const mockExecAsync = createMockExecAsync(config);

  vi.mock('child_process', () => ({
    exec: vi.fn(),
  }));

  vi.mock('util', () => ({
    promisify: vi.fn(() => mockExecAsync),
  }));

  return mockExecAsync;
}
