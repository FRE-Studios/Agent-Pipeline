// src/core/git-manager.ts

import { simpleGit, SimpleGit } from 'simple-git';
import { ErrorFactory } from '../utils/error-factory.js';

/**
 * Information about a git worktree
 */
export interface WorktreeInfo {
  path: string;       // Absolute path to worktree directory
  branch: string;     // Branch name (without refs/heads/)
  head: string;       // HEAD commit SHA
  bare?: boolean;     // Whether this is the bare repo entry
  detached?: boolean; // Whether HEAD is detached
}

/**
 * Manages git operations for pipeline execution.
 * Wraps simple-git with error handling and pipeline-specific workflows.
 */
export class GitManager {
  protected git: SimpleGit;

  constructor(repoPath: string) {
    this.git = simpleGit(repoPath);
  }

  async getCurrentCommit(): Promise<string> {
    const log = await this.git.log(['-1']);
    return log.latest?.hash || '';
  }

  async getChangedFiles(commitSha: string): Promise<string[]> {
    try {
      const diff = await this.git.diff([
        '--name-only',
        `${commitSha}^`,
        commitSha
      ]);
      return diff.split('\n').filter(Boolean);
    } catch (error) {
      const gitError = ErrorFactory.createGitError(error, 'diff');

      if (gitError.message.includes('ambiguous argument') ||
          gitError.message.includes('unknown revision')) {
        const allFiles = await this.git.raw(['ls-tree', '--name-only', '-r', commitSha]);
        return allFiles.split('\n').filter(Boolean);
      }

      throw new Error(gitError.suggestion || gitError.message);
    }
  }

  async hasUncommittedChanges(): Promise<boolean> {
    const status = await this.git.status();
    return !status.isClean();
  }

  async stageAllChanges(): Promise<void> {
    await this.git.add('.');
  }

  async commitWithMetadata(
    message: string,
    metadata: Record<string, string>
  ): Promise<string> {
    const status = await this.git.status();
    if (status.staged.length === 0) {
      throw new Error('No staged changes to commit. Stage changes with git.add() first.');
    }

    const trailers = Object.entries(metadata)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');

    const fullMessage = `${message}\n\n${trailers}`;

    await this.git.commit(fullMessage, undefined, { '--no-verify': null });
    return this.getCurrentCommit();
  }

  /**
   * Creates a pipeline commit with metadata trailers.
   * Auto-stages all changes before committing.
   */
  async createPipelineCommit(
    stageName: string,
    runId: string,
    customMessage?: string,
    commitPrefix?: string
  ): Promise<string> {
    if (!(await this.hasUncommittedChanges())) {
      return '';
    }

    await this.stageAllChanges();

    const message = customMessage || `Apply ${stageName} changes`;
    const resolvedPrefix = commitPrefix
      ? commitPrefix.replace('{{stage}}', stageName)
      : `[pipeline:${stageName}]`;
    const separator = resolvedPrefix.endsWith(' ') ? '' : ' ';
    const commitMessage = `${resolvedPrefix}${separator}${message}`;

    return this.commitWithMetadata(commitMessage, {
      'Agent-Pipeline': 'true',
      'Pipeline-Run-ID': runId,
      'Pipeline-Stage': stageName
    });
  }

  async revertToCommit(commitSha: string): Promise<void> {
    await this.git.reset(['--hard', commitSha]);
  }

  async getCommitMessage(commitSha: string): Promise<string> {
    const log = await this.git.log(['-1', commitSha]);
    return log.latest?.message || '';
  }

  // ============================================
  // Worktree Operations
  // ============================================

  /**
   * Check if a branch is currently checked out in any worktree (including main).
   * @param branch - Branch name to check
   * @returns Path to worktree where branch is checked out, or null if not checked out
   */
  async isBranchCheckedOut(branch: string): Promise<string | null> {
    const worktrees = await this.listWorktrees();
    const match = worktrees.find(wt => wt.branch === branch);
    return match ? match.path : null;
  }

