// src/validators/types.ts

import { PipelineConfig } from '../config/schema.js';

/**
 * Validation error with field, message, and severity.
 */
export interface ValidationError {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

/**
 * Shared context passed to all validators during validation.
 */
export interface ValidationContext {
  config: PipelineConfig;
  repoPath: string;
  errors: ValidationError[];
  /** Set to true to skip remaining validators (e.g., on critical failure) */
  skipRemainingValidators?: boolean;
}

/**
 * Interface for all validators.
 * Validators are composed by the ValidationOrchestrator and executed in priority order.
 */
export interface Validator {
  /** Unique identifier for this validator */
  readonly name: string;

  /** Priority level: 0=critical, 1=conditional, 2=configurable */
  readonly priority: 0 | 1 | 2;

  /**
   * Check if this validator should run given current context.
   * Allows conditional validators to self-exclude.
   */
  shouldRun(context: ValidationContext): boolean;

  /**
   * Perform validation, mutating context.errors.
   * Can set context.skipRemainingValidators for critical failures.
   */
  validate(context: ValidationContext): Promise<void>;
}
