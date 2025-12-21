import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HookInstaller } from '../../cli/hooks.js';
import { createTempDir, cleanupTempDir } from '../setup.js';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('HookInstaller', () => {
  let tempDir: string;
  let installer: HookInstaller;
  let gitHooksDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir('hooks-test-');
    // Create .git/hooks directory to simulate a git repo
    gitHooksDir = path.join(tempDir, '.git', 'hooks');
    await fs.mkdir(gitHooksDir, { recursive: true });
    installer = new HookInstaller(tempDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('Install - Post-Commit Hook', () => {
    it('should create post-commit hook file', async () => {
      await installer.install('test-pipeline', 'post-commit');

      const hookPath = path.join(gitHooksDir, 'post-commit');
      const exists = await fs.stat(hookPath).then(() => true, () => false);
      expect(exists).toBe(true);
    });

    it('should create hook with bash shebang', async () => {
      await installer.install('test-pipeline', 'post-commit');

      const hookPath = path.join(gitHooksDir, 'post-commit');
      const content = await fs.readFile(hookPath, 'utf-8');
      expect(content).toMatch(/^#!\/bin\/bash/);
    });

    it('should include pipeline name in hook script', async () => {
      await installer.install('my-pipeline', 'post-commit');

      const hookPath = path.join(gitHooksDir, 'post-commit');
      const content = await fs.readFile(hookPath, 'utf-8');
      expect(content).toContain('my-pipeline');
    });

    it('should include hook marker comment with pipeline name', async () => {
      await installer.install('test-pipeline', 'post-commit');

      const hookPath = path.join(gitHooksDir, 'post-commit');
      const content = await fs.readFile(hookPath, 'utf-8');
      expect(content).toContain('# Agent Pipeline (post-commit): test-pipeline');
    });

    it('should include lock directory to prevent overlap', async () => {
      await installer.install('test-pipeline', 'post-commit');

      const hookPath = path.join(gitHooksDir, 'post-commit');
      const content = await fs.readFile(hookPath, 'utf-8');

      expect(content).toContain('.agent-pipeline/locks');
      expect(content).toContain('lockPath');
    });

    it('should make hook file executable', async () => {
      await installer.install('test-pipeline', 'post-commit');

      const hookPath = path.join(gitHooksDir, 'post-commit');
      const stats = await fs.stat(hookPath);
      // Check if owner can execute (0o100 = owner execute bit)
      expect(stats.mode & 0o100).toBeTruthy();
    });

    it('should use nohup for background execution', async () => {
      await installer.install('test-pipeline', 'post-commit');

      const hookPath = path.join(gitHooksDir, 'post-commit');
      const content = await fs.readFile(hookPath, 'utf-8');
      expect(content).toContain('nohup');
      expect(content).toContain('.agent-pipeline/logs');
      expect(content).toContain('>> "$logPath" 2>&1 &');
    });

    it('should include user notification message', async () => {
      await installer.install('test-pipeline', 'post-commit');

      const hookPath = path.join(gitHooksDir, 'post-commit');
      const content = await fs.readFile(hookPath, 'utf-8');
      expect(content).toContain('echo');
      expect(content).toContain('Agent Pipeline running in background');
    });
  });

  describe('Install - Pre-Commit Hook', () => {
    it('should create pre-commit hook file', async () => {
      await installer.install('validation-pipeline', 'pre-commit');

      const hookPath = path.join(gitHooksDir, 'pre-commit');
      const exists = await fs.stat(hookPath).then(() => true, () => false);
      expect(exists).toBe(true);
    });

    it('should include correct hook marker for pre-commit', async () => {
      await installer.install('validation-pipeline', 'pre-commit');

      const hookPath = path.join(gitHooksDir, 'pre-commit');
      const content = await fs.readFile(hookPath, 'utf-8');
      expect(content).toContain('# Agent Pipeline (pre-commit): validation-pipeline');
    });

    it('should make pre-commit hook executable', async () => {
      await installer.install('validation-pipeline', 'pre-commit');

      const hookPath = path.join(gitHooksDir, 'pre-commit');
      const stats = await fs.stat(hookPath);
      expect(stats.mode & 0o100).toBeTruthy();
    });
  });

  describe('Install - Pre-Push Hook', () => {
    it('should create pre-push hook file', async () => {
      await installer.install('deploy-check', 'pre-push');

      const hookPath = path.join(gitHooksDir, 'pre-push');
      const exists = await fs.stat(hookPath).then(() => true, () => false);
      expect(exists).toBe(true);
    });

    it('should include correct hook marker for pre-push', async () => {
      await installer.install('deploy-check', 'pre-push');

      const hookPath = path.join(gitHooksDir, 'pre-push');
      const content = await fs.readFile(hookPath, 'utf-8');
      expect(content).toContain('# Agent Pipeline (pre-push): deploy-check');
    });
  });

  describe('Install - Post-Merge Hook', () => {
    it('should create post-merge hook file', async () => {
      await installer.install('cleanup-pipeline', 'post-merge');

      const hookPath = path.join(gitHooksDir, 'post-merge');
      const exists = await fs.stat(hookPath).then(() => true, () => false);
      expect(exists).toBe(true);
    });

    it('should include correct hook marker for post-merge', async () => {
      await installer.install('cleanup-pipeline', 'post-merge');

      const hookPath = path.join(gitHooksDir, 'post-merge');
      const content = await fs.readFile(hookPath, 'utf-8');
      expect(content).toContain('# Agent Pipeline (post-merge): cleanup-pipeline');
    });

    it('should make post-merge hook executable', async () => {
      await installer.install('cleanup-pipeline', 'post-merge');

      const hookPath = path.join(gitHooksDir, 'post-merge');
      const stats = await fs.stat(hookPath);
      expect(stats.mode & 0o100).toBeTruthy();
    });
  });

  describe('Install - Appending to Existing Hooks', () => {
    it('should append to existing hook without overwriting', async () => {
      const hookPath = path.join(gitHooksDir, 'post-commit');
      const existingContent = '#!/bin/bash\n\n# Existing hook\necho "Existing hook runs first"\n';
      await fs.writeFile(hookPath, existingContent, 'utf-8');

      await installer.install('test-pipeline', 'post-commit');

      const content = await fs.readFile(hookPath, 'utf-8');
      expect(content).toContain('# Existing hook');
      expect(content).toContain('echo "Existing hook runs first"');
      expect(content).toContain('# Agent Pipeline (post-commit): test-pipeline');
    });

    it('should preserve existing hook permissions', async () => {
      const hookPath = path.join(gitHooksDir, 'post-commit');
      const existingContent = '#!/bin/bash\necho "test"\n';
      await fs.writeFile(hookPath, existingContent, 'utf-8');
      await fs.chmod(hookPath, 0o755);

      await installer.install('test-pipeline', 'post-commit');

      const stats = await fs.stat(hookPath);
      expect(stats.mode & 0o100).toBeTruthy();
    });

    it('should maintain proper spacing between hooks', async () => {
      const hookPath = path.join(gitHooksDir, 'post-commit');
      const existingContent = '#!/bin/bash\necho "existing"\n';
      await fs.writeFile(hookPath, existingContent, 'utf-8');

      await installer.install('test-pipeline', 'post-commit');

      const content = await fs.readFile(hookPath, 'utf-8');
      // Should have blank lines separating sections
      expect(content).toContain('\n\n# Agent Pipeline');
    });
  });

  describe('Install - Idempotency', () => {
    it('should detect already installed pipeline', async () => {
      await installer.install('test-pipeline', 'post-commit');

      // Install again
      await installer.install('test-pipeline', 'post-commit');

      const hookPath = path.join(gitHooksDir, 'post-commit');
      const content = await fs.readFile(hookPath, 'utf-8');

      // Should only have one instance of the marker
      const matches = content.match(/# Agent Pipeline \(post-commit\): test-pipeline/g);
      expect(matches).toHaveLength(1);
    });

    it('should allow multiple pipelines on same hook type', async () => {
      await installer.install('pipeline-1', 'post-commit');
      await installer.install('pipeline-2', 'post-commit');

      const hookPath = path.join(gitHooksDir, 'post-commit');
      const content = await fs.readFile(hookPath, 'utf-8');

      expect(content).toContain('# Agent Pipeline (post-commit): pipeline-1');
      expect(content).toContain('# Agent Pipeline (post-commit): pipeline-2');
    });

    it('should allow same pipeline on different hook types', async () => {
      await installer.install('multi-hook-pipeline', 'pre-commit');
      await installer.install('multi-hook-pipeline', 'post-commit');

      const preCommitPath = path.join(gitHooksDir, 'pre-commit');
      const postCommitPath = path.join(gitHooksDir, 'post-commit');

      const preCommitContent = await fs.readFile(preCommitPath, 'utf-8');
      const postCommitContent = await fs.readFile(postCommitPath, 'utf-8');

      expect(preCommitContent).toContain('# Agent Pipeline (pre-commit): multi-hook-pipeline');
      expect(postCommitContent).toContain('# Agent Pipeline (post-commit): multi-hook-pipeline');
    });
  });

  describe('Uninstall - Single Hook Type', () => {
    it('should remove hook file if only agent-pipeline content', async () => {
      await installer.install('test-pipeline', 'post-commit');
      await installer.uninstall('post-commit');

      const hookPath = path.join(gitHooksDir, 'post-commit');
      const exists = await fs.stat(hookPath).then(() => true, () => false);
      expect(exists).toBe(false);
    });

    it('should preserve other hooks when removing agent-pipeline section', async () => {
      const hookPath = path.join(gitHooksDir, 'post-commit');
      const existingContent = '#!/bin/bash\n\n# Other hook\necho "Keep this"\n';
      await fs.writeFile(hookPath, existingContent, 'utf-8');
      await installer.install('test-pipeline', 'post-commit');

      await installer.uninstall('post-commit');

      const content = await fs.readFile(hookPath, 'utf-8');
      expect(content).toContain('# Other hook');
      expect(content).toContain('echo "Keep this"');
      expect(content).not.toContain('# Agent Pipeline');
    });

    it('should handle non-existent hooks gracefully', async () => {
      // Should not throw error
      await expect(installer.uninstall('post-commit')).resolves.not.toThrow();
    });
  });

  describe('Uninstall - All Hook Types', () => {
    it('should remove agent-pipeline from all hook types', async () => {
      await installer.install('pipeline-1', 'pre-commit');
      await installer.install('pipeline-2', 'post-commit');
      await installer.install('pipeline-3', 'post-merge');

      await installer.uninstall();

      const preCommitPath = path.join(gitHooksDir, 'pre-commit');
      const postCommitPath = path.join(gitHooksDir, 'post-commit');
      const postMergePath = path.join(gitHooksDir, 'post-merge');

      const preExists = await fs.stat(preCommitPath).then(() => true, () => false);
      const postExists = await fs.stat(postCommitPath).then(() => true, () => false);
      const mergeExists = await fs.stat(postMergePath).then(() => true, () => false);

      expect(preExists).toBe(false);
      expect(postExists).toBe(false);
      expect(mergeExists).toBe(false);
    });

    it('should handle mix of existing and non-existing hooks', async () => {
      await installer.install('test-pipeline', 'post-commit');
      // Don't install pre-commit

      // Should not throw error
      await expect(installer.uninstall()).resolves.not.toThrow();

      const postCommitPath = path.join(gitHooksDir, 'post-commit');
      const exists = await fs.stat(postCommitPath).then(() => true, () => false);
      expect(exists).toBe(false);
    });

    it('should preserve non-agent-pipeline hooks across all types', async () => {
      const preCommitPath = path.join(gitHooksDir, 'pre-commit');
      const postCommitPath = path.join(gitHooksDir, 'post-commit');

      await fs.writeFile(preCommitPath, '#!/bin/bash\necho "Keep pre"\n', 'utf-8');
      await fs.writeFile(postCommitPath, '#!/bin/bash\necho "Keep post"\n', 'utf-8');

      await installer.install('test-1', 'pre-commit');
      await installer.install('test-2', 'post-commit');

      await installer.uninstall();

      const preContent = await fs.readFile(preCommitPath, 'utf-8');
      const postContent = await fs.readFile(postCommitPath, 'utf-8');

      expect(preContent).toContain('echo "Keep pre"');
      expect(preContent).not.toContain('# Agent Pipeline');
      expect(postContent).toContain('echo "Keep post"');
      expect(postContent).not.toContain('# Agent Pipeline');
    });
  });

  describe('Edge Cases', () => {
    it('should handle hook with only shebang', async () => {
      const hookPath = path.join(gitHooksDir, 'post-commit');
      await fs.writeFile(hookPath, '#!/bin/bash\n', 'utf-8');

      await installer.install('test-pipeline', 'post-commit');

      const content = await fs.readFile(hookPath, 'utf-8');
      expect(content).toContain('#!/bin/bash');
      expect(content).toContain('# Agent Pipeline');
    });

    it('should handle hook with trailing whitespace', async () => {
      const hookPath = path.join(gitHooksDir, 'post-commit');
      await fs.writeFile(hookPath, '#!/bin/bash\n\necho "test"   \n\n', 'utf-8');

      await installer.install('test-pipeline', 'post-commit');

      const content = await fs.readFile(hookPath, 'utf-8');
      expect(content).toContain('echo "test"');
      expect(content).toContain('# Agent Pipeline');
    });

    it('should handle uninstall when hook contains only whitespace', async () => {
      await installer.install('test-pipeline', 'post-commit');

      // Uninstall should remove the file
      await installer.uninstall('post-commit');

      const hookPath = path.join(gitHooksDir, 'post-commit');
      const exists = await fs.stat(hookPath).then(() => true, () => false);
      expect(exists).toBe(false);
    });

    it('should handle multiple agent-pipeline sections in same hook', async () => {
      await installer.install('pipeline-1', 'post-commit');
      await installer.install('pipeline-2', 'post-commit');

      await installer.uninstall('post-commit');

      const hookPath = path.join(gitHooksDir, 'post-commit');
      const exists = await fs.stat(hookPath).then(() => true, () => false);
      expect(exists).toBe(false);
    });
  });

  describe('Console Output', () => {
    it('should log success message with hook type on install', async () => {
      const consoleSpy = vi.spyOn(console, 'log');

      await installer.install('test-pipeline', 'post-commit');

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('post-commit hook installed'));

      consoleSpy.mockRestore();
    });

    it('should log warning when pipeline already installed', async () => {
      const consoleSpy = vi.spyOn(console, 'log');

      await installer.install('test-pipeline', 'post-commit');
      await installer.install('test-pipeline', 'post-commit');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('already installed for test-pipeline on post-commit')
      );

      consoleSpy.mockRestore();
    });

    it('should log info message when no hooks to uninstall', async () => {
      const consoleSpy = vi.spyOn(console, 'log');

      await installer.uninstall();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('No Agent Pipeline hooks found to uninstall')
      );

      consoleSpy.mockRestore();
    });
  });
});
