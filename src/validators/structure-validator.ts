// src/validators/structure-validator.ts

import { Validator, ValidationContext } from './types.js';

/**
 * Validates basic pipeline structure: name, trigger, and agents array.
 */
export class StructureValidator implements Validator {
  readonly name = 'structure';
  readonly priority = 0 as const;

  shouldRun(): boolean {
    return true; // Always runs
  }

  async validate(context: ValidationContext): Promise<void> {
    const { config, errors } = context;

    if (!config.name || config.name.trim() === '') {
      errors.push({
        field: 'name',
        message: 'Pipeline name is required',
        severity: 'error',
      });
    }

    if (!config.trigger) {
      errors.push({
        field: 'trigger',
        message: 'Pipeline trigger is required (manual or post-commit)',
        severity: 'error',
      });
    } else if (!['manual', 'post-commit'].includes(config.trigger)) {
      errors.push({
        field: 'trigger',
        message: `Invalid trigger: ${config.trigger}. Must be 'manual' or 'post-commit'`,
        severity: 'error',
      });
    }

    if (!config.agents || config.agents.length === 0) {
      errors.push({
        field: 'agents',
        message: 'Pipeline must have at least one agent',
        severity: 'error',
      });
    }
  }
}
