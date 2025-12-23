// src/cli/commands/install.ts

import { PipelineLoader } from '../../config/pipeline-loader.js';
import { HookInstaller } from '../hooks.js';

export async function installCommand(
  repoPath: string,
  pipelineName: string
): Promise<void> {
  // Load pipeline config to get trigger type
  const loader = new PipelineLoader(repoPath);
  const { config } = await loader.loadPipeline(pipelineName);

  // Validate that the trigger is not 'manual'
  if (config.trigger === 'manual') {
    console.error('❌ Cannot install git hook for manual pipelines.');
    console.error(`   Pipeline "${pipelineName}" has trigger: manual`);
    console.error(`   Use 'agent-pipeline run ${pipelineName}' instead.`);
    process.exit(1);
  }

  // Require branch strategy for hook installs to prevent commit loops
  if (!config.git?.branchStrategy) {
    console.error('❌ Cannot install git hook without git.branchStrategy configured.');
    console.error(`   Pipeline "${pipelineName}" is missing git.branchStrategy`);
    console.error(`   Add git.branchStrategy (reusable, unique-per-run, or unique-and-delete), then re-run install.`);
    console.error(`   Use 'agent-pipeline run ${pipelineName}' to run on the current branch.`);
    process.exit(1);
  }

  if (config.git.branchStrategy === 'reusable') {
    console.warn('⚠️  git.branchStrategy is set to reusable.');
    console.warn('   For hook-triggered pipelines, unique-per-run or unique-and-delete is safer to avoid branch contention.');
  }

  if (config.settings?.autoCommit) {
    console.warn('⚠️  autoCommit is enabled for this hook-triggered pipeline.');
    console.warn('   This will create commits on the pipeline branch; disable autoCommit for read-only hooks.');
  }

  const installer = new HookInstaller(repoPath);
  await installer.install(pipelineName, config.trigger);
}
