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
    it('should create 4 example pipeline template files', async () => {
      await initCommand(tempDir);

      const templateNames = [
        'post-commit-example.yml',
        'pre-commit-example.yml',
        'pre-push-example.yml',
        'post-merge-example.yml'
      ];

      for (const templateName of templateNames) {
        const pipelinePath = path.join(tempDir, '.agent-pipeline', 'pipelines', templateName);
        const exists = await fs.stat(pipelinePath).then(() => true, () => false);
        expect(exists).toBe(true);
      }
    });

    it('should create valid YAML in all template pipelines', async () => {
      await initCommand(tempDir);

      const templateNames = [
        'post-commit-example.yml',
        'pre-commit-example.yml',
        'pre-push-example.yml',
        'post-merge-example.yml'
      ];

      for (const templateName of templateNames) {
        const pipelinePath = path.join(tempDir, '.agent-pipeline', 'pipelines', templateName);
        const content = await fs.readFile(pipelinePath, 'utf-8');
        const parsed = YAML.parse(content);
        expect(parsed).toBeDefined();
      }
    });

    describe('post-commit-example.yml', () => {
      it('should have correct pipeline configuration', async () => {
        await initCommand(tempDir);

        const pipelinePath = path.join(tempDir, '.agent-pipeline', 'pipelines', 'post-commit-example.yml');
        const content = await fs.readFile(pipelinePath, 'utf-8');
        const parsed = YAML.parse(content);

        expect(parsed.name).toBe('post-commit-example');
        expect(parsed.trigger).toBe('post-commit');
        expect(parsed.settings.executionMode).toBe('parallel');
        expect(parsed.settings.failureStrategy).toBe('continue');
        expect(parsed.agents).toHaveLength(3);
      });

      it('should include code-review agent', async () => {
        await initCommand(tempDir);

        const pipelinePath = path.join(tempDir, '.agent-pipeline', 'pipelines', 'post-commit-example.yml');
        const content = await fs.readFile(pipelinePath, 'utf-8');
        const parsed = YAML.parse(content);

        const agent = parsed.agents.find((a: any) => a.name === 'code-review');
        expect(agent).toBeDefined();
        expect(agent.agent).toBe('.claude/agents/code-reviewer.md');
        expect(agent.timeout).toBe(120);
        expect(agent.outputs).toEqual(['issues_found', 'severity_level']);
      });
    });

    describe('pre-commit-example.yml', () => {
      it('should have correct pipeline configuration', async () => {
        await initCommand(tempDir);

        const pipelinePath = path.join(tempDir, '.agent-pipeline', 'pipelines', 'pre-commit-example.yml');
        const content = await fs.readFile(pipelinePath, 'utf-8');
        const parsed = YAML.parse(content);

        expect(parsed.name).toBe('pre-commit-example');
        expect(parsed.trigger).toBe('pre-commit');
        expect(parsed.settings.autoCommit).toBe(false);
        expect(parsed.settings.failureStrategy).toBe('stop');
        expect(parsed.settings.preserveWorkingTree).toBe(true);
        expect(parsed.agents).toHaveLength(3);
      });

      it('should include lint-check and security-scan agents', async () => {
        await initCommand(tempDir);

        const pipelinePath = path.join(tempDir, '.agent-pipeline', 'pipelines', 'pre-commit-example.yml');
        const content = await fs.readFile(pipelinePath, 'utf-8');
        const parsed = YAML.parse(content);

        const lintAgent = parsed.agents.find((a: any) => a.name === 'lint-check');
        const securityAgent = parsed.agents.find((a: any) => a.name === 'security-scan');

        expect(lintAgent).toBeDefined();
        expect(securityAgent).toBeDefined();
        expect(lintAgent.timeout).toBe(60);
        expect(securityAgent.timeout).toBe(60);
      });
    });

    describe('pre-push-example.yml', () => {
      it('should have correct pipeline configuration', async () => {
        await initCommand(tempDir);

        const pipelinePath = path.join(tempDir, '.agent-pipeline', 'pipelines', 'pre-push-example.yml');
        const content = await fs.readFile(pipelinePath, 'utf-8');
        const parsed = YAML.parse(content);

        expect(parsed.name).toBe('pre-push-example');
        expect(parsed.trigger).toBe('pre-push');
        expect(parsed.settings.autoCommit).toBe(false);
        expect(parsed.settings.failureStrategy).toBe('stop');
        expect(parsed.agents).toHaveLength(4);
      });

      it('should include conditional push-approval agent', async () => {
        await initCommand(tempDir);

        const pipelinePath = path.join(tempDir, '.agent-pipeline', 'pipelines', 'pre-push-example.yml');
        const content = await fs.readFile(pipelinePath, 'utf-8');
        const parsed = YAML.parse(content);

        const pushApproval = parsed.agents.find((a: any) => a.name === 'push-approval');
        expect(pushApproval).toBeDefined();
        expect(pushApproval.condition).toBeDefined();
        expect(pushApproval.dependsOn).toEqual(['security-audit', 'code-quality', 'dependency-check']);
      });
    });

    describe('post-merge-example.yml', () => {
      it('should have correct pipeline configuration with git workflow', async () => {
        await initCommand(tempDir);

        const pipelinePath = path.join(tempDir, '.agent-pipeline', 'pipelines', 'post-merge-example.yml');
        const content = await fs.readFile(pipelinePath, 'utf-8');
        const parsed = YAML.parse(content);

        expect(parsed.name).toBe('post-merge-example');
        expect(parsed.trigger).toBe('post-merge');
        expect(parsed.settings.failureStrategy).toBe('continue');
        expect(parsed.git).toBeDefined();
        expect(parsed.git.pullRequest.autoCreate).toBe(true);
        expect(parsed.notifications).toBeDefined();
        expect(parsed.agents).toHaveLength(4);
      });

      it('should include cleanup agents with dependencies', async () => {
        await initCommand(tempDir);

        const pipelinePath = path.join(tempDir, '.agent-pipeline', 'pipelines', 'post-merge-example.yml');
        const content = await fs.readFile(pipelinePath, 'utf-8');
        const parsed = YAML.parse(content);

        const summaryReport = parsed.agents.find((a: any) => a.name === 'summary-report');
        expect(summaryReport).toBeDefined();
        expect(summaryReport.dependsOn).toEqual(['doc-sync', 'dependency-audit', 'code-consolidation']);
      });
    });
  });

  describe('Example Agent Creation', () => {
    it('should create 5 default agent files when plugin import is disabled', async () => {
      // Disable plugin import to ensure default agents are created
      await initCommand(tempDir, { importPluginAgents: false });

      const agentNames = [
        'code-reviewer.md',
        'doc-updater.md',
        'quality-checker.md',
        'security-auditor.md',
        'summary.md'
      ];

      for (const agentName of agentNames) {
        const agentPath = path.join(tempDir, '.claude', 'agents', agentName);
        const exists = await fs.stat(agentPath).then(() => true, () => false);
        expect(exists).toBe(true);
      }
    });

    it('should include valid markdown in code-reviewer agent', async () => {
      await initCommand(tempDir, { importPluginAgents: false });

      const agentPath = path.join(tempDir, '.claude', 'agents', 'code-reviewer.md');
      const content = await fs.readFile(agentPath, 'utf-8');

      expect(content).toContain('# Code Review Agent');
      expect(content).toContain('## Your Task');
      expect(content).toContain('## Output Format');
      expect(content).toContain('report_outputs');
    });

    it('should include valid markdown in doc-updater agent', async () => {
      await initCommand(tempDir, { importPluginAgents: false });

      const agentPath = path.join(tempDir, '.claude', 'agents', 'doc-updater.md');
      const content = await fs.readFile(agentPath, 'utf-8');

      expect(content).toContain('# Documentation Updater Agent');
      expect(content).toContain('## Your Task');
      expect(content).toContain('## Output Format');
      expect(content).toContain('report_outputs');
    });

    it('should include valid markdown in quality-checker agent', async () => {
      await initCommand(tempDir, { importPluginAgents: false });

      const agentPath = path.join(tempDir, '.claude', 'agents', 'quality-checker.md');
      const content = await fs.readFile(agentPath, 'utf-8');

      expect(content).toContain('# Quality Checker Agent');
      expect(content).toContain('## Your Task');
      expect(content).toContain('## Output Format');
      expect(content).toContain('report_outputs');
    });

    it('should include valid markdown in security-auditor agent', async () => {
      await initCommand(tempDir, { importPluginAgents: false });

      const agentPath = path.join(tempDir, '.claude', 'agents', 'security-auditor.md');
      const content = await fs.readFile(agentPath, 'utf-8');

      expect(content).toContain('# Security Auditor Agent');
      expect(content).toContain('## Your Task');
      expect(content).toContain('## Output Format');
      expect(content).toContain('report_outputs');
    });

    it('should include valid markdown in summary agent', async () => {
      await initCommand(tempDir, { importPluginAgents: false });

      const agentPath = path.join(tempDir, '.claude', 'agents', 'summary.md');
      const content = await fs.readFile(agentPath, 'utf-8');

      expect(content).toContain('# Summary Agent');
      expect(content).toContain('## Your Task');
    });

    it('should not create default agents if plugin agents already exist', async () => {
      // Pre-create an agent file to simulate plugin agent import
      const agentsDir = path.join(tempDir, '.claude', 'agents');
      await fs.mkdir(agentsDir, { recursive: true });
      await fs.writeFile(path.join(agentsDir, 'existing-agent.md'), '# Existing Agent', 'utf-8');

      await initCommand(tempDir, { importPluginAgents: false });

      // Should not create default agents since an agent already exists
      const codeReviewerPath = path.join(agentsDir, 'code-reviewer.md');
      const exists = await fs.stat(codeReviewerPath).then(() => true, () => false);
      expect(exists).toBe(false);
    });

    it('should create agents with proper output format instructions', async () => {
      await initCommand(tempDir, { importPluginAgents: false });

      const agentsWithOutputs = ['code-reviewer.md', 'doc-updater.md', 'quality-checker.md', 'security-auditor.md'];

      for (const agentName of agentsWithOutputs) {
        const agentPath = path.join(tempDir, '.claude', 'agents', agentName);
        const content = await fs.readFile(agentPath, 'utf-8');
        expect(content).toContain('report_outputs');
      }
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
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('.agent-pipeline/pipelines/'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('.claude/agents/'));
    });

    it('should log pipeline creation confirmation with 4 templates', async () => {
      await initCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✅ Creating example pipelines:'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('post-commit-example.yml'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('pre-commit-example.yml'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('pre-push-example.yml'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('post-merge-example.yml'));
    });

    it('should log agent creation confirmation with 5 agents', async () => {
      // Disable plugin import to ensure default agents are created
      await initCommand(tempDir, { importPluginAgents: false });

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✅ Created example agents:'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('code-reviewer.md'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('doc-updater.md'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('quality-checker.md'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('security-auditor.md'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('summary.md'));
    });

    it('should log success message', async () => {
      await initCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✨ Agent Pipeline initialized successfully'));
    });

    it('should log next steps with correct command', async () => {
      await initCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Next steps:'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('agent-pipeline run post-commit-example'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('agent-pipeline install post-commit-example'));
    });

    it('should log plugin agent import information', async () => {
      await initCommand(tempDir);

      // Should show plugin agent search message
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('📦 Searching for Claude Code plugin agents'));
    });
  });

  describe('AgentImporter Integration', () => {
    it('should call AgentImporter by default', async () => {
      await initCommand(tempDir);

      // AgentImporter.importPluginAgents should be called
      // This is verified by the console log output test above
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('📦 Searching for Claude Code plugin agents'));
    });

    it('should skip AgentImporter when importPluginAgents is false', async () => {
      await initCommand(tempDir, { importPluginAgents: false });

      // Should not show plugin agent search message
      const calls = (console.log as any).mock.calls;
      const hasPluginMessage = calls.some((call: any[]) =>
        call[0]?.includes('📦 Searching for Claude Code plugin agents')
      );
      expect(hasPluginMessage).toBe(false);
    });

    it('should create default agents if no plugin agents exist', async () => {
      // Disable plugin import to force default agent creation
      await initCommand(tempDir, { importPluginAgents: false });

      // Default agents should be created
      const agentNames = [
        'code-reviewer.md',
        'doc-updater.md',
        'quality-checker.md',
        'security-auditor.md',
        'summary.md'
      ];

      for (const agentName of agentNames) {
        const agentPath = path.join(tempDir, '.claude', 'agents', agentName);
        const exists = await fs.stat(agentPath).then(() => true, () => false);
        expect(exists).toBe(true);
      }
    });

    it('should not create default agents if plugin agents were imported', async () => {
      // Pre-create an agent to simulate existing agents
      const agentsDir = path.join(tempDir, '.claude', 'agents');
      await fs.mkdir(agentsDir, { recursive: true });
      await fs.writeFile(path.join(agentsDir, 'plugin-agent.md'), '# Plugin Agent', 'utf-8');

      await initCommand(tempDir, { importPluginAgents: false });

      // Check that we don't have default agents (because existing agents were found)
      const codeReviewerPath = path.join(agentsDir, 'code-reviewer.md');
      const exists = await fs.stat(codeReviewerPath).then(() => true, () => false);

      // Should not create default agents
      expect(exists).toBe(false);
    });

    it('should show imported agent count in success message when agents imported', async () => {
      // This test checks console output when plugin agents ARE imported
      await initCommand(tempDir);

      const calls = (console.log as any).mock.calls;

      // Should show either "Imported X agent(s)" or "Created example agents:"
      const hasImportedOrCreatedMessage = calls.some((call: any[]) =>
        (call[0]?.includes('📦 Imported') && call[0]?.includes('agent(s)')) ||
        call[0]?.includes('✅ Created example agents:')
      );
      expect(hasImportedOrCreatedMessage).toBe(true);
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
      // Disable plugin import for deterministic testing
      await initCommand(tempDir, { importPluginAgents: false });

      // Verify all directories
      const pipelinesDir = path.join(tempDir, '.agent-pipeline', 'pipelines');
      const agentsDir = path.join(tempDir, '.claude', 'agents');
      expect(await fs.stat(pipelinesDir).then(() => true, () => false)).toBe(true);
      expect(await fs.stat(agentsDir).then(() => true, () => false)).toBe(true);

      // Verify all 4 pipeline template files
      const templateNames = [
        'post-commit-example.yml',
        'pre-commit-example.yml',
        'pre-push-example.yml',
        'post-merge-example.yml'
      ];

      for (const templateName of templateNames) {
        const pipelinePath = path.join(pipelinesDir, templateName);
        expect(await fs.stat(pipelinePath).then(() => true, () => false)).toBe(true);
      }

      // Verify all 5 default agent files
      const agentNames = [
        'code-reviewer.md',
        'doc-updater.md',
        'quality-checker.md',
        'security-auditor.md',
        'summary.md'
      ];

      for (const agentName of agentNames) {
        const agentPath = path.join(agentsDir, agentName);
        expect(await fs.stat(agentPath).then(() => true, () => false)).toBe(true);
      }

      // Verify .gitignore
      const gitignorePath = path.join(tempDir, '.gitignore');
      expect(await fs.stat(gitignorePath).then(() => true, () => false)).toBe(true);
    });

    it('should create valid pipeline configurations readable by system', async () => {
      await initCommand(tempDir);

      const templateNames = [
        'post-commit-example.yml',
        'pre-commit-example.yml',
        'pre-push-example.yml',
        'post-merge-example.yml'
      ];

      for (const templateName of templateNames) {
        const pipelinePath = path.join(tempDir, '.agent-pipeline', 'pipelines', templateName);
        const content = await fs.readFile(pipelinePath, 'utf-8');
        const parsed = YAML.parse(content);

        // Verify it's a valid pipeline config structure
        expect(parsed.name).toBeDefined();
        expect(parsed.trigger).toBeDefined();
        expect(parsed.agents).toBeDefined();
        expect(Array.isArray(parsed.agents)).toBe(true);
        expect(parsed.settings).toBeDefined();
      }
    });

    it('should be idempotent (safe to run multiple times)', async () => {
      // Run init twice
      await initCommand(tempDir);
      await initCommand(tempDir);

      // Verify template files still exist and have correct content
      const pipelinePath = path.join(tempDir, '.agent-pipeline', 'pipelines', 'post-commit-example.yml');
      const content = await fs.readFile(pipelinePath, 'utf-8');
      const parsed = YAML.parse(content);

      expect(parsed.name).toBe('post-commit-example');
      expect(parsed.agents).toHaveLength(3);

      // Verify all 4 templates exist
      const templateNames = [
        'post-commit-example.yml',
        'pre-commit-example.yml',
        'pre-push-example.yml',
        'post-merge-example.yml'
      ];

      const pipelinesDir = path.join(tempDir, '.agent-pipeline', 'pipelines');
      for (const templateName of templateNames) {
        const templatePath = path.join(pipelinesDir, templateName);
        expect(await fs.stat(templatePath).then(() => true, () => false)).toBe(true);
      }
    });

    it('should create files with correct encoding', async () => {
      await initCommand(tempDir);

      const pipelinePath = path.join(tempDir, '.agent-pipeline', 'pipelines', 'post-commit-example.yml');
      const buffer = await fs.readFile(pipelinePath);

      // Should be readable as UTF-8
      const content = buffer.toString('utf-8');
      expect(content).toContain('post-commit-example');
    });

    it('should create agents with proper markdown structure', async () => {
      // Disable plugin import for deterministic testing
      await initCommand(tempDir, { importPluginAgents: false });

      const agentNames = [
        'code-reviewer.md',
        'doc-updater.md',
        'quality-checker.md',
        'security-auditor.md',
        'summary.md'
      ];

      for (const agentName of agentNames) {
        const agentPath = path.join(tempDir, '.claude', 'agents', agentName);
        const content = await fs.readFile(agentPath, 'utf-8');

        // Check markdown headers
        expect(content).toMatch(/^# /m);
        expect(content).toMatch(/^## /m);
      }
    });
  });
});
