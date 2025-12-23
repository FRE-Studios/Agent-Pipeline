// src/core/branch-manager.ts

import { GitManager } from './git-manager.js';
import { ErrorFactory } from '../utils/error-factory.js';

export type BranchStrategy = 'reusable' | 'unique-per-run' | 'unique-and-delete';

/**
 * Manages git branch workflows for pipeline isolation.
 * Extends GitManager with branch-specific operations.
 */
export class BranchManager extends GitManager {
  /**
   * Setup pipeline branch for execution.
   * Creates new branch or switches to existing one, pulls latest from base.
   */
  async setupPipelineBranch(
    pipelineName: string,
    runId: string,
    baseBranch: string = 'main',
    strategy: BranchStrategy = 'reusable',
    branchPrefix: string = 'pipeline'
  ): Promise<string> {
    // Fetch latest from remote
    try {
      await this.fetch();
    } catch (error) {
      console.warn(`⚠️  Could not fetch from remote: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Generate branch name based on strategy
    const branchName = this.getBranchName(pipelineName, runId, strategy, branchPrefix);

    // Check if branch exists locally
    const exists = await this.branchExists(branchName);

    if (exists) {
      console.log(`📍 Switching to existing branch: ${branchName}`);
      await this.checkoutBranch(branchName);

      // Try to merge latest from base to avoid conflicts
      try {
        const remoteBase = `origin/${baseBranch}`;
        await this.git.merge([remoteBase]);
        console.log(`✅ Merged latest changes from ${remoteBase}`);
      } catch (error) {
        console.warn(`⚠️  Could not merge from origin/${baseBranch}, continuing...`);
      }
    } else {
      console.log(`📍 Creating new branch: ${branchName}`);
      try {
        // Create branch from remote base
        await this.checkoutBranch(branchName, `origin/${baseBranch}`);
      } catch (error) {
        // Fallback: create from local base if remote doesn't exist
        console.warn(`⚠️  Could not create from origin/${baseBranch}, trying local ${baseBranch}...`);
        await this.checkoutBranch(branchName, baseBranch);
      }
    }

    return branchName;
  }

  /**
   * Generate branch name based on strategy
   */
  private getBranchName(
    pipelineName: string,
    runId: string,
    strategy: BranchStrategy,
    branchPrefix: string
  ): string {
    if (strategy === 'unique-per-run' || strategy === 'unique-and-delete') {
      // Include first 8 chars of runId for uniqueness
      return `${branchPrefix}/${pipelineName}/${runId.substring(0, 8)}`;
    } else {
      // Reusable branch (simpler)
      return `${branchPrefix}/${pipelineName}`;
    }
  }

  /**
   * Push branch to remote with error handling.
   */
  async pushBranch(branchName: string): Promise<void> {
    console.log(`⬆️  Pushing ${branchName} to remote...`);
    try {
      await this.push(['-u', 'origin', branchName]);
    } catch (error) {
      const gitError = ErrorFactory.createGitError(error, 'push');
      throw new Error(
        `Failed to push branch ${branchName}: ${gitError.message}\n` +
        (gitError.suggestion ? `Suggestion: ${gitError.suggestion}` : '')
      );
    }
  }

  /**
   * Get current branch name.
   * Throws if not on a branch (detached HEAD).
   */
  async getCurrentBranch(): Promise<string> {
    const status = await this.git.status();
    if (!status.current) {
      throw new Error(
        'Not currently on a branch (detached HEAD state). ' +
        'Checkout a branch before running pipeline.'
      );
    }
    return status.current;
  }

  /**
   * Check if branch exists locally
   */
  async branchExists(branchName: string): Promise<boolean> {
    const branches = await this.git.branchLocal();
    return branches.all.includes(branchName);
  }

  /**
   * Checkout a branch (switch or create)
   */
  async checkoutBranch(branchName: string, startPoint?: string): Promise<void> {
    if (startPoint) {
      await this.git.checkoutBranch(branchName, startPoint);
    } else {
      await this.git.checkout(branchName);
    }
  }

  /**
   * Fetch from remote
   */
  async fetch(remote: string = 'origin'): Promise<void> {
    await this.git.fetch(remote);
  }

  /**
   * Push to remote
   */
  async push(args: string[]): Promise<void> {
    await this.git.push(args);
  }

  /**
   * Delete a local branch
   */
  async deleteLocalBranch(branchName: string, force: boolean = false): Promise<void> {
    await this.git.deleteLocalBranch(branchName, force);
  }

  /**
   * List all pipeline branches
   */
  async listPipelineBranches(prefix: string = 'pipeline'): Promise<string[]> {
    const branches = await this.git.branchLocal();
    return branches.all.filter(b => b.startsWith(`${prefix}/`));
  }
}
