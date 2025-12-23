// src/cli/commands/cleanup.ts

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { BranchManager } from '../../core/branch-manager.js';
import { WorktreeManager } from '../../core/worktree-manager.js';
import { InteractivePrompts } from '../utils/interactive-prompts.js';
import * as YAML from 'yaml';

export interface CleanupOptions {
  pipeline?: string;
  force?: boolean;
  deleteLogs?: boolean;
  worktrees?: boolean;
  all?: boolean;
}

export async function cleanupCommand(
  repoPath: string,
  options: CleanupOptions = {}
): Promise<void> {
  const branchManager = new BranchManager(repoPath);

  let branchPrefix = 'pipeline';
  let worktreeBaseDir: string | undefined;

  if (options.pipeline) {
    try {
      const pipelinePath = path.join(
        repoPath,
        '.agent-pipeline',
        'pipelines',
        `${options.pipeline}.yml`
      );
      const content = fsSync.readFileSync(pipelinePath, 'utf-8');
      const config = YAML.parse(content) as {
        git?: { branchPrefix?: string };
        settings?: { worktree?: { directory?: string } };
      };
      branchPrefix = config?.git?.branchPrefix || branchPrefix;
      worktreeBaseDir = config?.settings?.worktree?.directory;
    } catch {
      // Fall back to defaults when pipeline config is missing or incomplete.
    }
  }

  const worktreeManager = worktreeBaseDir
    ? new WorktreeManager(repoPath, worktreeBaseDir)
    : new WorktreeManager(repoPath);

  // Determine what to cleanup
  const cleanWorktrees = options.worktrees || options.all;
  const cleanBranches = !options.worktrees || options.all;

  let hasItems = false;

  // List worktrees if requested
  if (cleanWorktrees) {
    const worktrees = await worktreeManager.listPipelineWorktrees(branchPrefix);
    const worktreesToDelete = options.pipeline
      ? worktrees.filter(wt => {
          const matchesPipeline = wt.path.includes(options.pipeline!) || wt.branch.includes(options.pipeline!);
          if (!matchesPipeline) return false;
          if (!worktreeBaseDir) return true;
          return wt.path.startsWith(worktreeManager.getWorktreeBaseDir());
        })
      : worktrees;

    if (worktreesToDelete.length > 0) {
      hasItems = true;
      console.log('Pipeline worktrees to delete:');
      worktreesToDelete.forEach(wt => console.log(`  - ${wt.path} (branch: ${wt.branch})`));

      if (options.force) {
        console.log('\n🧹 Cleaning up worktrees...\n');
        for (const wt of worktreesToDelete) {
          try {
            await worktreeManager.cleanupWorktree(wt.path, cleanBranches, true);
            console.log(`✅ Removed worktree: ${wt.path}`);
          } catch (error) {
            console.error(`❌ Failed to remove ${wt.path}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
    } else {
      console.log('No pipeline worktrees found to clean up');
    }
  }

  // List branches if requested
  if (cleanBranches) {
    const pipelineBranches = await branchManager.listPipelineBranches(branchPrefix);
    const branchesToDelete = options.pipeline
      ? pipelineBranches.filter(b => b.includes(options.pipeline!))
      : pipelineBranches;

    if (branchesToDelete.length > 0) {
      hasItems = true;
      if (cleanWorktrees) console.log('');
      console.log('Pipeline branches to delete:');
      branchesToDelete.forEach(b => console.log(`  - ${b}`));

      if (options.force) {
        console.log('\n🧹 Cleaning up branches...\n');
        for (const branch of branchesToDelete) {
          try {
            await branchManager.deleteLocalBranch(branch, true);
            console.log(`✅ Deleted branch: ${branch}`);
          } catch (error) {
            console.error(`❌ Failed to delete ${branch}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
    } else if (!cleanWorktrees) {
      console.log('No pipeline branches found to clean up');
    }
  }

  // Show usage help if not forcing
  if (!options.force && hasItems) {
    console.log('\nRun with --force to delete these items');
    console.log('Examples:');
    console.log('  agent-pipeline cleanup --worktrees --force  # Remove worktrees only');
    console.log('  agent-pipeline cleanup --force              # Remove branches only');
    console.log('  agent-pipeline cleanup --all --force        # Remove both');
    console.log('  agent-pipeline cleanup --all --force --delete-logs');
    return;
  }

  // Handle log deletion
  if (options.force && hasItems) {
    if (options.deleteLogs === true) {
      await deleteAssociatedLogs(repoPath, options.pipeline);
    } else if (options.deleteLogs === undefined) {
      // Ask user if they want to delete logs
      const shouldDeleteLogs = await InteractivePrompts.confirm(
        '\nDelete associated history files?',
        false
      );

      if (shouldDeleteLogs) {
        await deleteAssociatedLogs(repoPath, options.pipeline);
      }
    }
  }

  if (options.force && hasItems) {
    console.log('\n✨ Cleanup complete!');
  }
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

    let stateFiles: string[] = [];
    try {
      stateFiles = await fs.readdir(stateDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        console.log('   No history files found to delete');
        return;
      }
      throw err;
    }

    let deletedCount = 0;

    for (const file of stateFiles) {
      if (!file.endsWith('.json')) continue;

      try {
        const statePath = path.join(stateDir, file);
        const content = await fs.readFile(statePath, 'utf-8');
        const state = JSON.parse(content);

        // If pipeline name is specified, only delete logs for that pipeline
        const shouldDelete = pipelineName
          ? state.pipelineConfig?.name?.includes(pipelineName) || state.pipelineConfig?.name === pipelineName
          : true;

        if (shouldDelete) {
          await fs.unlink(statePath);
          console.log(`   ✅ Deleted ${file}`);
          deletedCount++;
        }
      } catch (fileError) {
        console.warn(`   ⚠️  Could not process ${file}: ${(fileError as Error).message}`);
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
