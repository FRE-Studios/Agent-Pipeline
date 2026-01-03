// src/core/pipeline-finalizer.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import { GitManager } from './git-manager.js';
import { BranchManager } from './branch-manager.js';
import { WorktreeManager } from './worktree-manager.js';
import { PRCreator } from './pr-creator.js';
import { StateManager } from './state-manager.js';
import { PipelineFormatter } from '../utils/pipeline-formatter.js';
import { PipelineConfig, PipelineState, MergeStrategy } from '../config/schema.js';
import { NotificationContext } from '../notifications/types.js';

export class PipelineFinalizer {
  private worktreeManager: WorktreeManager;

  constructor(
    private gitManager: GitManager,
    private branchManager: BranchManager,
    private prCreator: PRCreator,
    private stateManager: StateManager,
    private repoPath: string,
    private dryRun: boolean,
    private shouldLog: (interactive: boolean) => boolean
  ) {
    this.worktreeManager = new WorktreeManager(repoPath);
  }

  /**
   * Finalize the pipeline execution
   */
  async finalize(
    state: PipelineState,
    config: PipelineConfig,
    pipelineBranch: string | undefined,
    worktreePath: string | undefined,
    executionRepoPath: string,
    startTime: number,
    interactive: boolean,
    verbose: boolean,
    notifyCallback: (context: NotificationContext) => Promise<void>,
    stateChangeCallback: (state: PipelineState) => void
  ): Promise<PipelineState> {
    // Calculate metrics (use worktree git manager if executing in worktree)
    await this.calculateMetrics(state, startTime, executionRepoPath);

    // Handle merge strategy (pull-request, local-merge, or none)
    if (pipelineBranch && config.git) {
      const mergeStrategy = config.git.mergeStrategy || 'none';
      await this.handleMergeStrategy(
        mergeStrategy,
        config,
        pipelineBranch,
        state,
        executionRepoPath,
        interactive,
        notifyCallback
      );
    }

    // Save final state
    await this.stateManager.saveState(state);
    stateChangeCallback(state);

    // Notify completion or failure
    await this.notifyCompletion(state, notifyCallback);

    // Print summary if not interactive
    if (this.shouldLog(interactive)) {
      this.printSummary(state, worktreePath, verbose);
    }

    // Handle worktree cleanup based on strategy and status
    await this.handleWorktreeCleanup(worktreePath, config, state.status, interactive);

    return state;
  }

  /**
   * Calculate final metrics (duration and final commit)
   */
  private async calculateMetrics(
    state: PipelineState,
    startTime: number,
    executionRepoPath: string
  ): Promise<void> {
    const endTime = Date.now();
    state.artifacts.totalDuration = (endTime - startTime) / 1000;

    // Get final commit from execution path (worktree or main repo)
    const execGitManager = executionRepoPath !== this.repoPath
      ? new GitManager(executionRepoPath)
      : this.gitManager;
    state.artifacts.finalCommit = await execGitManager.getCurrentCommit();
  }

  /**
   * Handle merge strategy dispatch
   */
  private async handleMergeStrategy(
    strategy: MergeStrategy,
    config: PipelineConfig,
    branchName: string,
    state: PipelineState,
    executionRepoPath: string,
    interactive: boolean,
    notifyCallback: (context: NotificationContext) => Promise<void>
  ): Promise<void> {
    // Skip merge strategies if no commits were made
    const hasCommits = state.stages.some(s => s.commitSha);
    if (!hasCommits && (strategy === 'pull-request' || strategy === 'local-merge')) {
      if (this.shouldLog(interactive)) {
        console.log(`\n📍 No commits to merge. Work preserved on branch: ${branchName}`);
      }
      return;
    }

    switch (strategy) {
      case 'pull-request':
        await this.handlePullRequest(config, branchName, state, executionRepoPath, interactive, notifyCallback);
        break;
      case 'local-merge':
        await this.handleLocalMerge(config, branchName, interactive);
        break;
      case 'none':
        // No merge action - work stays in worktree/branch
        if (this.shouldLog(interactive)) {
          console.log(`\n📍 Work preserved on branch: ${branchName}`);
        }
        break;
    }
  }

