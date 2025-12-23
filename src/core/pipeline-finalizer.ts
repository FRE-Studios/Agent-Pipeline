// src/core/pipeline-finalizer.ts

import { GitManager } from './git-manager.js';
import { BranchManager } from './branch-manager.js';
import { WorktreeManager } from './worktree-manager.js';
import { PRCreator } from './pr-creator.js';
import { StateManager } from './state-manager.js';
import { PipelineFormatter } from '../utils/pipeline-formatter.js';
import { PipelineConfig, PipelineState } from '../config/schema.js';
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
    notifyCallback: (context: NotificationContext) => Promise<void>,
    stateChangeCallback: (state: PipelineState) => void
  ): Promise<PipelineState> {
    // Calculate metrics (use worktree git manager if executing in worktree)
    await this.calculateMetrics(state, startTime, executionRepoPath);

    // Handle PR creation if configured (push from worktree)
    if (pipelineBranch && config.git?.pullRequest?.autoCreate) {
      await this.handlePRCreation(config, pipelineBranch, state, executionRepoPath, interactive, notifyCallback);
    }

    // Save final state
    await this.stateManager.saveState(state);
    stateChangeCallback(state);

    // Notify completion or failure
    await this.notifyCompletion(state, notifyCallback);

    // Print summary if not interactive
    if (this.shouldLog(interactive)) {
      this.printSummary(state, worktreePath);
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
   * Handle PR creation (push and create)
   */
  private async handlePRCreation(
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

      // Create PR
      const prConfig = config.git!.pullRequest!;
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
  private printSummary(state: PipelineState, worktreePath?: string): void {
    console.log(PipelineFormatter.formatSummary(state));
    if (worktreePath) {
      console.log(`\n🌳 Worktree location: ${worktreePath}`);
    }
  }

  /**
   * Handle worktree cleanup based on strategy and pipeline status.
   * - Reusable strategy: Keep worktree for faster subsequent runs
   * - Unique-per-run on success: Optionally cleanup
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

    // For unique-per-run, cleanup on success, keep on failure for debugging
    if (strategy === 'unique-per-run' && success) {
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
    } else if (!success) {
      if (this.shouldLog(interactive)) {
        console.log(`\n🌳 Worktree preserved for debugging: ${worktreePath}`);
      }
    }
  }
}
