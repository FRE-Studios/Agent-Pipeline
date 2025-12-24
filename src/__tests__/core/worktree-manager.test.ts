// src/__tests__/core/worktree-manager.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorktreeManager, WorktreeSetupResult } from '../../core/worktree-manager.js';
import { WorktreeInfo } from '../../core/git-manager.js';
import { simpleGit } from 'simple-git';
import * as fs from 'fs/promises';

// Mock dependencies
vi.mock('simple-git');
vi.mock('fs/promises');

describe('WorktreeManager', () => {
  let worktreeManager: WorktreeManager;
  let mockGit: any;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  const testRepoPath = '/test/repo';
  const defaultWorktreeBaseDir = '/test/repo/.agent-pipeline/worktrees';

  const createMockWorktreeInfo = (overrides: Partial<WorktreeInfo> = {}): WorktreeInfo => ({
    path: '/test/repo/.agent-pipeline/worktrees/test-pipeline',
    branch: 'pipeline/test-pipeline',
    head: 'abc123',
    bare: false,
    detached: false,
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock git instance
    mockGit = {
      fetch: vi.fn().mockResolvedValue(undefined),
      merge: vi.fn().mockResolvedValue(undefined),
      raw: vi.fn().mockResolvedValue(''),
      branchLocal: vi.fn().mockResolvedValue({ all: ['main'] }),
      deleteLocalBranch: vi.fn().mockResolvedValue(undefined),
      log: vi.fn().mockResolvedValue({ latest: { hash: 'abc123' } }),
    };

    (simpleGit as any).mockReturnValue(mockGit);

    // Mock fs operations
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT')); // Directory doesn't exist by default
    vi.mocked(fs.rm).mockResolvedValue(undefined);

    // Spy on console
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    worktreeManager = new WorktreeManager(testRepoPath);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default worktree base directory', () => {
      const manager = new WorktreeManager('/my/repo');
      expect(manager.getWorktreeBaseDir()).toBe('/my/repo/.agent-pipeline/worktrees');
      expect(manager.getRepoPath()).toBe('/my/repo');
    });

    it('should accept custom absolute worktree base directory', () => {
      const manager = new WorktreeManager('/my/repo', '/custom/worktrees');
      expect(manager.getWorktreeBaseDir()).toBe('/custom/worktrees');
    });

    it('should resolve relative worktree base directory to absolute path', () => {
      const manager = new WorktreeManager('/my/repo', 'custom/worktrees');
      expect(manager.getWorktreeBaseDir()).toBe('/my/repo/custom/worktrees');
    });

    it('should handle repo path with trailing components', () => {
      const manager = new WorktreeManager('/path/to/my-project');
      expect(manager.getWorktreeBaseDir()).toBe('/path/to/my-project/.agent-pipeline/worktrees');
    });
  });

  describe('getWorktreeBaseDir', () => {
    it('should return the worktree base directory', () => {
      expect(worktreeManager.getWorktreeBaseDir()).toBe(defaultWorktreeBaseDir);
    });
  });

  describe('getRepoPath', () => {
    it('should return the repository path', () => {
      expect(worktreeManager.getRepoPath()).toBe(testRepoPath);
    });
  });

  describe('setupPipelineWorktree', () => {
    const pipelineName = 'test-pipeline';
    const runId = 'run-12345678-abcd';

    beforeEach(() => {
      // Mock worktreeExists to return false by default
      mockGit.raw.mockImplementation(async (args: string[]) => {
        if (args[0] === 'worktree' && args[1] === 'list') {
          return ''; // No worktrees
        }
        return '';
      });
    });

    describe('reusable strategy', () => {
      it('should create new worktree with reusable branch name', async () => {
        const result = await worktreeManager.setupPipelineWorktree(
          pipelineName,
          runId,
          'main',
          'reusable',
          'pipeline'
        );

        expect(result.branchName).toBe('pipeline/test-pipeline');
        expect(result.worktreePath).toBe(`${defaultWorktreeBaseDir}/test-pipeline`);
        expect(result.isNew).toBe(true);
        expect(fs.mkdir).toHaveBeenCalledWith(defaultWorktreeBaseDir, { recursive: true });
      });

      it('should use existing worktree when it exists', async () => {
        const existingWorktreePath = `${defaultWorktreeBaseDir}/test-pipeline`;

        // Mock worktree exists
        mockGit.raw.mockImplementation(async (args: string[]) => {
          if (args[0] === 'worktree' && args[1] === 'list') {
            return `worktree ${existingWorktreePath}\nHEAD abc123\nbranch refs/heads/pipeline/test-pipeline\n`;
          }
          return '';
        });

        const result = await worktreeManager.setupPipelineWorktree(
          pipelineName,
          runId,
          'main',
          'reusable'
        );

        expect(result.isNew).toBe(false);
        expect(result.worktreePath).toBe(existingWorktreePath);
        expect(consoleSpy).toHaveBeenCalledWith(`Using existing worktree: ${existingWorktreePath}`);
      });
    });

    describe('unique-per-run strategy', () => {
      it('should create worktree with unique branch name including runId', async () => {
        const result = await worktreeManager.setupPipelineWorktree(
          pipelineName,
          runId,
          'main',
          'unique-per-run',
          'pipeline'
        );

        expect(result.branchName).toBe('pipeline/test-pipeline/run-1234');
        expect(result.worktreePath).toBe(`${defaultWorktreeBaseDir}/test-pipeline-run-1234`);
        expect(result.isNew).toBe(true);
      });
    });

    describe('unique-and-delete strategy', () => {
      it('should create worktree with unique branch name', async () => {
        const result = await worktreeManager.setupPipelineWorktree(
          pipelineName,
          runId,
          'main',
          'unique-and-delete',
          'pipeline'
        );

        expect(result.branchName).toBe('pipeline/test-pipeline/run-1234');
        expect(result.worktreePath).toBe(`${defaultWorktreeBaseDir}/test-pipeline-run-1234`);
        expect(result.isNew).toBe(true);
      });
    });

    describe('fetch behavior', () => {
      it('should fetch from origin before setting up worktree', async () => {
        await worktreeManager.setupPipelineWorktree(pipelineName, runId);

        expect(mockGit.fetch).toHaveBeenCalledWith('origin');
      });

      it('should continue if fetch fails', async () => {
        mockGit.fetch.mockRejectedValue(new Error('Network error'));

        const result = await worktreeManager.setupPipelineWorktree(pipelineName, runId);

        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Could not fetch from remote')
        );
        expect(result.isNew).toBe(true);
      });
    });

    describe('stale worktree cleanup', () => {
      it('should clean up stale worktree directory', async () => {
        const staleWorktreePath = `${defaultWorktreeBaseDir}/test-pipeline`;

        // Directory exists but not in worktree list
        vi.mocked(fs.access).mockResolvedValue(undefined);
        mockGit.raw.mockImplementation(async (args: string[]) => {
          if (args[0] === 'worktree' && args[1] === 'list') {
            return ''; // Not in worktree list
          }
          if (args[0] === 'worktree' && args[1] === 'prune') {
            return '';
          }
          if (args[0] === 'worktree' && args[1] === 'add') {
            return '';
          }
          return '';
        });

        await worktreeManager.setupPipelineWorktree(pipelineName, runId, 'main', 'reusable');

        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('Cleaning up stale worktree directory')
        );
        expect(fs.rm).toHaveBeenCalledWith(staleWorktreePath, { recursive: true, force: true });
      });
    });

    describe('worktree creation', () => {
      it('should create worktree with correct parameters', async () => {
        mockGit.raw.mockImplementation(async (args: string[]) => {
          if (args[0] === 'worktree' && args[1] === 'list') {
            return '';
          }
          if (args[0] === 'worktree' && args[1] === 'add') {
            return '';
          }
          return '';
        });

        await worktreeManager.setupPipelineWorktree(pipelineName, runId, 'develop', 'reusable');

        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('Creating worktree')
        );
      });

      it('should use custom branch prefix', async () => {
        const result = await worktreeManager.setupPipelineWorktree(
          pipelineName,
          runId,
          'main',
          'reusable',
          'custom-prefix'
        );

        expect(result.branchName).toBe('custom-prefix/test-pipeline');
      });

      it('should use default base branch of main', async () => {
        const result = await worktreeManager.setupPipelineWorktree(pipelineName, runId);

        expect(result.branchName).toBe('pipeline/test-pipeline');
        expect(result.isNew).toBe(true);
      });
    });

    describe('worktree update', () => {
      it('should update existing worktree from base branch', async () => {
        const existingWorktreePath = `${defaultWorktreeBaseDir}/test-pipeline`;

        // Mock existing worktree
        mockGit.raw.mockImplementation(async (args: string[]) => {
          if (args[0] === 'worktree' && args[1] === 'list') {
            return `worktree ${existingWorktreePath}\nHEAD abc123\nbranch refs/heads/pipeline/test-pipeline\n`;
          }
          return '';
        });

        await worktreeManager.setupPipelineWorktree(pipelineName, runId, 'main', 'reusable');

        // Should have created a new GitManager for the worktree and called merge
        expect(mockGit.fetch).toHaveBeenCalledWith('origin');
        expect(mockGit.merge).toHaveBeenCalledWith(['origin/main']);
        expect(consoleSpy).toHaveBeenCalledWith('Updated worktree from origin/main');
      });

      it('should handle update failure gracefully', async () => {
        const existingWorktreePath = `${defaultWorktreeBaseDir}/test-pipeline`;

        mockGit.raw.mockImplementation(async (args: string[]) => {
          if (args[0] === 'worktree' && args[1] === 'list') {
            return `worktree ${existingWorktreePath}\nHEAD abc123\nbranch refs/heads/pipeline/test-pipeline\n`;
          }
          return '';
        });

        mockGit.merge.mockRejectedValue(new Error('Merge conflict'));

        const result = await worktreeManager.setupPipelineWorktree(
          pipelineName,
          runId,
          'main',
          'reusable'
        );

        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Could not update worktree from main')
        );
        expect(result.isNew).toBe(false);
      });
    });
  });

  describe('cleanupWorktree', () => {
    const worktreePath = '/test/repo/.agent-pipeline/worktrees/test-pipeline';

    beforeEach(() => {
      mockGit.raw.mockImplementation(async (args: string[]) => {
        if (args[0] === 'worktree' && args[1] === 'list') {
          return `worktree ${worktreePath}\nHEAD abc123\nbranch refs/heads/pipeline/test-pipeline\n`;
        }
        if (args[0] === 'worktree' && args[1] === 'remove') {
          return '';
        }
        if (args[0] === 'worktree' && args[1] === 'prune') {
          return '';
        }
        return '';
      });
    });

    it('should remove worktree successfully', async () => {
      await worktreeManager.cleanupWorktree(worktreePath);

      expect(mockGit.raw).toHaveBeenCalledWith(['worktree', 'remove', worktreePath]);
      expect(consoleSpy).toHaveBeenCalledWith(`Removed worktree: ${worktreePath}`);
    });

    it('should prune worktrees after removal', async () => {
      await worktreeManager.cleanupWorktree(worktreePath);

      expect(mockGit.raw).toHaveBeenCalledWith(['worktree', 'prune']);
    });

    it('should force remove when force=true', async () => {
      await worktreeManager.cleanupWorktree(worktreePath, false, true);

      expect(mockGit.raw).toHaveBeenCalledWith(['worktree', 'remove', worktreePath, '--force']);
    });

    it('should retry with force when removal fails due to uncommitted changes', async () => {
      let callCount = 0;
      mockGit.raw.mockImplementation(async (args: string[]) => {
        if (args[0] === 'worktree' && args[1] === 'remove') {
          callCount++;
          if (callCount === 1 && !args.includes('--force')) {
            throw new Error('worktree has uncommitted changes');
          }
          return '';
        }
        if (args[0] === 'worktree' && args[1] === 'list') {
          return `worktree ${worktreePath}\nHEAD abc123\nbranch refs/heads/pipeline/test-pipeline\n`;
        }
        if (args[0] === 'worktree' && args[1] === 'prune') {
          return '';
        }
        return '';
      });

      await worktreeManager.cleanupWorktree(worktreePath);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Worktree has uncommitted changes, forcing removal...'
      );
      expect(mockGit.raw).toHaveBeenCalledWith(['worktree', 'remove', worktreePath, '--force']);
    });

    it('should throw when removal fails for other reasons', async () => {
      mockGit.raw.mockImplementation(async (args: string[]) => {
        if (args[0] === 'worktree' && args[1] === 'remove') {
          throw new Error('Permission denied');
        }
        if (args[0] === 'worktree' && args[1] === 'list') {
          return `worktree ${worktreePath}\nHEAD abc123\nbranch refs/heads/pipeline/test-pipeline\n`;
        }
        return '';
      });

      await expect(worktreeManager.cleanupWorktree(worktreePath)).rejects.toThrow(
        'Permission denied'
      );
    });

    describe('branch deletion', () => {
      it('should delete branch when deleteBranch=true', async () => {
        await worktreeManager.cleanupWorktree(worktreePath, true);

        expect(mockGit.deleteLocalBranch).toHaveBeenCalledWith('pipeline/test-pipeline', false);
        expect(consoleSpy).toHaveBeenCalledWith('Deleted branch: pipeline/test-pipeline');
      });

      it('should force delete branch when force=true', async () => {
        await worktreeManager.cleanupWorktree(worktreePath, true, true);

        expect(mockGit.deleteLocalBranch).toHaveBeenCalledWith('pipeline/test-pipeline', true);
      });

      it('should not delete branch when deleteBranch=false', async () => {
        await worktreeManager.cleanupWorktree(worktreePath, false);

        expect(mockGit.deleteLocalBranch).not.toHaveBeenCalled();
      });

      it('should handle branch deletion failure gracefully', async () => {
        mockGit.deleteLocalBranch.mockRejectedValue(new Error('Branch not found'));

        await worktreeManager.cleanupWorktree(worktreePath, true);

        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Could not delete branch pipeline/test-pipeline')
        );
      });

      it('should not attempt branch deletion when worktree has no branch', async () => {
        mockGit.raw.mockImplementation(async (args: string[]) => {
          if (args[0] === 'worktree' && args[1] === 'list') {
            // Worktree with detached HEAD (no branch)
            return `worktree ${worktreePath}\nHEAD abc123\ndetached\n`;
          }
          if (args[0] === 'worktree' && args[1] === 'remove') {
            return '';
          }
          if (args[0] === 'worktree' && args[1] === 'prune') {
            return '';
          }
          return '';
        });

        await worktreeManager.cleanupWorktree(worktreePath, true);

        expect(mockGit.deleteLocalBranch).not.toHaveBeenCalled();
      });
    });
  });

  describe('listPipelineWorktrees', () => {
    it('should return only pipeline worktrees', async () => {
      mockGit.raw.mockImplementation(async (args: string[]) => {
        if (args[0] === 'worktree' && args[1] === 'list') {
          return `worktree /test/repo\nHEAD abc123\nbranch refs/heads/main\n\nworktree /test/repo/.agent-pipeline/worktrees/my-pipeline\nHEAD def456\nbranch refs/heads/pipeline/my-pipeline\n\nworktree /test/repo/.agent-pipeline/worktrees/other-pipeline\nHEAD ghi789\nbranch refs/heads/pipeline/other-pipeline\n`;
        }
        return '';
      });

      const worktrees = await worktreeManager.listPipelineWorktrees();

      expect(worktrees).toHaveLength(2);
      expect(worktrees[0].branch).toBe('pipeline/my-pipeline');
      expect(worktrees[1].branch).toBe('pipeline/other-pipeline');
    });

    it('should filter by custom branch prefix', async () => {
      mockGit.raw.mockImplementation(async (args: string[]) => {
        if (args[0] === 'worktree' && args[1] === 'list') {
          return `worktree /wt1\nHEAD abc123\nbranch refs/heads/pipeline/test\n\nworktree /wt2\nHEAD def456\nbranch refs/heads/custom/test\n`;
        }
        return '';
      });

      const worktrees = await worktreeManager.listPipelineWorktrees('custom');

      expect(worktrees).toHaveLength(1);
      expect(worktrees[0].branch).toBe('custom/test');
    });

    it('should exclude bare repositories', async () => {
      mockGit.raw.mockImplementation(async (args: string[]) => {
        if (args[0] === 'worktree' && args[1] === 'list') {
          return `worktree /bare/repo\nHEAD abc123\nbare\n\nworktree /wt1\nHEAD def456\nbranch refs/heads/pipeline/test\n`;
        }
        return '';
      });

      const worktrees = await worktreeManager.listPipelineWorktrees();

      expect(worktrees).toHaveLength(1);
      expect(worktrees[0].bare).toBeFalsy();
    });

    it('should return empty array when no pipeline worktrees exist', async () => {
      mockGit.raw.mockImplementation(async (args: string[]) => {
        if (args[0] === 'worktree' && args[1] === 'list') {
          return `worktree /test/repo\nHEAD abc123\nbranch refs/heads/main\n`;
        }
        return '';
      });

      const worktrees = await worktreeManager.listPipelineWorktrees();

      expect(worktrees).toHaveLength(0);
    });
  });

  describe('branch naming strategies', () => {
    describe('getBranchName (via setupPipelineWorktree)', () => {
      it('should generate reusable branch name', async () => {
        const result = await worktreeManager.setupPipelineWorktree(
          'my-pipeline',
          'run-abcdefgh-1234',
          'main',
          'reusable',
          'pipeline'
        );

        expect(result.branchName).toBe('pipeline/my-pipeline');
      });

      it('should generate unique-per-run branch name with truncated runId', async () => {
        const result = await worktreeManager.setupPipelineWorktree(
          'my-pipeline',
          'run-abcdefgh-1234',
          'main',
          'unique-per-run',
          'pipeline'
        );

        expect(result.branchName).toBe('pipeline/my-pipeline/run-abcd');
      });

      it('should generate unique-and-delete branch name with truncated runId', async () => {
        const result = await worktreeManager.setupPipelineWorktree(
          'my-pipeline',
          'run-abcdefgh-1234',
          'main',
          'unique-and-delete',
          'pipeline'
        );

        expect(result.branchName).toBe('pipeline/my-pipeline/run-abcd');
      });
    });

    describe('getWorktreeDirName (via setupPipelineWorktree)', () => {
      it('should generate reusable worktree directory name', async () => {
        const result = await worktreeManager.setupPipelineWorktree(
          'my-pipeline',
          'run-abcdefgh-1234',
          'main',
          'reusable'
        );

        expect(result.worktreePath).toBe(`${defaultWorktreeBaseDir}/my-pipeline`);
      });

      it('should generate unique worktree directory name for unique-per-run', async () => {
        const result = await worktreeManager.setupPipelineWorktree(
          'my-pipeline',
          'run-abcdefgh-1234',
          'main',
          'unique-per-run'
        );

        expect(result.worktreePath).toBe(`${defaultWorktreeBaseDir}/my-pipeline-run-abcd`);
      });

      it('should generate unique worktree directory name for unique-and-delete', async () => {
        const result = await worktreeManager.setupPipelineWorktree(
          'my-pipeline',
          'run-abcdefgh-1234',
          'main',
          'unique-and-delete'
        );

        expect(result.worktreePath).toBe(`${defaultWorktreeBaseDir}/my-pipeline-run-abcd`);
      });
    });
  });

  describe('edge cases', () => {
    it('should handle pipeline names with special characters', async () => {
      const result = await worktreeManager.setupPipelineWorktree(
        'my-complex_pipeline.v2',
        'run-12345678',
        'main',
        'reusable'
      );

      expect(result.branchName).toBe('pipeline/my-complex_pipeline.v2');
      expect(result.worktreePath).toBe(`${defaultWorktreeBaseDir}/my-complex_pipeline.v2`);
    });

    it('should handle short runId gracefully', async () => {
      const result = await worktreeManager.setupPipelineWorktree(
        'test',
        'abc',
        'main',
        'unique-per-run'
      );

      expect(result.branchName).toBe('pipeline/test/abc');
      expect(result.worktreePath).toBe(`${defaultWorktreeBaseDir}/test-abc`);
    });

    it('should handle empty branchPrefix', async () => {
      const result = await worktreeManager.setupPipelineWorktree(
        'test',
        'run-12345678',
        'main',
        'reusable',
        ''
      );

      expect(result.branchName).toBe('/test');
    });

    it('should handle different base branches', async () => {
      mockGit.raw.mockImplementation(async (args: string[]) => {
        if (args[0] === 'worktree' && args[1] === 'list') {
          return '';
        }
        if (args[0] === 'worktree' && args[1] === 'add') {
          // Verify the base branch is passed correctly
          if (args.includes('origin/develop')) {
            return '';
          }
          throw new Error('Wrong base branch');
        }
        return '';
      });

      const result = await worktreeManager.setupPipelineWorktree(
        'test',
        'run-12345678',
        'develop',
        'reusable'
      );

      expect(result.isNew).toBe(true);
    });

    it('should handle cleanup when worktree not found in list', async () => {
      const unknownPath = '/unknown/worktree/path';

      mockGit.raw.mockImplementation(async (args: string[]) => {
        if (args[0] === 'worktree' && args[1] === 'list') {
          return ''; // Worktree not in list
        }
        if (args[0] === 'worktree' && args[1] === 'remove') {
          return '';
        }
        if (args[0] === 'worktree' && args[1] === 'prune') {
          return '';
        }
        return '';
      });

      await worktreeManager.cleanupWorktree(unknownPath, true);

      // Should not try to delete branch since it wasn't found
      expect(mockGit.deleteLocalBranch).not.toHaveBeenCalled();
    });
  });

  describe('integration scenarios', () => {
    it('should handle full lifecycle: create, use, cleanup', async () => {
      const pipelineName = 'integration-test';
      const runId = 'run-integration123';

      // 1. Create worktree
      mockGit.raw.mockImplementation(async (args: string[]) => {
        if (args[0] === 'worktree' && args[1] === 'list') {
          return '';
        }
        return '';
      });

      const setupResult = await worktreeManager.setupPipelineWorktree(
        pipelineName,
        runId,
        'main',
        'unique-and-delete'
      );

      expect(setupResult.isNew).toBe(true);
      expect(setupResult.branchName).toBe('pipeline/integration-test/run-inte');

      // 2. Cleanup with branch deletion
      mockGit.raw.mockImplementation(async (args: string[]) => {
        if (args[0] === 'worktree' && args[1] === 'list') {
          return `worktree ${setupResult.worktreePath}\nHEAD abc123\nbranch refs/heads/${setupResult.branchName}\n`;
        }
        if (args[0] === 'worktree' && args[1] === 'remove') {
          return '';
        }
        if (args[0] === 'worktree' && args[1] === 'prune') {
          return '';
        }
        return '';
      });

      await worktreeManager.cleanupWorktree(setupResult.worktreePath, true, false);

      expect(mockGit.deleteLocalBranch).toHaveBeenCalledWith(setupResult.branchName, false);
    });

    it('should handle reusable workflow: create once, reuse multiple times', async () => {
      const pipelineName = 'reusable-test';
      const worktreePath = `${defaultWorktreeBaseDir}/${pipelineName}`;

      // First run: create new worktree
      mockGit.raw.mockImplementation(async (args: string[]) => {
        if (args[0] === 'worktree' && args[1] === 'list') {
          return '';
        }
        return '';
      });

      const firstResult = await worktreeManager.setupPipelineWorktree(
        pipelineName,
        'run-first',
        'main',
        'reusable'
      );

      expect(firstResult.isNew).toBe(true);

      // Second run: reuse existing worktree
      mockGit.raw.mockImplementation(async (args: string[]) => {
        if (args[0] === 'worktree' && args[1] === 'list') {
          return `worktree ${worktreePath}\nHEAD abc123\nbranch refs/heads/pipeline/${pipelineName}\n`;
        }
        return '';
      });

      const secondResult = await worktreeManager.setupPipelineWorktree(
        pipelineName,
        'run-second',
        'main',
        'reusable'
      );

      expect(secondResult.isNew).toBe(false);
      expect(secondResult.worktreePath).toBe(firstResult.worktreePath);
    });
  });
});
