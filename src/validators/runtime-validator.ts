// src/validators/runtime-validator.ts

import { AgentRuntimeRegistry } from '../core/agent-runtime-registry.js';
import { Validator, ValidationContext, ValidationError } from './types.js';

/**
 * Validates runtime configuration: type registration, model availability, permission modes.
 */
export class RuntimeValidator implements Validator {
  readonly name = 'runtime';
  readonly priority = 0 as const;

  shouldRun(context: ValidationContext): boolean {
    return !!context.config.runtime || context.config.agents?.some((a) => a.runtime) || false;
  }

  async validate(context: ValidationContext): Promise<void> {
    const { config, errors } = context;

    // Validate pipeline-level runtime
    if (config.runtime) {
      await this.validateRuntimeConfig(
        errors,
        'runtime',
        config.runtime,
        config.settings?.permissionMode
      );
    }

    // Validate stage-level runtime overrides
    if (config.agents) {
      for (const agent of config.agents) {
        if (agent.runtime) {
          await this.validateRuntimeConfig(
            errors,
            `agents.${agent.name}.runtime`,
            agent.runtime,
            config.settings?.permissionMode
          );
        }
      }
    }
  }

  private async validateRuntimeConfig(
    errors: ValidationError[],
    field: string,
    runtime: { type: string; options?: Record<string, unknown> },
    permissionMode?: string
  ): Promise<void> {
    // Check if runtime type is registered
    if (!AgentRuntimeRegistry.hasRuntime(runtime.type)) {
      const availableRuntimes = AgentRuntimeRegistry.getAvailableTypes().join(', ');
      errors.push({
        field,
        message: `Unknown runtime type: ${runtime.type}. Available runtimes: [${availableRuntimes}]`,
        severity: 'error',
      });
      return; // Skip further validation if runtime doesn't exist
    }

    // Get runtime instance
    const runtimeInstance = AgentRuntimeRegistry.getRuntime(runtime.type);
    const capabilities = runtimeInstance.getCapabilities();

    // Validate runtime availability (warnings only at load time)
    try {
      const validation = await runtimeInstance.validate();

      // Add errors as warnings (we'll fail at execution time if still unavailable)
      for (const error of validation.errors) {
        errors.push({
          field,
          message: `Runtime availability: ${error}`,
          severity: 'warning',
        });
      }

      // Add validation warnings
      for (const warning of validation.warnings) {
        errors.push({
          field,
          message: warning,
          severity: 'warning',
        });
      }
    } catch (error) {
      // Runtime validation failed unexpectedly
      errors.push({
        field,
        message: `Runtime validation failed: ${error instanceof Error ? error.message : String(error)}`,
        severity: 'warning',
      });
    }

    // Validate model selection
    const model = runtime.options?.model;
    if (model && typeof model === 'string') {
      if (!capabilities.availableModels.includes(model)) {
        const availableModels = capabilities.availableModels.join(', ');
        errors.push({
          field: `${field}.options.model`,
          message: `Model "${model}" not available for runtime "${runtime.type}". Available models: [${availableModels}]`,
          severity: 'error',
        });
      }
    }

    // Validate permission mode (if specified in runtime options or at pipeline level)
    const runtimePermissionMode = runtime.options?.permissionMode as string | undefined;
    const effectivePermissionMode = runtimePermissionMode || permissionMode;

    if (effectivePermissionMode) {
      if (!capabilities.permissionModes.includes(effectivePermissionMode)) {
        const availableModes = capabilities.permissionModes.join(', ');
        errors.push({
          field: `${field}.options.permissionMode`,
          message: `Permission mode "${effectivePermissionMode}" not supported by runtime "${runtime.type}". Supported modes: [${availableModes}]`,
          severity: 'error',
        });
      }
    }
  }
}