  /**
   * Create a new git worktree for isolated pipeline execution.
   * @param worktreePath - Absolute path where worktree will be created
   * @param branch - Branch name to checkout in the worktree
   * @param baseBranch - Base branch to create new branch from (if branch doesn't exist)
   */
  async createWorktree(
    worktreePath: string,
    branch: string,
    baseBranch: string = 'main'
  ): Promise<void> {
    // Check if branch is already checked out anywhere
    const checkedOutPath = await this.isBranchCheckedOut(branch);
    if (checkedOutPath) {
      throw new Error(
        `Branch '${branch}' is already checked out at '${checkedOutPath}'. ` +
        `Git does not allow checking out the same branch in multiple worktrees.`
      );
    }

    // Check if the branch exists locally
    const branches = await this.git.branchLocal();
    const branchExists = branches.all.includes(branch);

    if (branchExists) {
      // Add worktree with existing branch
      try {
        await this.git.raw(['worktree', 'add', worktreePath, branch]);
      } catch (error) {
        const gitError = ErrorFactory.createGitError(error, 'worktree_add');
        throw new Error(`Failed to add worktree for existing branch '${branch}': ${gitError.message}`);
      }
    } else {
      // Create new branch and worktree from base
      // Try remote base first, fall back to local
      try {
        await this.git.raw(['worktree', 'add', '-b', branch, worktreePath, `origin/${baseBranch}`]);
      } catch (error) {
        // Check if the first attempt created the branch before failing
        // (can happen if origin exists but worktree path has issues)
        const branchesAfterFirstAttempt = await this.git.branchLocal();
        const branchCreatedByFailedAttempt = branchesAfterFirstAttempt.all.includes(branch);

        if (branchCreatedByFailedAttempt) {
          // Branch was created by failed attempt, just add worktree without -b
          try {
            await this.git.raw(['worktree', 'add', worktreePath, branch]);
            return;
          } catch (wtError) {
            const gitError = ErrorFactory.createGitError(wtError, 'worktree_add');
            throw new Error(`Failed to add worktree for branch '${branch}': ${gitError.message}`);
          }
        }

        // Fallback to local base branch if remote doesn't exist
        try {
          await this.git.raw(['worktree', 'add', '-b', branch, worktreePath, baseBranch]);
        } catch (fallbackError) {
          const errorMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);

          // Handle race condition: branch may have been created by concurrent run
          // or left behind from a previous failed run that branchLocal() missed
          if (errorMessage.includes('already exists')) {
            try {
              await this.git.raw(['worktree', 'add', worktreePath, branch]);
              return;
            } catch (existingBranchError) {
              const gitError = ErrorFactory.createGitError(existingBranchError, 'worktree_add');
              throw new Error(`Failed to add worktree for existing branch '${branch}': ${gitError.message}`);
            }
          }

          const gitError = ErrorFactory.createGitError(fallbackError, 'worktree_create');
          throw new Error(
            `Failed to create worktree with new branch '${branch}' from base '${baseBranch}': ${gitError.message}`
          );
        }
      }
    }
  }

  /**
   * Remove a worktree directory and its git association.
   * @param worktreePath - Absolute path to the worktree
   * @param force - Force removal even with uncommitted changes
   */
  async removeWorktree(worktreePath: string, force: boolean = false): Promise<void> {
    const args = ['worktree', 'remove', worktreePath];
    if (force) {
      args.push('--force');
    }
    await this.git.raw(args);
  }

  /**
   * List all worktrees associated with this repository.
   * @returns Array of worktree information objects
   */
  async listWorktrees(): Promise<WorktreeInfo[]> {
    const output = await this.git.raw(['worktree', 'list', '--porcelain']);
    return this.parseWorktreeList(output);
  }

  /**
   * Clean up stale worktree administrative entries.
   * Useful after manually deleting worktree directories.
   */
  async pruneWorktrees(): Promise<void> {
    await this.git.raw(['worktree', 'prune']);
  }

  /**
   * Check if a worktree exists at the given path.
   * @param worktreePath - Absolute path to check
   */
  async worktreeExists(worktreePath: string): Promise<boolean> {
    const worktrees = await this.listWorktrees();
    return worktrees.some(wt => wt.path === worktreePath);
  }

  /**
   * Parse git worktree list --porcelain output into structured data.
   * Format:
   *   worktree /path/to/worktree
   *   HEAD <sha>
   *   branch refs/heads/branch-name
   *   (blank line between entries)
   */
  private parseWorktreeList(output: string): WorktreeInfo[] {
    const worktrees: WorktreeInfo[] = [];
    const entries = output.trim().split('\n\n');

    for (const entry of entries) {
      if (!entry.trim()) continue;

      const lines = entry.split('\n');
      const wt: Partial<WorktreeInfo> = {};

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          wt.path = line.slice(9);
        } else if (line.startsWith('HEAD ')) {
          wt.head = line.slice(5);
        } else if (line.startsWith('branch ')) {
          wt.branch = line.slice(7).replace('refs/heads/', '');
        } else if (line === 'bare') {
          wt.bare = true;
        } else if (line === 'detached') {
          wt.detached = true;
        }
      }

      if (wt.path && wt.head) {
        worktrees.push({
          path: wt.path,
          head: wt.head,
          branch: wt.branch || '',
          bare: wt.bare,
          detached: wt.detached
        });
      }
    }

    return worktrees;
  }
}
