import { vi } from 'vitest';
import { GitManager } from '../../core/git-manager.js';

export interface MockGitManagerConfig {
  hasChanges?: boolean;
  commitSha?: string;
  commitMessage?: string;
  shouldFailCommit?: boolean;
}

export function createMockGitManager(config: MockGitManagerConfig = {}): GitManager {
  const {
    hasChanges = false,
    commitSha = 'abc123def456',
    commitMessage = '[pipeline:test] Test commit',
    shouldFailCommit = false,
  } = config;

  return {
    hasUncommittedChanges: vi.fn().mockResolvedValue(hasChanges),
    createPipelineCommit: vi.fn().mockImplementation(async () => {
      if (shouldFailCommit) {
        throw new Error('Git commit failed');
      }
      return hasChanges ? commitSha : '';
    }),
    getCommitMessage: vi.fn().mockResolvedValue(commitMessage),
    getCurrentCommit: vi.fn().mockResolvedValue(commitSha),
    getChangedFiles: vi.fn().mockResolvedValue(['file1.ts', 'file2.ts']),
    stageAllChanges: vi.fn().mockResolvedValue(undefined),
  } as unknown as GitManager;
}
