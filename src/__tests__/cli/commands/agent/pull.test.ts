import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { pullAgentsCommand } from '../../../../cli/commands/agent/pull.js';
import { AgentImporter } from '../../../../cli/utils/agent-importer.js';
import { InteractivePrompts } from '../../../../cli/utils/interactive-prompts.js';
import { createTempDir, cleanupTempDir } from '../../../setup.js';
import * as fs from 'fs/promises';
import * as path from 'path';

// Mock AgentImporter and InteractivePrompts
vi.mock('../../../../cli/utils/agent-importer.js');
vi.mock('../../../../cli/utils/interactive-prompts.js');

describe('pullAgentsCommand', () => {
  let tempDir: string;
  let agentsDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir('agent-pull-test-');
    agentsDir = path.join(tempDir, '.claude', 'agents');
    await fs.mkdir(agentsDir, { recursive: true });
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
    vi.clearAllMocks();
  });

  describe('Agent Import from Plugins', () => {
    it('should import agents from Claude Code plugins', async () => {
      vi.mocked(AgentImporter.importPluginAgents).mockResolvedValue({
        total: 3,
        imported: 3,
        skipped: 0,
        agents: [
          {
            agentName: 'agent1',
            targetName: 'agent1.md',
            marketplace: 'marketplace1',
            plugin: 'plugin1',
            originalPath: '/path/to/agent1.md',
          },
          {
            agentName: 'agent2',
            targetName: 'agent2.md',
            marketplace: 'marketplace1',
            plugin: 'plugin1',
            originalPath: '/path/to/agent2.md',
          },
          {
            agentName: 'agent3',
            targetName: 'agent3.md',
            marketplace: 'marketplace2',
            plugin: 'plugin2',
            originalPath: '/path/to/agent3.md',
          },
        ],
      });

      await pullAgentsCommand(tempDir);

      expect(AgentImporter.importPluginAgents).toHaveBeenCalledWith(agentsDir);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Agent pull complete'));
    });

    it('should create agents directory if it does not exist', async () => {
      await fs.rm(agentsDir, { recursive: true, force: true });

      vi.mocked(AgentImporter.importPluginAgents).mockResolvedValue({
        total: 1,
        imported: 1,
        skipped: 0,
        agents: [],
      });

      await pullAgentsCommand(tempDir);

      const exists = await fs.access(agentsDir).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should show success message after import', async () => {
      vi.mocked(AgentImporter.importPluginAgents).mockResolvedValue({
        total: 2,
        imported: 2,
        skipped: 0,
        agents: [],
      });

      await pullAgentsCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Agent pull complete'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Next steps:'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('agent-pipeline agent list'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('agent-pipeline create'));
    });
  });

  describe('No Plugins Found', () => {
    it('should show tips when no agents imported', async () => {
      vi.mocked(AgentImporter.importPluginAgents).mockResolvedValue({
        total: 0,
        imported: 0,
        skipped: 0,
        agents: [],
      });

      await pullAgentsCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Tips for adding agents'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Install Claude Code plugins'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Create custom agents'));
      expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('Agent pull complete'));
    });

    it('should not prompt for updates when no agents imported', async () => {
      vi.mocked(AgentImporter.importPluginAgents).mockResolvedValue({
        total: 0,
        imported: 0,
        skipped: 0,
        agents: [],
      });

      await pullAgentsCommand(tempDir);

      expect(InteractivePrompts.confirm).not.toHaveBeenCalled();
    });
  });

  describe('Conflict Handling', () => {
    it('should detect when agents are skipped', async () => {
      vi.mocked(AgentImporter.importPluginAgents).mockResolvedValue({
        total: 3,
        imported: 1,
        skipped: 2,
        agents: [],
      });
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(false);

      await pullAgentsCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('2 agent(s) already exist'));
      expect(InteractivePrompts.confirm).toHaveBeenCalledWith(
        expect.stringContaining('see which agents have updates available'),
        true
      );
    });

    it('should prompt to check for updates when conflicts exist', async () => {
      vi.mocked(AgentImporter.importPluginAgents).mockResolvedValue({
        total: 2,
        imported: 0,
        skipped: 2,
        agents: [
          {
            agentName: 'existing-agent',
            targetName: 'existing-agent.md',
            marketplace: 'marketplace1',
            plugin: 'plugin1',
            originalPath: path.join(tempDir, 'source', 'existing-agent.md'),
          },
        ],
      });
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(true);

      // Create existing agent
      await fs.writeFile(path.join(agentsDir, 'existing-agent.md'), '# Old Version', 'utf-8');

      // Create source agent (different content)
      const sourceDir = path.join(tempDir, 'source');
      await fs.mkdir(sourceDir, { recursive: true });
      await fs.writeFile(path.join(sourceDir, 'existing-agent.md'), '# New Version', 'utf-8');

      await pullAgentsCommand(tempDir);

      expect(InteractivePrompts.confirm).toHaveBeenCalled();
    });

    it('should skip update check if user declines', async () => {
      vi.mocked(AgentImporter.importPluginAgents).mockResolvedValue({
        total: 2,
        imported: 0,
        skipped: 2,
        agents: [],
      });
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(false);

      await pullAgentsCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('2 agent(s) already exist'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Agent pull complete'));
    });
  });

  describe('Agent Update Flow', () => {
    it('should detect agents with updates available', async () => {
      const sourceDir = path.join(tempDir, 'source');
      await fs.mkdir(sourceDir, { recursive: true });

      // Create existing agent with old content
      await fs.writeFile(
        path.join(agentsDir, 'test-agent.md'),
        '<!--\nImported from...\n-->\n\n# Old Content',
        'utf-8'
      );

      // Create source agent with new content
      await fs.writeFile(path.join(sourceDir, 'test-agent.md'), '# New Content', 'utf-8');

      vi.mocked(AgentImporter.importPluginAgents).mockResolvedValue({
        total: 1,
        imported: 0,
        skipped: 1,
        agents: [
          {
            agentName: 'test-agent',
            targetName: 'test-agent.md',
            marketplace: 'marketplace1',
            plugin: 'plugin1',
            originalPath: path.join(sourceDir, 'test-agent.md'),
          },
        ],
      });
      vi.mocked(InteractivePrompts.confirm)
        .mockResolvedValueOnce(true)  // Check for updates
        .mockResolvedValueOnce(false); // Don't update

      await pullAgentsCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('test-agent - UPDATE AVAILABLE'));
    });

    it('should update agent when user confirms', async () => {
      const sourceDir = path.join(tempDir, 'source');
      await fs.mkdir(sourceDir, { recursive: true });

      // Create existing agent
      await fs.writeFile(
        path.join(agentsDir, 'test-agent.md'),
        '<!--\nImported from...\n-->\n\n# Old Content',
        'utf-8'
      );

      // Create source agent
      await fs.writeFile(path.join(sourceDir, 'test-agent.md'), '# New Content', 'utf-8');

      vi.mocked(AgentImporter.importPluginAgents).mockResolvedValue({
        total: 1,
        imported: 0,
        skipped: 1,
        agents: [
          {
            agentName: 'test-agent',
            targetName: 'test-agent.md',
            marketplace: 'marketplace1',
            plugin: 'plugin1',
            originalPath: path.join(sourceDir, 'test-agent.md'),
          },
        ],
      });
      vi.mocked(InteractivePrompts.confirm)
        .mockResolvedValueOnce(true)  // Check for updates
        .mockResolvedValueOnce(true);  // Update agent

      await pullAgentsCommand(tempDir);

      const updatedContent = await fs.readFile(path.join(agentsDir, 'test-agent.md'), 'utf-8');
      expect(updatedContent).toContain('# New Content');
      expect(updatedContent).toContain('Imported from Claude Code Plugin');
      expect(updatedContent).toContain('Updated:');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Updated'));
    });

    it('should skip update when user declines', async () => {
      const sourceDir = path.join(tempDir, 'source');
      await fs.mkdir(sourceDir, { recursive: true });

      const oldContent = '<!--\nImported from...\n-->\n\n# Old Content';
      await fs.writeFile(path.join(agentsDir, 'test-agent.md'), oldContent, 'utf-8');
      await fs.writeFile(path.join(sourceDir, 'test-agent.md'), '# New Content', 'utf-8');

      vi.mocked(AgentImporter.importPluginAgents).mockResolvedValue({
        total: 1,
        imported: 0,
        skipped: 1,
        agents: [
          {
            agentName: 'test-agent',
            targetName: 'test-agent.md',
            marketplace: 'marketplace1',
            plugin: 'plugin1',
            originalPath: path.join(sourceDir, 'test-agent.md'),
          },
        ],
      });
      vi.mocked(InteractivePrompts.confirm)
        .mockResolvedValueOnce(true)  // Check for updates
        .mockResolvedValueOnce(false); // Skip update

      await pullAgentsCommand(tempDir);

      const content = await fs.readFile(path.join(agentsDir, 'test-agent.md'), 'utf-8');
      expect(content).toBe(oldContent);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Skipped'));
    });

    it('should not show update when content is identical', async () => {
      const sourceDir = path.join(tempDir, 'source');
      await fs.mkdir(sourceDir, { recursive: true });

      const sameContent = '# Same Content';
      await fs.writeFile(
        path.join(agentsDir, 'test-agent.md'),
        `<!--\nMetadata\n-->\n\n${sameContent}`,
        'utf-8'
      );
      await fs.writeFile(path.join(sourceDir, 'test-agent.md'), sameContent, 'utf-8');

      vi.mocked(AgentImporter.importPluginAgents).mockResolvedValue({
        total: 1,
        imported: 0,
        skipped: 1,
        agents: [
          {
            agentName: 'test-agent',
            targetName: 'test-agent.md',
            marketplace: 'marketplace1',
            plugin: 'plugin1',
            originalPath: path.join(sourceDir, 'test-agent.md'),
          },
        ],
      });
      vi.mocked(InteractivePrompts.confirm).mockResolvedValueOnce(true); // Check for updates

      await pullAgentsCommand(tempDir);

      expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE AVAILABLE'));
    });

    it('should handle multiple agents with updates', async () => {
      const sourceDir = path.join(tempDir, 'source');
      await fs.mkdir(sourceDir, { recursive: true });

      // Create two existing agents
      await fs.writeFile(
        path.join(agentsDir, 'agent1.md'),
        '<!--\nMeta\n-->\n\n# Old 1',
        'utf-8'
      );
      await fs.writeFile(
        path.join(agentsDir, 'agent2.md'),
        '<!--\nMeta\n-->\n\n# Old 2',
        'utf-8'
      );

      // Create source agents with new content
      await fs.writeFile(path.join(sourceDir, 'agent1.md'), '# New 1', 'utf-8');
      await fs.writeFile(path.join(sourceDir, 'agent2.md'), '# New 2', 'utf-8');

      vi.mocked(AgentImporter.importPluginAgents).mockResolvedValue({
        total: 2,
        imported: 0,
        skipped: 2,
        agents: [
          {
            agentName: 'agent1',
            targetName: 'agent1.md',
            marketplace: 'marketplace1',
            plugin: 'plugin1',
            originalPath: path.join(sourceDir, 'agent1.md'),
          },
          {
            agentName: 'agent2',
            targetName: 'agent2.md',
            marketplace: 'marketplace1',
            plugin: 'plugin1',
            originalPath: path.join(sourceDir, 'agent2.md'),
          },
        ],
      });
      vi.mocked(InteractivePrompts.confirm)
        .mockResolvedValueOnce(true)  // Check for updates
        .mockResolvedValueOnce(true)  // Update agent1
        .mockResolvedValueOnce(false); // Skip agent2

      await pullAgentsCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('agent1 - UPDATE AVAILABLE'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('agent2 - UPDATE AVAILABLE'));

      const agent1Content = await fs.readFile(path.join(agentsDir, 'agent1.md'), 'utf-8');
      expect(agent1Content).toContain('# New 1');

      const agent2Content = await fs.readFile(path.join(agentsDir, 'agent2.md'), 'utf-8');
      expect(agent2Content).toContain('# Old 2');
    });
  });

  describe('Custom Source Option', () => {
    it('should show warning for custom source and fallback to plugins', async () => {
      vi.mocked(AgentImporter.importPluginAgents).mockResolvedValue({
        total: 1,
        imported: 1,
        skipped: 0,
        agents: [],
      });

      await pullAgentsCommand(tempDir, { source: 'https://example.com/agents' });

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Custom source pull not yet implemented'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Falling back to Claude Code plugins'));
      expect(AgentImporter.importPluginAgents).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle import errors gracefully', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

      vi.mocked(AgentImporter.importPluginAgents).mockRejectedValue(
        new Error('Plugin directory not found')
      );

      await pullAgentsCommand(tempDir);

      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Failed to pull agents'));
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Plugin directory not found'));
      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
    });

    it('should exit with code 1 on error', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

      vi.mocked(AgentImporter.importPluginAgents).mockRejectedValue(new Error('Test error'));

      await pullAgentsCommand(tempDir);

      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
    });

    it('should handle file access errors during update check', async () => {
      vi.mocked(AgentImporter.importPluginAgents).mockResolvedValue({
        total: 1,
        imported: 0,
        skipped: 1,
        agents: [
          {
            agentName: 'missing-agent',
            targetName: 'missing-agent.md',
            marketplace: 'marketplace1',
            plugin: 'plugin1',
            originalPath: '/nonexistent/path/agent.md',
          },
        ],
      });
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(true);

      // Should not throw, just skip the agent
      await pullAgentsCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Agent pull complete'));
    });
  });

  describe('Console Output', () => {
    it('should show checking for updates message', async () => {
      vi.mocked(AgentImporter.importPluginAgents).mockResolvedValue({
        total: 1,
        imported: 0,
        skipped: 1,
        agents: [],
      });
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(true);

      await pullAgentsCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Checking for agent updates'));
    });

    it('should display next steps after successful pull', async () => {
      vi.mocked(AgentImporter.importPluginAgents).mockResolvedValue({
        total: 3,
        imported: 3,
        skipped: 0,
        agents: [],
      });

      await pullAgentsCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Next steps:'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('View agents: agent-pipeline agent list'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Create pipeline: agent-pipeline create'));
    });
  });

  describe('Edge Cases', () => {
    it('should handle all agents being skipped', async () => {
      vi.mocked(AgentImporter.importPluginAgents).mockResolvedValue({
        total: 5,
        imported: 0,
        skipped: 5,
        agents: [],
      });
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(false);

      await pullAgentsCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('5 agent(s) already exist'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Agent pull complete'));
    });

    it('should handle partial import (some new, some skipped)', async () => {
      vi.mocked(AgentImporter.importPluginAgents).mockResolvedValue({
        total: 10,
        imported: 6,
        skipped: 4,
        agents: [],
      });
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(false);

      await pullAgentsCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('4 agent(s) already exist'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Agent pull complete'));
    });

    it('should handle empty agents directory creation', async () => {
      const nonExistentDir = path.join(tempDir, 'new-repo');

      vi.mocked(AgentImporter.importPluginAgents).mockResolvedValue({
        total: 1,
        imported: 1,
        skipped: 0,
        agents: [],
      });

      await pullAgentsCommand(nonExistentDir);

      const agentsDirPath = path.join(nonExistentDir, '.claude', 'agents');
      const exists = await fs.access(agentsDirPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });
  });

  describe('Integration', () => {
    it('should complete full workflow with new imports', async () => {
      vi.mocked(AgentImporter.importPluginAgents).mockResolvedValue({
        total: 3,
        imported: 3,
        skipped: 0,
        agents: [],
      });

      await pullAgentsCommand(tempDir);

      expect(AgentImporter.importPluginAgents).toHaveBeenCalledWith(agentsDir);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Agent pull complete'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Next steps:'));
    });

    it('should complete full workflow with no agents found', async () => {
      vi.mocked(AgentImporter.importPluginAgents).mockResolvedValue({
        total: 0,
        imported: 0,
        skipped: 0,
        agents: [],
      });

      await pullAgentsCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Tips for adding agents'));
      expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('Agent pull complete'));
    });

    it('should complete full update workflow', async () => {
      const sourceDir = path.join(tempDir, 'source');
      await fs.mkdir(sourceDir, { recursive: true });

      await fs.writeFile(
        path.join(agentsDir, 'agent.md'),
        '<!--\nMeta\n-->\n\n# Old',
        'utf-8'
      );
      await fs.writeFile(path.join(sourceDir, 'agent.md'), '# New', 'utf-8');

      vi.mocked(AgentImporter.importPluginAgents).mockResolvedValue({
        total: 1,
        imported: 0,
        skipped: 1,
        agents: [
          {
            agentName: 'agent',
            targetName: 'agent.md',
            marketplace: 'marketplace1',
            plugin: 'plugin1',
            originalPath: path.join(sourceDir, 'agent.md'),
          },
        ],
      });
      vi.mocked(InteractivePrompts.confirm)
        .mockResolvedValueOnce(true)  // Check updates
        .mockResolvedValueOnce(true);  // Update agent

      await pullAgentsCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('1 agent(s) already exist'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Checking for agent updates'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('agent - UPDATE AVAILABLE'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Updated'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Agent pull complete'));
    });
  });
});
