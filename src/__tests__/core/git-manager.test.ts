import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { GitManager } from '../../core/git-manager.js';
import { simpleGit } from 'simple-git';
import {
  cleanRepositoryState,
  dirtyRepositoryState,
  stagedChangesState,
  unstagedChangesState,
  freshRepositoryState,
  multipleFilesChangedState,
  singleFileChangedState,
  filesWithSpacesState,
  commitWithMetadata,
  multiLineCommitMessage,
  emptyCommitMessage,
} from '../fixtures/git-states.js';

// Mock simple-git module
vi.mock('simple-git');

describe('GitManager', () => {
  let gitManager: GitManager;
  let mockGit: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create default mock git instance
    mockGit = {
      log: vi.fn(),
      diff: vi.fn(),
      status: vi.fn(),
      add: vi.fn(),
      commit: vi.fn(),
      reset: vi.fn(),
      raw: vi.fn(),
    };

    (simpleGit as any).mockReturnValue(mockGit);
    gitManager = new GitManager('/test/repo');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with valid repository path', () => {
      const manager = new GitManager('/valid/path');
      expect(simpleGit).toHaveBeenCalledWith('/valid/path');
      expect(manager).toBeInstanceOf(GitManager);
    });

    it('should create SimpleGit instance correctly', () => {
      expect(simpleGit).toHaveBeenCalledTimes(1);
      expect(simpleGit).toHaveBeenCalledWith('/test/repo');
    });

    it('should handle different path formats', () => {
      const manager1 = new GitManager('relative/path');
      const manager2 = new GitManager('/absolute/path');
      const manager3 = new GitManager('.');

      expect(simpleGit).toHaveBeenCalledWith('relative/path');
      expect(simpleGit).toHaveBeenCalledWith('/absolute/path');
      expect(simpleGit).toHaveBeenCalledWith('.');
    });
  });

  describe('getCurrentCommit', () => {
    it('should return latest commit hash when available', async () => {
      mockGit.log.mockResolvedValue({
        latest: cleanRepositoryState.latest,
      });

      const result = await gitManager.getCurrentCommit();

      expect(mockGit.log).toHaveBeenCalledWith(['-1']);
      expect(result).toBe('abc123def456');
    });

    it('should return empty string when no commits exist', async () => {
      mockGit.log.mockResolvedValue({
        latest: null,
      });

      const result = await gitManager.getCurrentCommit();

      expect(result).toBe('');
    });

    it('should handle git log errors gracefully', async () => {
      mockGit.log.mockRejectedValue(new Error('Git log failed'));

      await expect(gitManager.getCurrentCommit()).rejects.toThrow('Git log failed');
    });

    it('should return full SHA-1 hash format', async () => {
      mockGit.log.mockResolvedValue({
        latest: {
          hash: '1234567890abcdef1234567890abcdef12345678',
          message: 'Test',
          author_name: 'Test',
          author_email: 'test@test.com',
        },
      });

      const result = await gitManager.getCurrentCommit();

      expect(result).toBe('1234567890abcdef1234567890abcdef12345678');
      expect(result).toHaveLength(40);
    });

    it('should work with fresh repository', async () => {
      mockGit.log.mockResolvedValue({
        latest: freshRepositoryState.latest,
      });

      const result = await gitManager.getCurrentCommit();

      expect(result).toBe('');
    });

    it('should handle undefined latest property', async () => {
      mockGit.log.mockResolvedValue({});

      const result = await gitManager.getCurrentCommit();

      expect(result).toBe('');
    });
  });

  describe('getChangedFiles', () => {
    it('should return list of changed files for commit', async () => {
      mockGit.diff.mockResolvedValue('file1.ts\nfile2.ts\nfile3.ts');

      const result = await gitManager.getChangedFiles('abc123');

      expect(mockGit.diff).toHaveBeenCalledWith(['--name-only', 'abc123^', 'abc123']);
      expect(result).toEqual(['file1.ts', 'file2.ts', 'file3.ts']);
    });

    it('should filter out empty lines from diff output', async () => {
      mockGit.diff.mockResolvedValue('file1.ts\n\n\nfile2.ts\n\n');

      const result = await gitManager.getChangedFiles('abc123');

      expect(result).toEqual(['file1.ts', 'file2.ts']);
      expect(result).not.toContain('');
    });

    it('should handle commit with no changes', async () => {
      mockGit.diff.mockResolvedValue('');

      const result = await gitManager.getChangedFiles('abc123');

      expect(result).toEqual([]);
    });

    it('should handle commit with single file', async () => {
      mockGit.diff.mockResolvedValue('single-file.ts');

      const result = await gitManager.getChangedFiles('abc123');

      expect(result).toEqual(['single-file.ts']);
    });

    it('should handle commit with multiple files', async () => {
      mockGit.diff.mockResolvedValue(multipleFilesChangedState.diffOutput);

      const result = await gitManager.getChangedFiles('multi123');

      expect(result).toEqual([
        'src/core/file1.ts',
        'src/utils/file2.ts',
        'tests/test.ts',
      ]);
    });

    it('should handle files with spaces in names', async () => {
      mockGit.diff.mockResolvedValue(filesWithSpacesState.diffOutput);

      const result = await gitManager.getChangedFiles('spaces123');

      expect(result).toEqual(['file with spaces.ts', 'another file.md']);
    });

    it('should handle renamed files', async () => {
      mockGit.diff.mockResolvedValue('old-name.ts\nnew-name.ts');

      const result = await gitManager.getChangedFiles('rename123');

      expect(result).toEqual(['old-name.ts', 'new-name.ts']);
    });

    it('should throw on invalid commit SHA', async () => {
      mockGit.diff.mockRejectedValue(new Error('Invalid object name'));

      await expect(gitManager.getChangedFiles('invalid-sha')).rejects.toThrow();
    });

    it('should handle first commit (no parent) by listing all files', async () => {
      mockGit.diff.mockRejectedValue(new Error('ambiguous argument \'abc123^\': unknown revision'));
      mockGit.raw.mockResolvedValue('file1.ts\nfile2.ts\nfile3.ts');

      const result = await gitManager.getChangedFiles('abc123');

      expect(mockGit.raw).toHaveBeenCalledWith(['ls-tree', '--name-only', '-r', 'abc123']);
      expect(result).toEqual(['file1.ts', 'file2.ts', 'file3.ts']);
    });

    it('should provide helpful error message for first commit edge case', async () => {
      mockGit.diff.mockRejectedValue(new Error('unknown revision or path'));
      mockGit.raw.mockResolvedValue('initial-file.ts');

      const result = await gitManager.getChangedFiles('first-commit-sha');

      expect(result).toEqual(['initial-file.ts']);
    });
  });

  describe('hasUncommittedChanges', () => {
    it('should return true when working directory is dirty', async () => {
      mockGit.status.mockResolvedValue({
        ...dirtyRepositoryState,
        isClean: () => false,
      });

      const result = await gitManager.hasUncommittedChanges();

      expect(result).toBe(true);
    });

    it('should return false when working directory is clean', async () => {
      mockGit.status.mockResolvedValue({
        ...cleanRepositoryState,
        isClean: () => true,
      });

      const result = await gitManager.hasUncommittedChanges();

      expect(result).toBe(false);
    });

    it('should detect staged changes', async () => {
      mockGit.status.mockResolvedValue({
        ...stagedChangesState,
        isClean: () => false,
      });

      const result = await gitManager.hasUncommittedChanges();

      expect(result).toBe(true);
    });

    it('should detect unstaged changes', async () => {
      mockGit.status.mockResolvedValue({
        ...unstagedChangesState,
        isClean: () => false,
      });

      const result = await gitManager.hasUncommittedChanges();

      expect(result).toBe(true);
    });

    it('should detect untracked files', async () => {
      mockGit.status.mockResolvedValue({
        files: ['untracked.ts'],
        isClean: () => false,
      });

      const result = await gitManager.hasUncommittedChanges();

      expect(result).toBe(true);
    });

    it('should detect deleted files', async () => {
      mockGit.status.mockResolvedValue({
        deleted: ['deleted-file.ts'],
        isClean: () => false,
      });

      const result = await gitManager.hasUncommittedChanges();

      expect(result).toBe(true);
    });

    it('should handle git status errors', async () => {
      mockGit.status.mockRejectedValue(new Error('Not a git repository'));

      await expect(gitManager.hasUncommittedChanges()).rejects.toThrow(
        'Not a git repository'
      );
    });
  });

  describe('stageAllChanges', () => {
    it('should stage all changes with git add .', async () => {
      mockGit.add.mockResolvedValue(undefined);

      await gitManager.stageAllChanges();

      expect(mockGit.add).toHaveBeenCalledWith('.');
    });

    it('should handle no changes to stage', async () => {
      mockGit.add.mockResolvedValue(undefined);

      await gitManager.stageAllChanges();

      expect(mockGit.add).toHaveBeenCalledWith('.');
    });

    it('should stage multiple file types', async () => {
      mockGit.add.mockResolvedValue(undefined);

      await gitManager.stageAllChanges();

      expect(mockGit.add).toHaveBeenCalledWith('.');
    });

    it('should stage new files', async () => {
      mockGit.add.mockResolvedValue(undefined);

      await gitManager.stageAllChanges();

      expect(mockGit.add).toHaveBeenCalledWith('.');
    });

    it('should throw on git add failure', async () => {
      mockGit.add.mockRejectedValue(new Error('Permission denied'));

      await expect(gitManager.stageAllChanges()).rejects.toThrow('Permission denied');
    });
  });

  describe('commitWithMetadata', () => {
    beforeEach(() => {
      mockGit.status.mockResolvedValue({
        staged: ['file1.ts', 'file2.ts'],
        isClean: () => false,
      });
      mockGit.commit.mockResolvedValue({
        commit: 'new-commit-sha',
      });
      mockGit.log.mockResolvedValue({
        latest: { hash: 'new-commit-sha' },
      });
    });

    it('should throw error when no staged changes', async () => {
      mockGit.status.mockResolvedValue({
        staged: [],
        isClean: () => true,
      });

      await expect(
        gitManager.commitWithMetadata('Test', {})
      ).rejects.toThrow('No staged changes to commit');
    });

    it('should create commit with metadata trailers', async () => {
      const message = 'Test commit';
      const metadata = { 'Run-ID': '12345', Stage: 'test' };

      await gitManager.commitWithMetadata(message, metadata);

      const expectedMessage = 'Test commit\n\nRun-ID: 12345\nStage: test';
      expect(mockGit.commit).toHaveBeenCalledWith(
        expectedMessage,
        undefined,
        { '--no-verify': null }
      );
    });

    it('should format metadata as key-value pairs', async () => {
      const metadata = { Key1: 'value1', Key2: 'value2', Key3: 'value3' };

      await gitManager.commitWithMetadata('Message', metadata);

      const expectedMessage = 'Message\n\nKey1: value1\nKey2: value2\nKey3: value3';
      expect(mockGit.commit).toHaveBeenCalledWith(
        expectedMessage,
        undefined,
        { '--no-verify': null }
      );
    });

    it('should return new commit SHA', async () => {
      mockGit.log.mockResolvedValue({
        latest: { hash: 'new-sha-123' },
      });

      const result = await gitManager.commitWithMetadata('Message', {});

      expect(result).toBe('new-sha-123');
      expect(mockGit.log).toHaveBeenCalledWith(['-1']);
    });

    it('should handle single metadata field', async () => {
      const metadata = { 'Single-Key': 'single-value' };

      await gitManager.commitWithMetadata('Single field', metadata);

      const expectedMessage = 'Single field\n\nSingle-Key: single-value';
      expect(mockGit.commit).toHaveBeenCalledWith(
        expectedMessage,
        undefined,
        { '--no-verify': null }
      );
    });

    it('should handle multiple metadata fields', async () => {
      const metadata = {
        Field1: 'value1',
        Field2: 'value2',
        Field3: 'value3',
        Field4: 'value4',
      };

      await gitManager.commitWithMetadata('Multiple fields', metadata);

      expect(mockGit.commit).toHaveBeenCalled();
      const call = mockGit.commit.mock.calls[0][0];
      expect(call).toContain('Field1: value1');
      expect(call).toContain('Field2: value2');
      expect(call).toContain('Field3: value3');
      expect(call).toContain('Field4: value4');
    });

    it('should handle empty metadata object', async () => {
      await gitManager.commitWithMetadata('No metadata', {});

      const expectedMessage = 'No metadata\n\n';
      expect(mockGit.commit).toHaveBeenCalledWith(
        expectedMessage,
        undefined,
        { '--no-verify': null }
      );
    });

    it('should preserve commit message formatting', async () => {
      const message = 'Multi-line\nmessage\nhere';

      await gitManager.commitWithMetadata(message, { Key: 'value' });

      const expectedMessage = 'Multi-line\nmessage\nhere\n\nKey: value';
      expect(mockGit.commit).toHaveBeenCalledWith(
        expectedMessage,
        undefined,
        { '--no-verify': null }
      );
    });

    it('should add blank line before trailers', async () => {
      await gitManager.commitWithMetadata('Message', { Trailer: 'value' });

      const call = mockGit.commit.mock.calls[0][0];
      expect(call).toMatch(/Message\n\nTrailer: value/);
    });

    it('should call getCurrentCommit after committing', async () => {
      await gitManager.commitWithMetadata('Message', {});

      expect(mockGit.commit).toHaveBeenCalled();
      expect(mockGit.log).toHaveBeenCalledWith(['-1']);
    });

    it('should validate staged changes before committing', async () => {
      mockGit.status.mockResolvedValue({
        staged: ['file1.ts'],
        isClean: () => false,
      });

      await gitManager.commitWithMetadata('Message', { Key: 'value' });

      expect(mockGit.status).toHaveBeenCalled();
      expect(mockGit.commit).toHaveBeenCalled();
    });

    it('should throw on commit failure', async () => {
      mockGit.commit.mockRejectedValue(new Error('Nothing to commit'));

      await expect(
        gitManager.commitWithMetadata('Message', {})
      ).rejects.toThrow('Nothing to commit');
    });
  });

  describe('createPipelineCommit', () => {
    beforeEach(() => {
      mockGit.add.mockResolvedValue(undefined);
      mockGit.status.mockResolvedValue({
        staged: ['file1.ts'],
        isClean: () => false,
      });
      mockGit.commit.mockResolvedValue({ commit: 'new-sha' });
      mockGit.log.mockResolvedValue({
        latest: { hash: 'pipeline-commit-sha' },
      });
    });

    it('should create commit with pipeline metadata', async () => {
      mockGit.status.mockResolvedValue({
        staged: ['file1.ts'],
        isClean: () => false,
      });

      const result = await gitManager.createPipelineCommit(
        'test-stage',
        'run-123'
      );

      expect(mockGit.add).toHaveBeenCalledWith('.');
      expect(mockGit.commit).toHaveBeenCalled();
      expect(result).toBe('pipeline-commit-sha');
    });

    it('should return empty string when no changes exist', async () => {
      mockGit.status.mockResolvedValue({
        isClean: () => true,
      });

      const result = await gitManager.createPipelineCommit(
        'test-stage',
        'run-123'
      );

      expect(result).toBe('');
      expect(mockGit.add).not.toHaveBeenCalled();
      expect(mockGit.commit).not.toHaveBeenCalled();
    });

    it('should stage changes before committing', async () => {
      mockGit.status.mockResolvedValue({
        staged: ['file1.ts'],
        isClean: () => false,
      });

      await gitManager.createPipelineCommit('stage', 'run-id');

      expect(mockGit.add).toHaveBeenCalledWith('.');
      expect(mockGit.commit).toHaveBeenCalled();

      // Verify add was called before commit by checking invocation order
      const addCallOrder = mockGit.add.mock.invocationCallOrder[0];
      const commitCallOrder = mockGit.commit.mock.invocationCallOrder[0];
      expect(addCallOrder).toBeLessThan(commitCallOrder);
    });

    it('should use custom message when provided', async () => {
      mockGit.status.mockResolvedValue({
        staged: ['file1.ts'],
        isClean: () => false,
      });

      await gitManager.createPipelineCommit(
        'test-stage',
        'run-123',
        'Custom commit message'
      );

      const commitCall = mockGit.commit.mock.calls[0][0];
      expect(commitCall).toContain('[pipeline:test-stage] Custom commit message');
    });

    it('should use commitPrefix when provided', async () => {
      mockGit.status.mockResolvedValue({
        staged: ['file1.ts'],
        isClean: () => false,
      });

      await gitManager.createPipelineCommit(
        'test-stage',
        'run-123',
        undefined,
        '[custom:{{stage}}]'
      );

      const commitCall = mockGit.commit.mock.calls[0][0];
      expect(commitCall).toContain('[custom:test-stage] Apply test-stage changes');
    });

    it('should use default message with stage name', async () => {
      mockGit.status.mockResolvedValue({
        staged: ['file1.ts'],
        isClean: () => false,
      });

      await gitManager.createPipelineCommit('build-stage', 'run-456');

      const commitCall = mockGit.commit.mock.calls[0][0];
      expect(commitCall).toContain('[pipeline:build-stage] Apply build-stage changes');
    });

    it('should format commit message with [pipeline:stageName] prefix', async () => {
      mockGit.status.mockResolvedValue({
        staged: ['file1.ts'],
        isClean: () => false,
      });

      await gitManager.createPipelineCommit('deploy', 'run-789');

      const commitCall = mockGit.commit.mock.calls[0][0];
      expect(commitCall).toMatch(/^\[pipeline:deploy\]/);
    });

    it('should include Pipeline-Run-ID trailer', async () => {
      mockGit.status.mockResolvedValue({
        staged: ['file1.ts'],
        isClean: () => false,
      });

      await gitManager.createPipelineCommit('stage', 'my-run-id');

      const commitCall = mockGit.commit.mock.calls[0][0];
      expect(commitCall).toContain('Pipeline-Run-ID: my-run-id');
    });

    it('should include Pipeline-Stage trailer', async () => {
      mockGit.status.mockResolvedValue({
        staged: ['file1.ts'],
        isClean: () => false,
      });

      await gitManager.createPipelineCommit('my-stage', 'run-id');

      const commitCall = mockGit.commit.mock.calls[0][0];
      expect(commitCall).toContain('Pipeline-Stage: my-stage');
    });

    it('should include Agent-Pipeline trailer', async () => {
      mockGit.status.mockResolvedValue({
        staged: ['file1.ts'],
        isClean: () => false,
      });

      await gitManager.createPipelineCommit('stage', 'run-id');

      const commitCall = mockGit.commit.mock.calls[0][0];
      expect(commitCall).toContain('Agent-Pipeline: true');
    });

    it('should return new commit SHA on success', async () => {
      mockGit.status.mockResolvedValue({
        staged: ['file1.ts'],
        isClean: () => false,
      });
      mockGit.log.mockResolvedValue({
        latest: { hash: 'success-sha-abc' },
      });

      const result = await gitManager.createPipelineCommit('stage', 'run');

      expect(result).toBe('success-sha-abc');
    });

    it('should handle stage names with spaces/special chars', async () => {
      mockGit.status.mockResolvedValue({
        staged: ['file1.ts'],
        isClean: () => false,
      });

      await gitManager.createPipelineCommit('test stage (v2)', 'run-123');

      const commitCall = mockGit.commit.mock.calls[0][0];
      expect(commitCall).toContain('[pipeline:test stage (v2)]');
    });

    it('should skip staging if no uncommitted changes', async () => {
      mockGit.status.mockResolvedValue({
        isClean: () => true,
      });

      await gitManager.createPipelineCommit('stage', 'run');

      expect(mockGit.add).not.toHaveBeenCalled();
    });

    it('should propagate errors from git operations', async () => {
      mockGit.status.mockResolvedValue({
        staged: ['file1.ts'],
        isClean: () => false,
      });
      mockGit.add.mockRejectedValue(new Error('Add failed'));

      await expect(
        gitManager.createPipelineCommit('stage', 'run')
      ).rejects.toThrow('Add failed');
    });
  });

  describe('revertToCommit', () => {
    it('should hard reset to specified commit', async () => {
      mockGit.reset.mockResolvedValue(undefined);

      await gitManager.revertToCommit('abc123');

      expect(mockGit.reset).toHaveBeenCalledWith(['--hard', 'abc123']);
    });

    it('should call git reset with --hard flag', async () => {
      mockGit.reset.mockResolvedValue(undefined);

      await gitManager.revertToCommit('def456');

      expect(mockGit.reset).toHaveBeenCalledWith(['--hard', 'def456']);
      const call = mockGit.reset.mock.calls[0][0];
      expect(call).toContain('--hard');
    });

    it('should handle valid commit SHA', async () => {
      mockGit.reset.mockResolvedValue(undefined);

      await expect(
        gitManager.revertToCommit('1234567890abcdef')
      ).resolves.not.toThrow();
    });

    it('should throw on invalid commit SHA', async () => {
      mockGit.reset.mockRejectedValue(new Error('Invalid commit reference'));

      await expect(gitManager.revertToCommit('invalid')).rejects.toThrow(
        'Invalid commit reference'
      );
    });

    it('should throw on reset failure', async () => {
      mockGit.reset.mockRejectedValue(new Error('Reset failed'));

      await expect(gitManager.revertToCommit('abc123')).rejects.toThrow(
        'Reset failed'
      );
    });
  });

  describe('getCommitMessage', () => {
    it('should return commit message for valid SHA', async () => {
      mockGit.log.mockResolvedValue({
        latest: commitWithMetadata.latest,
      });

      const result = await gitManager.getCommitMessage('meta123def456');

      expect(mockGit.log).toHaveBeenCalledWith(['-1', 'meta123def456']);
      expect(result).toBe(
        '[pipeline:test-stage] Apply test-stage changes\n\nAgent-Pipeline: true\nPipeline-Run-ID: run-12345\nPipeline-Stage: test-stage'
      );
    });

    it('should return empty string for non-existent commit', async () => {
      mockGit.log.mockResolvedValue({
        latest: null,
      });

      const result = await gitManager.getCommitMessage('nonexistent');

      expect(result).toBe('');
    });

    it('should preserve multi-line messages', async () => {
      mockGit.log.mockResolvedValue({
        latest: multiLineCommitMessage.latest,
      });

      const result = await gitManager.getCommitMessage('multiline123');

      expect(result).toContain('First line of commit');
      expect(result).toContain('Detailed description here');
      expect(result).toContain('With multiple lines');
      expect(result).toContain('Trailer-Key: trailer-value');
    });

    it('should include trailers in message', async () => {
      mockGit.log.mockResolvedValue({
        latest: commitWithMetadata.latest,
      });

      const result = await gitManager.getCommitMessage('meta123');

      expect(result).toContain('Agent-Pipeline: true');
      expect(result).toContain('Pipeline-Run-ID: run-12345');
      expect(result).toContain('Pipeline-Stage: test-stage');
    });

    it('should handle commit with no message', async () => {
      mockGit.log.mockResolvedValue({
        latest: emptyCommitMessage.latest,
      });

      const result = await gitManager.getCommitMessage('empty123');

      expect(result).toBe('');
    });

    it('should throw on git log error', async () => {
      mockGit.log.mockRejectedValue(new Error('Commit not found'));

      await expect(gitManager.getCommitMessage('invalid')).rejects.toThrow(
        'Commit not found'
      );
    });
  });

  describe('listWorktrees', () => {
    it('should return empty array when no worktrees exist', async () => {
      mockGit.raw.mockResolvedValue('');

      const result = await gitManager.listWorktrees();

      expect(mockGit.raw).toHaveBeenCalledWith(['worktree', 'list', '--porcelain']);
      expect(result).toEqual([]);
    });

    it('should parse single worktree entry', async () => {
      const porcelainOutput = `worktree /path/to/repo
HEAD abc123def456
branch refs/heads/main
`;

      mockGit.raw.mockResolvedValue(porcelainOutput);

      const result = await gitManager.listWorktrees();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        path: '/path/to/repo',
        head: 'abc123def456',
        branch: 'main',
        bare: undefined,
        detached: undefined,
      });
    });

    it('should parse multiple worktree entries', async () => {
      const porcelainOutput = `worktree /path/to/main
HEAD abc123
branch refs/heads/main

worktree /path/to/feature
HEAD def456
branch refs/heads/feature-branch`;

      mockGit.raw.mockResolvedValue(porcelainOutput);

      const result = await gitManager.listWorktrees();

      expect(result).toHaveLength(2);
      expect(result[0].path).toBe('/path/to/main');
      expect(result[0].branch).toBe('main');
      expect(result[1].path).toBe('/path/to/feature');
      expect(result[1].branch).toBe('feature-branch');
    });

    it('should handle bare repository entry', async () => {
      const porcelainOutput = `worktree /path/to/bare.git
HEAD abc123
bare`;

      mockGit.raw.mockResolvedValue(porcelainOutput);

      const result = await gitManager.listWorktrees();

      expect(result).toHaveLength(1);
      expect(result[0].bare).toBe(true);
      expect(result[0].branch).toBe('');
    });

    it('should handle detached HEAD state', async () => {
      const porcelainOutput = `worktree /path/to/repo
HEAD abc123def456
detached`;

      mockGit.raw.mockResolvedValue(porcelainOutput);

      const result = await gitManager.listWorktrees();

      expect(result).toHaveLength(1);
      expect(result[0].detached).toBe(true);
      expect(result[0].branch).toBe('');
    });

    it('should strip refs/heads/ prefix from branch names', async () => {
      const porcelainOutput = `worktree /path/to/repo
HEAD abc123
branch refs/heads/feature/nested-branch`;

      mockGit.raw.mockResolvedValue(porcelainOutput);

      const result = await gitManager.listWorktrees();

      expect(result[0].branch).toBe('feature/nested-branch');
    });

    it('should skip entries without path or HEAD', async () => {
      const porcelainOutput = `worktree /valid/path
HEAD abc123
branch refs/heads/main

HEAD def456
branch refs/heads/orphan`;

      mockGit.raw.mockResolvedValue(porcelainOutput);

      const result = await gitManager.listWorktrees();

      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('/valid/path');
    });

    it('should handle git raw error', async () => {
      mockGit.raw.mockRejectedValue(new Error('Not a git repository'));

      await expect(gitManager.listWorktrees()).rejects.toThrow('Not a git repository');
    });
  });

  describe('isBranchCheckedOut', () => {
    it('should return path when branch is checked out', async () => {
      const porcelainOutput = `worktree /path/to/repo
HEAD abc123
branch refs/heads/main

worktree /path/to/feature
HEAD def456
branch refs/heads/feature-branch`;

      mockGit.raw.mockResolvedValue(porcelainOutput);

      const result = await gitManager.isBranchCheckedOut('feature-branch');

      expect(result).toBe('/path/to/feature');
    });

    it('should return null when branch is not checked out', async () => {
      const porcelainOutput = `worktree /path/to/repo
HEAD abc123
branch refs/heads/main`;

      mockGit.raw.mockResolvedValue(porcelainOutput);

      const result = await gitManager.isBranchCheckedOut('non-existent-branch');

      expect(result).toBeNull();
    });

    it('should return path for main worktree', async () => {
      const porcelainOutput = `worktree /path/to/repo
HEAD abc123
branch refs/heads/main`;

      mockGit.raw.mockResolvedValue(porcelainOutput);

      const result = await gitManager.isBranchCheckedOut('main');

      expect(result).toBe('/path/to/repo');
    });

    it('should return null for detached HEAD worktrees', async () => {
      const porcelainOutput = `worktree /path/to/repo
HEAD abc123
detached`;

      mockGit.raw.mockResolvedValue(porcelainOutput);

      const result = await gitManager.isBranchCheckedOut('any-branch');

      expect(result).toBeNull();
    });
  });

  describe('worktreeExists', () => {
    it('should return true when worktree exists at path', async () => {
      const porcelainOutput = `worktree /path/to/repo
HEAD abc123
branch refs/heads/main

worktree /path/to/worktree
HEAD def456
branch refs/heads/feature`;

      mockGit.raw.mockResolvedValue(porcelainOutput);

      const result = await gitManager.worktreeExists('/path/to/worktree');

      expect(result).toBe(true);
    });

    it('should return false when worktree does not exist', async () => {
      const porcelainOutput = `worktree /path/to/repo
HEAD abc123
branch refs/heads/main`;

      mockGit.raw.mockResolvedValue(porcelainOutput);

      const result = await gitManager.worktreeExists('/non/existent/path');

      expect(result).toBe(false);
    });

    it('should return false for empty worktree list', async () => {
      mockGit.raw.mockResolvedValue('');

      const result = await gitManager.worktreeExists('/any/path');

      expect(result).toBe(false);
    });

    it('should match exact path only', async () => {
      const porcelainOutput = `worktree /path/to/repo
HEAD abc123
branch refs/heads/main`;

      mockGit.raw.mockResolvedValue(porcelainOutput);

      const result = await gitManager.worktreeExists('/path/to');

      expect(result).toBe(false);
    });
  });

  describe('createWorktree', () => {
    beforeEach(() => {
      // Default: no worktrees checked out, branch doesn't exist
      mockGit.raw.mockResolvedValue('');
      mockGit.branchLocal = vi.fn().mockResolvedValue({ all: [] });
    });

    it('should create worktree with new branch from remote base', async () => {
      mockGit.raw
        .mockResolvedValueOnce('') // listWorktrees (empty)
        .mockResolvedValueOnce(undefined); // worktree add

      mockGit.branchLocal.mockResolvedValue({ all: [] });

      await gitManager.createWorktree('/path/to/worktree', 'new-branch', 'main');

      expect(mockGit.raw).toHaveBeenCalledWith([
        'worktree', 'add', '-b', 'new-branch', '/path/to/worktree', 'origin/main'
      ]);
    });

    it('should fallback to local base branch if remote fails', async () => {
      mockGit.raw
        .mockResolvedValueOnce('') // listWorktrees
        .mockRejectedValueOnce(new Error('Remote not found')) // remote base fails
        .mockResolvedValueOnce(undefined); // local base succeeds

      mockGit.branchLocal.mockResolvedValue({ all: [] });

      await gitManager.createWorktree('/path/to/worktree', 'new-branch', 'main');

      expect(mockGit.raw).toHaveBeenCalledWith([
        'worktree', 'add', '-b', 'new-branch', '/path/to/worktree', 'main'
      ]);
    });

    it('should use existing branch without -b flag', async () => {
      mockGit.raw
        .mockResolvedValueOnce('') // listWorktrees
        .mockResolvedValueOnce(undefined); // worktree add

      mockGit.branchLocal.mockResolvedValue({ all: ['existing-branch', 'main'] });

      await gitManager.createWorktree('/path/to/worktree', 'existing-branch');

      expect(mockGit.raw).toHaveBeenCalledWith([
        'worktree', 'add', '/path/to/worktree', 'existing-branch'
      ]);
    });

    it('should throw if branch is already checked out', async () => {
      const porcelainOutput = `worktree /existing/worktree
HEAD abc123
branch refs/heads/feature-branch`;

      mockGit.raw.mockResolvedValueOnce(porcelainOutput);

      await expect(
        gitManager.createWorktree('/new/path', 'feature-branch')
      ).rejects.toThrow("Branch 'feature-branch' is already checked out at '/existing/worktree'");
    });

    it('should throw with helpful message when branch checkout fails', async () => {
      mockGit.raw
        .mockResolvedValueOnce('') // listWorktrees
        .mockRejectedValueOnce(new Error('fatal: invalid reference'));

      mockGit.branchLocal.mockResolvedValue({ all: ['existing-branch'] });

      await expect(
        gitManager.createWorktree('/path/to/worktree', 'existing-branch')
      ).rejects.toThrow("Failed to add worktree for existing branch 'existing-branch'");
    });

    it('should throw with helpful message when new branch creation fails', async () => {
      mockGit.raw
        .mockResolvedValueOnce('') // listWorktrees
        .mockRejectedValueOnce(new Error('Remote not found'))
        .mockRejectedValueOnce(new Error('fatal: branch already exists'));

      mockGit.branchLocal.mockResolvedValue({ all: [] });

      await expect(
        gitManager.createWorktree('/path/to/worktree', 'new-branch', 'main')
      ).rejects.toThrow("Failed to create worktree with new branch 'new-branch' from base 'main'");
    });

    it('should use default base branch when not specified', async () => {
      mockGit.raw
        .mockResolvedValueOnce('') // listWorktrees
        .mockResolvedValueOnce(undefined); // worktree add

      mockGit.branchLocal.mockResolvedValue({ all: [] });

      await gitManager.createWorktree('/path/to/worktree', 'new-branch');

      expect(mockGit.raw).toHaveBeenCalledWith([
        'worktree', 'add', '-b', 'new-branch', '/path/to/worktree', 'origin/main'
      ]);
    });

    it('should handle case where first attempt creates branch but fails for other reason', async () => {
      // Scenario: First attempt with origin/main creates branch but fails (e.g., directory issue)
      // The fix should detect the branch now exists and add worktree without -b flag
      mockGit.raw
        .mockResolvedValueOnce('') // listWorktrees (empty)
        .mockRejectedValueOnce(new Error('fatal: path already exists')) // first attempt fails after creating branch
        .mockResolvedValueOnce(undefined); // adding worktree with existing branch succeeds

      // First call: branch doesn't exist
      // After first failed attempt: branch exists (was created before failure)
      mockGit.branchLocal
        .mockResolvedValueOnce({ all: [] }) // before first attempt
        .mockResolvedValueOnce({ all: ['new-branch'] }); // after failed attempt, branch exists

      await gitManager.createWorktree('/path/to/worktree', 'new-branch', 'main');

      // Should use worktree add without -b since branch now exists
      expect(mockGit.raw).toHaveBeenCalledWith([
        'worktree', 'add', '/path/to/worktree', 'new-branch'
      ]);
    });

    it('should throw error if worktree add with existing branch fails after first attempt created branch', async () => {
      mockGit.raw
        .mockResolvedValueOnce('') // listWorktrees (empty)
        .mockRejectedValueOnce(new Error('fatal: path already exists')) // first attempt fails
        .mockRejectedValueOnce(new Error('fatal: worktree add failed')); // second attempt also fails

      mockGit.branchLocal
        .mockResolvedValueOnce({ all: [] }) // before first attempt
        .mockResolvedValueOnce({ all: ['new-branch'] }); // branch exists after failed attempt

      await expect(
        gitManager.createWorktree('/path/to/worktree', 'new-branch', 'main')
      ).rejects.toThrow("Failed to add worktree for branch 'new-branch'");
    });
  });

  describe('removeWorktree', () => {
    it('should remove worktree without force flag', async () => {
      mockGit.raw.mockResolvedValue(undefined);

      await gitManager.removeWorktree('/path/to/worktree');

      expect(mockGit.raw).toHaveBeenCalledWith([
        'worktree', 'remove', '/path/to/worktree'
      ]);
    });

    it('should remove worktree with force flag', async () => {
      mockGit.raw.mockResolvedValue(undefined);

      await gitManager.removeWorktree('/path/to/worktree', true);

      expect(mockGit.raw).toHaveBeenCalledWith([
        'worktree', 'remove', '/path/to/worktree', '--force'
      ]);
    });

    it('should throw on removal failure', async () => {
      mockGit.raw.mockRejectedValue(new Error('Worktree has uncommitted changes'));

      await expect(
        gitManager.removeWorktree('/path/to/dirty/worktree')
      ).rejects.toThrow('Worktree has uncommitted changes');
    });

    it('should throw when worktree does not exist', async () => {
      mockGit.raw.mockRejectedValue(new Error("'/non/existent' is not a working tree"));

      await expect(
        gitManager.removeWorktree('/non/existent')
      ).rejects.toThrow("is not a working tree");
    });
  });

  describe('pruneWorktrees', () => {
    it('should call git worktree prune', async () => {
      mockGit.raw.mockResolvedValue(undefined);

      await gitManager.pruneWorktrees();

      expect(mockGit.raw).toHaveBeenCalledWith(['worktree', 'prune']);
    });

    it('should handle prune error', async () => {
      mockGit.raw.mockRejectedValue(new Error('Prune failed'));

      await expect(gitManager.pruneWorktrees()).rejects.toThrow('Prune failed');
    });
  });

  describe('getChangedFiles - additional edge cases', () => {
    it('should throw error with suggestion for non-recoverable diff failure', async () => {
      mockGit.diff.mockRejectedValue(new Error('fatal: repository corrupt'));

      await expect(gitManager.getChangedFiles('abc123')).rejects.toThrow();
    });

    it('should use suggestion from ErrorFactory when available', async () => {
      // Simulate an error that doesn't match the first-commit patterns
      const error = new Error('permission denied');
      mockGit.diff.mockRejectedValue(error);

      await expect(gitManager.getChangedFiles('abc123')).rejects.toThrow('permission denied');
    });
  });

  describe('createPipelineCommit - additional edge cases', () => {
    beforeEach(() => {
      mockGit.add.mockResolvedValue(undefined);
      mockGit.status.mockResolvedValue({
        staged: ['file1.ts'],
        isClean: () => false,
      });
      mockGit.commit.mockResolvedValue({ commit: 'new-sha' });
      mockGit.log.mockResolvedValue({
        latest: { hash: 'pipeline-commit-sha' },
      });
    });

    it('should not add extra separator when commitPrefix ends with space', async () => {
      mockGit.status.mockResolvedValue({
        staged: ['file1.ts'],
        isClean: () => false,
      });

      await gitManager.createPipelineCommit(
        'test-stage',
        'run-123',
        'Custom message',
        '[custom:{{stage}}] ' // Note: ends with space
      );

      const commitCall = mockGit.commit.mock.calls[0][0];
      expect(commitCall).toContain('[custom:test-stage] Custom message');
      // Should not have double space
      expect(commitCall).not.toContain('[custom:test-stage]  Custom message');
    });

    it('should add separator when commitPrefix does not end with space', async () => {
      mockGit.status.mockResolvedValue({
        staged: ['file1.ts'],
        isClean: () => false,
      });

      await gitManager.createPipelineCommit(
        'test-stage',
        'run-123',
        'Custom message',
        '[custom:{{stage}}]' // Note: no trailing space
      );

      const commitCall = mockGit.commit.mock.calls[0][0];
      expect(commitCall).toContain('[custom:test-stage] Custom message');
    });
  });
});
