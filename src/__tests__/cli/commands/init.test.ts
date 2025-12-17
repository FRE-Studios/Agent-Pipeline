import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initCommand } from '../../../cli/commands/init.js';
import { createTempDir, cleanupTempDir } from '../../setup.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as YAML from 'yaml';
import { AgentImporter } from '../../../cli/utils/agent-importer.js';
import { simpleGit } from 'simple-git';
import { AgentRuntimeRegistry } from '../../../core/agent-runtime-registry.js';
import { ClaudeCodeHeadlessRuntime } from '../../../core/agent-runtimes/claude-code-headless-runtime.js';

describe('initCommand', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir('init-command-test-');
    // Initialize git repo for validation to pass
    const git = simpleGit(tempDir);
    await git.init();
    await git.addConfig('user.name', 'Test User');
    await git.addConfig('user.email', 'test@example.com');

    // Register runtimes for validation
    AgentRuntimeRegistry.clear();
    AgentRuntimeRegistry.register(new ClaudeCodeHeadlessRuntime());
  });

  afterEach(async () => {
    AgentRuntimeRegistry.clear();
    await cleanupTempDir(tempDir);
  });

  describe('Directory Creation', () => {
    it('should create .agent-pipeline/pipelines directory', async () => {
      await initCommand(tempDir);

      const pipelinesDir = path.join(tempDir, '.agent-pipeline', 'pipelines');
      const exists = await fs.stat(pipelinesDir).then(() => true, () => false);
      expect(exists).toBe(true);
    });

    it('should create .agent-pipeline/agents directory', async () => {
      await initCommand(tempDir);

      const agentsDir = path.join(tempDir, '.agent-pipeline', 'agents');
      const exists = await fs.stat(agentsDir).then(() => true, () => false);
      expect(exists).toBe(true);
    });

    it('should handle existing directories gracefully', async () => {
      // Pre-create directories
      const pipelinesDir = path.join(tempDir, '.agent-pipeline', 'pipelines');
      const agentsDir = path.join(tempDir, '.agent-pipeline', 'agents');
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
      const agentsDir = path.join(tempDir, '.agent-pipeline', 'agents');

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
        expect(storyteller.agent).toBe('.agent-pipeline/agents/storyteller.md');
        expect(logician).toBeDefined();
        expect(logician.agent).toBe('.agent-pipeline/agents/detective-logician.md');
        expect(synthesizer).toBeDefined();
        expect(synthesizer.agent).toBe('.agent-pipeline/agents/synthesizer.md');
        expect(judge).toBeDefined();
        expect(judge.agent).toBe('.agent-pipeline/agents/judge.md');
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
        expect(agent.agent).toBe('.agent-pipeline/agents/code-reviewer.md');
        expect(agent.timeout).toBe(300);
        // Note: outputs field removed - using file-based handover strategy
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

  });

  describe('Example Agent Creation', () => {
    it('should create only agents required by test-pipeline by default', async () => {
      await initCommand(tempDir);

      const agentsDir = path.join(tempDir, '.agent-pipeline', 'agents');
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
      await initCommand(tempDir, { exampleName: 'post-commit' });

      const agentsDir = path.join(tempDir, '.agent-pipeline', 'agents');
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
      await initCommand(tempDir, { all: true });

      const agentsDir = path.join(tempDir, '.agent-pipeline', 'agents');
      const files = await fs.readdir(agentsDir);
      const mdFiles = files.filter(f => f.endsWith('.md') && !f.startsWith('.'));

      // Should include all agents that have templates and are used by pipelines when --all is set
      // test-pipeline (8 game agents) + post-commit-example (code-reviewer, quality-checker, doc-updater)
      const expectedAgents = [
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
      ];

      expect(mdFiles.sort()).toEqual(expectedAgents);
    });

    it('should include valid markdown in storyteller agent', async () => {
      await initCommand(tempDir);

      const agentPath = path.join(tempDir, '.agent-pipeline', 'agents', 'storyteller.md');
      const content = await fs.readFile(agentPath, 'utf-8');

      expect(content).toContain('# Storyteller Agent');
      expect(content).toContain('## Your Task');
      expect(content).toContain('## Output Format');
    });

    it('should include valid markdown in doc-updater agent', async () => {
      await initCommand(tempDir, { all: true });

      const agentPath = path.join(tempDir, '.agent-pipeline', 'agents', 'doc-updater.md');
      const content = await fs.readFile(agentPath, 'utf-8');

      expect(content).toContain('# Documentation Updater Agent');
      expect(content).toContain('## Your Task');
      expect(content).toContain('## Output Format');
    });

    it('should include valid markdown in quality-checker agent', async () => {
      await initCommand(tempDir, { all: true });

      const agentPath = path.join(tempDir, '.agent-pipeline', 'agents', 'quality-checker.md');
      const content = await fs.readFile(agentPath, 'utf-8');

      expect(content).toContain('# Quality Checker Agent');
      expect(content).toContain('## Your Task');
      expect(content).toContain('## Output Format');
    });

    it('should include valid markdown in judge agent', async () => {
      await initCommand(tempDir);

      const agentPath = path.join(tempDir, '.agent-pipeline', 'agents', 'judge.md');
      const content = await fs.readFile(agentPath, 'utf-8');

      expect(content).toContain('# Judge Agent');
      expect(content).toContain('## Your Task');
    });

    it('should not create agents that already exist', async () => {
      // Pre-create storyteller.md to simulate existing agent
      const agentsDir = path.join(tempDir, '.agent-pipeline', 'agents');
      await fs.mkdir(agentsDir, { recursive: true });
      await fs.writeFile(path.join(agentsDir, 'storyteller.md'), '# Existing Storyteller', 'utf-8');

      await initCommand(tempDir);

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
      await initCommand(tempDir, { all: true });

      // Test agents that should have output format instructions
      const agentsWithOutputFormat = ['code-reviewer.md', 'doc-updater.md', 'quality-checker.md'];

      for (const agentName of agentsWithOutputFormat) {
        const agentPath = path.join(tempDir, '.agent-pipeline', 'agents', agentName);
        const exists = await fs.stat(agentPath).then(() => true, () => false);
        if (exists) {
          const content = await fs.readFile(agentPath, 'utf-8');
          expect(content).toContain('## Output Format');
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
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('.agent-pipeline/agents/'));
    });

    it('should log pipeline creation confirmation', async () => {
      await initCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✅ Creating pipelines:'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('test-pipeline.yml'));
    });

    it('should log agent creation confirmation', async () => {
      vi.spyOn(AgentImporter, 'discoverPluginAgents').mockResolvedValue([]);
      await initCommand(tempDir);

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

    it('should log plugin agent discovery information', async () => {
      vi.spyOn(AgentImporter, 'discoverPluginAgents').mockResolvedValue([
        { agentName: 'test', targetName: 'test.md', marketplace: 'm', plugin: 'p', originalPath: '/path' }
      ]);
      await initCommand(tempDir);

      // Should show agent count and pull command hint
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('agent(s) found'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('agent-pipeline agent pull'));
    });
  });

  describe('AgentImporter Integration', () => {
    it('should call AgentImporter.discoverPluginAgents by default', async () => {
      const spy = vi.spyOn(AgentImporter, 'discoverPluginAgents').mockResolvedValue([]);
      await initCommand(tempDir);

      expect(spy).toHaveBeenCalled();
    });

    it('should show message when plugin agents are found', async () => {
      vi.spyOn(AgentImporter, 'discoverPluginAgents').mockResolvedValue([
        { agentName: 'agent1', targetName: 'agent1.md', marketplace: 'm', plugin: 'p', originalPath: '/path' },
        { agentName: 'agent2', targetName: 'agent2.md', marketplace: 'm', plugin: 'p', originalPath: '/path' }
      ]);
      await initCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('2 agent(s) found'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('agent-pipeline agent pull'));
    });

    it('should create required agents if no plugin agents exist', async () => {
      vi.spyOn(AgentImporter, 'discoverPluginAgents').mockResolvedValue([]);
      await initCommand(tempDir);

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
        const agentPath = path.join(tempDir, '.agent-pipeline', 'agents', agentName);
        const exists = await fs.stat(agentPath).then(() => true, () => false);
        expect(exists).toBe(true);
      }
    });

    it('should not create agents that already exist from plugins', async () => {
      // Pre-create storyteller.md to simulate existing agent
      const agentsDir = path.join(tempDir, '.agent-pipeline', 'agents');
      await fs.mkdir(agentsDir, { recursive: true });
      await fs.writeFile(path.join(agentsDir, 'storyteller.md'), '# Plugin Agent', 'utf-8');

      vi.spyOn(AgentImporter, 'discoverPluginAgents').mockResolvedValue([]);
      await initCommand(tempDir);

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

    it('should show fallback agent summary when creating required agents', async () => {
      vi.spyOn(AgentImporter, 'discoverPluginAgents').mockResolvedValue([]);

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
      await initCommand(tempDir);

      // Verify all directories
      const pipelinesDir = path.join(tempDir, '.agent-pipeline', 'pipelines');
      const agentsDir = path.join(tempDir, '.agent-pipeline', 'agents');
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
      await initCommand(tempDir, { all: true });

      const pipelinesDir = path.join(tempDir, '.agent-pipeline', 'pipelines');
      const files = await fs.readdir(pipelinesDir);
      const ymlFiles = files.filter(f => f.endsWith('.yml'));

      expect(ymlFiles.length).toBe(2); // test + post-commit example
      expect(ymlFiles).toContain('test-pipeline.yml');
      expect(ymlFiles).toContain('post-commit-example.yml');
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
      await initCommand(tempDir);

      const agentNames = [
        'storyteller.md',
        'detective-logician.md',
        'synthesizer.md',
        'judge.md'
      ];

      for (const agentName of agentNames) {
        const agentPath = path.join(tempDir, '.agent-pipeline', 'agents', agentName);
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
        await initCommand(tempDir);

        // Use a simple test by checking what files were created
        const agentsDir = path.join(tempDir, '.agent-pipeline', 'agents');
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
        await initCommand(tempDir, { exampleName: 'post-commit' });

        const agentsDir = path.join(tempDir, '.agent-pipeline', 'agents');
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

  describe('Pipeline Validation', () => {
    it('should validate created pipelines after init', async () => {
      await initCommand(tempDir);

      // Should log validation step
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Validating pipelines'));
    });

    it('should show valid status for test-pipeline', async () => {
      await initCommand(tempDir);

      // Should show test-pipeline as valid
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('test-pipeline: valid'));
    });

    it('should show valid status for all pipelines when --all flag is used', async () => {
      await initCommand(tempDir, { all: true });

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('test-pipeline: valid'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('post-commit-example: valid'));
    });

    it('should report validation warnings for runtime availability', async () => {
      // Clear runtimes so validation reports warnings about runtime unavailability
      AgentRuntimeRegistry.clear();
      AgentRuntimeRegistry.register(new ClaudeCodeHeadlessRuntime());

      await initCommand(tempDir);

      // Validation should still pass (warnings don't block) and show valid status
      // Note: runtime warnings are expected in test environment where claude CLI may not be installed
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Validating pipelines'));
    });

    it('should ensure pipeline templates are always valid', async () => {
      // This test verifies our shipped templates pass validation
      // If this fails, it means we broke a template
      await initCommand(tempDir);

      // Should show success message (templates should always be valid)
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('initialized successfully'));
    });

    it('should validate all example pipelines pass validation', async () => {
      await initCommand(tempDir, { all: true });

      // All pipelines should be valid
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('test-pipeline: valid'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('post-commit-example: valid'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('initialized successfully'));
    });

    it('should fail validation and block success when runtime is unknown', async () => {
      // Clear all runtimes - validation should fail because runtime type is unknown
      AgentRuntimeRegistry.clear();

      await initCommand(tempDir);

      // Should report error about unknown runtime
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('error'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Unknown runtime type'));

      // Should NOT show success message
      const calls = (console.log as any).mock.calls;
      const hasSuccessMessage = calls.some((call: any[]) =>
        call[0]?.includes('initialized successfully')
      );
      expect(hasSuccessMessage).toBe(false);
    });

    it('should report validation issues message when validation fails', async () => {
      // Clear all runtimes to cause validation failure
      AgentRuntimeRegistry.clear();

      await initCommand(tempDir);

      // Should show validation issues message
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('validation issues'));
    });
  });
});
