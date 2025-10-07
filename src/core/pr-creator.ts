// src/core/pr-creator.ts

import { exec } from 'child_process';
import { promisify } from 'util';
import { PipelineState } from '../config/schema.js';

const execAsync = promisify(exec);

export interface PRConfig {
  autoCreate?: boolean;
  title?: string;
  body?: string;
  reviewers?: string[];
  labels?: string[];
  draft?: boolean;
  assignees?: string[];
  milestone?: string;
  web?: boolean;  // Open in browser for interactive mode
}

export class PRCreator {
  /**
   * Check if GitHub CLI is installed and authenticated
   */
  async checkGHCLI(): Promise<{ installed: boolean; authenticated: boolean }> {
    try {
      // Check if gh is installed
      await execAsync('gh --version');

      // Check if authenticated
      try {
        await execAsync('gh auth status');
        return { installed: true, authenticated: true };
      } catch {
        return { installed: true, authenticated: false };
      }
    } catch {
      return { installed: false, authenticated: false };
    }
  }

  /**
   * Create a pull request using GitHub CLI
   */
  async createPR(
    branchName: string,
    baseBranch: string,
    config: PRConfig,
    pipelineState: PipelineState
  ): Promise<{ url: string; number: number }> {
    // Check prerequisites
    const ghStatus = await this.checkGHCLI();

    if (!ghStatus.installed) {
      throw new Error(
        'GitHub CLI (gh) is not installed. Install from: https://cli.github.com/\n\n' +
        'Or disable PR creation:\n' +
        '- Remove git.pullRequest.autoCreate from your pipeline config\n' +
        '- Or run with: agent-pipeline run <pipeline> --no-pr'
      );
    }

    if (!ghStatus.authenticated) {
      throw new Error(
        'GitHub CLI is not authenticated. Run: gh auth login\n\n' +
        'Or disable PR creation:\n' +
        '- Run with: agent-pipeline run <pipeline> --no-pr'
      );
    }

    // Build PR title and body
    const title = config.title ||
      `🤖 [Agent Pipeline] ${pipelineState.pipelineConfig.name}`;

    const body = config.body || this.buildDefaultPRBody(pipelineState);

    // Build gh pr create command
    const args: string[] = [
      'pr', 'create',
      '--base', baseBranch,
      '--head', branchName,
      '--title', this.escapeShellArg(title),
      '--body', this.escapeShellArg(body)
    ];

    // Add optional flags
    if (config.draft) {
      args.push('--draft');
    }

    if (config.reviewers && config.reviewers.length > 0) {
      args.push('--reviewer', config.reviewers.join(','));
    }

    if (config.labels && config.labels.length > 0) {
      args.push('--label', config.labels.join(','));
    }

    if (config.assignees && config.assignees.length > 0) {
      args.push('--assignee', config.assignees.join(','));
    }

    if (config.milestone) {
      args.push('--milestone', this.escapeShellArg(config.milestone));
    }

    if (config.web) {
      // Open in browser for interactive editing
      args.push('--web');
    }

    // Execute gh pr create
    console.log(`\n🚀 Creating pull request...`);

    try {
      const { stdout } = await execAsync(`gh ${args.join(' ')}`);

      // Extract PR URL from output
      const urlMatch = stdout.match(/https:\/\/github\.com\/[^\s]+/);
      const url = urlMatch ? urlMatch[0] : '';

      // Extract PR number
      const numberMatch = stdout.match(/#(\d+)/);
      const number = numberMatch ? parseInt(numberMatch[1]) : 0;

      return { url, number };
    } catch (error) {
      if (error instanceof Error) {
        // Check for common errors
        if (error.message.includes('already exists')) {
          throw new Error(
            `A pull request already exists for ${branchName}. ` +
            `View it with: gh pr view ${branchName}`
          );
        }

        throw new Error(`Failed to create PR: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Build default PR body with pipeline summary
   */
  private buildDefaultPRBody(state: PipelineState): string {
    const successCount = state.stages.filter(s => s.status === 'success').length;
    const totalCount = state.stages.length;

    const summary = `
## 🤖 Agent Pipeline Summary

**Pipeline:** ${state.pipelineConfig.name}
**Run ID:** \`${state.runId}\`
**Status:** ${state.status === 'completed' ? '✅ Completed' : '⚠️ ' + state.status}
**Duration:** ${state.artifacts.totalDuration?.toFixed(2)}s
**Stages:** ${successCount}/${totalCount} successful

### Stages Executed

${state.stages.map((s, i) => {
  const icon = s.status === 'success' ? '✅' :
               s.status === 'failed' ? '❌' :
               s.status === 'skipped' ? '⏭️' : '⏳';

  const retry = s.retryAttempt && s.retryAttempt > 0
    ? ` (${s.retryAttempt} retries)`
    : '';

  return `${i + 1}. ${icon} **${s.stageName}** - ${s.duration?.toFixed(2)}s${retry}`;
}).join('\n')}

### Commits

${state.stages
  .filter(s => s.commitSha)
  .map(s => `- \`${s.commitSha?.substring(0, 7)}\` ${s.commitMessage}`)
  .join('\n')}

---

*This PR was automatically generated by [Agent Pipeline](https://github.com/yourusername/agent-pipeline)*
    `.trim();

    return summary;
  }

  /**
   * View an existing PR
   */
  async viewPR(branchName: string): Promise<void> {
    await execAsync(`gh pr view ${branchName} --web`);
  }

  /**
   * Check if a PR already exists for this branch
   */
  async prExists(branchName: string): Promise<boolean> {
    try {
      await execAsync(`gh pr view ${branchName}`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Escape shell arguments to prevent command injection
   */
  private escapeShellArg(arg: string): string {
    // Wrap in single quotes and escape any single quotes in the string
    return `'${arg.replace(/'/g, "'\\''")}'`;
  }
}
