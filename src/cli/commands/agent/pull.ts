// src/cli/commands/agent/pull.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import { AgentImporter } from '../../utils/agent-importer.js';
import { InteractivePrompts } from '../../utils/interactive-prompts.js';

export interface PullAgentsOptions {
  source?: string;
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

    // Import from Claude Code plugins
    const summary = await AgentImporter.importPluginAgents(agentsDir);

    if (summary.total === 0) {
      console.log('\n💡 Tips for adding agents:');
      console.log('   1. Install Claude Code plugins with agent collections');
      console.log('   2. Create custom agents in .claude/agents/');
      console.log('   3. Import agents from files or URLs (coming soon)\n');
      return;
    }

    // Check for conflicts (agents that were skipped because they exist)
    if (summary.skipped > 0) {
      console.log(`\n⚠️  ${summary.skipped} agent(s) already exist\n`);

      const update = await InteractivePrompts.confirm(
        'Would you like to see which agents have updates available?',
        true
      );

      if (update) {
        console.log('\n📊 Checking for agent updates...\n');

        for (const agent of summary.agents) {
          const targetPath = path.join(agentsDir, agent.targetName);

          try {
            await fs.access(targetPath);

            // Read both versions and compare
            const existing = await fs.readFile(targetPath, 'utf-8');
            const source = await fs.readFile(agent.originalPath, 'utf-8');

            // Remove metadata header for comparison
            const cleanExisting = existing.replace(/<!--[\s\S]*?-->\n\n/, '');
            const cleanSource = source;

            if (cleanExisting !== cleanSource) {
              console.log(`   📝 ${agent.agentName} - UPDATE AVAILABLE`);

              const override = await InteractivePrompts.confirm(
                `      Update ${agent.agentName}?`,
                false
              );

              if (override) {
                const enhancedContent = `<!--
Imported from Claude Code Plugin
Marketplace: ${agent.marketplace}
Plugin: ${agent.plugin}
Original: ${agent.agentName}.md
Imported: ${new Date().toISOString()}
Updated: ${new Date().toISOString()}
-->

${cleanSource}`;

                await fs.writeFile(targetPath, enhancedContent, 'utf-8');
                console.log(`      ✅ Updated\n`);
              } else {
                console.log(`      ⏭️  Skipped\n`);
              }
            }
          } catch {
            // Agent doesn't exist, skip
          }
        }
      }
    }

    console.log('\n✅ Agent pull complete!\n');
    console.log('💡 Next steps:');
    console.log('   - View agents: agent-pipeline agent list');
    console.log('   - Create pipeline: agent-pipeline create\n');

  } catch (error) {
    console.error(`❌ Failed to pull agents: ${(error as Error).message}`);
    process.exit(1);
  }
}
