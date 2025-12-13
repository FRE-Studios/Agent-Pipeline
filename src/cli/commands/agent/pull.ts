// src/cli/commands/agent/pull.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import { AgentImporter, ImportedAgent } from '../../utils/agent-importer.js';
import { InteractivePrompts } from '../../utils/interactive-prompts.js';

export interface PullAgentsOptions {
  source?: string;
  all?: boolean;
}

export async function pullAgentsCommand(
  repoPath: string,
  options: PullAgentsOptions = {}
): Promise<void> {
  const agentsDir = path.join(repoPath, '.claude', 'agents');

  try {
    // Ensure agents directory exists
    await fs.mkdir(agentsDir, { recursive: true });

    if (options.source) {
      // Pull from custom source (future feature)
      console.log('⚠️  Custom source pull not yet implemented');
      console.log('   Falling back to Claude Code plugins\n');
    }

    // Discover available agents
    console.log('\n📦 Searching for Claude Code plugin agents...');
    const discoveredAgents = await AgentImporter.discoverPluginAgents();

    if (discoveredAgents.length === 0) {
      console.log('\n💡 Tips for adding agents:');
      console.log('   1. Install Claude Code plugins with agent collections');
      console.log('   2. Create custom agents in .claude/agents/');
      console.log('   3. Import agents from files or URLs (coming soon)\n');
      return;
    }

    console.log(`   Found ${discoveredAgents.length} agent(s) across installed plugins\n`);

    // If --all flag, import all agents
    if (options.all) {
      await AgentImporter.importPluginAgents(agentsDir, { silent: true });
      await showImportSummary(agentsDir, discoveredAgents);
      return;
    }

    // Interactive selection
    const selectedAgents = await selectAgentsInteractively(discoveredAgents);

    if (selectedAgents.length === 0) {
      console.log('\nNo agents selected. Exiting.\n');
      return;
    }

    // Import selected agents
    await AgentImporter.importSelectedAgents(agentsDir, selectedAgents);

    console.log('✅ Agent pull complete!\n');
    console.log('💡 Next steps:');
    console.log('   - View agents: agent-pipeline agent list');
    console.log('   - Create pipeline: agent-pipeline create\n');

  } catch (error) {
    console.error(`❌ Failed to pull agents: ${(error as Error).message}`);
    process.exit(1);
  }
}

/**
 * Interactive agent selection using multiSelect
 */
async function selectAgentsInteractively(agents: ImportedAgent[]): Promise<ImportedAgent[]> {
  // Group agents by marketplace/plugin for display
  const grouped = agents.reduce((acc, agent) => {
    const key = `${agent.marketplace}/${agent.plugin}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(agent);
    return acc;
  }, {} as Record<string, ImportedAgent[]>);

  // Build options list with plugin grouping info
  const options: { name: string; value: string }[] = [];
  const agentMap = new Map<string, ImportedAgent>();

  for (const [pluginKey, pluginAgents] of Object.entries(grouped)) {
    for (const agent of pluginAgents) {
      const key = `${agent.marketplace}:${agent.plugin}:${agent.agentName}`;
      options.push({
        name: `${agent.agentName} (${pluginKey})`,
        value: key
      });
      agentMap.set(key, agent);
    }
  }

  const selectedKeys = await InteractivePrompts.multiSelect(
    '\nSelect agents to import:',
    options
  );

  return selectedKeys
    .map(key => agentMap.get(key))
    .filter((agent): agent is ImportedAgent => agent !== undefined);
}

/**
 * Show import summary after --all import
 */
async function showImportSummary(agentsDir: string, agents: ImportedAgent[]): Promise<void> {
  let imported = 0;
  let skipped = 0;

  for (const agent of agents) {
    const targetPath = path.join(agentsDir, agent.targetName);
    try {
      await fs.access(targetPath);
      // File exists - was either imported or skipped
      const content = await fs.readFile(targetPath, 'utf-8');
      if (content.includes('Imported from Claude Code Plugin')) {
        imported++;
      } else {
        skipped++;
      }
    } catch {
      skipped++;
    }
  }

  console.log(`\n📊 Import complete: ${imported} imported, ${skipped} skipped\n`);
  console.log('✅ Agent pull complete!\n');
  console.log('💡 Next steps:');
  console.log('   - View agents: agent-pipeline agent list');
  console.log('   - Create pipeline: agent-pipeline create\n');
}