  /**
   * Handle pull-request merge strategy: push branch and create PR
   */
  private async handlePullRequest(
    config: PipelineConfig,
    branchName: string,
    state: PipelineState,
    executionRepoPath: string,
    interactive: boolean,
    notifyCallback: (context: NotificationContext) => Promise<void>
  ): Promise<void> {
    try {
      // Push branch to remote (use worktree branch manager if in worktree)
      const pushBranchManager = executionRepoPath !== this.repoPath
        ? new BranchManager(executionRepoPath)
        : this.branchManager;
      await pushBranchManager.pushBranch(branchName);

      // Check if PR already exists
      const exists = await this.prCreator.prExists(branchName);
      if (exists) {
        if (this.shouldLog(interactive)) {
          console.log(`\n✅ Pull request already exists for ${branchName}`);
          console.log(`   View it with: gh pr view ${branchName}`);
        }
        return;
      }

      // Create PR (use empty config if pullRequest not specified)
      const prConfig = config.git?.pullRequest || {};
      const result = await this.prCreator.createPR(
        branchName,
        config.git?.baseBranch || 'main',
        prConfig,
        state
      );

      if (this.shouldLog(interactive)) {
        console.log(`\n✅ Pull Request created: ${result.url}`);
      }

      // Save PR info to state
      state.artifacts.pullRequest = {
        url: result.url,
        number: result.number,
        branch: branchName
      };

      await this.stateManager.saveState(state);

      // Notify PR created
      await notifyCallback({
        event: 'pr.created',
        pipelineState: state,
        prUrl: result.url
      });
    } catch (error) {
      if (this.shouldLog(interactive)) {
        console.error(
          `\n❌ Failed to create PR: ${error instanceof Error ? error.message : String(error)}`
        );
        console.log(`   Branch ${branchName} has been pushed to remote.`);
        console.log(`   You can create the PR manually with: gh pr create`);
      }
    }
  }

  /**
   * Handle local-merge strategy: merge branch to baseBranch locally
   */
  private async handleLocalMerge(
    config: PipelineConfig,
    branchName: string,
    interactive: boolean
  ): Promise<void> {
    const baseBranch = config.git?.baseBranch || 'main';
    const baseCheckedOutPath = await this.gitManager.isBranchCheckedOut(baseBranch);
    let mergeWorktreePath: string | null = null;

    try {
      if (baseCheckedOutPath) {
        throw new Error(
          `Base branch '${baseBranch}' is currently checked out at '${baseCheckedOutPath}'. ` +
          'Switch to a different branch or use mergeStrategy: pull-request.'
        );
      }

      const worktreeBaseDir = this.worktreeManager.getWorktreeBaseDir();
      await fs.mkdir(worktreeBaseDir, { recursive: true });

      const safeBranchName = branchName.replace(/[\\/]/g, '-');
      mergeWorktreePath = path.join(
        worktreeBaseDir,
        `merge-${safeBranchName}-${Date.now()}`
      );

      await this.worktreeManager.createWorktree(mergeWorktreePath, baseBranch, baseBranch);
      const mergeGitManager = new GitManager(mergeWorktreePath);

      if (this.shouldLog(interactive)) {
        console.log(`\n🔀 Merging ${branchName} into ${baseBranch}...`);
      }

      await mergeGitManager.merge(branchName);

      await this.worktreeManager.removeWorktree(mergeWorktreePath, true);
      await this.worktreeManager.pruneWorktrees();
      mergeWorktreePath = null;

      if (this.shouldLog(interactive)) {
        console.log(`✅ Successfully merged ${branchName} into ${baseBranch}`);
      }
    } catch (error) {
      if (this.shouldLog(interactive)) {
        console.error(
          `\n❌ Failed to merge: ${error instanceof Error ? error.message : String(error)}`
        );
        console.log(`   Branch ${branchName} still exists with your changes.`);
        console.log(`   You can merge manually with: git checkout ${baseBranch} && git merge ${branchName}`);
        if (mergeWorktreePath) {
          console.log(`   Merge worktree preserved at: ${mergeWorktreePath}`);
        }
      }
      throw error; // Re-throw so caller knows merge failed
    }
  }

