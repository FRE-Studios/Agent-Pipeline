// src/cli/utils/agent-importer.ts
// Utility for discovering and importing Claude Code plugin agents

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

export interface ImportedAgent {
  originalPath: string;
  marketplace: string;
  plugin: string;
  agentName: string;
  targetName: string;
}

export interface ImportSummary {
  total: number;
  imported: number;
  skipped: number;
  agents: ImportedAgent[];
}

export class AgentImporter {
  /**
   * Get the base path for Claude Code plugins based on platform
   */
  static getClaudePluginsBasePath(): string {
    const platform = os.platform();
    const homeDir = os.homedir();

    switch (platform) {
      case 'darwin': // macOS
        return path.join(homeDir, '.claude', 'plugins', 'marketplaces');

      case 'win32': // Windows
        return path.join(homeDir, 'AppData', 'Roaming', 'Claude', 'plugins', 'marketplaces');

      case 'linux':
      default:
        return path.join(homeDir, '.claude', 'plugins', 'marketplaces');
    }
  }

  /**
   * Discover all agent files in installed Claude Code plugins
   */
  static async discoverPluginAgents(): Promise<ImportedAgent[]> {
    const basePath = AgentImporter.getClaudePluginsBasePath();
    const discoveredAgents: ImportedAgent[] = [];

    try {
      // Check if plugins directory exists
      await fs.access(basePath);
    } catch {
      console.log(`ℹ️  No Claude Code plugins found at: ${basePath}`);
      return [];
    }

    try {
      // Iterate through marketplaces
      const marketplaces = await fs.readdir(basePath);

      for (const marketplace of marketplaces) {
        const marketplacePath = path.join(basePath, marketplace, 'plugins');

        try {
          // Iterate through plugins in this marketplace
          const plugins = await fs.readdir(marketplacePath);

          for (const plugin of plugins) {
            const agentsPath = path.join(marketplacePath, plugin, 'agents');

            try {
              // Check if agents directory exists
              const agentFiles = await fs.readdir(agentsPath);
              const mdFiles = agentFiles.filter(f => f.endsWith('.md'));

              for (const agentFile of mdFiles) {
                const agentName = path.basename(agentFile, '.md');
                discoveredAgents.push({
                  originalPath: path.join(agentsPath, agentFile),
                  marketplace,
                  plugin,
                  agentName,
                  // Create a unique name to avoid conflicts
                  targetName: `${plugin}-${agentName}.md`
                });
              }
            } catch {
              // No agents directory in this plugin
            }
          }
        } catch {
          // Could not read plugins directory for this marketplace
        }
      }
    } catch (error) {
      console.log(`⚠️  Error scanning for plugins: ${(error as Error).message}`);
    }

    return discoveredAgents;
  }

  /**
   * Import plugin agents into the target directory
   */
  static async importPluginAgents(targetAgentsDir: string, options?: { silent?: boolean }): Promise<ImportSummary> {
    const silent = options?.silent ?? false;

    if (!silent) {
      console.log('\n📦 Searching for Claude Code plugin agents...');
    }

    const agents = await AgentImporter.discoverPluginAgents();

    if (agents.length === 0) {
      if (!silent) {
        console.log('   No plugin agents found to import.\n');
      }
      return { total: 0, imported: 0, skipped: 0, agents: [] };
    }

    if (!silent) {
      console.log(`   Found ${agents.length} agent(s) across installed plugins\n`);
    }

    // Group agents by marketplace and plugin for better display
    const grouped = agents.reduce((acc, agent) => {
      const key = `${agent.marketplace}/${agent.plugin}`;
      if (!acc[key]) acc[key] = [];
      acc[key].push(agent);
      return acc;
    }, {} as Record<string, ImportedAgent[]>);

    // Import agents and show progress
    let imported = 0;
    let skipped = 0;

    for (const [key, pluginAgents] of Object.entries(grouped)) {
      if (!silent) {
        console.log(`   📂 ${key}:`);
      }

      for (const agent of pluginAgents) {
        const targetPath = path.join(targetAgentsDir, agent.targetName);

        try {
          // Check if target already exists
          try {
            await fs.access(targetPath);
            if (!silent) {
              console.log(`      ⏭️  ${agent.agentName} (already exists, skipping)`);
            }
            skipped++;
            continue;
          } catch {
            // File doesn't exist, good to import
          }

          // Read the original agent file
          const content = await fs.readFile(agent.originalPath, 'utf-8');

          // Add metadata header to imported agent
          const enhancedContent = `<!--
Imported from Claude Code Plugin
Marketplace: ${agent.marketplace}
Plugin: ${agent.plugin}
Original: ${agent.agentName}.md
Imported: ${new Date().toISOString()}
-->

${content}`;

          await fs.writeFile(targetPath, enhancedContent, 'utf-8');
          if (!silent) {
            console.log(`      ✅ ${agent.agentName}`);
          }
          imported++;
        } catch (error) {
          if (!silent) {
            console.log(`      ❌ ${agent.agentName} (${(error as Error).message})`);
          }
        }
      }
    }

    // Create import manifest for tracking
    const manifestPath = path.join(targetAgentsDir, '.import-manifest.json');
    const manifest = {
      importedAt: new Date().toISOString(),
      pluginsPath: AgentImporter.getClaudePluginsBasePath(),
      summary: {
        total: agents.length,
        imported,
        skipped
      },
      agents: agents.map(a => ({
        marketplace: a.marketplace,
        plugin: a.plugin,
        original: a.agentName,
        target: a.targetName
      }))
    };

    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

    if (!silent) {
      console.log(`\n   📊 Import complete: ${imported} imported, ${skipped} skipped\n`);
    }

    return { total: agents.length, imported, skipped, agents };
  }
}
