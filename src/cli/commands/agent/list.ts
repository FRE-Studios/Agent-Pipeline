// src/cli/commands/agent/list.ts

import * as fs from 'fs/promises';
import * as path from 'path';

interface AgentInfo {
  name: string;
  path: string;
  description: string;
  modified: Date;
}

export async function listAgentsCommand(repoPath: string): Promise<void> {
  try {
    const agentsDir = path.join(repoPath, '.claude', 'agents');

    try {
      await fs.access(agentsDir);
    } catch {
      console.log('❌ No agents directory found');
      console.log('   Run "agent-pipeline init" to set up the project\n');
      return;
    }

    const files = await fs.readdir(agentsDir);
    const mdFiles = files.filter(f => f.endsWith('.md') && !f.startsWith('.'));

    if (mdFiles.length === 0) {
      console.log('\n📋 No agents found\n');
      console.log('💡 Import agents from Claude Code plugins:');
      console.log('   agent-pipeline agent pull\n');
      return;
    }

    // Read agent info
    const agents: AgentInfo[] = [];

    for (const file of mdFiles) {
      const filePath = path.join(agentsDir, file);
      const stats = await fs.stat(filePath);
      const content = await fs.readFile(filePath, 'utf-8');

      // Extract first # header as description
      const headerMatch = content.match(/^#\s+(.+)$/m);
      const description = headerMatch ? headerMatch[1] : 'No description';

      agents.push({
        name: path.basename(file, '.md'),
        path: file,
        description,
        modified: stats.mtime
      });
    }

    // Sort by name
    agents.sort((a, b) => a.name.localeCompare(b.name));

    // Display table
    console.log(`\n📋 Available Agents (${agents.length})\n`);
    console.log('─'.repeat(80));
    console.log(
      'NAME'.padEnd(30) +
      'DESCRIPTION'.padEnd(40) +
      'MODIFIED'
    );
    console.log('─'.repeat(80));

    for (const agent of agents) {
      const modifiedStr = agent.modified.toLocaleDateString();
      console.log(
        agent.name.padEnd(30).substring(0, 30) +
        agent.description.padEnd(40).substring(0, 40) +
        modifiedStr
      );
    }

    console.log('─'.repeat(80));
    console.log('\n💡 View agent details: agent-pipeline agent info <agent-name>\n');
  } catch (error) {
    console.error(`❌ Failed to list agents: ${(error as Error).message}`);
    process.exit(1);
  }
}
