// src/core/worktree-manager.ts

import * as path from 'path';
import * as fs from 'fs/promises';
import chalk from 'chalk';
import { GitManager, WorktreeInfo } from './git-manager.js';
import { BranchStrategy } from './branch-manager.js';

// Console output styling (consistent with cli/commands/init.ts)
const c = {
  success: chalk.green,
  warn: chalk.yellow,
  error: chalk.red,
  dim: chalk.dim,
  cmd: chalk.cyan,
  branch: chalk.magenta,
  path: chalk.yellow,
};

/**
 * Result of setting up a pipeline worktree
 */
export interface WorktreeSetupResult {
  worktreePath: string;   // Absolute path to worktree directory
  branchName: string;     // Branch checked out in worktree
  isNew: boolean;         // Whether worktree was newly created
}

/**
 * Manages git worktree operations for pipeline isolation.
 * Pipelines execute in dedicated worktrees, leaving user's working directory untouched.
 */
export class WorktreeManager extends GitManager {
  private worktreeBaseDir: string;
  private repoPath: string;

  constructor(repoPath: string, worktreeBaseDir?: string) {
    super(repoPath);
    this.repoPath = repoPath;
    const baseDir = worktreeBaseDir || path.join(repoPath, '.agent-pipeline', 'worktrees');
    this.worktreeBaseDir = path.isAbsolute(baseDir) ? baseDir : path.resolve(repoPath, baseDir);
  }

  /**
   * Setup a worktree for pipeline execution.
   * Handles both reusable and unique-per-run strategies.
   *
   * @param pipelineName - Name of the pipeline
   * @param runId - Unique run identifier
   * @param baseBranch - Base branch to create from (default: 'main')
   * @param strategy - Branch naming strategy
   * @param branchPrefix - Prefix for branch names (default: 'pipeline')
   */
  async setupPipelineWorktree(
    pipelineName: string,
    runId: string,
    baseBranch: string = 'main',
    strategy: BranchStrategy = 'reusable',
    branchPrefix: string = 'pipeline'
  ): Promise<WorktreeSetupResult> {
    // Ensure base directory exists
    await fs.mkdir(this.worktreeBaseDir, { recursive: true });

    // Fetch latest from remote
    try {
      await this.git.fetch('origin');
    } catch (error) {
      console.log(`${c.warn('⚠')}  ${c.dim('Could not fetch from remote:')} ${c.dim(error instanceof Error ? error.message : String(error))}`);
    }

    // Generate branch and worktree names
    const branchName = this.getBranchName(pipelineName, runId, strategy, branchPrefix);
    const worktreeDirName = this.getWorktreeDirName(pipelineName, runId, strategy);
    const worktreePath = path.join(this.worktreeBaseDir, worktreeDirName);

    // Check if worktree already exists
    const exists = await this.worktreeExists(worktreePath);

    if (exists) {
      // For reusable strategy, update existing worktree
      console.log(`${c.dim('Using existing worktree:')} ${c.path(worktreePath)}`);
      await this.updateWorktree(worktreePath, baseBranch);
      return { worktreePath, branchName, isNew: false };
    }

    // Check if directory exists but worktree is stale
    try {
      await fs.access(worktreePath);
      // Directory exists but not in worktree list - prune and recreate
      console.log(`${c.dim('Cleaning up stale worktree:')} ${c.path(worktreePath)}`);
      await this.pruneWorktrees();
      await fs.rm(worktreePath, { recursive: true, force: true });
    } catch {
      // Directory doesn't exist, which is expected
    }

    // Create new worktree
    console.log(`${c.dim('Creating worktree:')} ${c.path(worktreePath)}`);
    await this.createWorktree(worktreePath, branchName, baseBranch);
    return { worktreePath, branchName, isNew: true };
  }

  /**
   * Update existing worktree with latest from base branch.
   * Creates a new GitManager instance for the worktree to perform operations.
   */
  private async updateWorktree(worktreePath: string, baseBranch: string): Promise<void> {
    // Create a GitManager for the worktree
    const worktreeGit = new GitManager(worktreePath);

    try {
      // Pull latest from remote base branch
      await worktreeGit['git'].fetch('origin');
      await worktreeGit['git'].merge([`origin/${baseBranch}`]);
      console.log(`${c.dim('Updated worktree from')} ${c.branch(`origin/${baseBranch}`)}`);
    } catch (error) {
      console.log(`${c.warn('⚠')}  ${c.dim('Could not update worktree from')} ${c.branch(baseBranch)}: ${c.dim(error instanceof Error ? error.message : String(error))}`);
    }
  }

