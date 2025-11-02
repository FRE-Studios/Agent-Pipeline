import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initCommand } from '../../../cli/commands/init.js';
import { createTempDir, cleanupTempDir } from '../../setup.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as YAML from 'yaml';
import { AgentImporter } from '../../../cli/utils/agent-importer.js';

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
    it('should create only test-pipeline.yml by default', async () => {
      await initCommand(tempDir);

      const pipelinesDir = path.join(tempDir, '.agent-pipeline', 'pipelines');
      const files = await fs.readdir(pipelinesDir);
      const ymlFiles = files.filter(f => f.endsWith('.yml'));

      expect(ymlFiles).toEqual(['test-pipeline.yml']);
    });

    it('should create test-pipeline + specific example when exampleName is provided', async () => {
      await initCommand(tempDir, { exampleName: 'post-commit' });

      const pipelinesDir = path.join(tempDir, '.agent-pipeline', 'pipelines');
      const files = await fs.readdir(pipelinesDir);
      const ymlFiles = files.filter(f => f.endsWith('.yml')).sort();

      expect(ymlFiles).toEqual(['post-commit-example.yml', 'test-pipeline.yml']);
    });

    it('should create all pipelines when --all flag is set', async () => {
      await initCommand(tempDir, { all: true });

      const pipelinesDir = path.join(tempDir, '.agent-pipeline', 'pipelines');
      const files = await fs.readdir(pipelinesDir);
      const ymlFiles = files.filter(f => f.endsWith('.yml')).sort();

      expect(ymlFiles).toEqual([
        'post-commit-example.yml',
        'post-merge-example.yml',
        'pre-commit-example.yml',
        'pre-push-example.yml',
        'test-pipeline.yml'
      ]);
    });

    it('should throw error for invalid example name', async () => {
      await expect(
        initCommand(tempDir, { exampleName: 'invalid-example' })
      ).rejects.toThrow('Invalid example name');
    });

    it('should create valid YAML in test-pipeline', async () => {
      await initCommand(tempDir);

      const pipelinePath = path.join(tempDir, '.agent-pipeline', 'pipelines', 'test-pipeline.yml');
      const content = await fs.readFile(pipelinePath, 'utf-8');
      const parsed = YAML.parse(content);

      expect(parsed).toBeDefined();
      expect(parsed.name).toBe('test-pipeline');
      expect(parsed.trigger).toBe('manual');
    });

    describe('test-pipeline.yml', () => {
      it('should have correct pipeline configuration', async () => {
        await initCommand(tempDir);

        const pipelinePath = path.join(tempDir, '.agent-pipeline', 'pipelines', 'test-pipeline.yml');
        const content = await fs.readFile(pipelinePath, 'utf-8');
        const parsed = YAML.parse(content);

        expect(parsed.name).toBe('test-pipeline');
        expect(parsed.trigger).toBe('manual');
        expect(parsed.settings.executionMode).toBe('parallel');
        expect(parsed.settings.autoCommit).toBe(false);
        expect(parsed.settings.preserveWorkingTree).toBe(true);
        expect(parsed.agents).toHaveLength(8);
      });

      it('should include game agents (storyteller, detectives, synthesizer, judge)', async () => {
        await initCommand(tempDir);

        const pipelinePath = path.join(tempDir, '.agent-pipeline', 'pipelines', 'test-pipeline.yml');
        const content = await fs.readFile(pipelinePath, 'utf-8');
        const parsed = YAML.parse(content);

        const storyteller = parsed.agents.find((a: any) => a.name === 'storyteller');
        const logician = parsed.agents.find((a: any) => a.name === 'logician');
        const synthesizer = parsed.agents.find((a: any) => a.name === 'synthesizer');
        const judge = parsed.agents.find((a: any) => a.name === 'judge');

        expect(storyteller).toBeDefined();
        expect(storyteller.agent).toBe('.claude/agents/storyteller.md');
        expect(logician).toBeDefined();
        expect(logician.agent).toBe('.claude/agents/detective-logician.md');
        expect(synthesizer).toBeDefined();
        expect(synthesizer.agent).toBe('.claude/agents/synthesizer.md');
        expect(judge).toBeDefined();
        expect(judge.agent).toBe('.claude/agents/judge.md');
      });
    });

    describe('post-commit-example.yml', () => {
      it('should have correct pipeline configuration', async () => {
        await initCommand(tempDir, { exampleName: 'post-commit' });

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
        await initCommand(tempDir, { exampleName: 'post-commit' });

        const pipelinePath = path.join(tempDir, '.agent-pipeline', 'pipelines', 'post-commit-example.yml');
        const content = await fs.readFile(pipelinePath, 'utf-8');
        const parsed = YAML.parse(content);

        const agent = parsed.agents.find((a: any) => a.name === 'code-review');
        expect(agent).toBeDefined();
        expect(agent.agent).toBe('.claude/agents/code-reviewer.md');
        expect(agent.timeout).toBe(300);
        expect(agent.outputs).toEqual(['issues_found', 'severity_level']);
      });

      it('should have sequential execution with correct dependencies', async () => {
        await initCommand(tempDir, { exampleName: 'post-commit' });

        const pipelinePath = path.join(tempDir, '.agent-pipeline', 'pipelines', 'post-commit-example.yml');
        const content = await fs.readFile(pipelinePath, 'utf-8');
        const parsed = YAML.parse(content);

        const codeReview = parsed.agents.find((a: any) => a.name === 'code-review');
        const qualityCheck = parsed.agents.find((a: any) => a.name === 'quality-check');
        const docUpdater = parsed.agents.find((a: any) => a.name === 'doc-updater');

        // Verify sequential chain: code-review → quality-check → doc-updater
        expect(codeReview.dependsOn).toBeUndefined();
        expect(qualityCheck.dependsOn).toEqual(['code-review']);
        expect(docUpdater.dependsOn).toEqual(['quality-check']);
      });
    });

    describe('pre-commit-example.yml', () => {
      it('should have correct pipeline configuration', async () => {
        await initCommand(tempDir, { exampleName: 'pre-commit' });

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
        await initCommand(tempDir, { exampleName: 'pre-commit' });

        const pipelinePath = path.join(tempDir, '.agent-pipeline', 'pipelines', 'pre-commit-example.yml');
        const content = await fs.readFile(pipelinePath, 'utf-8');
        const parsed = YAML.parse(content);

        const lintAgent = parsed.agents.find((a: any) => a.name === 'lint-check');
        const securityAgent = parsed.agents.find((a: any) => a.name === 'security-scan');

        expect(lintAgent).toBeDefined();
        expect(securityAgent).toBeDefined();
        expect(lintAgent.timeout).toBe(180);
        expect(securityAgent.timeout).toBe(180);
      });
    });

    describe('pre-push-example.yml', () => {
      it('should have correct pipeline configuration', async () => {
        await initCommand(tempDir, { exampleName: 'pre-push' });

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
        await initCommand(tempDir, { exampleName: 'pre-push' });

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
        await initCommand(tempDir, { exampleName: 'post-merge' });

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
        await initCommand(tempDir, { exampleName: 'post-merge' });

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
    it('should create only agents required by test-pipeline by default', async () => {
      await initCommand(tempDir, { importPluginAgents: false });

      const agentsDir = path.join(tempDir, '.claude', 'agents');
      const files = await fs.readdir(agentsDir);
      const mdFiles = files.filter(f => f.endsWith('.md') && !f.startsWith('.'));

      // test-pipeline uses 8 game agents
      expect(mdFiles.sort()).toEqual([
        'detective-empath.md',
        'detective-linguist.md',
        'detective-logician.md',
        'detective-skeptic.md',
        'detective-statistician.md',
        'judge.md',
        'storyteller.md',
        'synthesizer.md'
      ]);
    });

    it('should create agents required by post-commit-example when specified', async () => {
      await initCommand(tempDir, { exampleName: 'post-commit', importPluginAgents: false });

      const agentsDir = path.join(tempDir, '.claude', 'agents');
      const files = await fs.readdir(agentsDir);
      const mdFiles = files.filter(f => f.endsWith('.md') && !f.startsWith('.'));

      // test-pipeline (8 game agents) + post-commit-example (code-reviewer, quality-checker, doc-updater)
      expect(mdFiles.sort()).toEqual([
        'code-reviewer.md',
        'detective-empath.md',
        'detective-linguist.md',
        'detective-logician.md',
        'detective-skeptic.md',
        'detective-statistician.md',
        'doc-updater.md',
        'judge.md',
        'quality-checker.md',
        'storyteller.md',
        'synthesizer.md'
      ]);
    });

    it('should create all required agents when --all flag is set', async () => {
      await initCommand(tempDir, { all: true, importPluginAgents: false });

      const agentsDir = path.join(tempDir, '.claude', 'agents');
      const files = await fs.readdir(agentsDir);
      const mdFiles = files.filter(f => f.endsWith('.md') && !f.startsWith('.'));

      // Should include all agents that have templates and are used by pipelines when --all is set
      // test-pipeline (8 game agents) + all AVAILABLE_EXAMPLES (post-commit, pre-commit, pre-push, post-merge)
      // Note: memory-updater is NOT included because large-pipeline-example is not in AVAILABLE_EXAMPLES
      const expectedAgents = [
        'cleanup-reporter.md',
        'code-reducer.md',
        'code-reviewer.md',
        'dependency-auditor.md',
        'detective-empath.md',
        'detective-linguist.md',
        'detective-logician.md',
        'detective-skeptic.md',
        'detective-statistician.md',
        'doc-updater.md',
        'judge.md',
        'quality-checker.md',
        'security-auditor.md',
        'storyteller.md',
        'summary.md',
        'synthesizer.md'
      ];

      expect(mdFiles.sort()).toEqual(expectedAgents);
    });

    it('should include valid markdown in storyteller agent', async () => {
      await initCommand(tempDir, { importPluginAgents: false });

      const agentPath = path.join(tempDir, '.claude', 'agents', 'storyteller.md');
      const content = await fs.readFile(agentPath, 'utf-8');

      expect(content).toContain('# Storyteller Agent');
      expect(content).toContain('## Your Task');
      expect(content).toContain('## Output Format');
      expect(content).toContain('report_outputs');
    });

    it('should include valid markdown in doc-updater agent', async () => {
      await initCommand(tempDir, { all: true, importPluginAgents: false });

      const agentPath = path.join(tempDir, '.claude', 'agents', 'doc-updater.md');
      const content = await fs.readFile(agentPath, 'utf-8');

      expect(content).toContain('# Documentation Updater Agent');
      expect(content).toContain('## Your Task');
      expect(content).toContain('## Output Format');
      expect(content).toContain('report_outputs');
    });

    it('should include valid markdown in quality-checker agent', async () => {
      await initCommand(tempDir, { all: true, importPluginAgents: false });

      const agentPath = path.join(tempDir, '.claude', 'agents', 'quality-checker.md');
      const content = await fs.readFile(agentPath, 'utf-8');

      expect(content).toContain('# Quality Checker Agent');
      expect(content).toContain('## Your Task');
      expect(content).toContain('## Output Format');
      expect(content).toContain('report_outputs');
    });

    it('should include valid markdown in security-auditor agent', async () => {
      await initCommand(tempDir, { all: true, importPluginAgents: false });

      const agentPath = path.join(tempDir, '.claude', 'agents', 'security-auditor.md');
      const content = await fs.readFile(agentPath, 'utf-8');

      expect(content).toContain('# Security Auditor Agent');
      expect(content).toContain('## Your Task');
      expect(content).toContain('## Output Format');
      expect(content).toContain('report_outputs');
    });

    it('should include valid markdown in judge agent', async () => {
      await initCommand(tempDir, { importPluginAgents: false });

      const agentPath = path.join(tempDir, '.claude', 'agents', 'judge.md');
      const content = await fs.readFile(agentPath, 'utf-8');

      expect(content).toContain('# Judge Agent');
      expect(content).toContain('## Your Task');
    });

    it('should not create agents that already exist', async () => {
      // Pre-create storyteller.md to simulate existing agent
      const agentsDir = path.join(tempDir, '.claude', 'agents');
      await fs.mkdir(agentsDir, { recursive: true });
      await fs.writeFile(path.join(agentsDir, 'storyteller.md'), '# Existing Storyteller', 'utf-8');

      await initCommand(tempDir, { importPluginAgents: false });

      // Should create other 7 game agents but not storyteller.md (already exists)
      const files = await fs.readdir(agentsDir);
      const mdFiles = files.filter(f => f.endsWith('.md'));

      expect(mdFiles.sort()).toEqual([
        'detective-empath.md',
        'detective-linguist.md',
        'detective-logician.md',
        'detective-skeptic.md',
        'detective-statistician.md',
        'judge.md',
        'storyteller.md',
        'synthesizer.md'
      ]);

      // Verify storyteller.md was NOT overwritten
      const content = await fs.readFile(path.join(agentsDir, 'storyteller.md'), 'utf-8');
      expect(content).toContain('# Existing Storyteller');
    });

    it('should create agents with proper output format instructions', async () => {
      await initCommand(tempDir, { all: true, importPluginAgents: false });

      // Test agents that should have report_outputs
      const agentsWithOutputs = ['code-reviewer.md', 'doc-updater.md', 'quality-checker.md', 'security-auditor.md'];

      for (const agentName of agentsWithOutputs) {
        const agentPath = path.join(tempDir, '.claude', 'agents', agentName);
        const exists = await fs.stat(agentPath).then(() => true, () => false);
        if (exists) {
          const content = await fs.readFile(agentPath, 'utf-8');
          expect(content).toContain('report_outputs');
        }
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

    it('should log pipeline creation confirmation', async () => {
      await initCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✅ Creating pipelines:'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('test-pipeline.yml'));
    });

    it('should log agent creation confirmation', async () => {
      // Disable plugin import to ensure fallback agents are created
      await initCommand(tempDir, { importPluginAgents: false });

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Created'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('fallback agent'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('storyteller.md'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('judge.md'));
    });

    it('should log success message', async () => {
      await initCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✨ Agent Pipeline initialized successfully'));
    });

    it('should log next steps with correct command', async () => {
      await initCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Next steps:'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('agent-pipeline run test-pipeline'));
    });

    it('should log install command when post-commit example is created', async () => {
      await initCommand(tempDir, { exampleName: 'post-commit' });

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

    it('should create required agents if no plugin agents exist', async () => {
      // Disable plugin import to force fallback agent creation
      await initCommand(tempDir, { importPluginAgents: false });

      // Required agents for test-pipeline (8 game agents) should be created
      const agentNames = [
        'storyteller.md',
        'detective-logician.md',
        'detective-empath.md',
        'detective-statistician.md',
        'detective-linguist.md',
        'detective-skeptic.md',
        'synthesizer.md',
        'judge.md'
      ];

      for (const agentName of agentNames) {
        const agentPath = path.join(tempDir, '.claude', 'agents', agentName);
        const exists = await fs.stat(agentPath).then(() => true, () => false);
        expect(exists).toBe(true);
      }
    });

    it('should not create agents that already exist from plugins', async () => {
      // Pre-create code-reviewer.md to simulate plugin import
      const agentsDir = path.join(tempDir, '.claude', 'agents');
      await fs.mkdir(agentsDir, { recursive: true });
      await fs.writeFile(path.join(agentsDir, 'storyteller.md'), '# Plugin Agent', 'utf-8');

      await initCommand(tempDir, { importPluginAgents: false });

      // Should create the other 7 game agents but not storyteller.md (already exists)
      const files = await fs.readdir(agentsDir);
      const mdFiles = files.filter(f => f.endsWith('.md'));

      expect(mdFiles.sort()).toEqual([
        'detective-empath.md',
        'detective-linguist.md',
        'detective-logician.md',
        'detective-skeptic.md',
        'detective-statistician.md',
        'judge.md',
        'storyteller.md',
        'synthesizer.md'
      ]);
    });

    it('should show fallback agent summary when no plugin agents are imported', async () => {
      vi.spyOn(AgentImporter, 'importPluginAgents').mockResolvedValue({
        total: 0,
        imported: 0,
        skipped: 0,
        agents: []
      });

      await initCommand(tempDir);

      const calls = (console.log as any).mock.calls;
      const hasFallbackMessage = calls.some((call: any[]) =>
        call[0]?.includes('fallback agent(s) required by your pipelines')
      );

      expect(hasFallbackMessage).toBe(true);
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

      // Verify only test-pipeline is created by default
      const pipelineFiles = await fs.readdir(pipelinesDir);
      const ymlFiles = pipelineFiles.filter(f => f.endsWith('.yml'));
      expect(ymlFiles).toEqual(['test-pipeline.yml']);

      // Verify only required agents are created (8 game agents)
      const agentFiles = await fs.readdir(agentsDir);
      const mdFiles = agentFiles.filter(f => f.endsWith('.md') && !f.startsWith('.'));
      expect(mdFiles.sort()).toEqual([
        'detective-empath.md',
        'detective-linguist.md',
        'detective-logician.md',
        'detective-skeptic.md',
        'detective-statistician.md',
        'judge.md',
        'storyteller.md',
        'synthesizer.md'
      ]);

      // Verify .gitignore
      const gitignorePath = path.join(tempDir, '.gitignore');
      expect(await fs.stat(gitignorePath).then(() => true, () => false)).toBe(true);
    });

    it('should create valid pipeline configuration readable by system', async () => {
      await initCommand(tempDir);

      const pipelinePath = path.join(tempDir, '.agent-pipeline', 'pipelines', 'test-pipeline.yml');
      const content = await fs.readFile(pipelinePath, 'utf-8');
      const parsed = YAML.parse(content);

      // Verify it's a valid pipeline config structure
      expect(parsed.name).toBeDefined();
      expect(parsed.trigger).toBeDefined();
      expect(parsed.agents).toBeDefined();
      expect(Array.isArray(parsed.agents)).toBe(true);
      expect(parsed.settings).toBeDefined();
    });

    it('should create all pipelines when --all flag is used', async () => {
      await initCommand(tempDir, { all: true, importPluginAgents: false });

      const pipelinesDir = path.join(tempDir, '.agent-pipeline', 'pipelines');
      const files = await fs.readdir(pipelinesDir);
      const ymlFiles = files.filter(f => f.endsWith('.yml'));

      expect(ymlFiles.length).toBe(5); // test + 4 examples
      expect(ymlFiles).toContain('test-pipeline.yml');
      expect(ymlFiles).toContain('post-commit-example.yml');
      expect(ymlFiles).toContain('pre-commit-example.yml');
      expect(ymlFiles).toContain('pre-push-example.yml');
      expect(ymlFiles).toContain('post-merge-example.yml');
    });

    it('should be idempotent (safe to run multiple times)', async () => {
      // Run init twice
      await initCommand(tempDir);
      await initCommand(tempDir);

      // Verify template file still exists and has correct content
      const pipelinePath = path.join(tempDir, '.agent-pipeline', 'pipelines', 'test-pipeline.yml');
      const content = await fs.readFile(pipelinePath, 'utf-8');
      const parsed = YAML.parse(content);

      expect(parsed.name).toBe('test-pipeline');
      expect(parsed.agents).toHaveLength(8);

      // Verify test-pipeline exists
      const pipelinesDir = path.join(tempDir, '.agent-pipeline', 'pipelines');
      const templatePath = path.join(pipelinesDir, 'test-pipeline.yml');
      expect(await fs.stat(templatePath).then(() => true, () => false)).toBe(true);
    });

    it('should create files with correct encoding', async () => {
      await initCommand(tempDir);

      const pipelinePath = path.join(tempDir, '.agent-pipeline', 'pipelines', 'test-pipeline.yml');
      const buffer = await fs.readFile(pipelinePath);

      // Should be readable as UTF-8
      const content = buffer.toString('utf-8');
      expect(content).toContain('test-pipeline');
    });

    it('should create agents with proper markdown structure', async () => {
      // Disable plugin import for deterministic testing
      await initCommand(tempDir, { importPluginAgents: false });

      const agentNames = [
        'storyteller.md',
        'detective-logician.md',
        'synthesizer.md',
        'judge.md'
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

  describe('Helper Functions', () => {
    describe('getRequiredAgents', () => {
      it('should extract agents from test-pipeline', async () => {
        await initCommand(tempDir, { importPluginAgents: false });

        // Use a simple test by checking what files were created
        const agentsDir = path.join(tempDir, '.claude', 'agents');
        const files = await fs.readdir(agentsDir);
        const mdFiles = files.filter(f => f.endsWith('.md') && !f.startsWith('.'));

        // test-pipeline should require 8 game agents
        expect(mdFiles).toContain('storyteller.md');
        expect(mdFiles).toContain('detective-logician.md');
        expect(mdFiles).toContain('synthesizer.md');
        expect(mdFiles).toContain('judge.md');
        expect(mdFiles).toHaveLength(8);
      });

      it('should extract unique agents from multiple pipelines', async () => {
        await initCommand(tempDir, { exampleName: 'post-commit', importPluginAgents: false });

        const agentsDir = path.join(tempDir, '.claude', 'agents');
        const files = await fs.readdir(agentsDir);
        const mdFiles = files.filter(f => f.endsWith('.md') && !f.startsWith('.'));

        // test-pipeline (8 game agents) + post-commit (code-reviewer, doc-updater, quality-checker)
        expect(mdFiles.sort()).toEqual([
          'code-reviewer.md',
          'detective-empath.md',
          'detective-linguist.md',
          'detective-logician.md',
          'detective-skeptic.md',
          'detective-statistician.md',
          'doc-updater.md',
          'judge.md',
          'quality-checker.md',
          'storyteller.md',
          'synthesizer.md'
        ]);
      });
    });
  });
});