  /**
   * Notify pipeline completion or failure
   */
  private async notifyCompletion(
    state: PipelineState,
    notifyCallback: (context: NotificationContext) => Promise<void>
  ): Promise<void> {
    const event = state.status === 'completed' ? 'pipeline.completed' : 'pipeline.failed';
    await notifyCallback({
      event,
      pipelineState: state,
      prUrl: state.artifacts.pullRequest?.url
    });
  }

  /**
   * Print summary to console
   */
  private printSummary(state: PipelineState, worktreePath?: string, verbose: boolean = false): void {
    // Calculate total tokens across all stages
    const totals = this.calculateTotalTokens(state);

    // Print formatted summary with token totals
    console.log(PipelineFormatter.formatSummary(state, verbose, totals));

    if (worktreePath && verbose) {
      console.log(`\n🌳 Worktree location: ${worktreePath}`);
    }
  }

  /**
   * Calculate total tokens across all stages.
   * Uses same formula as PipelineFormatter.formatTokenUsage for consistency.
   * Total processed = actual_input + cache_read + (cache_creation if not already included)
   */
  private calculateTotalTokens(state: PipelineState): { totalProcessed: number; totalOutput: number } {
    let totalProcessed = 0;
    let totalOutput = 0;

    for (const stage of state.stages) {
      if (stage.tokenUsage) {
        const cacheRead = stage.tokenUsage.cache_read || 0;
        const cacheCreation = stage.tokenUsage.cache_creation || 0;
        const actualInput = stage.tokenUsage.actual_input || 0;

        // Some runtimes include cache_creation in actual_input, some don't
        const cacheCreationIncluded = cacheCreation > 0 && actualInput >= cacheCreation;
        const stageProcessed = actualInput + cacheRead + (cacheCreationIncluded ? 0 : cacheCreation);

        totalProcessed += stageProcessed;
        totalOutput += stage.tokenUsage.output || 0;
      }
    }

    return { totalProcessed, totalOutput };
  }

  /**
   * Handle worktree cleanup based on strategy and pipeline status.
   * - Reusable strategy: Keep worktree for faster subsequent runs
   * - Unique-and-delete on success: Cleanup worktree and branch
   * - On failure: Always keep for debugging
   */
  private async handleWorktreeCleanup(
    worktreePath: string | undefined,
    config: PipelineConfig,
    status: PipelineState['status'],
    interactive: boolean
  ): Promise<void> {
    if (!worktreePath || this.dryRun) {
      return;
    }

    const strategy = config.git?.branchStrategy || 'reusable';
    const success = status === 'completed';

    // For reusable strategy, always keep the worktree
    if (strategy === 'reusable') {
      if (this.shouldLog(interactive)) {
        console.log(`\n🌳 Worktree preserved at: ${worktreePath}`);
        console.log(`   Use 'agent-pipeline cleanup --worktrees' to remove.`);
      }
      return;
    }

    // For unique-and-delete, cleanup on success, keep on failure for debugging
    if (strategy === 'unique-and-delete' && success) {
      try {
        await this.worktreeManager.cleanupWorktree(worktreePath, true, false);
        if (this.shouldLog(interactive)) {
          console.log(`\n🗑️  Cleaned up worktree: ${worktreePath}`);
        }
      } catch (error) {
        if (this.shouldLog(interactive)) {
          console.warn(`\n⚠️  Could not cleanup worktree: ${error instanceof Error ? error.message : String(error)}`);
          console.log(`   Worktree remains at: ${worktreePath}`);
        }
      }
    } else if (strategy === 'unique-per-run' && success) {
      if (this.shouldLog(interactive)) {
        console.log(`\n🌳 Worktree preserved at: ${worktreePath}`);
        console.log(`   Use 'agent-pipeline cleanup --worktrees' to remove.`);
      }
    } else if (!success) {
      if (this.shouldLog(interactive)) {
        console.log(`\n🌳 Worktree preserved for debugging: ${worktreePath}`);
      }
    }
  }
}
