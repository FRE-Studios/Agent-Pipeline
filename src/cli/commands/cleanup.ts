// src/cli/commands/cleanup.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import { BranchManager } from '../../core/branch-manager.js';
import { InteractivePrompts } from '../utils/interactive-prompts.js';

export interface CleanupOptions {
  pipeline?: string;
  force?: boolean;
  deleteLogs?: boolean;
}

export async function cleanupCommand(
  repoPath: string,
  options: CleanupOptions = {}
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
    console.log('         agent-pipeline cleanup --force --delete-logs');
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

  // Handle log deletion
  if (options.deleteLogs !== undefined ? options.deleteLogs : false) {
    await deleteAssociatedLogs(repoPath, options.pipeline);
  } else if (branchesToDelete.length > 0) {
    // Ask user if they want to delete logs
    const shouldDeleteLogs = await InteractivePrompts.confirm(
      '\nDelete associated history files?',
      false
    );

    if (shouldDeleteLogs) {
      await deleteAssociatedLogs(repoPath, options.pipeline);
    }
  }

  console.log('\n✨ Cleanup complete!');
}

/**
 * Delete state/log files for specific pipelines
 */
async function deleteAssociatedLogs(
  repoPath: string,
  pipelineName?: string
): Promise<void> {
  const stateDir = path.join(repoPath, '.agent-pipeline', 'state', 'runs');

  try {
    console.log('\n🗑️  Deleting history files...\n');

    const stateFiles = await fs.readdir(stateDir);
    let deletedCount = 0;

    for (const file of stateFiles) {
      if (!file.endsWith('.json')) continue;

      const statePath = path.join(stateDir, file);
      const content = await fs.readFile(statePath, 'utf-8');
      const state = JSON.parse(content);

      // If pipeline name is specified, only delete logs for that pipeline
      // Otherwise, delete all logs for pipeline branches we're cleaning up
      const shouldDelete = pipelineName
        ? state.pipelineConfig?.name === pipelineName
        : true; // Delete all if no specific pipeline

      if (shouldDelete) {
        await fs.unlink(statePath);
        console.log(`   ✅ Deleted ${file}`);
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      console.log(`\n   📊 Deleted ${deletedCount} history file(s)`);
    } else {
      console.log('   No history files found to delete');
    }
  } catch (error) {
    console.error(`   ⚠️  Could not delete history files: ${(error as Error).message}`);
  }
}
