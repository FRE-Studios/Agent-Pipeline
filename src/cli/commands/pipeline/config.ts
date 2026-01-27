// src/cli/commands/pipeline/config.ts

import * as YAML from 'yaml';
import { PipelineLoader } from '../../../config/pipeline-loader.js';

export async function configPipelineCommand(
  repoPath: string,
  pipelineName: string
): Promise<void> {
  try {
    const loader = new PipelineLoader(repoPath);
    const config = await loader.loadPipeline(pipelineName);

    console.log(`\n⚙️  Configuration for: ${pipelineName}\n`);
    console.log('─'.repeat(60));
    console.log(YAML.stringify(config));
    console.log('─'.repeat(60));
    console.log('');
  } catch (error) {
    if ((error as any).message?.includes('Pipeline not found')) {
      console.error(`❌ Pipeline "${pipelineName}" not found`);
    } else {
      console.error(`❌ Failed to load configuration: ${(error as Error).message}`);
    }
    process.exit(1);
  }
}
