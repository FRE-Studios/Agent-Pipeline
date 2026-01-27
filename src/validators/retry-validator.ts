// src/validators/retry-validator.ts

import { Validator, ValidationContext } from './types.js';

/**
 * Validates retry configuration sanity: maxAttempts and delay limits.
 */
export class RetryValidator implements Validator {
  readonly name = 'retry';
  readonly priority = 2 as const; // P2 - advisory warnings

  shouldRun(context: ValidationContext): boolean {
    return context.config.agents?.some((a) => a.retry) ?? false;
  }

  async validate(context: ValidationContext): Promise<void> {
    const { config, errors } = context;
    if (!config.agents) return;

    for (const agent of config.agents) {
      if (agent.retry) {
        this.checkRetrySanity(errors, `agents.${agent.name}.retry`, agent.retry);
      }
    }
  }

  private checkRetrySanity(
    errors: ValidationContext['errors'],
    field: string,
    retry: { maxAttempts?: number; delay?: number }
  ): void {
    if (retry.maxAttempts && retry.maxAttempts > 10) {
      errors.push({
        field,
        message: `maxAttempts (${retry.maxAttempts}) exceeds recommended limit. Consider reducing to <= 10 to avoid excessive delays`,
        severity: 'warning',
      });
    }

    if (retry.delay && retry.delay > 300) {
      errors.push({
        field,
        message: `Retry delay (${retry.delay}s) exceeds recommended maximum. Consider reducing to <= 300s (5 minutes)`,
        severity: 'warning',
      });
    }
  }
}
