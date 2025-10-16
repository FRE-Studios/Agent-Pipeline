// src/cli/commands/list.ts

import { PipelineLoader } from '../../config/pipeline-loader.js';

export async function listCommand(repoPath: string): Promise<void> {
  const loader = new PipelineLoader(repoPath);
  const pipelines = await loader.listPipelines();

  if (pipelines.length === 0) {
    console.log('No pipelines found in .agent-pipeline/pipelines/');
  } else {
    console.log('Available pipelines:');
    pipelines.forEach(p => console.log(`  - ${p}`));
  }
}
