// src/__tests__/cli/utils/agent-importer.test.ts
// Tests for AgentImporter utility

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentImporter } from '../../../cli/utils/agent-importer.js';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

// Mock dependencies
vi.mock('fs/promises');
vi.mock('os');

describe('AgentImporter', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  describe('getClaudePluginsBasePath()', () => {
    it('should return macOS path when platform is darwin', () => {
      vi.mocked(os.platform).mockReturnValue('darwin');
      vi.mocked(os.homedir).mockReturnValue('/Users/testuser');

      const result = AgentImporter.getClaudePluginsBasePath();

      expect(result).toBe('/Users/testuser/.claude/plugins/marketplaces');
    });

    it('should return Windows path when platform is win32', () => {
      vi.mocked(os.platform).mockReturnValue('win32');
      vi.mocked(os.homedir).mockReturnValue('C:\\Users\\testuser');

      const result = AgentImporter.getClaudePluginsBasePath();

      // path.join normalizes to forward slashes, so we check the path components
      expect(result).toContain('testuser');
      expect(result).toContain('AppData');
      expect(result).toContain('Roaming');
      expect(result).toContain('Claude');
      expect(result).toContain('plugins');
      expect(result).toContain('marketplaces');
    });

    it('should return Linux path when platform is linux', () => {
      vi.mocked(os.platform).mockReturnValue('linux');
      vi.mocked(os.homedir).mockReturnValue('/home/testuser');

      const result = AgentImporter.getClaudePluginsBasePath();

      expect(result).toBe('/home/testuser/.claude/plugins/marketplaces');
    });

    it('should default to Linux path for unknown platforms', () => {
      vi.mocked(os.platform).mockReturnValue('freebsd' as NodeJS.Platform);
      vi.mocked(os.homedir).mockReturnValue('/home/testuser');

      const result = AgentImporter.getClaudePluginsBasePath();

      expect(result).toBe('/home/testuser/.claude/plugins/marketplaces');
    });
  });

  describe('discoverPluginAgents()', () => {
    beforeEach(() => {
      vi.mocked(os.platform).mockReturnValue('darwin');
      vi.mocked(os.homedir).mockReturnValue('/Users/testuser');
    });

    it('should return empty array when plugins directory does not exist', async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

      const result = await AgentImporter.discoverPluginAgents();

      expect(result).toEqual([]);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('No Claude Code plugins found')
      );
    });

    it('should discover agents from plugin directories', async () => {
      const basePath = '/Users/testuser/.claude/plugins/marketplaces';

      // Mock directory structure:
      // marketplaces/
      //   claude-code-plugins/
      //     plugins/
      //       code-reviewer/
      //         agents/
      //           review.md
      //           audit.md

      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readdir)
        .mockResolvedValueOnce(['claude-code-plugins'] as any) // marketplaces
        .mockResolvedValueOnce(['code-reviewer', 'test-plugin'] as any) // plugins
        .mockResolvedValueOnce(['review.md', 'audit.md'] as any) // agents in code-reviewer
        .mockResolvedValueOnce(['helper.md'] as any); // agents in test-plugin

      const result = await AgentImporter.discoverPluginAgents();

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        originalPath: path.join(basePath, 'claude-code-plugins/plugins/code-reviewer/agents/review.md'),
        marketplace: 'claude-code-plugins',
        plugin: 'code-reviewer',
        agentName: 'review',
        targetName: 'code-reviewer-review.md'
      });
      expect(result[1]).toEqual({
        originalPath: path.join(basePath, 'claude-code-plugins/plugins/code-reviewer/agents/audit.md'),
        marketplace: 'claude-code-plugins',
        plugin: 'code-reviewer',
        agentName: 'audit',
        targetName: 'code-reviewer-audit.md'
      });
      expect(result[2]).toEqual({
        originalPath: path.join(basePath, 'claude-code-plugins/plugins/test-plugin/agents/helper.md'),
        marketplace: 'claude-code-plugins',
        plugin: 'test-plugin',
        agentName: 'helper',
        targetName: 'test-plugin-helper.md'
      });
    });

    it('should handle multiple marketplaces', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readdir)
        .mockResolvedValueOnce(['marketplace1', 'marketplace2'] as any)
        .mockResolvedValueOnce(['plugin1'] as any) // marketplace1/plugins
        .mockResolvedValueOnce(['agent1.md'] as any) // marketplace1/plugins/plugin1/agents
        .mockResolvedValueOnce(['plugin2'] as any) // marketplace2/plugins
        .mockResolvedValueOnce(['agent2.md'] as any); // marketplace2/plugins/plugin2/agents

      const result = await AgentImporter.discoverPluginAgents();

      expect(result).toHaveLength(2);
      expect(result[0].marketplace).toBe('marketplace1');
      expect(result[1].marketplace).toBe('marketplace2');
    });

    it('should skip plugins without agents directory', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readdir)
        .mockResolvedValueOnce(['marketplace'] as any)
        .mockResolvedValueOnce(['plugin-with-agents', 'plugin-no-agents'] as any)
        .mockResolvedValueOnce(['agent.md'] as any) // plugin-with-agents
        .mockRejectedValueOnce(new Error('ENOENT')); // plugin-no-agents fails

      const result = await AgentImporter.discoverPluginAgents();

      expect(result).toHaveLength(1);
      expect(result[0].plugin).toBe('plugin-with-agents');
    });

    it('should filter out non-.md files', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readdir)
        .mockResolvedValueOnce(['marketplace'] as any)
        .mockResolvedValueOnce(['plugin'] as any)
        .mockResolvedValueOnce(['agent.md', 'readme.txt', 'config.json', 'test.MD'] as any);

      const result = await AgentImporter.discoverPluginAgents();

      // Only .md files should be included (case-sensitive check)
      expect(result).toHaveLength(1);
      expect(result[0].agentName).toBe('agent');
    });

    it('should handle errors gracefully during scanning', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockRejectedValue(new Error('Permission denied'));

      const result = await AgentImporter.discoverPluginAgents();

      expect(result).toEqual([]);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error scanning for plugins')
      );
    });

    it('should handle marketplace directory read errors', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readdir)
        .mockResolvedValueOnce(['marketplace1', 'marketplace2'] as any)
        .mockRejectedValueOnce(new Error('Permission denied')) // marketplace1 fails
        .mockResolvedValueOnce(['plugin'] as any) // marketplace2 succeeds
        .mockResolvedValueOnce(['agent.md'] as any);

      const result = await AgentImporter.discoverPluginAgents();

      // Should still get agents from marketplace2
      expect(result).toHaveLength(1);
      expect(result[0].marketplace).toBe('marketplace2');
    });
  });

  describe('importPluginAgents()', () => {
    const targetDir = '/test/agents';

    beforeEach(() => {
      vi.mocked(os.platform).mockReturnValue('darwin');
      vi.mocked(os.homedir).mockReturnValue('/Users/testuser');
    });

    it('should import agents with metadata headers', async () => {
      const mockAgents = [
        {
          originalPath: '/path/to/agent.md',
          marketplace: 'test-marketplace',
          plugin: 'test-plugin',
          agentName: 'reviewer',
          targetName: 'test-plugin-reviewer.md'
        }
      ];

      vi.mocked(fs.access)
        .mockResolvedValueOnce(undefined) // basePath exists
        .mockRejectedValueOnce(new Error('ENOENT')); // target doesn't exist

      vi.mocked(fs.readdir)
        .mockResolvedValueOnce(['test-marketplace'] as any)
        .mockResolvedValueOnce(['test-plugin'] as any)
        .mockResolvedValueOnce(['reviewer.md'] as any);

      vi.mocked(fs.readFile).mockResolvedValue('# Test Agent\n\nAgent content here');
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const result = await AgentImporter.importPluginAgents(targetDir);

      expect(result.total).toBe(1);
      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(0);

      // Verify metadata was added
      expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith(
        path.join(targetDir, 'test-plugin-reviewer.md'),
        expect.stringContaining('Imported from Claude Code Plugin'),
        'utf-8'
      );
      expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith(
        path.join(targetDir, 'test-plugin-reviewer.md'),
        expect.stringContaining('Marketplace: test-marketplace'),
        'utf-8'
      );
      expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith(
        path.join(targetDir, 'test-plugin-reviewer.md'),
        expect.stringContaining('# Test Agent'),
        'utf-8'
      );
    });

    it('should skip agents that already exist', async () => {
      vi.mocked(fs.access)
        .mockResolvedValueOnce(undefined) // basePath exists
        .mockResolvedValueOnce(undefined); // target exists (skip)

      vi.mocked(fs.readdir)
        .mockResolvedValueOnce(['marketplace'] as any)
        .mockResolvedValueOnce(['plugin'] as any)
        .mockResolvedValueOnce(['existing.md'] as any);

      const result = await AgentImporter.importPluginAgents(targetDir);

      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(1);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('already exists, skipping')
      );

      // Manifest should be written, but not the agent file
      const agentFilePath = path.join(targetDir, 'plugin-existing.md');
      const writeFileCalls = vi.mocked(fs.writeFile).mock.calls;
      const agentFileWritten = writeFileCalls.some(call => call[0] === agentFilePath);
      expect(agentFileWritten).toBe(false);
    });

    it('should return empty summary when no plugins found', async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

      const result = await AgentImporter.importPluginAgents(targetDir);

      expect(result).toEqual({
        total: 0,
        imported: 0,
        skipped: 0,
        agents: []
      });
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('No plugin agents found')
      );
    });

    it('should create import manifest with correct data', async () => {
      vi.mocked(fs.access)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('ENOENT'));

      vi.mocked(fs.readdir)
        .mockResolvedValueOnce(['marketplace'] as any)
        .mockResolvedValueOnce(['plugin'] as any)
        .mockResolvedValueOnce(['agent.md'] as any);

      vi.mocked(fs.readFile).mockResolvedValue('Agent content');
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await AgentImporter.importPluginAgents(targetDir);

      // Find the manifest write call
      const manifestCall = vi.mocked(fs.writeFile).mock.calls.find(
        call => call[0] === path.join(targetDir, '.import-manifest.json')
      );

      expect(manifestCall).toBeDefined();

      const manifest = JSON.parse(manifestCall![1] as string);
      expect(manifest).toMatchObject({
        pluginsPath: expect.stringContaining('.claude/plugins/marketplaces'),
        summary: {
          total: 1,
          imported: 1,
          skipped: 0
        },
        agents: [
          {
            marketplace: 'marketplace',
            plugin: 'plugin',
            original: 'agent',
            target: 'plugin-agent.md'
          }
        ]
      });
      expect(manifest.importedAt).toBeDefined();
    });

    it('should work in silent mode without most console output', async () => {
      vi.mocked(fs.access)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('ENOENT'));

      vi.mocked(fs.readdir)
        .mockResolvedValueOnce(['marketplace'] as any)
        .mockResolvedValueOnce(['plugin'] as any)
        .mockResolvedValueOnce(['agent.md'] as any);

      vi.mocked(fs.readFile).mockResolvedValue('Content');
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await AgentImporter.importPluginAgents(targetDir, { silent: true });

      // Silent mode should suppress most output, but doesn't suppress
      // the plugin grouping header or import status messages
      expect(consoleLogSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Searching for Claude Code plugin agents')
      );
      expect(consoleLogSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Import complete')
      );
    });

    it('should handle multiple agents from different plugins', async () => {
      vi.mocked(fs.access)
        .mockResolvedValueOnce(undefined) // basePath exists
        .mockRejectedValueOnce(new Error('ENOENT')) // agent1 doesn't exist
        .mockRejectedValueOnce(new Error('ENOENT')); // agent2 doesn't exist

      vi.mocked(fs.readdir)
        .mockResolvedValueOnce(['marketplace'] as any)
        .mockResolvedValueOnce(['plugin1', 'plugin2'] as any)
        .mockResolvedValueOnce(['agent1.md'] as any) // plugin1
        .mockResolvedValueOnce(['agent2.md'] as any); // plugin2

      vi.mocked(fs.readFile).mockResolvedValue('Content');
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const result = await AgentImporter.importPluginAgents(targetDir);

      expect(result.total).toBe(2);
      expect(result.imported).toBe(2);
      expect(result.skipped).toBe(0);
    });

    it('should group agents by marketplace/plugin in console output', async () => {
      vi.mocked(fs.access)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('ENOENT'));

      vi.mocked(fs.readdir)
        .mockResolvedValueOnce(['marketplace'] as any)
        .mockResolvedValueOnce(['plugin'] as any)
        .mockResolvedValueOnce(['agent.md'] as any);

      vi.mocked(fs.readFile).mockResolvedValue('Content');
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await AgentImporter.importPluginAgents(targetDir);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('📂 marketplace/plugin:')
      );
    });

    it('should handle file read errors gracefully', async () => {
      vi.mocked(fs.access)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('ENOENT'));

      vi.mocked(fs.readdir)
        .mockResolvedValueOnce(['marketplace'] as any)
        .mockResolvedValueOnce(['plugin'] as any)
        .mockResolvedValueOnce(['agent.md'] as any);

      vi.mocked(fs.readFile).mockRejectedValue(new Error('Permission denied'));

      const result = await AgentImporter.importPluginAgents(targetDir);

      expect(result.imported).toBe(0);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('❌')
      );
    });

    it('should provide correct summary statistics', async () => {
      vi.mocked(fs.access)
        .mockResolvedValueOnce(undefined) // basePath
        .mockResolvedValueOnce(undefined) // agent1 exists (skip)
        .mockRejectedValueOnce(new Error('ENOENT')) // agent2 doesn't exist
        .mockRejectedValueOnce(new Error('ENOENT')); // agent3 doesn't exist

      vi.mocked(fs.readdir)
        .mockResolvedValueOnce(['marketplace'] as any)
        .mockResolvedValueOnce(['plugin'] as any)
        .mockResolvedValueOnce(['agent1.md', 'agent2.md', 'agent3.md'] as any);

      vi.mocked(fs.readFile)
        .mockResolvedValueOnce('Content 2')
        .mockRejectedValueOnce(new Error('Read error')); // agent3 fails

      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const result = await AgentImporter.importPluginAgents(targetDir);

      expect(result.total).toBe(3);
      expect(result.imported).toBe(1); // Only agent2 imported
      expect(result.skipped).toBe(1); // agent1 skipped
      // agent3 failed but still counted in total

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Import complete: 1 imported, 1 skipped')
      );
    });
  });

  describe('importSelectedAgents()', () => {
    const targetDir = '/test/agents';

    beforeEach(() => {
      vi.mocked(os.platform).mockReturnValue('darwin');
      vi.mocked(os.homedir).mockReturnValue('/Users/testuser');
    });

    it('should return empty summary when no agents selected', async () => {
      const result = await AgentImporter.importSelectedAgents(targetDir, []);

      expect(result).toEqual({
        total: 0,
        imported: 0,
        skipped: 0,
        agents: []
      });
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('No agents selected')
      );
    });

    it('should import selected agents with metadata headers', async () => {
      const selectedAgents = [
        {
          originalPath: '/path/to/agent.md',
          marketplace: 'test-marketplace',
          plugin: 'test-plugin',
          agentName: 'reviewer',
          targetName: 'test-plugin-reviewer.md'
        }
      ];

      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT')); // target doesn't exist
      vi.mocked(fs.readFile).mockResolvedValue('# Test Agent\n\nAgent content here');
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const result = await AgentImporter.importSelectedAgents(targetDir, selectedAgents);

      expect(result.total).toBe(1);
      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(0);

      // Verify metadata was added
      expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith(
        path.join(targetDir, 'test-plugin-reviewer.md'),
        expect.stringContaining('Imported from Claude Code Plugin'),
        'utf-8'
      );
      expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith(
        path.join(targetDir, 'test-plugin-reviewer.md'),
        expect.stringContaining('Marketplace: test-marketplace'),
        'utf-8'
      );
    });

    it('should skip agents that already exist', async () => {
      const selectedAgents = [
        {
          originalPath: '/path/to/existing.md',
          marketplace: 'marketplace',
          plugin: 'plugin',
          agentName: 'existing',
          targetName: 'plugin-existing.md'
        }
      ];

      vi.mocked(fs.access).mockResolvedValue(undefined); // target exists
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const result = await AgentImporter.importSelectedAgents(targetDir, selectedAgents);

      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(1);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('already exists, skipping')
      );
    });

    it('should handle multiple agents from different plugins', async () => {
      const selectedAgents = [
        {
          originalPath: '/path/to/agent1.md',
          marketplace: 'marketplace',
          plugin: 'plugin1',
          agentName: 'agent1',
          targetName: 'plugin1-agent1.md'
        },
        {
          originalPath: '/path/to/agent2.md',
          marketplace: 'marketplace',
          plugin: 'plugin2',
          agentName: 'agent2',
          targetName: 'plugin2-agent2.md'
        }
      ];

      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(fs.readFile).mockResolvedValue('Content');
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const result = await AgentImporter.importSelectedAgents(targetDir, selectedAgents);

      expect(result.total).toBe(2);
      expect(result.imported).toBe(2);
      expect(result.skipped).toBe(0);
    });

    it('should group agents by marketplace/plugin in console output', async () => {
      const selectedAgents = [
        {
          originalPath: '/path/to/agent.md',
          marketplace: 'my-marketplace',
          plugin: 'my-plugin',
          agentName: 'agent',
          targetName: 'my-plugin-agent.md'
        }
      ];

      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(fs.readFile).mockResolvedValue('Content');
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await AgentImporter.importSelectedAgents(targetDir, selectedAgents);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('📂 my-marketplace/my-plugin:')
      );
    });

    it('should handle file read errors gracefully', async () => {
      const selectedAgents = [
        {
          originalPath: '/path/to/agent.md',
          marketplace: 'marketplace',
          plugin: 'plugin',
          agentName: 'agent',
          targetName: 'plugin-agent.md'
        }
      ];

      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(fs.readFile).mockRejectedValue(new Error('Permission denied'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const result = await AgentImporter.importSelectedAgents(targetDir, selectedAgents);

      expect(result.imported).toBe(0);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('❌')
      );
    });

    it('should create import manifest with selected agents data', async () => {
      const selectedAgents = [
        {
          originalPath: '/path/to/agent.md',
          marketplace: 'marketplace',
          plugin: 'plugin',
          agentName: 'agent',
          targetName: 'plugin-agent.md'
        }
      ];

      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(fs.readFile).mockResolvedValue('Agent content');
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await AgentImporter.importSelectedAgents(targetDir, selectedAgents);

      // Find the manifest write call
      const manifestCall = vi.mocked(fs.writeFile).mock.calls.find(
        call => call[0] === path.join(targetDir, '.import-manifest.json')
      );

      expect(manifestCall).toBeDefined();

      const manifest = JSON.parse(manifestCall![1] as string);
      expect(manifest).toMatchObject({
        pluginsPath: expect.stringContaining('.claude/plugins/marketplaces'),
        summary: {
          total: 1,
          imported: 1,
          skipped: 0
        },
        agents: [
          {
            marketplace: 'marketplace',
            plugin: 'plugin',
            original: 'agent',
            target: 'plugin-agent.md'
          }
        ]
      });
      expect(manifest.importedAt).toBeDefined();
    });

    it('should provide correct summary statistics with mixed results', async () => {
      const selectedAgents = [
        {
          originalPath: '/path/to/agent1.md',
          marketplace: 'marketplace',
          plugin: 'plugin',
          agentName: 'agent1',
          targetName: 'plugin-agent1.md'
        },
        {
          originalPath: '/path/to/agent2.md',
          marketplace: 'marketplace',
          plugin: 'plugin',
          agentName: 'agent2',
          targetName: 'plugin-agent2.md'
        },
        {
          originalPath: '/path/to/agent3.md',
          marketplace: 'marketplace',
          plugin: 'plugin',
          agentName: 'agent3',
          targetName: 'plugin-agent3.md'
        }
      ];

      vi.mocked(fs.access)
        .mockResolvedValueOnce(undefined) // agent1 exists (skip)
        .mockRejectedValueOnce(new Error('ENOENT')) // agent2 doesn't exist
        .mockRejectedValueOnce(new Error('ENOENT')); // agent3 doesn't exist

      vi.mocked(fs.readFile)
        .mockResolvedValueOnce('Content 2')
        .mockRejectedValueOnce(new Error('Read error')); // agent3 fails

      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const result = await AgentImporter.importSelectedAgents(targetDir, selectedAgents);

      expect(result.total).toBe(3);
      expect(result.imported).toBe(1); // Only agent2 imported
      expect(result.skipped).toBe(1); // agent1 skipped

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Import complete: 1 imported, 1 skipped')
      );
    });

    it('should display importing message with agent count', async () => {
      const selectedAgents = [
        {
          originalPath: '/path/to/agent1.md',
          marketplace: 'marketplace',
          plugin: 'plugin',
          agentName: 'agent1',
          targetName: 'plugin-agent1.md'
        },
        {
          originalPath: '/path/to/agent2.md',
          marketplace: 'marketplace',
          plugin: 'plugin',
          agentName: 'agent2',
          targetName: 'plugin-agent2.md'
        }
      ];

      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(fs.readFile).mockResolvedValue('Content');
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await AgentImporter.importSelectedAgents(targetDir, selectedAgents);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Importing 2 agent(s)')
      );
    });
  });
});
