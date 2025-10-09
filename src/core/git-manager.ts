// src/core/git-manager.ts

import { simpleGit, SimpleGit } from 'simple-git';
import { ErrorFactory } from '../utils/error-factory.js';

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

    await this.git.commit(fullMessage);
    return this.getCurrentCommit();
  }

  /**
   * Creates a pipeline commit with metadata trailers.
   * Auto-stages all changes before committing.
   */
  async createPipelineCommit(
    stageName: string,
    runId: string,
    customMessage?: string
  ): Promise<string> {
    if (!(await this.hasUncommittedChanges())) {
      return '';
    }

    await this.stageAllChanges();

    const message = customMessage || `Apply ${stageName} changes`;
    const commitMessage = `[pipeline:${stageName}] ${message}`;

    return this.commitWithMetadata(commitMessage, {
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
}
