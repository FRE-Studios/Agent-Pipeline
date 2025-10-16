// src/cli/commands/agent/info.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import { PipelineLoader } from '../../../config/pipeline-loader.js';

export async function agentInfoCommand(
  repoPath: string,
  agentName: string
): Promise<void> {
  try {
    const agentsDir = path.join(repoPath, '.claude', 'agents');

    // Try with and without .md extension
    let agentPath = path.join(agentsDir, `${agentName}.md`);

    try {
      await fs.access(agentPath);
    } catch {
      // Try without adding .md (in case user provided it)
      agentPath = path.join(agentsDir, agentName);
      await fs.access(agentPath);
    }

    // Read agent content
    const content = await fs.readFile(agentPath, 'utf-8');
    const stats = await fs.stat(agentPath);

    // Find pipelines using this agent
    const loader = new PipelineLoader(repoPath);
    const allPipelines = await loader.listPipelines();
    const usingPipelines: string[] = [];

    for (const pipelineName of allPipelines) {
      try {
        const config = await loader.loadPipeline(pipelineName);
        const agentFile = path.basename(agentPath);
        const isUsed = config.agents.some(a =>
          a.agent.endsWith(agentFile) ||
          a.agent.endsWith(agentName)
        );
        if (isUsed) {
          usingPipelines.push(pipelineName);
        }
      } catch {
        // Skip invalid pipelines
      }
    }

    // Display agent info
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Agent: ${path.basename(agentPath, '.md')}`);
    console.log(`${'='.repeat(80)}\n`);

    console.log(`File: ${path.relative(repoPath, agentPath)}`);
    console.log(`Size: ${stats.size} bytes`);
    console.log(`Modified: ${stats.mtime.toLocaleString()}`);

    if (usingPipelines.length > 0) {
      console.log(`\nUsed by ${usingPipelines.length} pipeline(s):`);
      usingPipelines.forEach(p => console.log(`  - ${p}`));
    } else {
      console.log('\nNot currently used by any pipelines');
    }

    console.log(`\n${'─'.repeat(80)}\n`);
    console.log('Content:\n');
    console.log(content);
    console.log(`\n${'='.repeat(80)}\n`);

  } catch (error) {
    if ((error as any).code === 'ENOENT') {
      console.error(`❌ Agent "${agentName}" not found`);
      console.error('   Run "agent-pipeline agent list" to see available agents\n');
    } else {
      console.error(`❌ Failed to read agent info: ${(error as Error).message}`);
    }
    process.exit(1);
  }
}
