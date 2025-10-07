// src/cli/commands/cleanup.ts

import { BranchManager } from '../../core/branch-manager.js';

export async function cleanupCommand(
  repoPath: string,
  options: { pipeline?: string; force?: boolean } = {}
): Promise<void> {
  const branchManager = new BranchManager(repoPath);

  // List all pipeline branches
  const pipelineBranches = await branchManager.listPipelineBranches('pipeline');

  // Filter by pipeline name if specified
  const branchesToDelete = options.pipeline
    ? pipelineBranches.filter(b => b.includes(options.pipeline!))
    : pipelineBranches;

  if (branchesToDelete.length === 0) {
    console.log('No pipeline branches found to clean up');
    return;
  }

  console.log('Pipeline branches to delete:');
  branchesToDelete.forEach(b => console.log(`  - ${b}`));

  if (!options.force) {
    console.log('\nRun with --force to delete these branches');
    console.log('Example: agent-pipeline cleanup --force');
    return;
  }

  console.log('\n🧹 Cleaning up pipeline branches...\n');

  for (const branch of branchesToDelete) {
    try {
      await branchManager.deleteLocalBranch(branch, true);
      console.log(`✅ Deleted ${branch}`);
    } catch (error) {
      console.error(`❌ Failed to delete ${branch}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log('\n✨ Cleanup complete!');
}
