// src/utils/error-factory.ts

export interface StageErrorDetails {
  message: string;
  stack?: string;
  agentPath?: string;
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

  private static getSuggestion(message: string, agentPath?: string): string | undefined {
    if (message.includes('ENOENT')) {
      return `Agent file not found. Check path: ${agentPath}`;
    }

    if (message.includes('timeout') || message.includes('Agent timeout')) {
      return 'Agent exceeded timeout. Consider increasing timeout in pipeline config.';
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
}
