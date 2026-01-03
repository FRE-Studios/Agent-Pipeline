// src/validators/validation-orchestrator.ts

import { PipelineConfig } from '../config/schema.js';
import { ValidationError, ValidationContext, Validator } from './types.js';

// Import all validators
import { EnvironmentValidator } from './environment-validator.js';
import { GitValidator } from './git-validator.js';
import { StructureValidator } from './structure-validator.js';
import { RuntimeValidator } from './runtime-validator.js';
import { AgentValidator } from './agent-validator.js';
import { SettingsValidator } from './settings-validator.js';
import { NotificationValidator } from './notification-validator.js';
import { RetryValidator } from './retry-validator.js';
import { DAGValidator } from './dag-validator.js';

/**
 * Orchestrates validation by composing multiple validators.
 * Validators are executed in priority order (0 first, then 1, then 2).
 */
export class ValidationOrchestrator {
  private validators: Validator[] = [];

  constructor() {
    // Register validators in priority order
    // P0: Critical validators
    this.register(new EnvironmentValidator());
    this.register(new GitValidator());
    this.register(new StructureValidator());
    this.register(new RuntimeValidator());
    this.register(new AgentValidator());
    this.register(new SettingsValidator());
    // P1: Conditional validators
    this.register(new NotificationValidator());
    // P2: Configurable validators
    this.register(new RetryValidator());
    this.register(new DAGValidator());
  }

  /**
   * Register a validator. Validators are automatically sorted by priority.
   */
  register(validator: Validator): void {
    this.validators.push(validator);
    this.validators.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Run all registered validators against the config.
   * Returns accumulated validation errors.
   */
  async validate(config: PipelineConfig, repoPath: string): Promise<ValidationError[]> {
    const context: ValidationContext = {
      config,
      repoPath,
      errors: [],
    };

    for (const validator of this.validators) {
      if (context.skipRemainingValidators) break;

      if (validator.shouldRun(context)) {
        await validator.validate(context);
      }
    }

    return context.errors;
  }
}
