// src/core/pipeline-finalizer.ts

import { GitManager } from './git-manager.js';
import { BranchManager } from './branch-manager.js';
import { PRCreator } from './pr-creator.js';
import { StateManager } from './state-manager.js';
import { PipelineFormatter } from '../utils/pipeline-formatter.js';
import { PipelineConfig, PipelineState } from '../config/schema.js';
import { NotificationContext } from '../notifications/types.js';

export class PipelineFinalizer {
  constructor(
    private gitManager: GitManager,
    private branchManager: BranchManager,
    private prCreator: PRCreator,
    private stateManager: StateManager,
    private repoPath: string,
    private dryRun: boolean,
    private shouldLog: (interactive: boolean) => boolean
  ) {}

  /**
   * Finalize the pipeline execution
   */
  async finalize(
    state: PipelineState,
    config: PipelineConfig,
    pipelineBranch: string | undefined,
    originalBranch: string,
    startTime: number,
    interactive: boolean,
    notifyCallback: (context: NotificationContext) => Promise<void>,
    stateChangeCallback: (state: PipelineState) => void
  ): Promise<PipelineState> {
    // Calculate metrics
    await this.calculateMetrics(state, startTime);

    // Handle PR creation if configured
    if (pipelineBranch && config.git?.pullRequest?.autoCreate) {
      await this.handlePRCreation(config, pipelineBranch, state, interactive, notifyCallback);
    }

    // Save final state
    await this.stateManager.saveState(state);
    stateChangeCallback(state);

    // Notify completion or failure
    await this.notifyCompletion(state, notifyCallback);

    // Print summary if not interactive
    if (this.shouldLog(interactive)) {
      this.printSummary(state);
    }

    // Return to original branch
    await this.cleanup(pipelineBranch, originalBranch, interactive);

    return state;
  }

  /**
   * Calculate final metrics (duration and final commit)
   */
  private async calculateMetrics(state: PipelineState, startTime: number): Promise<void> {
    const endTime = Date.now();
    state.artifacts.totalDuration = (endTime - startTime) / 1000;
    state.artifacts.finalCommit = await this.gitManager.getCurrentCommit();
  }

  /**
   * Handle PR creation (push and create)
   */
  private async handlePRCreation(
    config: PipelineConfig,
    branchName: string,
    state: PipelineState,
    interactive: boolean,
    notifyCallback: (context: NotificationContext) => Promise<void>
  ): Promise<void> {
    try {
      // Push branch to remote
      await this.branchManager.pushBranch(branchName);

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
  private printSummary(state: PipelineState): void {
    console.log(PipelineFormatter.formatSummary(state));
  }

  /**
   * Return to original branch (cleanup)
   */
  private async cleanup(
    pipelineBranch: string | undefined,
    originalBranch: string,
    interactive: boolean
  ): Promise<void> {
    if (pipelineBranch && originalBranch && !this.dryRun) {
      if (this.shouldLog(interactive)) {
        console.log(`\n↩️  Returning to branch: ${originalBranch}`);
      }
      await this.branchManager.checkoutBranch(originalBranch);
    }
  }
}
