import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initCommand } from '../../../cli/commands/init.js';
import { createTempDir, cleanupTempDir } from '../../setup.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as YAML from 'yaml';

describe('initCommand', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir('init-command-test-');
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('Directory Creation', () => {
    it('should create .agent-pipeline/pipelines directory', async () => {
      await initCommand(tempDir);

      const pipelinesDir = path.join(tempDir, '.agent-pipeline', 'pipelines');
      const exists = await fs.stat(pipelinesDir).then(() => true, () => false);
      expect(exists).toBe(true);
    });

    it('should create .claude/agents directory', async () => {
      await initCommand(tempDir);

      const agentsDir = path.join(tempDir, '.claude', 'agents');
      const exists = await fs.stat(agentsDir).then(() => true, () => false);
      expect(exists).toBe(true);
    });

    it('should handle existing directories gracefully', async () => {
      // Pre-create directories
      const pipelinesDir = path.join(tempDir, '.agent-pipeline', 'pipelines');
      const agentsDir = path.join(tempDir, '.claude', 'agents');
      await fs.mkdir(pipelinesDir, { recursive: true });
      await fs.mkdir(agentsDir, { recursive: true });

      // Should not throw error
      await expect(initCommand(tempDir)).resolves.not.toThrow();

      // Directories should still exist
      expect(await fs.stat(pipelinesDir).then(() => true, () => false)).toBe(true);
      expect(await fs.stat(agentsDir).then(() => true, () => false)).toBe(true);
    });

    it('should handle nested directory creation', async () => {
      await initCommand(tempDir);

      // Check both nested directories exist
      const pipelinesDir = path.join(tempDir, '.agent-pipeline', 'pipelines');
      const agentsDir = path.join(tempDir, '.claude', 'agents');

      const pipelinesStats = await fs.stat(pipelinesDir);
      const agentsStats = await fs.stat(agentsDir);

      expect(pipelinesStats.isDirectory()).toBe(true);
      expect(agentsStats.isDirectory()).toBe(true);
    });
  });

  describe('Example Pipeline Creation', () => {
    it('should create example-pipeline.yml file', async () => {
      await initCommand(tempDir);

      const pipelinePath = path.join(tempDir, '.agent-pipeline', 'pipelines', 'example-pipeline.yml');
      const exists = await fs.stat(pipelinePath).then(() => true, () => false);
      expect(exists).toBe(true);
    });

    it('should create valid YAML in example pipeline', async () => {
      await initCommand(tempDir);

      const pipelinePath = path.join(tempDir, '.agent-pipeline', 'pipelines', 'example-pipeline.yml');
      const content = await fs.readFile(pipelinePath, 'utf-8');

      // Should parse without error
      const parsed = YAML.parse(content);
      expect(parsed).toBeDefined();
    });

    it('should include required pipeline fields', async () => {
      await initCommand(tempDir);

      const pipelinePath = path.join(tempDir, '.agent-pipeline', 'pipelines', 'example-pipeline.yml');
      const content = await fs.readFile(pipelinePath, 'utf-8');
      const parsed = YAML.parse(content);

      expect(parsed.name).toBe('example-pipeline');
      expect(parsed.trigger).toBe('manual');
      expect(parsed.agents).toBeDefined();
      expect(parsed.agents).toHaveLength(2);
    });

    it('should include settings in example pipeline', async () => {
      await initCommand(tempDir);

      const pipelinePath = path.join(tempDir, '.agent-pipeline', 'pipelines', 'example-pipeline.yml');
      const content = await fs.readFile(pipelinePath, 'utf-8');
      const parsed = YAML.parse(content);

      expect(parsed.settings).toBeDefined();
      expect(parsed.settings.autoCommit).toBe(true);
      expect(parsed.settings.commitPrefix).toBe('[pipeline:{{stage}}]');
      expect(parsed.settings.failureStrategy).toBe('stop');
      expect(parsed.settings.preserveWorkingTree).toBe(false);
    });

    it('should include code-review agent configuration', async () => {
      await initCommand(tempDir);

      const pipelinePath = path.join(tempDir, '.agent-pipeline', 'pipelines', 'example-pipeline.yml');
      const content = await fs.readFile(pipelinePath, 'utf-8');
      const parsed = YAML.parse(content);

      const codeReviewAgent = parsed.agents.find((a: any) => a.name === 'code-review');
      expect(codeReviewAgent).toBeDefined();
      expect(codeReviewAgent.agent).toBe('.claude/agents/code-reviewer.md');
      expect(codeReviewAgent.timeout).toBe(120);
      expect(codeReviewAgent.outputs).toEqual(['issues_found', 'severity_level']);
    });

    it('should include doc-updater agent configuration', async () => {
      await initCommand(tempDir);

      const pipelinePath = path.join(tempDir, '.agent-pipeline', 'pipelines', 'example-pipeline.yml');
      const content = await fs.readFile(pipelinePath, 'utf-8');
      const parsed = YAML.parse(content);

      const docUpdaterAgent = parsed.agents.find((a: any) => a.name === 'doc-updater');
      expect(docUpdaterAgent).toBeDefined();
      expect(docUpdaterAgent.agent).toBe('.claude/agents/doc-updater.md');
      expect(docUpdaterAgent.onFail).toBe('continue');
    });
  });

  describe('Example Agent Creation', () => {
    it('should create code-reviewer.md file', async () => {
      await initCommand(tempDir);

      const agentPath = path.join(tempDir, '.claude', 'agents', 'code-reviewer.md');
      const exists = await fs.stat(agentPath).then(() => true, () => false);
      expect(exists).toBe(true);
    });

    it('should create doc-updater.md file', async () => {
      await initCommand(tempDir);

      const agentPath = path.join(tempDir, '.claude', 'agents', 'doc-updater.md');
      const exists = await fs.stat(agentPath).then(() => true, () => false);
      expect(exists).toBe(true);
    });

    it('should include valid markdown in code-reviewer agent', async () => {
      await initCommand(tempDir);

      const agentPath = path.join(tempDir, '.claude', 'agents', 'code-reviewer.md');
      const content = await fs.readFile(agentPath, 'utf-8');

      expect(content).toContain('# Code Review Agent');
      expect(content).toContain('## Your Task');
      expect(content).toContain('## Output Format');
      expect(content).toContain('## Context');
    });

    it('should include task description in code-reviewer agent', async () => {
      await initCommand(tempDir);

      const agentPath = path.join(tempDir, '.claude', 'agents', 'code-reviewer.md');
      const content = await fs.readFile(agentPath, 'utf-8');

      expect(content).toContain('Code Quality');
      expect(content).toContain('Potential Bugs');
      expect(content).toContain('Security');
      expect(content).toContain('Performance');
    });

    it('should include output format in code-reviewer agent', async () => {
      await initCommand(tempDir);

      const agentPath = path.join(tempDir, '.claude', 'agents', 'code-reviewer.md');
      const content = await fs.readFile(agentPath, 'utf-8');

      expect(content).toContain('issues_found:');
      expect(content).toContain('severity_level:');
      expect(content).toContain('### Findings:');
      expect(content).toContain('### Recommendations:');
    });

    it('should include valid markdown in doc-updater agent', async () => {
      await initCommand(tempDir);

      const agentPath = path.join(tempDir, '.claude', 'agents', 'doc-updater.md');
      const content = await fs.readFile(agentPath, 'utf-8');

      expect(content).toContain('# Documentation Updater Agent');
      expect(content).toContain('## Your Task');
      expect(content).toContain('## Output Format');
      expect(content).toContain('## Guidelines');
    });

    it('should include task description in doc-updater agent', async () => {
      await initCommand(tempDir);

      const agentPath = path.join(tempDir, '.claude', 'agents', 'doc-updater.md');
      const content = await fs.readFile(agentPath, 'utf-8');

      expect(content).toContain('README Updates');
      expect(content).toContain('Code Comments');
      expect(content).toContain('API Documentation');
      expect(content).toContain('Changelog');
    });

    it('should include guidelines in doc-updater agent', async () => {
      await initCommand(tempDir);

      const agentPath = path.join(tempDir, '.claude', 'agents', 'doc-updater.md');
      const content = await fs.readFile(agentPath, 'utf-8');

      expect(content).toContain('Be concise but comprehensive');
      expect(content).toContain('Follow existing documentation style');
      expect(content).toContain('Focus on user-facing changes');
      expect(content).toContain('Update examples if needed');
    });
  });

  describe('Gitignore Management', () => {
    it('should create .gitignore if it does not exist', async () => {
      await initCommand(tempDir);

      const gitignorePath = path.join(tempDir, '.gitignore');
      const exists = await fs.stat(gitignorePath).then(() => true, () => false);
      expect(exists).toBe(true);
    });

    it('should add .agent-pipeline/state/ to new .gitignore', async () => {
      await initCommand(tempDir);

      const gitignorePath = path.join(tempDir, '.gitignore');
      const content = await fs.readFile(gitignorePath, 'utf-8');

      expect(content).toContain('# Agent Pipeline');
      expect(content).toContain('.agent-pipeline/state/');
    });

    it('should append to existing .gitignore', async () => {
      const gitignorePath = path.join(tempDir, '.gitignore');
      const existingContent = '# Existing content\nnode_modules/\n';
      await fs.writeFile(gitignorePath, existingContent, 'utf-8');

      await initCommand(tempDir);

      const content = await fs.readFile(gitignorePath, 'utf-8');
      expect(content).toContain('# Existing content');
      expect(content).toContain('node_modules/');
      expect(content).toContain('# Agent Pipeline');
      expect(content).toContain('.agent-pipeline/state/');
    });

    it('should not duplicate .agent-pipeline/state/ entry', async () => {
      const gitignorePath = path.join(tempDir, '.gitignore');
      const existingContent = '# Existing\nnode_modules/\n.agent-pipeline/state/\n';
      await fs.writeFile(gitignorePath, existingContent, 'utf-8');

      await initCommand(tempDir);

      const content = await fs.readFile(gitignorePath, 'utf-8');
      const matches = content.match(/\.agent-pipeline\/state\//g);
      expect(matches).toHaveLength(1);
    });

    it('should preserve existing gitignore format', async () => {
      const gitignorePath = path.join(tempDir, '.gitignore');
      const existingContent = '# Comments\n*.log\n!important.log\n\n# Section\ndist/\n';
      await fs.writeFile(gitignorePath, existingContent, 'utf-8');

      await initCommand(tempDir);

      const content = await fs.readFile(gitignorePath, 'utf-8');
      expect(content).toContain('# Comments');
      expect(content).toContain('*.log');
      expect(content).toContain('!important.log');
      expect(content).toContain('# Section');
      expect(content).toContain('dist/');
    });

    it('should handle empty existing .gitignore', async () => {
      const gitignorePath = path.join(tempDir, '.gitignore');
      await fs.writeFile(gitignorePath, '', 'utf-8');

      await initCommand(tempDir);

      const content = await fs.readFile(gitignorePath, 'utf-8');
      expect(content).toContain('# Agent Pipeline');
      expect(content).toContain('.agent-pipeline/state/');
    });
  });

  describe('Console Output', () => {
    it('should log initialization message', async () => {
      await initCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('🚀 Initializing Agent Pipeline'));
    });

    it('should log directory creation confirmation', async () => {
      await initCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✅ Created directory structure'));
    });

    it('should log pipeline creation confirmation', async () => {
      await initCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✅ Created example pipeline'));
    });

    it('should log agent creation confirmation', async () => {
      await initCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✅ Created example agents'));
    });

    it('should log success message', async () => {
      await initCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✨ Agent Pipeline initialized successfully'));
    });

    it('should log next steps', async () => {
      await initCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Next steps:'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('agent-pipeline run example-pipeline'));
    });

    it('should log gitignore update when modified', async () => {
      await initCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✅ Updated .gitignore'));
    });
  });

  describe('Error Handling', () => {
    it('should throw error on invalid path', async () => {
      // Use a path that will fail (contains null byte)
      const invalidPath = '/tmp/test\0invalid';

      await expect(initCommand(invalidPath)).rejects.toThrow();
    });

    it('should log error message on failure', async () => {
      // Use a path that will fail (contains null byte)
      const invalidPath = '/tmp/test\0invalid';

      await expect(initCommand(invalidPath)).rejects.toThrow();

      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('❌ Failed to initialize Agent Pipeline'));
    });

    it('should throw error when writing to read-only directory', async () => {
      // Create a directory and make it read-only
      const readOnlyDir = path.join(tempDir, 'readonly');
      await fs.mkdir(readOnlyDir, { recursive: true });
      await fs.chmod(readOnlyDir, 0o444);

      try {
        await expect(initCommand(readOnlyDir)).rejects.toThrow();
      } finally {
        // Cleanup: restore permissions
        await fs.chmod(readOnlyDir, 0o755);
      }
    });

    it('should handle missing parent directory gracefully', async () => {
      const nonExistentParent = path.join(tempDir, 'does-not-exist', 'subdir');

      // Should create parent directories recursively
      await initCommand(nonExistentParent);

      const pipelinesDir = path.join(nonExistentParent, '.agent-pipeline', 'pipelines');
      expect(await fs.stat(pipelinesDir).then(() => true, () => false)).toBe(true);
    });

    it('should handle gitignore in non-existent directory gracefully', async () => {
      // Create a fresh temp directory that exists
      const freshDir = path.join(tempDir, 'fresh');
      await fs.mkdir(freshDir, { recursive: true });

      // Should succeed and create .gitignore
      await initCommand(freshDir);

      const gitignorePath = path.join(freshDir, '.gitignore');
      const content = await fs.readFile(gitignorePath, 'utf-8');
      expect(content).toContain('.agent-pipeline/state/');
    });
  });

  describe('Integration', () => {
    it('should create complete project structure in one command', async () => {
      await initCommand(tempDir);

      // Verify all directories
      const pipelinesDir = path.join(tempDir, '.agent-pipeline', 'pipelines');
      const agentsDir = path.join(tempDir, '.claude', 'agents');
      expect(await fs.stat(pipelinesDir).then(() => true, () => false)).toBe(true);
      expect(await fs.stat(agentsDir).then(() => true, () => false)).toBe(true);

      // Verify all files
      const pipelinePath = path.join(pipelinesDir, 'example-pipeline.yml');
      const codeReviewerPath = path.join(agentsDir, 'code-reviewer.md');
      const docUpdaterPath = path.join(agentsDir, 'doc-updater.md');
      const gitignorePath = path.join(tempDir, '.gitignore');

      expect(await fs.stat(pipelinePath).then(() => true, () => false)).toBe(true);
      expect(await fs.stat(codeReviewerPath).then(() => true, () => false)).toBe(true);
      expect(await fs.stat(docUpdaterPath).then(() => true, () => false)).toBe(true);
      expect(await fs.stat(gitignorePath).then(() => true, () => false)).toBe(true);
    });

    it('should create valid pipeline configuration readable by system', async () => {
      await initCommand(tempDir);

      const pipelinePath = path.join(tempDir, '.agent-pipeline', 'pipelines', 'example-pipeline.yml');
      const content = await fs.readFile(pipelinePath, 'utf-8');
      const parsed = YAML.parse(content);

      // Verify it's a valid pipeline config structure
      expect(parsed.name).toBeDefined();
      expect(parsed.trigger).toBeDefined();
      expect(parsed.agents).toBeDefined();
      expect(Array.isArray(parsed.agents)).toBe(true);
      expect(parsed.settings).toBeDefined();
    });

    it('should be idempotent (safe to run multiple times)', async () => {
      // Run init twice
      await initCommand(tempDir);
      await initCommand(tempDir);

      // Verify files still exist and have correct content
      const pipelinePath = path.join(tempDir, '.agent-pipeline', 'pipelines', 'example-pipeline.yml');
      const content = await fs.readFile(pipelinePath, 'utf-8');
      const parsed = YAML.parse(content);

      expect(parsed.name).toBe('example-pipeline');
      expect(parsed.agents).toHaveLength(2);
    });

    it('should create files with correct encoding', async () => {
      await initCommand(tempDir);

      const pipelinePath = path.join(tempDir, '.agent-pipeline', 'pipelines', 'example-pipeline.yml');
      const buffer = await fs.readFile(pipelinePath);

      // Should be readable as UTF-8
      const content = buffer.toString('utf-8');
      expect(content).toContain('example-pipeline');
    });

    it('should create agents with proper markdown structure', async () => {
      await initCommand(tempDir);

      const codeReviewerPath = path.join(tempDir, '.claude', 'agents', 'code-reviewer.md');
      const docUpdaterPath = path.join(tempDir, '.claude', 'agents', 'doc-updater.md');

      const codeReviewerContent = await fs.readFile(codeReviewerPath, 'utf-8');
      const docUpdaterContent = await fs.readFile(docUpdaterPath, 'utf-8');

      // Check markdown headers
      expect(codeReviewerContent).toMatch(/^# /m);
      expect(codeReviewerContent).toMatch(/^## /m);
      expect(docUpdaterContent).toMatch(/^# /m);
      expect(docUpdaterContent).toMatch(/^## /m);
    });
  });
});
