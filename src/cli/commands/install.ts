// src/cli/commands/install.ts

import { PipelineLoader } from '../../config/pipeline-loader.js';
import { HookInstaller } from '../hooks.js';

export async function installCommand(
  repoPath: string,
  pipelineName: string
): Promise<void> {
  // Load pipeline config to get trigger type
  const loader = new PipelineLoader(repoPath);
  const config = await loader.loadPipeline(pipelineName);

  // Validate that the trigger is not 'manual'
  if (config.trigger === 'manual') {
    console.error('❌ Cannot install git hook for manual pipelines.');
    console.error(`   Pipeline "${pipelineName}" has trigger: manual`);
    console.error(`   Use 'agent-pipeline run ${pipelineName}' instead.`);
    process.exit(1);
  }

  const installer = new HookInstaller(repoPath);
  await installer.install(pipelineName, config.trigger);
}
