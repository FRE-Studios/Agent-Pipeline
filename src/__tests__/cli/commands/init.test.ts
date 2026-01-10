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

// Expected agents for each pipeline (only active/non-commented agents)
const FRONTEND_AGENTS = [
  'brutalist_purist.md',
  'cyberpunk_hacker.md',
  'indie_game_dev.md',
  'product_owner.md',
  'showcase.md'
];

const POST_COMMIT_AGENTS = [
  'doc-updater.md'
];

const LOOP_AGENTS = [
  'socratic-explorer.md'
];

const ALL_EXPECTED_AGENTS = [...FRONTEND_AGENTS, ...POST_COMMIT_AGENTS, ...LOOP_AGENTS].sort();

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

  describe('Pipeline Creation', () => {
    it('should create all example pipelines by default', async () => {
      await initCommand(tempDir);

      const pipelinesDir = path.join(tempDir, '.agent-pipeline', 'pipelines');
      const files = await fs.readdir(pipelinesDir);
      const ymlFiles = files.filter(f => f.endsWith('.yml')).sort();

      expect(ymlFiles).toEqual([
        'front-end-parallel-example.yml',
        'loop-example.yml',
        'post-commit-example.yml'
      ]);
    });

    it('should create valid YAML in front-end-parallel-example', async () => {
      await initCommand(tempDir);

      const pipelinePath = path.join(tempDir, '.agent-pipeline', 'pipelines', 'front-end-parallel-example.yml');
      const content = await fs.readFile(pipelinePath, 'utf-8');
      const parsed = YAML.parse(content);

      expect(parsed).toBeDefined();
      expect(parsed.name).toBe('front-end-parallel-example');
      expect(parsed.trigger).toBe('manual');
    });

    describe('front-end-parallel-example.yml', () => {
      it('should have correct pipeline configuration', async () => {
        await initCommand(tempDir);

        const pipelinePath = path.join(tempDir, '.agent-pipeline', 'pipelines', 'front-end-parallel-example.yml');
        const content = await fs.readFile(pipelinePath, 'utf-8');
        const parsed = YAML.parse(content);

        expect(parsed.name).toBe('front-end-parallel-example');
        expect(parsed.trigger).toBe('manual');
        // Minimal template: no git section (no worktree isolation), execution.failureStrategy: continue
        expect(parsed.git).toBeUndefined();
        expect(parsed.execution?.failureStrategy).toBe('continue');
        expect(parsed.agents).toHaveLength(5); // Default: product-owner, 3 design agents, showcase
      });

      it('should include design agents with correct structure', async () => {
        await initCommand(tempDir);

        const pipelinePath = path.join(tempDir, '.agent-pipeline', 'pipelines', 'front-end-parallel-example.yml');
        const content = await fs.readFile(pipelinePath, 'utf-8');
        const parsed = YAML.parse(content);

        const productOwner = parsed.agents.find((a: any) => a.name === 'product-owner');
        const showcase = parsed.agents.find((a: any) => a.name === 'showcase');

        expect(productOwner).toBeDefined();
        expect(productOwner.agent).toBe('.agent-pipeline/agents/product_owner.md');
        expect(showcase).toBeDefined();
        expect(showcase.agent).toBe('.agent-pipeline/agents/showcase.md');
      });

      it('should have correct DAG dependencies for parallel execution', async () => {
        await initCommand(tempDir);

        const pipelinePath = path.join(tempDir, '.agent-pipeline', 'pipelines', 'front-end-parallel-example.yml');
        const content = await fs.readFile(pipelinePath, 'utf-8');
        const parsed = YAML.parse(content);

        const productOwner = parsed.agents.find((a: any) => a.name === 'product-owner');
        const brutalist = parsed.agents.find((a: any) => a.name === 'brutalist');
        const showcase = parsed.agents.find((a: any) => a.name === 'showcase');

        // Product owner has no dependencies (first stage)
        expect(productOwner.dependsOn).toBeUndefined();

        // Design agents depend on product-owner
        expect(brutalist.dependsOn).toEqual(['product-owner']);

        // Showcase depends on active design agents (3 by default)
        expect(showcase.dependsOn).toContain('brutalist');
        expect(showcase.dependsOn).toContain('indie-game');
        expect(showcase.dependsOn).toContain('cyberpunk');
        expect(showcase.dependsOn).toHaveLength(3);
      });
    });

    describe('post-commit-example.yml', () => {
      it('should have correct pipeline configuration', async () => {
        await initCommand(tempDir);

        const pipelinePath = path.join(tempDir, '.agent-pipeline', 'pipelines', 'post-commit-example.yml');
        const content = await fs.readFile(pipelinePath, 'utf-8');
        const parsed = YAML.parse(content);

        expect(parsed.name).toBe('post-commit-example');
        expect(parsed.trigger).toBe('post-commit');
        // Minimal template: no execution section (uses defaults), has git section for PR workflow
        expect(parsed.execution).toBeUndefined();
        expect(parsed.git.autoCommit).toBe(true);
        expect(parsed.git.mergeStrategy).toBe('pull-request');
        expect(parsed.agents).toHaveLength(1); // Default: doc-updater only
      });

      it('should include doc-updater agent by default', async () => {
        await initCommand(tempDir);

        const pipelinePath = path.join(tempDir, '.agent-pipeline', 'pipelines', 'post-commit-example.yml');
        const content = await fs.readFile(pipelinePath, 'utf-8');
        const parsed = YAML.parse(content);

        const agent = parsed.agents.find((a: any) => a.name === 'doc-updater');
        expect(agent).toBeDefined();
        expect(agent.agent).toBe('.agent-pipeline/agents/doc-updater.md');
        expect(agent.timeout).toBe(300);
      });

      it('should have doc-updater with no dependencies by default', async () => {
        await initCommand(tempDir);

        const pipelinePath = path.join(tempDir, '.agent-pipeline', 'pipelines', 'post-commit-example.yml');
        const content = await fs.readFile(pipelinePath, 'utf-8');
        const parsed = YAML.parse(content);

        const docUpdater = parsed.agents.find((a: any) => a.name === 'doc-updater');

        // doc-updater runs alone by default (full sequential flow is commented out)
        expect(docUpdater.dependsOn).toBeUndefined();
      });
    });
  });

  describe('Agent Creation', () => {
    it('should create all agents required by both pipelines', async () => {
      await initCommand(tempDir);

      const agentsDir = path.join(tempDir, '.agent-pipeline', 'agents');
      const files = await fs.readdir(agentsDir);
      const mdFiles = files.filter(f => f.endsWith('.md') && !f.startsWith('.')).sort();

      expect(mdFiles).toEqual(ALL_EXPECTED_AGENTS);
    });

    it('should create frontend design agents', async () => {
      await initCommand(tempDir);

      const agentsDir = path.join(tempDir, '.agent-pipeline', 'agents');
      const files = await fs.readdir(agentsDir);
      const mdFiles = files.filter(f => f.endsWith('.md'));

      for (const agent of FRONTEND_AGENTS) {
        expect(mdFiles).toContain(agent);
      }
    });

    it('should create post-commit agents', async () => {
      await initCommand(tempDir);

      const agentsDir = path.join(tempDir, '.agent-pipeline', 'agents');
      const files = await fs.readdir(agentsDir);
      const mdFiles = files.filter(f => f.endsWith('.md'));

      for (const agent of POST_COMMIT_AGENTS) {
        expect(mdFiles).toContain(agent);
      }
    });

    it('should include valid markdown in doc-updater agent', async () => {
      await initCommand(tempDir);

      const agentPath = path.join(tempDir, '.agent-pipeline', 'agents', 'doc-updater.md');
      const content = await fs.readFile(agentPath, 'utf-8');

      // Agent may have YAML frontmatter (---) or markdown header
      expect(content.startsWith('---') || content.match(/^# /m)).toBeTruthy();
      expect(content.length).toBeGreaterThan(100); // Has substantial content
    });

    it('should include valid markdown in product_owner agent', async () => {
      await initCommand(tempDir);

      const agentPath = path.join(tempDir, '.agent-pipeline', 'agents', 'product_owner.md');
      const content = await fs.readFile(agentPath, 'utf-8');

      expect(content).toMatch(/^# /m); // Has h1 header
      expect(content.length).toBeGreaterThan(100); // Has substantial content
    });

    it('should not create agents that already exist', async () => {
      // Pre-create doc-updater.md to simulate existing agent
      const agentsDir = path.join(tempDir, '.agent-pipeline', 'agents');
      await fs.mkdir(agentsDir, { recursive: true });
      await fs.writeFile(path.join(agentsDir, 'doc-updater.md'), '# Existing Updater', 'utf-8');

      await initCommand(tempDir);

      // Verify doc-updater.md was NOT overwritten
      const content = await fs.readFile(path.join(agentsDir, 'doc-updater.md'), 'utf-8');
      expect(content).toContain('# Existing Updater');
    });

    it('should create agents with proper markdown structure', async () => {
      await initCommand(tempDir);

      const agentNames = ['doc-updater.md', 'product_owner.md', 'showcase.md'];

      for (const agentName of agentNames) {
        const agentPath = path.join(tempDir, '.agent-pipeline', 'agents', agentName);
        const content = await fs.readFile(agentPath, 'utf-8');

        // Check agent has valid structure (frontmatter or markdown header)
        expect(content.startsWith('---') || content.match(/^# /m)).toBeTruthy();
        expect(content.length).toBeGreaterThan(50);
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
  });

  describe('Console Output', () => {
    it('should log initialization message', async () => {
      await initCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Agent Pipeline'));
    });

    it('should log directory creation confirmation', async () => {
      await initCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Created directory structure'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('.agent-pipeline/pipelines/'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('.agent-pipeline/agents/'));
    });

    it('should log pipeline creation confirmation', async () => {
      await initCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Creating pipelines'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('front-end-parallel-example.yml'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('post-commit-example.yml'));
    });

    it('should log agent creation confirmation', async () => {
      vi.spyOn(AgentImporter, 'discoverPluginAgents').mockResolvedValue([]);
      await initCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Created'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('agent(s)'));
    });

    it('should log success message', async () => {
      await initCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Agent Pipeline initialized successfully'));
    });

    it('should log next steps with correct commands', async () => {
      await initCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Next steps:'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('agent-pipeline run front-end-parallel-example'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('agent-pipeline run post-commit-example'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('agent-pipeline hooks install post-commit-example'));
    });

    it('should log plugin agent discovery information', async () => {
      vi.spyOn(AgentImporter, 'discoverPluginAgents').mockResolvedValue([
        { agentName: 'test', targetName: 'test.md', marketplace: 'm', plugin: 'p', originalPath: '/path' }
      ]);
      await initCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('agent(s) found'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('agent-pipeline agent pull'));
    });
  });

  describe('AgentImporter Integration', () => {
    it('should call AgentImporter.discoverPluginAgents', async () => {
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

    it('should not create agents that already exist from plugins', async () => {
      // Pre-create doc-updater.md to simulate existing agent
      const agentsDir = path.join(tempDir, '.agent-pipeline', 'agents');
      await fs.mkdir(agentsDir, { recursive: true });
      await fs.writeFile(path.join(agentsDir, 'doc-updater.md'), '# Plugin Agent', 'utf-8');

      vi.spyOn(AgentImporter, 'discoverPluginAgents').mockResolvedValue([]);
      await initCommand(tempDir);

      // Verify doc-updater.md was NOT overwritten
      const content = await fs.readFile(path.join(agentsDir, 'doc-updater.md'), 'utf-8');
      expect(content).toContain('# Plugin Agent');
    });

    it('should show fallback agent summary when creating required agents', async () => {
      vi.spyOn(AgentImporter, 'discoverPluginAgents').mockResolvedValue([]);

      await initCommand(tempDir);

      const calls = (console.log as any).mock.calls;
      const hasFallbackMessage = calls.some((call: any[]) =>
        call[0]?.includes('required by your pipelines')
      );

      expect(hasFallbackMessage).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should throw error on invalid path', async () => {
      const invalidPath = '/tmp/test\0invalid';

      await expect(initCommand(invalidPath)).rejects.toThrow();
    });

    it('should log error message on failure', async () => {
      const invalidPath = '/tmp/test\0invalid';

      await expect(initCommand(invalidPath)).rejects.toThrow();

      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Failed to initialize Agent Pipeline'));
    });

    it('should throw error when writing to read-only directory', async () => {
      const readOnlyDir = path.join(tempDir, 'readonly');
      await fs.mkdir(readOnlyDir, { recursive: true });
      await fs.chmod(readOnlyDir, 0o444);

      try {
        await expect(initCommand(readOnlyDir)).rejects.toThrow();
      } finally {
        await fs.chmod(readOnlyDir, 0o755);
      }
    });

    it('should handle missing parent directory gracefully', async () => {
      const nonExistentParent = path.join(tempDir, 'does-not-exist', 'subdir');

      await initCommand(nonExistentParent);

      const pipelinesDir = path.join(nonExistentParent, '.agent-pipeline', 'pipelines');
      expect(await fs.stat(pipelinesDir).then(() => true, () => false)).toBe(true);
    });
  });

  describe('Integration', () => {
    it('should create complete project structure in one command', async () => {
      await initCommand(tempDir);

      // Verify all directories
      const pipelinesDir = path.join(tempDir, '.agent-pipeline', 'pipelines');
      const agentsDir = path.join(tempDir, '.agent-pipeline', 'agents');
      expect(await fs.stat(pipelinesDir).then(() => true, () => false)).toBe(true);
      expect(await fs.stat(agentsDir).then(() => true, () => false)).toBe(true);

      // Verify both pipelines are created
      const pipelineFiles = await fs.readdir(pipelinesDir);
      const ymlFiles = pipelineFiles.filter(f => f.endsWith('.yml')).sort();
      expect(ymlFiles).toEqual(['front-end-parallel-example.yml', 'loop-example.yml', 'post-commit-example.yml']);

      // Verify all required agents are created
      const agentFiles = await fs.readdir(agentsDir);
      const mdFiles = agentFiles.filter(f => f.endsWith('.md') && !f.startsWith('.')).sort();
      expect(mdFiles).toEqual(ALL_EXPECTED_AGENTS);

      // Verify .gitignore
      const gitignorePath = path.join(tempDir, '.gitignore');
      expect(await fs.stat(gitignorePath).then(() => true, () => false)).toBe(true);
    });

    it('should create valid pipeline configuration readable by system', async () => {
      await initCommand(tempDir);

      const pipelinePath = path.join(tempDir, '.agent-pipeline', 'pipelines', 'front-end-parallel-example.yml');
      const content = await fs.readFile(pipelinePath, 'utf-8');
      const parsed = YAML.parse(content);

      expect(parsed.name).toBeDefined();
      expect(parsed.trigger).toBeDefined();
      expect(parsed.agents).toBeDefined();
      expect(Array.isArray(parsed.agents)).toBe(true);
      expect(parsed.execution).toBeDefined();
    });

    it('should be idempotent (safe to run multiple times)', async () => {
      await initCommand(tempDir);
      await initCommand(tempDir);

      const pipelinePath = path.join(tempDir, '.agent-pipeline', 'pipelines', 'front-end-parallel-example.yml');
      const content = await fs.readFile(pipelinePath, 'utf-8');
      const parsed = YAML.parse(content);

      expect(parsed.name).toBe('front-end-parallel-example');
      expect(parsed.agents).toHaveLength(5); // Default: product-owner, 3 design agents, showcase

      const pipelinesDir = path.join(tempDir, '.agent-pipeline', 'pipelines');
      const files = await fs.readdir(pipelinesDir);
      expect(files.filter(f => f.endsWith('.yml'))).toHaveLength(3);
    });

    it('should create files with correct encoding', async () => {
      await initCommand(tempDir);

      const pipelinePath = path.join(tempDir, '.agent-pipeline', 'pipelines', 'front-end-parallel-example.yml');
      const buffer = await fs.readFile(pipelinePath);

      const content = buffer.toString('utf-8');
      expect(content).toContain('front-end-parallel-example');
    });
  });

  describe('Pipeline Validation', () => {
    it('should validate created pipelines after init', async () => {
      await initCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Validating pipelines'));
    });

    it('should show valid status for all pipelines', async () => {
      await initCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('front-end-parallel-example: valid'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('loop-example: valid'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('post-commit-example: valid'));
    });

    it('should ensure pipeline templates are always valid', async () => {
      await initCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('initialized successfully'));
    });

    it('should fail validation and block success when runtime is unknown', async () => {
      AgentRuntimeRegistry.clear();

      await initCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('error'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Unknown runtime type'));

      const calls = (console.log as any).mock.calls;
      const hasSuccessMessage = calls.some((call: any[]) =>
        call[0]?.includes('initialized successfully')
      );
      expect(hasSuccessMessage).toBe(false);
    });

    it('should report validation issues message when validation fails', async () => {
      AgentRuntimeRegistry.clear();

      await initCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('validation issues'));
    });
  });
});
