// src/validators/settings-validator.ts

import { Validator, ValidationContext } from './types.js';

/**
 * Validates pipeline settings: failureStrategy, commitPrefix, permissionMode.
 */
export class SettingsValidator implements Validator {
  readonly name = 'settings';
  readonly priority = 0 as const;

  shouldRun(context: ValidationContext): boolean {
    return !!context.config.settings;
  }

  async validate(context: ValidationContext): Promise<void> {
    const { config, errors } = context;
    const settings = config.settings;
    if (!settings) return;

    if (settings.failureStrategy) {
      const validStrategies = ['stop', 'continue', 'warn'];
      if (!validStrategies.includes(settings.failureStrategy)) {
        errors.push({
          field: 'settings.failureStrategy',
          message: `Invalid failure strategy: ${settings.failureStrategy}. Must be one of: ${validStrategies.join(', ')}`,
          severity: 'error',
        });
      }
    }

    if (settings.commitPrefix && !settings.commitPrefix.includes('{{stage}}')) {
      errors.push({
        field: 'settings.commitPrefix',
        message: 'commitPrefix should include {{stage}} template variable',
        severity: 'warning',
      });
    }

    if (settings.permissionMode) {
      const validModes = ['default', 'acceptEdits', 'bypassPermissions', 'plan'];
      if (!validModes.includes(settings.permissionMode)) {
        errors.push({
          field: 'settings.permissionMode',
          message: `Invalid permission mode: ${settings.permissionMode}. Must be one of: ${validModes.join(', ')}`,
          severity: 'error',
        });
      }

      if (settings.permissionMode === 'bypassPermissions') {
        errors.push({
          field: 'settings.permissionMode',
          message:
            'bypassPermissions mode bypasses all permission checks. Use with caution in production.',
          severity: 'warning',
        });
      }
    }
  }
}
