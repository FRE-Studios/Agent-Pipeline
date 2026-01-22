// src/core/pipeline-finalizer.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import chalk from 'chalk';
import { GitManager } from './git-manager.js';
import { BranchManager } from './branch-manager.js';
import { WorktreeManager } from './worktree-manager.js';
import { PRCreator } from './pr-creator.js';
import { StateManager } from './state-manager.js';
import { PipelineFormatter } from '../utils/pipeline-formatter.js';
import { PipelineConfig, PipelineState, MergeStrategy } from '../config/schema.js';
import { NotificationContext } from '../notifications/types.js';

// Console output styling (consistent with cli/commands/init.ts)
const c = {
  success: chalk.green,
  warn: chalk.yellow,
  error: chalk.red,
  dim: chalk.dim,
  cmd: chalk.cyan,
  branch: chalk.magenta,
  path: chalk.yellow,
  header: chalk.bold.white,
};

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
    stateChangeCallback: (state: PipelineState) => void,
    options?: { suppressCompletionNotification?: boolean }
  ): Promise<PipelineState> {
    // Calculate metrics (use worktree git manager if executing in worktree)
    await this.calculateMetrics(state, startTime, executionRepoPath);

    // Handle aborted status specially - skip merge but preserve work
    if (state.status === 'aborted') {
      if (this.shouldLog(interactive)) {
        console.log(`\n${c.warn('⚠')}  ${c.warn('Pipeline aborted.')} Work preserved on branch: ${c.branch(pipelineBranch || '(current)')}`);
        if (worktreePath) {
          console.log(`   ${c.dim('Worktree preserved for recovery:')} ${c.path(worktreePath)}`);
        }
      }
      // Still copy handover directory if it exists
      if (worktreePath && state.artifacts.mainRepoHandoverDir) {
        await this.copyHandoverToMainRepo(
          state.artifacts.handoverDir,
          state.artifacts.mainRepoHandoverDir,
          interactive
        );
        state.artifacts.handoverDir = state.artifacts.mainRepoHandoverDir;
      }
      // Save state and notify
      await this.stateManager.saveState(state);
      stateChangeCallback(state);
      await notifyCallback({
        event: 'pipeline.aborted',
        pipelineState: state
      });
      return state;
    }

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

    // Copy handover directory from worktree to main repo (if in worktree mode)
    if (worktreePath && state.artifacts.mainRepoHandoverDir) {
      await this.copyHandoverToMainRepo(
        state.artifacts.handoverDir,
        state.artifacts.mainRepoHandoverDir,
        interactive
      );
      // Update state to point to main repo path (for persistence and future reference)
      state.artifacts.handoverDir = state.artifacts.mainRepoHandoverDir;
    }

    // Save final state
    await this.stateManager.saveState(state);
    stateChangeCallback(state);

    // Notify completion or failure (skip in loop mode - handled at session end)
    if (!options?.suppressCompletionNotification) {
      await this.notifyCompletion(state, notifyCallback);
    }

    // Print summary if not interactive
    if (this.shouldLog(interactive)) {
      this.printSummary(state, worktreePath, verbose);
    }

    // Handle worktree cleanup based on strategy and status
    const prCreatedSuccessfully = !!state.artifacts.pullRequest?.url;
    await this.handleWorktreeCleanup(worktreePath, config, state.status, interactive, prCreatedSuccessfully);

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
        console.log(`\n${c.dim('📍 No commits to merge.')} Work preserved on branch: ${c.branch(branchName)}`);
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
          console.log(`\n${c.dim('📍 Work preserved on branch:')} ${c.branch(branchName)}`);
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
        // Always log this - users need to know why a new PR wasn't created
        console.log(`\n${c.success('✓')} Pull request already exists for ${c.branch(branchName)}`);
        console.log(`   ${c.dim('View it with:')} ${c.cmd(`gh pr view ${branchName}`)}`);
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
        const isComplete = state.status === 'completed';
        const statusIcon = isComplete ? c.success('✓') : c.warn('⚠');
        const statusSuffix = state.status === 'partial' ? c.dim(' (partial success)') : '';
        console.log(`\n${statusIcon} Pull Request created${statusSuffix}: ${c.cmd(result.url)}`);
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
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Always save PR error to state (for UI visibility)
      state.artifacts.prError = errorMessage;
      await this.stateManager.saveState(state);

      // Always log PR creation errors - they're critical failures users need to see
      console.log(`\n${c.error('✗')} ${c.error('Failed to create PR:')} ${c.dim(errorMessage)}`);
      console.log(`   ${c.dim('Branch')} ${c.branch(branchName)} ${c.dim('has been pushed to remote.')}`);
      console.log(`   ${c.dim('You can create the PR manually with:')} ${c.cmd('gh pr create')}`);
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
        // Check if working tree is clean
        const checkedOutGitManager = new GitManager(baseCheckedOutPath);
        const hasChanges = await checkedOutGitManager.hasUncommittedChanges();

        if (hasChanges) {
          // Dirty working tree - can't merge safely
          if (this.shouldLog(interactive)) {
            console.log(`\n${c.warn('⚠')}  Cannot auto-merge: ${c.branch(baseBranch)} has uncommitted changes.`);
            console.log(`   ${c.dim('Pipeline completed successfully. Changes on branch:')} ${c.branch(branchName)}`);
            console.log(`\n   ${c.dim('Commit or stash your work, then run:')} ${c.cmd(`git merge ${branchName}`)}`);
          }
          return;
        }

        // Clean working tree - merge directly
        if (this.shouldLog(interactive)) {
          console.log(`\n${c.dim('🔀 Merging')} ${c.branch(branchName)} ${c.dim('into')} ${c.branch(baseBranch)}${c.dim('...')}`);
        }

        try {
          await checkedOutGitManager.merge(branchName);
          if (this.shouldLog(interactive)) {
            console.log(`${c.success('✓')} Successfully merged ${c.branch(branchName)} into ${c.branch(baseBranch)}`);
          }
          return;
        } catch (mergeError) {
          if (this.shouldLog(interactive)) {
            console.log(`\n${c.error('✗')} Failed to merge: ${mergeError instanceof Error ? mergeError.message : String(mergeError)}`);
            console.log(`   ${c.dim('To resolve:')} ${c.cmd('git status')} then fix conflicts and ${c.cmd('git commit')}`);
            console.log(`   ${c.dim('Or abort:')} ${c.cmd('git merge --abort')}`);
          }
          throw mergeError;
        }
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
        console.log(`\n${c.dim('🔀 Merging')} ${c.branch(branchName)} ${c.dim('into')} ${c.branch(baseBranch)}${c.dim('...')}`);
      }

      await mergeGitManager.merge(branchName);

      await this.worktreeManager.removeWorktree(mergeWorktreePath, true);
      await this.worktreeManager.pruneWorktrees();
      mergeWorktreePath = null;

      if (this.shouldLog(interactive)) {
        console.log(`${c.success('✓')} Successfully merged ${c.branch(branchName)} into ${c.branch(baseBranch)}`);
      }
    } catch (error) {
      if (this.shouldLog(interactive)) {
        console.log(`\n${c.error('✗')} ${c.error('Failed to merge:')} ${c.dim(error instanceof Error ? error.message : String(error))}`);
        console.log(`   ${c.dim('Branch')} ${c.branch(branchName)} ${c.dim('still exists with your changes.')}`);
        console.log('');
        console.log(`   ${c.dim('You can merge manually with:')}`);
        console.log(`   ${c.cmd(`git checkout ${baseBranch} && git merge ${branchName}`)}`);
        if (mergeWorktreePath) {
          console.log('');
          console.log(`   ${c.dim('Merge worktree preserved at:')} ${c.path(mergeWorktreePath)}`);
        }
        console.log('');
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
      console.log(`\n${c.dim('🌳 Worktree location:')} ${c.path(worktreePath)}`);
    }
  }

  /**
   * Calculate total tokens across all stages.
   * Uses same formula as PipelineFormatter.formatTokenUsage for consistency.
   * Total processed = actual_input + cache_read + (cache_creation if not already included)
   */
  private calculateTotalTokens(state: PipelineState): {
    totalProcessed: number;
    totalOutput: number;
    totalTurns: number;
    totalCacheRead: number;
  } {
    let totalProcessed = 0;
    let totalOutput = 0;
    let totalTurns = 0;
    let totalCacheRead = 0;

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
        totalTurns += stage.tokenUsage.num_turns || 0;
        totalCacheRead += cacheRead;
      }
    }

    return { totalProcessed, totalOutput, totalTurns, totalCacheRead };
  }

  /**
   * Copy handover directory from worktree to main repo.
   * This preserves agent outputs after worktree cleanup.
   */
  private async copyHandoverToMainRepo(
    sourcePath: string,
    destPath: string,
    interactive: boolean
  ): Promise<void> {
    try {
      // Ensure destination parent directory exists
      await fs.mkdir(path.dirname(destPath), { recursive: true });

      // Copy the entire handover directory
      await fs.cp(sourcePath, destPath, { recursive: true });

      if (this.shouldLog(interactive)) {
        console.log(`\n${c.dim('📋 Copied handover files to:')} ${c.path(destPath)}`);
      }
    } catch (error) {
      // Non-fatal: log warning but don't fail pipeline
      if (this.shouldLog(interactive)) {
        console.log(`\n${c.warn('⚠')}  ${c.dim('Could not copy handover directory:')} ${c.dim(error instanceof Error ? error.message : String(error))}`);
        console.log(`   ${c.dim('Source:')} ${c.path(sourcePath)}`);
        console.log(`   ${c.dim('Destination:')} ${c.path(destPath)}`);
      }
    }
  }

  /**
   * Handle worktree cleanup based on strategy and pipeline status.
   * - Reusable strategy: Keep worktree for faster subsequent runs
   * - Unique-and-delete on success: Cleanup worktree and branch
   * - On failure: Always keep for debugging
   *
   * @param prCreatedSuccessfully - If true, force-delete local branch since work is on remote
   */
  private async handleWorktreeCleanup(
    worktreePath: string | undefined,
    config: PipelineConfig,
    status: PipelineState['status'],
    interactive: boolean,
    prCreatedSuccessfully: boolean = false
  ): Promise<void> {
    if (!worktreePath || this.dryRun) {
      return;
    }

    const strategy = config.git?.branchStrategy || 'reusable';
    const success = status === 'completed';

    // For reusable strategy, always keep the worktree
    if (strategy === 'reusable') {
      if (this.shouldLog(interactive)) {
        console.log(`\n${c.dim('🌳 Worktree preserved at:')} ${c.path(worktreePath)}`);
        console.log(`   ${c.dim('Use')} ${c.cmd('agent-pipeline cleanup --worktrees')} ${c.dim('to remove.')}`);
      }
      return;
    }

    // For unique-and-delete, cleanup on success, keep on failure for debugging
    // Force-delete local branch if PR was created (work is safely on remote)
    if (strategy === 'unique-and-delete' && success) {
      try {
        await this.worktreeManager.cleanupWorktree(worktreePath, true, prCreatedSuccessfully);
        if (this.shouldLog(interactive)) {
          console.log(`\n${c.dim('🗑️  Cleaned up worktree:')} ${c.path(worktreePath)}`);
        }
      } catch (error) {
        if (this.shouldLog(interactive)) {
          console.log(`\n${c.warn('⚠')}  ${c.dim('Could not cleanup worktree:')} ${c.dim(error instanceof Error ? error.message : String(error))}`);
          console.log(`   ${c.dim('Worktree remains at:')} ${c.path(worktreePath)}`);
        }
      }
    } else if (strategy === 'unique-per-run' && success) {
      if (this.shouldLog(interactive)) {
        console.log(`\n${c.dim('🌳 Worktree preserved at:')} ${c.path(worktreePath)}`);
        console.log(`   ${c.dim('Use')} ${c.cmd('agent-pipeline cleanup --worktrees')} ${c.dim('to remove.')}`);
      }
    } else if (!success) {
      if (this.shouldLog(interactive)) {
        console.log(`\n${c.dim('🌳 Worktree preserved for debugging:')} ${c.path(worktreePath)}`);
      }
    }
  }
}