  /**
   * Cleanup worktree after pipeline completion.
   *
   * @param worktreePath - Absolute path to worktree
   * @param deleteBranch - Also delete the associated branch
   * @param force - Force removal even with uncommitted changes
   */
  async cleanupWorktree(
    worktreePath: string,
    deleteBranch: boolean = false,
    force: boolean = false
  ): Promise<void> {
    // Get branch name before removing worktree
    const worktrees = await this.listWorktrees();
    const wt = worktrees.find(w => w.path === worktreePath);
    const branchName = wt?.branch;

    // Remove worktree
    try {
      await this.removeWorktree(worktreePath, force);
      console.log(`${c.dim('Removed worktree:')} ${c.path(worktreePath)}`);
    } catch (error) {
      // If removal fails due to uncommitted changes, try with force
      if (!force && error instanceof Error && error.message.includes('uncommitted')) {
        console.log(`${c.warn('⚠')}  ${c.dim('Worktree has uncommitted changes, forcing removal...')}`);
        await this.removeWorktree(worktreePath, true);
      } else {
        throw error;
      }
    }

    // Optionally delete the branch
    if (deleteBranch && branchName) {
      try {
        await this.git.deleteLocalBranch(branchName, force);
        console.log(`${c.success('✓')} Deleted branch: ${c.branch(branchName)}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isNotMergedError = errorMessage.includes('not fully merged');

        if (isNotMergedError) {
          // Branch has commits that aren't merged - provide helpful guidance
          console.log('');
          console.log(`${c.warn('⚠')}  ${c.warn('Branch not deleted:')} ${c.branch(branchName)}`);
          console.log(`   ${c.dim('The branch has commits that are not merged into the base branch.')}`);
          console.log('');
          console.log(`   ${c.dim('To complete the merge manually:')}`);
          console.log(`   ${c.cmd(`git merge ${branchName}`)}`);
          console.log('');
          console.log(`   ${c.dim('To delete without merging (discard changes):')}`);
          console.log(`   ${c.cmd(`git branch -D ${branchName}`)}`);
          console.log('');
        } else {
          // Other error - show generic message
          console.log('');
          console.log(`${c.warn('⚠')}  Could not delete branch ${c.branch(branchName)}`);
          console.log(`   ${c.dim(errorMessage)}`);
          console.log('');
        }
      }
    }

    // Prune stale entries
    await this.pruneWorktrees();
  }

  /**
   * List all pipeline worktrees.
   * Filters to only include worktrees in the pipeline worktree directory.
   */
  async listPipelineWorktrees(branchPrefix: string = 'pipeline'): Promise<WorktreeInfo[]> {
    const allWorktrees = await this.listWorktrees();
    return allWorktrees.filter(wt =>
      !wt.bare && wt.branch.startsWith(`${branchPrefix}/`)
    );
  }

  /**
   * Generate branch name based on strategy.
   * Mirrors BranchManager.getBranchName for consistency.
   */
  private getBranchName(
    pipelineName: string,
    runId: string,
    strategy: BranchStrategy,
    branchPrefix: string
  ): string {
    if (strategy === 'unique-per-run' || strategy === 'unique-and-delete') {
      return `${branchPrefix}/${pipelineName}/${runId.substring(0, 8)}`;
    }
    return `${branchPrefix}/${pipelineName}`;
  }

  /**
   * Generate worktree directory name based on strategy.
   */
  private getWorktreeDirName(
    pipelineName: string,
    runId: string,
    strategy: BranchStrategy
  ): string {
    if (strategy === 'unique-per-run' || strategy === 'unique-and-delete') {
      return `${pipelineName}-${runId.substring(0, 8)}`;
    }
    return pipelineName;
  }

  /**
   * Get the base directory where worktrees are created.
   */
  getWorktreeBaseDir(): string {
    return this.worktreeBaseDir;
  }

  /**
   * Get the main repository path.
   */
  getRepoPath(): string {
    return this.repoPath;
  }
}
