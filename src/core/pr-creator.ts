import { spawn } from 'child_process';
import { PipelineState } from '../config/schema.js';
import { checkGHCLI } from '../utils/gh-cli-checker.js';

export interface PRConfig {
  title?: string;
  body?: string;
  reviewers?: string[];
  labels?: string[];
  draft?: boolean;
  assignees?: string[];
  milestone?: string;
  web?: boolean;
}

/**
 * Creates GitHub pull requests via GitHub CLI.
 * Requires 'gh' CLI to be installed and authenticated.
 */
export class PRCreator {
  /**
   * Executes a command using spawn and returns the output.
   * @param command The command to execute (e.g., 'gh').
   * @param args An array of string arguments.
   * @returns A promise that resolves with the command's stdout.
   */
  private executeGhCommand(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const process = spawn('gh', args);
      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          // Use stderr for the error message if available
          const errorMessage = stderr || stdout || 'Unknown error';
          reject(new Error(`gh command failed with exit code ${code}: ${errorMessage}`));
        }
      });

      process.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Create a pull request using GitHub CLI.
   */
  async createPR(
    branchName: string,
    baseBranch: string,
    config: PRConfig,
    pipelineState: PipelineState
  ): Promise<{ url: string; number: number }> {
    // Check prerequisites
    const ghStatus = await checkGHCLI();

    if (!ghStatus.installed) {
      throw new Error(
        'GitHub CLI (gh) is not installed. Install from: https://cli.github.com/\n\n' +
        'Or disable PR creation:\n' +
        "- Set git.mergeStrategy to 'local-merge' or 'none' in your pipeline config\n" +
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

    const body = config.body || PRCreator.buildDefaultPRBody(pipelineState);

    // Build gh pr create command
    const args: string[] = [
      'pr', 'create',
      '--base', baseBranch,
      '--head', branchName,
      '--title', title,
      '--body', body
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
      args.push('--milestone', config.milestone);
    }

    if (config.web) {
      // Open in browser for interactive editing
      args.push('--web');
    }

    // Execute gh pr create
    console.log(`\n🚀 Creating pull request...`);

    try {
      const stdout = await this.executeGhCommand(args);

      // Extract PR URL from output
      const urlMatch = stdout.match(/https:\/\/github\.com\/[^\s]+/);
      const url = urlMatch ? urlMatch[0] : '';

      // Extract PR number
      let number = 0;
      const numberMatch = stdout.match(/#(\d+)/);
      if (numberMatch) {
        number = parseInt(numberMatch[1]);
      } else if (url) {
        const urlNumberMatch = url.match(/\/pull\/(\d+)/);
        if (urlNumberMatch) {
          number = parseInt(urlNumberMatch[1]);
        }
      }

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
   * Build default PR body with pipeline summary.
   */
  private static buildDefaultPRBody(state: PipelineState): string {
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

  const retry = (s.retryAttempt || 0) > 0 ? ` (${s.retryAttempt} retries)` : '';

  return `${i + 1}. ${icon} **${s.stageName}** - ${s.duration?.toFixed(2)}s${retry}`;
}).join('\n')}

### Commits

${state.stages
  .filter(s => s.commitSha)
  .map(s => `- \`${s.commitSha?.substring(0, 7)}\` ${s.commitMessage}`)
  .join('\n')}

---

*This PR was automatically generated by Agent Pipeline*
    `.trim();

    return summary;
  }

  /**
   * View an existing PR
   */
  async viewPR(branchName: string): Promise<void> {
    await this.executeGhCommand(['pr', 'view', branchName, '--web']);
  }

  /**
   * Check if a PR already exists for this branch
   */
  async prExists(branchName: string): Promise<boolean> {
    try {
      await this.executeGhCommand(['pr', 'view', branchName]);
      return true;
    } catch {
      return false;
    }
  }
}
