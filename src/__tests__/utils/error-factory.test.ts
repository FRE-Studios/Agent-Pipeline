import { describe, it, expect } from 'vitest';
import { ErrorFactory } from '../../utils/error-factory.js';

describe('ErrorFactory', () => {
  describe('createStageError', () => {
    it('should create error details from Error object', () => {
      const error = new Error('Test error');
      const result = ErrorFactory.createStageError(error, '/path/to/agent.md');

      expect(result.message).toBe('Test error');
      expect(result.agentPath).toBe('/path/to/agent.md');
      expect(result.timestamp).toBeDefined();
      expect(result.stack).toBeDefined();
    });

    it('should create error details from string', () => {
      const result = ErrorFactory.createStageError('String error', '/path/to/agent.md');

      expect(result.message).toBe('String error');
      expect(result.agentPath).toBe('/path/to/agent.md');
      expect(result.timestamp).toBeDefined();
      expect(result.stack).toBeUndefined();
    });

    it('should add suggestion for ENOENT errors', () => {
      const error = new Error('ENOENT: file not found');
      const result = ErrorFactory.createStageError(error, '/missing/agent.md');

      expect(result.suggestion).toContain('Agent file not found');
      expect(result.suggestion).toContain('/missing/agent.md');
    });

    it('should add suggestion for timeout errors', () => {
      const error = new Error('Agent timeout after 5 minutes');
      const result = ErrorFactory.createStageError(error);

      expect(result.suggestion).toContain('Agent exceeded 5-minute timeout');
      expect(result.suggestion).toContain('increasing timeout');
    });

    it('should add suggestion for Claude CLI auth errors (GUI git hooks)', () => {
      const error = new Error('Claude CLI exited with code 1. stderr: (empty)\nstdout: Invalid API key · Please run /login');
      const result = ErrorFactory.createStageError(error);

      expect(result.suggestion).toContain('GUI git clients');
      expect(result.suggestion).toContain('macOS Keychain');
      expect(result.suggestion).toContain('claude-sdk runtime');
    });

    it('should add suggestion for API errors', () => {
      const error = new Error('API error: 401 unauthorized');
      const result = ErrorFactory.createStageError(error);

      expect(result.suggestion).toContain('ANTHROPIC_API_KEY');
    });

    it('should add suggestion for YAML parse errors', () => {
      const error = new Error('YAML parse error at line 5');
      const result = ErrorFactory.createStageError(error);

      expect(result.suggestion).toContain('YAML syntax');
    });

    it('should add suggestion for permission errors', () => {
      const error = new Error('permission denied');
      const result = ErrorFactory.createStageError(error);

      expect(result.suggestion).toContain('file permissions');
    });

    it('should not add suggestion for unknown errors', () => {
      const error = new Error('Unknown error');
      const result = ErrorFactory.createStageError(error);

      expect(result.suggestion).toBeUndefined();
    });
  });

  describe('createGitError', () => {
    it('should create error details from Error object', () => {
      const error = new Error('Git operation failed');
      const result = ErrorFactory.createGitError(error, 'push');

      expect(result.message).toBe('Git operation failed');
      expect(result.operation).toBe('push');
      expect(result.timestamp).toBeDefined();
      expect(result.stack).toBeDefined();
    });

    it('should create error details from string', () => {
      const result = ErrorFactory.createGitError('String git error', 'commit');

      expect(result.message).toBe('String git error');
      expect(result.operation).toBe('commit');
      expect(result.timestamp).toBeDefined();
      expect(result.stack).toBeUndefined();
    });

    it('should add suggestion for first commit edge case', () => {
      const error = new Error('ambiguous argument \'abc123^\': unknown revision');
      const result = ErrorFactory.createGitError(error, 'diff');

      expect(result.suggestion).toContain('Commit SHA or branch may not exist');
      expect(result.suggestion).toContain('first commit');
    });

    it('should add suggestion for unknown revision errors', () => {
      const error = new Error('unknown revision or path not in the working tree');
      const result = ErrorFactory.createGitError(error, 'diff');

      expect(result.suggestion).toContain('Commit SHA or branch may not exist');
      expect(result.suggestion).toContain('first commit');
    });

    it('should add suggestion for network errors', () => {
      const error = new Error('ENOTFOUND github.com');
      const result = ErrorFactory.createGitError(error, 'fetch');

      expect(result.suggestion).toContain('Network error');
      expect(result.suggestion).toContain('internet connection');
    });

    it('should add suggestion for DNS resolution errors', () => {
      const error = new Error('Could not resolve host: github.com');
      const result = ErrorFactory.createGitError(error, 'clone');

      expect(result.suggestion).toContain('Network error');
    });

    it('should add suggestion for authentication failures', () => {
      const error = new Error('authentication failed for https://github.com');
      const result = ErrorFactory.createGitError(error, 'push');

      expect(result.suggestion).toContain('Git authentication failed');
      expect(result.suggestion).toContain('SSH keys or HTTPS credentials');
    });

    it('should add suggestion for permission denied errors', () => {
      const error = new Error('Permission denied (publickey)');
      const result = ErrorFactory.createGitError(error, 'push');

      expect(result.suggestion).toContain('authentication failed');
    });

    it('should add suggestion for push rejections', () => {
      const error = new Error('push rejected: non-fast-forward');
      const result = ErrorFactory.createGitError(error, 'push');

      expect(result.suggestion).toContain('Push rejected');
      expect(result.suggestion).toContain('Pull latest changes');
    });

    it('should add suggestion for non-fast-forward errors', () => {
      const error = new Error('non-fast-forward updates were rejected');
      const result = ErrorFactory.createGitError(error, 'push');

      expect(result.suggestion).toContain('Push rejected');
      expect(result.suggestion).toContain('Pull latest changes');
    });

    it('should add suggestion for merge conflicts', () => {
      const error = new Error('CONFLICT (content): Merge conflict in file.ts');
      const result = ErrorFactory.createGitError(error, 'merge');

      expect(result.suggestion).toContain('Merge conflict detected');
      expect(result.suggestion).toContain('Resolve conflicts manually');
    });

    it('should add suggestion for not a git repository errors', () => {
      const error = new Error('fatal: not a git repository');
      const result = ErrorFactory.createGitError(error, 'status');

      expect(result.suggestion).toContain('not a git repository');
      expect(result.suggestion).toContain('git init');
    });

    it('should add suggestion for nothing to commit errors', () => {
      const error = new Error('nothing to commit, working tree clean');
      const result = ErrorFactory.createGitError(error, 'commit');

      expect(result.suggestion).toContain('No staged changes to commit');
      expect(result.suggestion).toContain('git add');
    });

    it('should add suggestion for no changes added errors', () => {
      const error = new Error('no changes added to commit');
      const result = ErrorFactory.createGitError(error, 'commit');

      expect(result.suggestion).toContain('No staged changes');
    });

    it('should add operation-specific suggestion for push failures', () => {
      const error = new Error('failed to push some refs');
      const result = ErrorFactory.createGitError(error, 'push');

      expect(result.suggestion).toContain('Push failed');
      expect(result.suggestion).toContain('remote branch exists');
      expect(result.suggestion).toContain('push permissions');
    });

    it('should not add suggestion for unknown git errors', () => {
      const error = new Error('Some unknown git error');
      const result = ErrorFactory.createGitError(error, 'status');

      expect(result.suggestion).toBeUndefined();
    });

    it('should handle error without operation parameter', () => {
      const error = new Error('Git error');
      const result = ErrorFactory.createGitError(error);

      expect(result.operation).toBeUndefined();
      expect(result.message).toBe('Git error');
    });

    it('should set timestamp in ISO format', () => {
      const error = new Error('Test');
      const result = ErrorFactory.createGitError(error, 'test');

      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });
});
