// src/cli/commands/pipeline/export.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import * as YAML from 'yaml';
import { PipelineLoader } from '../../../config/pipeline-loader.js';

export interface ExportOptions {
  output?: string;
  includeAgents?: boolean;
}

export async function exportPipelineCommand(
  repoPath: string,
  pipelineName: string,
  options: ExportOptions = {}
): Promise<void> {
  try {
    const loader = new PipelineLoader(repoPath);
    const { config } = await loader.loadPipeline(pipelineName);

    let output = YAML.stringify(config);

    // Include agent files if requested
    if (options.includeAgents) {
      output += '\n\n# Agent Files\n\n';

      for (const agent of config.agents) {
        const agentPath = path.join(repoPath, agent.agent);
        try {
          const agentContent = await fs.readFile(agentPath, 'utf-8');
          output += `# Agent: ${agent.name} (${agent.agent})\n`;
          output += '```markdown\n';
          output += agentContent;
          output += '\n```\n\n';
        } catch {
          output += `# Agent: ${agent.name} - Could not read file: ${agent.agent}\n\n`;
        }
      }
    }

    // Output to file or stdout
    if (options.output) {
      await fs.writeFile(options.output, output, 'utf-8');
      console.log(`✅ Pipeline exported to: ${options.output}`);

      if (options.includeAgents) {
        console.log(`   (includes ${config.agents.length} agent file(s))`);
      }
      console.log('');
    } else {
      console.log(output);
    }
  } catch (error) {
    if ((error as any).message?.includes('Pipeline not found')) {
      console.error(`❌ Pipeline "${pipelineName}" not found`);
    } else {
      console.error(`❌ Failed to export pipeline: ${(error as Error).message}`);
    }
    process.exit(1);
  }
}
