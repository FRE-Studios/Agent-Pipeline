// src/validators/execution-validator.ts

import { Validator, ValidationContext } from './types.js';

/**
 * Validates execution settings: mode, failureStrategy, permissionMode.
 */
export class ExecutionValidator implements Validator {
  readonly name = 'execution';
  readonly priority = 0 as const;

  shouldRun(context: ValidationContext): boolean {
    return !!context.config.execution;
  }

  async validate(context: ValidationContext): Promise<void> {
    const { config, errors } = context;
    const execution = config.execution;
    if (!execution) return;

    // Validate mode
    if (execution.mode) {
      const validModes = ['sequential', 'parallel'];
      if (!validModes.includes(execution.mode)) {
        errors.push({
          field: 'execution.mode',
          message: `Invalid execution mode: ${execution.mode}. Must be one of: ${validModes.join(', ')}`,
          severity: 'error',
        });
      }
    }

    // Validate failureStrategy
    if (execution.failureStrategy) {
      const validStrategies = ['stop', 'continue'];
      if (!validStrategies.includes(execution.failureStrategy)) {
        errors.push({
          field: 'execution.failureStrategy',
          message: `Invalid failure strategy: ${execution.failureStrategy}. Must be one of: ${validStrategies.join(', ')}`,
          severity: 'error',
        });
      }
    }

    // Validate permissionMode
    if (execution.permissionMode) {
      const validModes = ['default', 'acceptEdits', 'bypassPermissions', 'plan'];
      if (!validModes.includes(execution.permissionMode)) {
        errors.push({
          field: 'execution.permissionMode',
          message: `Invalid permission mode: ${execution.permissionMode}. Must be one of: ${validModes.join(', ')}`,
          severity: 'error',
        });
      }

      if (execution.permissionMode === 'bypassPermissions') {
        errors.push({
          field: 'execution.permissionMode',
          message:
            'bypassPermissions mode bypasses all permission checks. Use with caution in production.',
          severity: 'warning',
        });
      }
    }
  }
}
