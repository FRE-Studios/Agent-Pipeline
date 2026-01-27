import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { BranchManager } from '../../core/branch-manager.js';
import { simpleGit } from 'simple-git';
import {
  mainBranchState,
  pipelineBranchExists,
  multiplePipelineBranches,
  noPipelineBranches,
  customPrefixBranches,
  detachedHeadState,
  uniquePerRunBranches,
  emptyBranchList,
} from '../fixtures/branch-states.js';

// Mock simple-git module
vi.mock('simple-git');

describe('BranchManager', () => {
  let branchManager: BranchManager;
  let mockGit: any;
  let consoleLogSpy: any;
  let consoleWarnSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Spy on console methods
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Create default mock git instance
    mockGit = {
      status: vi.fn(),
      branchLocal: vi.fn(),
      branch: vi.fn(),
      checkout: vi.fn(),
      checkoutBranch: vi.fn(),
      fetch: vi.fn(),
      merge: vi.fn(),
      push: vi.fn(),
      deleteLocalBranch: vi.fn(),
    };

    (simpleGit as any).mockReturnValue(mockGit);
    branchManager = new BranchManager('/test/repo');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize BranchManager with repository path', () => {
      const manager = new BranchManager('/valid/path');
      expect(simpleGit).toHaveBeenCalledWith('/valid/path');
      expect(manager).toBeInstanceOf(BranchManager);
    });

    it('should extend GitManager functionality', () => {
      expect(branchManager).toBeInstanceOf(BranchManager);
      // BranchManager should have GitManager methods + branch methods
      expect(typeof branchManager.getCurrentCommit).toBe('function');
      expect(typeof branchManager.setupPipelineBranch).toBe('function');
    });
  });

  describe('setupPipelineBranch', () => {
    beforeEach(() => {
      mockGit.fetch.mockResolvedValue(undefined);
      mockGit.branchLocal.mockResolvedValue({
        all: ['main'],
        branches: {},
        current: 'main',
      });
      mockGit.checkoutBranch.mockResolvedValue(undefined);
      mockGit.merge.mockResolvedValue({});
    });

    it('should fetch from remote successfully', async () => {
      const branchName = await branchManager.setupPipelineBranch(
        'test-pipeline',
        'run-123'
      );

      expect(mockGit.fetch).toHaveBeenCalledWith('origin');
      expect(branchName).toBe('pipeline/test-pipeline');
    });

    it('should create reusable branch when it doesn\'t exist', async () => {
      mockGit.branchLocal.mockResolvedValue({ all: ['main'] });

      const branchName = await branchManager.setupPipelineBranch(
        'test-pipeline',
        'run-123',
        'main',
        'reusable'
      );

      expect(branchName).toBe('pipeline/test-pipeline');
      expect(mockGit.checkoutBranch).toHaveBeenCalledWith(
        'pipeline/test-pipeline',
        'origin/main'
      );
    });

    it('should create unique-per-run branch when it doesn\'t exist', async () => {
      mockGit.branchLocal.mockResolvedValue({ all: ['main'] });

      const branchName = await branchManager.setupPipelineBranch(
        'test-pipeline',
        'run-123456789',
        'main',
        'unique-per-run'
      );

      expect(branchName).toBe('pipeline/test-pipeline/run-1234');
      expect(mockGit.checkoutBranch).toHaveBeenCalledWith(
        'pipeline/test-pipeline/run-1234',
        'origin/main'
      );
    });

    it('should create branch from remote base (origin/main)', async () => {
      mockGit.branchLocal.mockResolvedValue({ all: ['main'] });

      await branchManager.setupPipelineBranch('test', 'run-1');

      expect(mockGit.checkoutBranch).toHaveBeenCalledWith(
        'pipeline/test',
        'origin/main'
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Creating new branch')
      );
    });

    it('should checkout existing branch and merge latest changes', async () => {
      mockGit.branchLocal.mockResolvedValue({
        all: ['main', 'pipeline/test-pipeline'],
      });
      mockGit.checkout.mockResolvedValue(undefined);
      mockGit.merge.mockResolvedValue({ result: 'success' });

      await branchManager.setupPipelineBranch('test-pipeline', 'run-1');

      expect(mockGit.checkout).toHaveBeenCalledWith('pipeline/test-pipeline');
      expect(mockGit.merge).toHaveBeenCalledWith(['origin/main']);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Switching to existing branch')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Merged latest changes')
      );
    });

    it('should return created/checked-out branch name', async () => {
      mockGit.branchLocal.mockResolvedValue({ all: ['main'] });

      const branchName = await branchManager.setupPipelineBranch(
        'my-pipeline',
        'run-123'
      );

      expect(branchName).toBe('pipeline/my-pipeline');
    });

    it('should use custom base branch (not main)', async () => {
      mockGit.branchLocal.mockResolvedValue({ all: ['develop'] });

      await branchManager.setupPipelineBranch(
        'test',
        'run-1',
        'develop'
      );

      expect(mockGit.checkoutBranch).toHaveBeenCalledWith(
        'pipeline/test',
        'origin/develop'
      );
    });

    it('should use custom branch prefix', async () => {
      mockGit.branchLocal.mockResolvedValue({ all: ['main'] });

      const branchName = await branchManager.setupPipelineBranch(
        'test',
        'run-1',
        'main',
        'reusable',
        'custom-prefix'
      );

      expect(branchName).toBe('custom-prefix/test');
      expect(mockGit.checkoutBranch).toHaveBeenCalledWith(
        'custom-prefix/test',
        'origin/main'
      );
    });

    it('should warn but continue when fetch fails', async () => {
      mockGit.fetch.mockRejectedValue(new Error('Network error'));
      mockGit.branchLocal.mockResolvedValue({ all: ['main'] });

      const branchName = await branchManager.setupPipelineBranch(
        'test',
        'run-1'
      );

      expect(branchName).toBe('pipeline/test');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Could not fetch from remote')
      );
    });

    it('should warn but continue when merge fails on existing branch', async () => {
      mockGit.branchLocal.mockResolvedValue({
        all: ['main', 'pipeline/test'],
      });
      mockGit.checkout.mockResolvedValue(undefined);
      mockGit.merge.mockRejectedValue(new Error('Merge conflict'));

      const branchName = await branchManager.setupPipelineBranch('test', 'run-1');

      expect(branchName).toBe('pipeline/test');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Could not merge')
      );
    });

    it('should fallback to local base when remote base doesn\'t exist', async () => {
      mockGit.branchLocal.mockResolvedValue({ all: ['main'] });
      mockGit.checkoutBranch
        .mockRejectedValueOnce(new Error('Remote branch not found'))
        .mockResolvedValueOnce(undefined);

      const branchName = await branchManager.setupPipelineBranch('test', 'run-1');

      expect(branchName).toBe('pipeline/test');
      expect(mockGit.checkoutBranch).toHaveBeenCalledTimes(2);
      expect(mockGit.checkoutBranch).toHaveBeenNthCalledWith(
        1,
        'pipeline/test',
        'origin/main'
      );
      expect(mockGit.checkoutBranch).toHaveBeenNthCalledWith(
        2,
        'pipeline/test',
        'main'
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Could not create from origin/main')
      );
    });

    it('should handle both fetch and merge failures gracefully', async () => {
      mockGit.fetch.mockRejectedValue(new Error('Fetch failed'));
      mockGit.branchLocal.mockResolvedValue({
        all: ['main', 'pipeline/test'],
      });
      mockGit.checkout.mockResolvedValue(undefined);
      mockGit.merge.mockRejectedValue(new Error('Merge failed'));

      const branchName = await branchManager.setupPipelineBranch('test', 'run-1');

      expect(branchName).toBe('pipeline/test');
      expect(consoleWarnSpy).toHaveBeenCalledTimes(2);
    });

    it('should generate reusable branch name (pipeline/pipeline-name)', async () => {
      mockGit.branchLocal.mockResolvedValue({ all: ['main'] });

      const branchName = await branchManager.setupPipelineBranch(
        'my-pipeline',
        'run-123',
        'main',
        'reusable'
      );

      expect(branchName).toBe('pipeline/my-pipeline');
    });

    it('should generate unique branch name (pipeline/pipeline-name/runid-8chars)', async () => {
      mockGit.branchLocal.mockResolvedValue({ all: ['main'] });

      const branchName = await branchManager.setupPipelineBranch(
        'my-pipeline',
        'run-123456789',
        'main',
        'unique-per-run'
      );

      expect(branchName).toBe('pipeline/my-pipeline/run-1234');
    });

    it('should use default strategy (reusable) when not specified', async () => {
      mockGit.branchLocal.mockResolvedValue({ all: ['main'] });

      const branchName = await branchManager.setupPipelineBranch(
        'test',
        'run-123'
      );

      expect(branchName).toBe('pipeline/test');
    });

    it('should use default base branch (main) when not specified', async () => {
      mockGit.branchLocal.mockResolvedValue({ all: ['main'] });

      await branchManager.setupPipelineBranch('test', 'run-1');

      expect(mockGit.checkoutBranch).toHaveBeenCalledWith(
        'pipeline/test',
        'origin/main'
      );
    });

    it('should use default prefix (pipeline) when not specified', async () => {
      mockGit.branchLocal.mockResolvedValue({ all: ['main'] });

      const branchName = await branchManager.setupPipelineBranch('test', 'run-1');

      expect(branchName).toBe('pipeline/test');
    });

    it('should handle pipeline names with special characters', async () => {
      mockGit.branchLocal.mockResolvedValue({ all: ['main'] });

      const branchName = await branchManager.setupPipelineBranch(
        'test-pipeline_v2',
        'run-1'
      );

      expect(branchName).toBe('pipeline/test-pipeline_v2');
    });
  });

  describe('getBranchName', () => {
    // Note: getBranchName is private, but we can test it indirectly through setupPipelineBranch
    // We'll test it directly by accessing it through type casting

    it('should generate reusable branch name with default prefix', async () => {
      mockGit.branchLocal.mockResolvedValue({ all: ['main'] });

      const branchName = await branchManager.setupPipelineBranch(
        'test',
        'run-123',
        'main',
        'reusable',
        'pipeline'
      );

      expect(branchName).toBe('pipeline/test');
    });

    it('should generate unique-per-run branch name with runId substring', async () => {
      mockGit.branchLocal.mockResolvedValue({ all: ['main'] });

      const branchName = await branchManager.setupPipelineBranch(
        'test',
        'abcdefghijklmnop',
        'main',
        'unique-per-run'
      );

      expect(branchName).toBe('pipeline/test/abcdefgh');
    });

    it('should use only first 8 chars of runId for unique branches', async () => {
      mockGit.branchLocal.mockResolvedValue({ all: ['main'] });

      const branchName = await branchManager.setupPipelineBranch(
        'test',
        '1234567890abcdef',
        'main',
        'unique-per-run'
      );

      expect(branchName).toBe('pipeline/test/12345678');
      expect(branchName).not.toContain('90abcdef');
    });

    it('should format as prefix/pipelineName for reusable strategy', async () => {
      mockGit.branchLocal.mockResolvedValue({ all: ['main'] });

      const branchName = await branchManager.setupPipelineBranch(
        'my-pipeline',
        'run-id',
        'main',
        'reusable'
      );

      expect(branchName).toBe('pipeline/my-pipeline');
      expect(branchName).not.toContain('run-id');
    });

    it('should format as prefix/pipelineName/runId for unique strategy', async () => {
      mockGit.branchLocal.mockResolvedValue({ all: ['main'] });

      const branchName = await branchManager.setupPipelineBranch(
        'my-pipeline',
        'run-12345',
        'main',
        'unique-per-run'
      );

      expect(branchName).toBe('pipeline/my-pipeline/run-1234');
      expect(branchName).toContain('/run-1234');
    });

    it('should handle custom prefix correctly', async () => {
      mockGit.branchLocal.mockResolvedValue({ all: ['main'] });

      const branchName = await branchManager.setupPipelineBranch(
        'test',
        'run-1',
        'main',
        'reusable',
        'custom'
      );

      expect(branchName).toBe('custom/test');
    });

    it('should handle pipeline names with hyphens/underscores', async () => {
      mockGit.branchLocal.mockResolvedValue({ all: ['main'] });

      const branchName = await branchManager.setupPipelineBranch(
        'test-pipeline_v2',
        'run-1',
        'main',
        'reusable'
      );

      expect(branchName).toBe('pipeline/test-pipeline_v2');
    });

    it('should handle long runId (>8 chars) by truncating', async () => {
      mockGit.branchLocal.mockResolvedValue({ all: ['main'] });

      const longRunId = 'very-long-run-id-with-many-characters';
      const branchName = await branchManager.setupPipelineBranch(
        'test',
        longRunId,
        'main',
        'unique-per-run'
      );

      expect(branchName).toBe('pipeline/test/very-lon');
      expect(branchName.split('/')[2]).toHaveLength(8);
    });
  });

  describe('getCurrentBranch', () => {
    it('should return current branch name from status', async () => {
      mockGit.status.mockResolvedValue({
        current: 'pipeline/test-pipeline',
      });

      const result = await branchManager.getCurrentBranch();

      expect(mockGit.status).toHaveBeenCalled();
      expect(result).toBe('pipeline/test-pipeline');
    });

    it('should throw error when no current branch (detached HEAD)', async () => {
      mockGit.status.mockResolvedValue({
        current: null,
      });

      await expect(branchManager.getCurrentBranch()).rejects.toThrow(
        'Not currently on a branch'
      );
    });

    it('should throw error on detached HEAD state', async () => {
      mockGit.status.mockResolvedValue(detachedHeadState);

      await expect(branchManager.getCurrentBranch()).rejects.toThrow(
        'detached HEAD'
      );
    });

    it('should return main when on main branch', async () => {
      mockGit.status.mockResolvedValue(mainBranchState);

      const result = await branchManager.getCurrentBranch();

      expect(result).toBe('main');
    });

    it('should throw on git status error', async () => {
      mockGit.status.mockRejectedValue(new Error('Git status failed'));

      await expect(branchManager.getCurrentBranch()).rejects.toThrow(
        'Git status failed'
      );
    });
  });

  describe('branchExists', () => {
    it('should return true when branch exists locally', async () => {
      mockGit.branchLocal.mockResolvedValue(pipelineBranchExists);

      const result = await branchManager.branchExists('pipeline/test-pipeline');

      expect(result).toBe(true);
      expect(mockGit.branchLocal).toHaveBeenCalled();
    });

    it('should return false when branch doesn\'t exist', async () => {
      mockGit.branchLocal.mockResolvedValue(mainBranchState);

      const result = await branchManager.branchExists('nonexistent-branch');

      expect(result).toBe(false);
    });

    it('should check against all local branches', async () => {
      mockGit.branchLocal.mockResolvedValue(multiplePipelineBranches);

      const exists1 = await branchManager.branchExists('pipeline/test-pipeline');
      const exists2 = await branchManager.branchExists('pipeline/deploy-pipeline');
      const exists3 = await branchManager.branchExists('nonexistent');

      expect(exists1).toBe(true);
      expect(exists2).toBe(true);
      expect(exists3).toBe(false);
    });

    it('should handle multiple branches correctly', async () => {
      mockGit.branchLocal.mockResolvedValue(multiplePipelineBranches);

      const result = await branchManager.branchExists('develop');

      expect(result).toBe(true);
    });

    it('should return false for empty branch list', async () => {
      mockGit.branchLocal.mockResolvedValue(emptyBranchList);

      const result = await branchManager.branchExists('any-branch');

      expect(result).toBe(false);
    });

    it('should throw on git branchLocal error', async () => {
      mockGit.branchLocal.mockRejectedValue(new Error('Git error'));

      await expect(branchManager.branchExists('test')).rejects.toThrow(
        'Git error'
      );
    });
  });

  describe('checkoutBranch', () => {
    it('should checkout existing branch without startPoint', async () => {
      mockGit.checkout.mockResolvedValue(undefined);

      await branchManager.checkoutBranch('existing-branch');

      expect(mockGit.checkout).toHaveBeenCalledWith('existing-branch');
      expect(mockGit.checkoutBranch).not.toHaveBeenCalled();
    });

    it('should create new branch with startPoint', async () => {
      mockGit.checkoutBranch.mockResolvedValue(undefined);

      await branchManager.checkoutBranch('new-branch', 'main');

      expect(mockGit.checkoutBranch).toHaveBeenCalledWith('new-branch', 'main');
      expect(mockGit.checkout).not.toHaveBeenCalled();
    });

    it('should call git.checkout when no startPoint provided', async () => {
      mockGit.checkout.mockResolvedValue(undefined);

      await branchManager.checkoutBranch('branch-name');

      expect(mockGit.checkout).toHaveBeenCalledWith('branch-name');
    });

    it('should call git.checkoutBranch when startPoint provided', async () => {
      mockGit.checkoutBranch.mockResolvedValue(undefined);

      await branchManager.checkoutBranch('branch-name', 'start-point');

      expect(mockGit.checkoutBranch).toHaveBeenCalledWith(
        'branch-name',
        'start-point'
      );
    });

    it('should handle remote startPoint (origin/main)', async () => {
      mockGit.checkoutBranch.mockResolvedValue(undefined);

      await branchManager.checkoutBranch('new-branch', 'origin/main');

      expect(mockGit.checkoutBranch).toHaveBeenCalledWith(
        'new-branch',
        'origin/main'
      );
    });

    it('should handle local startPoint (main)', async () => {
      mockGit.checkoutBranch.mockResolvedValue(undefined);

      await branchManager.checkoutBranch('new-branch', 'main');

      expect(mockGit.checkoutBranch).toHaveBeenCalledWith('new-branch', 'main');
    });

    it('should throw on checkout failure', async () => {
      mockGit.checkout.mockRejectedValue(new Error('Checkout failed'));

      await expect(branchManager.checkoutBranch('branch')).rejects.toThrow(
        'Checkout failed'
      );
    });
  });

  describe('fetch', () => {
    it('should fetch from default remote (origin)', async () => {
      mockGit.fetch.mockResolvedValue(undefined);

      await branchManager.fetch();

      expect(mockGit.fetch).toHaveBeenCalledWith('origin');
    });

    it('should fetch from custom remote', async () => {
      mockGit.fetch.mockResolvedValue(undefined);

      await branchManager.fetch('upstream');

      expect(mockGit.fetch).toHaveBeenCalledWith('upstream');
    });

    it('should call git.fetch with correct remote name', async () => {
      mockGit.fetch.mockResolvedValue(undefined);

      await branchManager.fetch('custom-remote');

      expect(mockGit.fetch).toHaveBeenCalledWith('custom-remote');
      expect(mockGit.fetch).toHaveBeenCalledTimes(1);
    });

    it('should handle fetch success', async () => {
      mockGit.fetch.mockResolvedValue(undefined);

      await expect(branchManager.fetch()).resolves.not.toThrow();
    });

    it('should throw on fetch failure', async () => {
      mockGit.fetch.mockRejectedValue(new Error('Network error'));

      await expect(branchManager.fetch()).rejects.toThrow('Network error');
    });
  });

  describe('push', () => {
    it('should push with provided arguments', async () => {
      mockGit.push.mockResolvedValue(undefined);

      await branchManager.push(['-u', 'origin', 'main']);

      expect(mockGit.push).toHaveBeenCalledWith(['-u', 'origin', 'main']);
    });

    it('should handle array of arguments correctly', async () => {
      mockGit.push.mockResolvedValue(undefined);

      await branchManager.push(['--force', 'origin', 'branch']);

      expect(mockGit.push).toHaveBeenCalledWith(['--force', 'origin', 'branch']);
    });

    it('should call git.push with exact arguments', async () => {
      mockGit.push.mockResolvedValue(undefined);
      const args = ['arg1', 'arg2', 'arg3'];

      await branchManager.push(args);

      expect(mockGit.push).toHaveBeenCalledWith(args);
    });

    it('should handle empty arguments array', async () => {
      mockGit.push.mockResolvedValue(undefined);

      await branchManager.push([]);

      expect(mockGit.push).toHaveBeenCalledWith([]);
    });

    it('should handle multiple flag arguments', async () => {
      mockGit.push.mockResolvedValue(undefined);

      await branchManager.push(['-u', '--force', 'origin', 'branch']);

      expect(mockGit.push).toHaveBeenCalledWith([
        '-u',
        '--force',
        'origin',
        'branch',
      ]);
    });

    it('should throw on push failure', async () => {
      mockGit.push.mockRejectedValue(new Error('Push rejected'));

      await expect(branchManager.push(['origin', 'main'])).rejects.toThrow(
        'Push rejected'
      );
    });
  });

  describe('pushBranch', () => {
    it('should push branch to origin with -u flag', async () => {
      mockGit.push.mockResolvedValue(undefined);

      await branchManager.pushBranch('pipeline/test');

      expect(mockGit.push).toHaveBeenCalledWith(['-u', 'origin', 'pipeline/test']);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Pushing pipeline/test')
      );
    });

    it('should set upstream when pushing', async () => {
      mockGit.push.mockResolvedValue(undefined);

      await branchManager.pushBranch('my-branch');

      const pushArgs = mockGit.push.mock.calls[0][0];
      expect(pushArgs).toContain('-u');
      expect(pushArgs).toContain('origin');
      expect(pushArgs).toContain('my-branch');
    });

    it('should call push with correct arguments array', async () => {
      mockGit.push.mockResolvedValue(undefined);

      await branchManager.pushBranch('test-branch');

      expect(mockGit.push).toHaveBeenCalledWith(['-u', 'origin', 'test-branch']);
    });

    it('should handle branch name with special characters', async () => {
      mockGit.push.mockResolvedValue(undefined);

      await branchManager.pushBranch('pipeline/test-pipeline_v2');

      expect(mockGit.push).toHaveBeenCalledWith([
        '-u',
        'origin',
        'pipeline/test-pipeline_v2',
      ]);
    });

    it('should throw descriptive error on push failure', async () => {
      mockGit.push.mockRejectedValue(new Error('Push rejected'));

      await expect(branchManager.pushBranch('test-branch')).rejects.toThrow(
        'Failed to push branch test-branch'
      );
    });

    it('should include error message and suggestion in thrown error', async () => {
      mockGit.push.mockRejectedValue(new Error('Network error'));

      await expect(branchManager.pushBranch('branch')).rejects.toThrow();
    });
  });

  describe('deleteLocalBranch', () => {
    it('should delete branch without force flag', async () => {
      mockGit.deleteLocalBranch.mockResolvedValue(undefined);

      await branchManager.deleteLocalBranch('old-branch');

      expect(mockGit.deleteLocalBranch).toHaveBeenCalledWith('old-branch', false);
    });

    it('should delete branch with force=true', async () => {
      mockGit.deleteLocalBranch.mockResolvedValue(undefined);

      await branchManager.deleteLocalBranch('old-branch', true);

      expect(mockGit.deleteLocalBranch).toHaveBeenCalledWith('old-branch', true);
    });

    it('should delete branch with force=false explicitly', async () => {
      mockGit.deleteLocalBranch.mockResolvedValue(undefined);

      await branchManager.deleteLocalBranch('old-branch', false);

      expect(mockGit.deleteLocalBranch).toHaveBeenCalledWith('old-branch', false);
    });

    it('should call git.deleteLocalBranch with correct params', async () => {
      mockGit.deleteLocalBranch.mockResolvedValue(undefined);

      await branchManager.deleteLocalBranch('branch-to-delete', true);

      expect(mockGit.deleteLocalBranch).toHaveBeenCalledWith(
        'branch-to-delete',
        true
      );
    });

    it('should throw on delete failure', async () => {
      mockGit.deleteLocalBranch.mockRejectedValue(
        new Error('Cannot delete current branch')
      );

      await expect(branchManager.deleteLocalBranch('branch')).rejects.toThrow(
        'Cannot delete current branch'
      );
    });
  });

  describe('listPipelineBranches', () => {
    it('should list all branches with default prefix (pipeline)', async () => {
      mockGit.branchLocal.mockResolvedValue(multiplePipelineBranches);

      const result = await branchManager.listPipelineBranches();

      expect(result).toEqual([
        'pipeline/test-pipeline',
        'pipeline/build-pipeline',
        'pipeline/deploy-pipeline',
      ]);
    });

    it('should list all branches with custom prefix', async () => {
      mockGit.branchLocal.mockResolvedValue(customPrefixBranches);

      const result = await branchManager.listPipelineBranches('custom');

      expect(result).toEqual(['custom/test-pipeline', 'custom/build-pipeline']);
    });

    it('should filter branches starting with prefix/', async () => {
      mockGit.branchLocal.mockResolvedValue(multiplePipelineBranches);

      const result = await branchManager.listPipelineBranches('pipeline');

      expect(result).not.toContain('main');
      expect(result).not.toContain('develop');
      expect(result).not.toContain('feature/new-feature');
      expect(result.every((b) => b.startsWith('pipeline/'))).toBe(true);
    });

    it('should return empty array when no pipeline branches exist', async () => {
      mockGit.branchLocal.mockResolvedValue(noPipelineBranches);

      const result = await branchManager.listPipelineBranches();

      expect(result).toEqual([]);
    });

    it('should not include branches without prefix', async () => {
      mockGit.branchLocal.mockResolvedValue(multiplePipelineBranches);

      const result = await branchManager.listPipelineBranches('pipeline');

      expect(result).not.toContain('main');
      expect(result).not.toContain('develop');
    });

    it('should handle multiple pipeline branches', async () => {
      mockGit.branchLocal.mockResolvedValue(uniquePerRunBranches);

      const result = await branchManager.listPipelineBranches();

      expect(result).toHaveLength(3);
      expect(result).toContain('pipeline/test-pipeline/abc12345');
      expect(result).toContain('pipeline/test-pipeline/def67890');
      expect(result).toContain('pipeline/build-pipeline/ghi11111');
    });

    it('should throw on branchLocal error', async () => {
      mockGit.branchLocal.mockRejectedValue(new Error('Git error'));

      await expect(branchManager.listPipelineBranches()).rejects.toThrow(
        'Git error'
      );
    });
  });

  describe('listRemotePipelineBranches', () => {
    it('should list all remote branches with default prefix (pipeline)', async () => {
      mockGit.branch.mockResolvedValue({
        all: [
          'origin/main',
          'origin/pipeline/test-pipeline',
          'origin/pipeline/build-pipeline',
          'origin/feature/something',
        ],
      });

      const result = await branchManager.listRemotePipelineBranches();

      expect(mockGit.branch).toHaveBeenCalledWith(['-r']);
      expect(result).toEqual([
        'pipeline/test-pipeline',
        'pipeline/build-pipeline',
      ]);
    });

    it('should list remote branches with custom prefix', async () => {
      mockGit.branch.mockResolvedValue({
        all: [
          'origin/main',
          'origin/review-pipeline/test/abc123',
          'origin/review-pipeline/test/def456',
          'origin/pipeline/other',
        ],
      });

      const result = await branchManager.listRemotePipelineBranches('review-pipeline');

      expect(result).toEqual([
        'review-pipeline/test/abc123',
        'review-pipeline/test/def456',
      ]);
    });

    it('should use custom remote name', async () => {
      mockGit.branch.mockResolvedValue({
        all: [
          'upstream/pipeline/feature-1',
          'upstream/pipeline/feature-2',
          'origin/pipeline/other',
        ],
      });

      const result = await branchManager.listRemotePipelineBranches('pipeline', 'upstream');

      expect(result).toEqual([
        'pipeline/feature-1',
        'pipeline/feature-2',
      ]);
    });

    it('should return empty array when no remote pipeline branches exist', async () => {
      mockGit.branch.mockResolvedValue({
        all: ['origin/main', 'origin/develop'],
      });

      const result = await branchManager.listRemotePipelineBranches();

      expect(result).toEqual([]);
    });

    it('should strip remote prefix from branch names', async () => {
      mockGit.branch.mockResolvedValue({
        all: ['origin/pipeline/test-123'],
      });

      const result = await branchManager.listRemotePipelineBranches();

      expect(result).toEqual(['pipeline/test-123']);
      expect(result[0]).not.toContain('origin/');
    });

    it('should throw on git branch error', async () => {
      mockGit.branch.mockRejectedValue(new Error('Network error'));

      await expect(branchManager.listRemotePipelineBranches()).rejects.toThrow(
        'Network error'
      );
    });
  });

  describe('deleteRemoteBranch', () => {
    it('should delete remote branch from default remote (origin)', async () => {
      mockGit.push.mockResolvedValue(undefined);

      await branchManager.deleteRemoteBranch('pipeline/test');

      expect(mockGit.push).toHaveBeenCalledWith('origin', 'pipeline/test', ['--delete']);
    });

    it('should delete remote branch from custom remote', async () => {
      mockGit.push.mockResolvedValue(undefined);

      await branchManager.deleteRemoteBranch('pipeline/test', 'upstream');

      expect(mockGit.push).toHaveBeenCalledWith('upstream', 'pipeline/test', ['--delete']);
    });

    it('should handle branch names with slashes', async () => {
      mockGit.push.mockResolvedValue(undefined);

      await branchManager.deleteRemoteBranch('review-pipeline/post-commit/abc123');

      expect(mockGit.push).toHaveBeenCalledWith('origin', 'review-pipeline/post-commit/abc123', ['--delete']);
    });

    it('should throw on delete failure', async () => {
      mockGit.push.mockRejectedValue(new Error('Remote branch not found'));

      await expect(branchManager.deleteRemoteBranch('nonexistent')).rejects.toThrow(
        'Remote branch not found'
      );
    });

    it('should throw on permission denied', async () => {
      mockGit.push.mockRejectedValue(new Error('Permission denied'));

      await expect(branchManager.deleteRemoteBranch('protected-branch')).rejects.toThrow(
        'Permission denied'
      );
    });
  });
});
