import { vi } from 'vitest';

export interface MockGitResponse {
  current?: string;
  all?: string[];
  latest?: {
    hash: string;
    message: string;
    author_name: string;
    author_email: string;
  };
}

export function createMockGit(response: MockGitResponse = {}) {
  return {
    checkIsRepo: vi.fn().mockResolvedValue(true),
    status: vi.fn().mockResolvedValue({
      current: response.current || 'main',
      tracking: null,
      ahead: 0,
      behind: 0,
      files: [],
      staged: [],
      modified: [],
      not_added: [],
      deleted: [],
      renamed: [],
    }),
    branch: vi.fn().mockResolvedValue({
      current: response.current || 'main',
      all: response.all || ['main'],
      branches: {},
    }),
    log: vi.fn().mockResolvedValue({
      latest: response.latest || {
        hash: 'abc123def456',
        message: 'Test commit',
        author_name: 'Test Author',
        author_email: 'test@example.com',
      },
      all: [
        response.latest || {
          hash: 'abc123def456',
          message: 'Test commit',
          author_name: 'Test Author',
          author_email: 'test@example.com',
        },
      ],
    }),
    revparse: vi.fn().mockResolvedValue('abc123def456'),
    diff: vi.fn().mockResolvedValue(''),
    diffSummary: vi.fn().mockResolvedValue({
      changed: 2,
      insertions: 10,
      deletions: 5,
      files: [
        { file: 'file1.ts', changes: 8, insertions: 5, deletions: 3 },
        { file: 'file2.ts', changes: 7, insertions: 5, deletions: 2 },
      ],
    }),
    add: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue({
      commit: 'new-commit-sha',
      summary: { changes: 1, insertions: 1, deletions: 0 },
    }),
    checkout: vi.fn().mockResolvedValue(undefined),
    checkoutBranch: vi.fn().mockResolvedValue(undefined),
    push: vi.fn().mockResolvedValue(undefined),
    pull: vi.fn().mockResolvedValue(undefined),
    fetch: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue(undefined),
    revert: vi.fn().mockResolvedValue(undefined),
    stash: vi.fn().mockResolvedValue(undefined),
    raw: vi.fn().mockResolvedValue(''),
  };
}

// Mock the simple-git module
export function mockSimpleGit(response: MockGitResponse = {}) {
  const mockGit = createMockGit(response);

  vi.mock('simple-git', () => ({
    simpleGit: vi.fn(() => mockGit),
    default: vi.fn(() => mockGit),
  }));

  return mockGit;
}
