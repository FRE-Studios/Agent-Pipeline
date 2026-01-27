// src/validators/environment-validator.ts

import { Validator, ValidationContext } from './types.js';

/** Default runtime type when not specified in pipeline config */
const DEFAULT_RUNTIME_TYPE = 'claude-code-headless';

/**
 * Validates runtime environment requirements: API keys based on runtime types used.
 */
export class EnvironmentValidator implements Validator {
  readonly name = 'environment';
  readonly priority = 0 as const;

  shouldRun(): boolean {
    return true; // Always runs
  }

  async validate(context: ValidationContext): Promise<void> {
    const { config, errors } = context;

    // Collect all runtime types used in the pipeline
    const usedRuntimes = new Set<string>();

    // Pipeline-level runtime (or default)
    const pipelineRuntime = config.runtime?.type ?? DEFAULT_RUNTIME_TYPE;
    usedRuntimes.add(pipelineRuntime);

    // Stage-level runtime overrides
    if (config.agents) {
      for (const agent of config.agents) {
        if (agent.runtime?.type) {
          usedRuntimes.add(agent.runtime.type);
        }
      }
    }

    // Validate based on which runtimes are used
    if (usedRuntimes.has('claude-sdk')) {
      this.validateClaudeApiKey(errors);
    }

    // Note: claude-code-headless validation happens in RuntimeValidator via runtime.validate()
    // which already checks for CLI availability and shows warnings
  }

  private validateClaudeApiKey(errors: ValidationContext['errors']): void {
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      errors.push({
        field: 'environment',
        message:
          'Claude API key not set. Set environment variable: export ANTHROPIC_API_KEY=sk-ant-...',
        severity: 'error',
      });
    }
  }
}
