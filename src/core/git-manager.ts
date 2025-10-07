// src/core/git-manager.ts

import { simpleGit, SimpleGit } from 'simple-git';

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
    const diff = await this.git.diff([
      '--name-only',
      `${commitSha}^`,
      commitSha
    ]);
    return diff.split('\n').filter(Boolean);
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
    // Add metadata as git trailers
    const trailers = Object.entries(metadata)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');

    const fullMessage = `${message}\n\n${trailers}`;

    await this.git.commit(fullMessage);
    return this.getCurrentCommit();
  }

  async createPipelineCommit(
    stageName: string,
    runId: string,
    customMessage?: string
  ): Promise<string> {
    if (!(await this.hasUncommittedChanges())) {
      return ''; // No changes to commit
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
