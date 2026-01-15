// src/utils/error-factory.ts

export interface StageErrorDetails {
  message: string;
  stack?: string;
  agentPath?: string;
  timestamp: string;
  suggestion?: string;
}

export interface GitErrorDetails {
  message: string;
  stack?: string;
  operation?: string;
  timestamp: string;
  suggestion?: string;
}

export class ErrorFactory {
  static createStageError(error: unknown, agentPath?: string): StageErrorDetails {
    const baseError: StageErrorDetails = {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      agentPath,
      timestamp: new Date().toISOString()
    };

    const suggestion = this.getSuggestion(baseError.message, agentPath);
    if (suggestion) {
      baseError.suggestion = suggestion;
    }

    return baseError;
  }

  static createGitError(error: unknown, operation?: string): GitErrorDetails {
    const baseError: GitErrorDetails = {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      operation,
      timestamp: new Date().toISOString()
    };

    const suggestion = this.getGitSuggestion(baseError.message, operation);
    if (suggestion) {
      baseError.suggestion = suggestion;
    }

    return baseError;
  }

  private static getSuggestion(message: string, agentPath?: string): string | undefined {
    if (message.includes('ENOENT')) {
      return `Agent file not found. Check path: ${agentPath}`;
    }

    if (message.includes('Agent timeout')) {
      // Extract timeout from message like "Agent timeout after 5 minutes"
      const match = message.match(/after (\d+) minutes/);
      const timeoutStr = match ? match[1] : '15';
      return `Agent exceeded ${timeoutStr}-minute timeout. Consider increasing timeout in pipeline config or optimizing agent complexity.`;
    }

    // Claude CLI auth error (common with GUI-triggered git hooks)
    if (message.includes('Invalid API key') || message.includes('Please run /login')) {
      return (
        'Claude CLI authentication failed. This commonly occurs when pipelines are triggered from GUI git clients ' +
        '(Xcode, VS Code, etc.) which cannot access macOS Keychain credentials. ' +
        'Workarounds: (1) Set ANTHROPIC_API_KEY in ~/.zshenv or .agent-pipeline/env, or ' +
        '(2) Use claude-sdk runtime instead. See docs/configuration.md "GUI Git Clients" section.'
      );
    }

    if (message.includes('API') || message.includes('401') || message.includes('403')) {
      return 'Check ANTHROPIC_API_KEY environment variable is set correctly.';
    }

    if (message.includes('YAML') || message.includes('parse')) {
      return 'Check YAML syntax in pipeline configuration file.';
    }

    if (message.includes('permission')) {
      return 'Check file permissions for agent definition and working directory.';
    }

    return undefined;
  }

  private static getGitSuggestion(message: string, operation?: string): string | undefined {
    if (message.includes('ambiguous argument') || message.includes('unknown revision')) {
      return 'Commit SHA or branch may not exist. This might be the first commit in the repository.';
    }

    if (message.includes('ENOTFOUND') || message.includes('Could not resolve host')) {
      return 'Network error. Check internet connection and git remote URL.';
    }

    if (message.includes('authentication failed') || message.includes('Permission denied')) {
      return 'Git authentication failed. Check SSH keys or HTTPS credentials.';
    }

    if (message.includes('rejected') || message.includes('non-fast-forward')) {
      return 'Push rejected. Pull latest changes or use force push (not recommended).';
    }

    if (message.includes('CONFLICT') || message.includes('merge conflict')) {
      return 'Merge conflict detected. Resolve conflicts manually before continuing.';
    }

    if (message.includes('not a git repository')) {
      return 'Current directory is not a git repository. Initialize with: git init';
    }

    if (message.includes('nothing to commit') || message.includes('no changes added')) {
      return 'No staged changes to commit. Stage changes with: git add';
    }

    if (operation === 'push' && message.includes('failed')) {
      return 'Push failed. Ensure remote branch exists and you have push permissions.';
    }

    return undefined;
  }
}
