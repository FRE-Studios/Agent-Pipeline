import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { pullAgentsCommand } from '../../../../cli/commands/agent/pull.js';
import { AgentImporter, ImportedAgent } from '../../../../cli/utils/agent-importer.js';
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

  const mockAgents: ImportedAgent[] = [
    {
      agentName: 'agent1',
      targetName: 'plugin1-agent1.md',
      marketplace: 'marketplace1',
      plugin: 'plugin1',
      originalPath: '/path/to/agent1.md',
    },
    {
      agentName: 'agent2',
      targetName: 'plugin1-agent2.md',
      marketplace: 'marketplace1',
      plugin: 'plugin1',
      originalPath: '/path/to/agent2.md',
    },
    {
      agentName: 'agent3',
      targetName: 'plugin2-agent3.md',
      marketplace: 'marketplace2',
      plugin: 'plugin2',
      originalPath: '/path/to/agent3.md',
    },
  ];

  beforeEach(async () => {
    tempDir = await createTempDir('agent-pull-test-');
    agentsDir = path.join(tempDir, '.agent-pipeline', 'agents');
    await fs.mkdir(agentsDir, { recursive: true });
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
    vi.clearAllMocks();
  });

  describe('Agent Discovery', () => {
    it('should discover agents from Claude Code plugins', async () => {
      vi.mocked(AgentImporter.discoverPluginAgents).mockResolvedValue(mockAgents);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue([]);

      await pullAgentsCommand(tempDir);

      expect(AgentImporter.discoverPluginAgents).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Found 3 agent(s)'));
    });

    it('should create agents directory if it does not exist', async () => {
      await fs.rm(agentsDir, { recursive: true, force: true });
      vi.mocked(AgentImporter.discoverPluginAgents).mockResolvedValue([]);

      await pullAgentsCommand(tempDir);

      const exists = await fs.access(agentsDir).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });
  });

  describe('No Plugins Found', () => {
    it('should show tips when no agents discovered', async () => {
      vi.mocked(AgentImporter.discoverPluginAgents).mockResolvedValue([]);

      await pullAgentsCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Tips for adding agents'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Install Claude Code plugins'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Create custom agents'));
      expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('Agent pull complete'));
    });

    it('should not prompt for selection when no agents discovered', async () => {
      vi.mocked(AgentImporter.discoverPluginAgents).mockResolvedValue([]);

      await pullAgentsCommand(tempDir);

      expect(InteractivePrompts.multiSelect).not.toHaveBeenCalled();
    });
  });

  describe('Interactive Selection', () => {
    it('should show interactive selection when agents are found', async () => {
      vi.mocked(AgentImporter.discoverPluginAgents).mockResolvedValue(mockAgents);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue([]);

      await pullAgentsCommand(tempDir);

      expect(InteractivePrompts.multiSelect).toHaveBeenCalledWith(
        expect.stringContaining('Select agents to import'),
        expect.any(Array)
      );
    });

    it('should pass agent options to multiSelect', async () => {
      vi.mocked(AgentImporter.discoverPluginAgents).mockResolvedValue(mockAgents);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue([]);

      await pullAgentsCommand(tempDir);

      const multiSelectCall = vi.mocked(InteractivePrompts.multiSelect).mock.calls[0];
      const options = multiSelectCall[1];

      expect(options).toHaveLength(3);
      expect(options[0].name).toContain('agent1');
      expect(options[0].name).toContain('marketplace1/plugin1');
    });

    it('should import selected agents', async () => {
      vi.mocked(AgentImporter.discoverPluginAgents).mockResolvedValue(mockAgents);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue([
        'marketplace1:plugin1:agent1',
        'marketplace2:plugin2:agent3'
      ]);
      vi.mocked(AgentImporter.importSelectedAgents).mockResolvedValue({
        total: 2,
        imported: 2,
        skipped: 0,
        agents: [mockAgents[0], mockAgents[2]]
      });

      await pullAgentsCommand(tempDir);

      expect(AgentImporter.importSelectedAgents).toHaveBeenCalledWith(
        agentsDir,
        expect.arrayContaining([
          expect.objectContaining({ agentName: 'agent1' }),
          expect.objectContaining({ agentName: 'agent3' })
        ])
      );
    });

    it('should show exit message when no agents selected', async () => {
      vi.mocked(AgentImporter.discoverPluginAgents).mockResolvedValue(mockAgents);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue([]);

      await pullAgentsCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No agents selected'));
      expect(AgentImporter.importSelectedAgents).not.toHaveBeenCalled();
    });

    it('should show success message after import', async () => {
      vi.mocked(AgentImporter.discoverPluginAgents).mockResolvedValue(mockAgents);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue([
        'marketplace1:plugin1:agent1'
      ]);
      vi.mocked(AgentImporter.importSelectedAgents).mockResolvedValue({
        total: 1,
        imported: 1,
        skipped: 0,
        agents: [mockAgents[0]]
      });

      await pullAgentsCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Agent pull complete'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Next steps:'));
    });
  });

  describe('--all Flag', () => {
    it('should import all agents when --all flag is set', async () => {
      vi.mocked(AgentImporter.discoverPluginAgents).mockResolvedValue(mockAgents);
      vi.mocked(AgentImporter.importPluginAgents).mockResolvedValue({
        total: 3,
        imported: 3,
        skipped: 0,
        agents: mockAgents
      });

      await pullAgentsCommand(tempDir, { all: true });

      expect(AgentImporter.importPluginAgents).toHaveBeenCalledWith(agentsDir, { silent: true });
      expect(InteractivePrompts.multiSelect).not.toHaveBeenCalled();
    });

    it('should show summary after --all import', async () => {
      vi.mocked(AgentImporter.discoverPluginAgents).mockResolvedValue(mockAgents);
      vi.mocked(AgentImporter.importPluginAgents).mockResolvedValue({
        total: 3,
        imported: 3,
        skipped: 0,
        agents: mockAgents
      });

      // Create mock imported files to simulate successful import
      for (const agent of mockAgents) {
        await fs.writeFile(
          path.join(agentsDir, agent.targetName),
          `<!--\nImported from Claude Code Plugin\n-->\n\n# ${agent.agentName}`,
          'utf-8'
        );
      }

      await pullAgentsCommand(tempDir, { all: true });

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Agent pull complete'));
    });
  });

  describe('Custom Source Option', () => {
    it('should show warning for custom source and fallback to plugins', async () => {
      vi.mocked(AgentImporter.discoverPluginAgents).mockResolvedValue([]);

      await pullAgentsCommand(tempDir, { source: 'https://example.com/agents' });

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Custom source pull not yet implemented'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Falling back to Claude Code plugins'));
      expect(AgentImporter.discoverPluginAgents).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle discovery errors gracefully', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);

      vi.mocked(AgentImporter.discoverPluginAgents).mockRejectedValue(
        new Error('Plugin directory not found')
      );

      await pullAgentsCommand(tempDir);

      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Failed to pull agents'));
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Plugin directory not found'));
      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
    });

    it('should exit with code 1 on error', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);

      vi.mocked(AgentImporter.discoverPluginAgents).mockRejectedValue(new Error('Test error'));

      await pullAgentsCommand(tempDir);

      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
    });
  });

  describe('Console Output', () => {
    it('should show searching message', async () => {
      vi.mocked(AgentImporter.discoverPluginAgents).mockResolvedValue([]);

      await pullAgentsCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Searching for Claude Code plugin agents'));
    });

    it('should display next steps after successful pull', async () => {
      vi.mocked(AgentImporter.discoverPluginAgents).mockResolvedValue(mockAgents);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue([
        'marketplace1:plugin1:agent1'
      ]);
      vi.mocked(AgentImporter.importSelectedAgents).mockResolvedValue({
        total: 1,
        imported: 1,
        skipped: 0,
        agents: [mockAgents[0]]
      });

      await pullAgentsCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Next steps:'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('View agents: agent-pipeline agent list'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Create pipeline: agent-pipeline create'));
    });
  });

  describe('Edge Cases', () => {
    it('should handle single agent selection', async () => {
      vi.mocked(AgentImporter.discoverPluginAgents).mockResolvedValue([mockAgents[0]]);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue([
        'marketplace1:plugin1:agent1'
      ]);
      vi.mocked(AgentImporter.importSelectedAgents).mockResolvedValue({
        total: 1,
        imported: 1,
        skipped: 0,
        agents: [mockAgents[0]]
      });

      await pullAgentsCommand(tempDir);

      expect(AgentImporter.importSelectedAgents).toHaveBeenCalledWith(
        agentsDir,
        expect.arrayContaining([expect.objectContaining({ agentName: 'agent1' })])
      );
    });

    it('should handle empty agents directory creation', async () => {
      const nonExistentDir = path.join(tempDir, 'new-repo');

      vi.mocked(AgentImporter.discoverPluginAgents).mockResolvedValue([]);

      await pullAgentsCommand(nonExistentDir);

      const agentsDirPath = path.join(nonExistentDir, '.agent-pipeline', 'agents');
      const exists = await fs.access(agentsDirPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });
  });

  describe('Integration', () => {
    it('should complete full workflow with interactive selection', async () => {
      vi.mocked(AgentImporter.discoverPluginAgents).mockResolvedValue(mockAgents);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue([
        'marketplace1:plugin1:agent1',
        'marketplace1:plugin1:agent2'
      ]);
      vi.mocked(AgentImporter.importSelectedAgents).mockResolvedValue({
        total: 2,
        imported: 2,
        skipped: 0,
        agents: [mockAgents[0], mockAgents[1]]
      });

      await pullAgentsCommand(tempDir);

      expect(AgentImporter.discoverPluginAgents).toHaveBeenCalled();
      expect(InteractivePrompts.multiSelect).toHaveBeenCalled();
      expect(AgentImporter.importSelectedAgents).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Agent pull complete'));
    });

    it('should complete full workflow with --all flag', async () => {
      vi.mocked(AgentImporter.discoverPluginAgents).mockResolvedValue(mockAgents);
      vi.mocked(AgentImporter.importPluginAgents).mockResolvedValue({
        total: 3,
        imported: 3,
        skipped: 0,
        agents: mockAgents
      });

      // Create mock imported files
      for (const agent of mockAgents) {
        await fs.writeFile(
          path.join(agentsDir, agent.targetName),
          `<!--\nImported from Claude Code Plugin\n-->\n\n# ${agent.agentName}`,
          'utf-8'
        );
      }

      await pullAgentsCommand(tempDir, { all: true });

      expect(AgentImporter.discoverPluginAgents).toHaveBeenCalled();
      expect(AgentImporter.importPluginAgents).toHaveBeenCalled();
      expect(InteractivePrompts.multiSelect).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Agent pull complete'));
    });

    it('should complete full workflow with no agents found', async () => {
      vi.mocked(AgentImporter.discoverPluginAgents).mockResolvedValue([]);

      await pullAgentsCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Tips for adding agents'));
      expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('Agent pull complete'));
    });
  });
});
