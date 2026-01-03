// src/validators/git-validator.ts

import { simpleGit } from 'simple-git';
import { checkGHCLI } from '../utils/gh-cli-checker.js';
import { Validator, ValidationContext } from './types.js';

/**
 * Validates git-related configuration: repository, user config, strategies, GitHub CLI.
 */
export class GitValidator implements Validator {
  readonly name = 'git';
  readonly priority = 0 as const;

  shouldRun(): boolean {
    return true; // Always runs for repo check
  }

  async validate(context: ValidationContext): Promise<void> {
    const { config, repoPath, errors } = context;

    // P0: Git repository check
    await this.validateRepository(repoPath, errors, context);

    // P0: Git user config (conditional - only if autoCommit is enabled)
    const autoCommit = config.settings?.autoCommit ?? true; // default is true
    if (autoCommit) {
      await this.validateUserConfig(repoPath, errors);
    }

    // P0: Git strategies validation
    this.validateStrategies(config, errors);

    // P0: GitHub CLI availability (conditional - only if PR creation enabled)
    if (config.git?.mergeStrategy === 'pull-request') {
      await this.validateGitHubCLI(errors);
    }
  }

  private async validateRepository(
    repoPath: string,
    errors: ValidationContext['errors'],
    context: ValidationContext
  ): Promise<void> {
    try {
      const git = simpleGit(repoPath);
      const isRepo = 'checkIsRepo';
      await git[isRepo]();
    } catch {
      errors.push({
        field: 'repository',
        message: 'Not a git repository. Initialize with: git init',
        severity: 'error',
      });
    }
  }

  private async validateUserConfig(
    repoPath: string,
    errors: ValidationContext['errors']
  ): Promise<void> {
    try {
      const git = simpleGit(repoPath);
      const name = await git.getConfig('user.name');
      const email = await git.getConfig('user.email');

      if (!name.value) {
        errors.push({
          field: 'git.config',
          message: 'Git user.name not configured. Run: git config user.name "Your Name"',
          severity: 'error',
        });
      }
      if (!email.value) {
        errors.push({
          field: 'git.config',
          message: 'Git user.email not configured. Run: git config user.email "you@example.com"',
          severity: 'error',
        });
      }
    } catch {
      // If git config fails, likely not a git repo - already caught by validateRepository
    }
  }

  private validateStrategies(
    config: ValidationContext['config'],
    errors: ValidationContext['errors']
  ): void {
    if (!config.git) return;

    const branchStrategy = config.git.branchStrategy || 'reusable';
    const mergeStrategy = config.git.mergeStrategy || 'none';

    // Validate branchStrategy value
    const validBranchStrategies = ['reusable', 'unique-per-run', 'unique-and-delete'];
    if (config.git.branchStrategy && !validBranchStrategies.includes(config.git.branchStrategy)) {
      errors.push({
        field: 'git.branchStrategy',
        message: `Invalid branch strategy: ${config.git.branchStrategy}. Must be one of: ${validBranchStrategies.join(', ')}`,
        severity: 'error',
      });
    }

    // Validate mergeStrategy value
    const validMergeStrategies = ['pull-request', 'local-merge', 'none'];
    if (config.git.mergeStrategy && !validMergeStrategies.includes(config.git.mergeStrategy)) {
      errors.push({
        field: 'git.mergeStrategy',
        message: `Invalid merge strategy: ${config.git.mergeStrategy}. Must be one of: ${validMergeStrategies.join(', ')}`,
        severity: 'error',
      });
    }

    // unique-and-delete + none = work would be lost
    if (branchStrategy === 'unique-and-delete' && mergeStrategy === 'none') {
      errors.push({
        field: 'git.branchStrategy',
        message:
          "Cannot use 'unique-and-delete' with 'none' merge strategy - work would be lost. " +
          "Use 'pull-request' or 'local-merge' to preserve work, or change branchStrategy to 'reusable' or 'unique-per-run'.",
        severity: 'error',
      });
    }

    // Warn if pullRequest config exists but mergeStrategy is not 'pull-request'
    if (config.git.pullRequest && mergeStrategy !== 'pull-request') {
      errors.push({
        field: 'git.pullRequest',
        message:
          "pullRequest settings are configured but mergeStrategy is not 'pull-request'. " +
          'These settings will be ignored.',
        severity: 'warning',
      });
    }
  }

  private async validateGitHubCLI(errors: ValidationContext['errors']): Promise<void> {
    const ghStatus = await checkGHCLI();

    if (!ghStatus.installed) {
      errors.push({
        field: 'git.mergeStrategy',
        message:
          "GitHub CLI (gh) is not installed. Install from https://cli.github.com/ or change mergeStrategy to 'local-merge' or 'none'",
        severity: 'error',
      });
    } else if (!ghStatus.authenticated) {
      errors.push({
        field: 'git.mergeStrategy',
        message:
          "GitHub CLI is not authenticated. Run 'gh auth login' or change mergeStrategy to 'local-merge' or 'none'",
        severity: 'error',
      });
    }
  }
}
