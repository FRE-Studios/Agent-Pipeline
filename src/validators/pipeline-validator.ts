// src/validators/pipeline-validator.ts

import { PipelineConfig } from '../config/schema.js';
import { ValidationOrchestrator } from './validation-orchestrator.js';

// Re-export ValidationError for backward compatibility
export { ValidationError } from './types.js';

/**
 * Pipeline validator facade that delegates to the ValidationOrchestrator.
 * Maintains backward compatibility with existing callers.
 */
export class PipelineValidator {
  private orchestrator = new ValidationOrchestrator();

  /**
   * Validate a pipeline configuration.
   * @param config The pipeline configuration to validate
   * @param repoPath The path to the repository
   * @returns Array of validation errors
   */
  async validate(
    config: PipelineConfig,
    repoPath: string
  ): Promise<import('./types.js').ValidationError[]> {
    return this.orchestrator.validate(config, repoPath);
  }

  /**
   * Validate and report results to console.
   * @param config The pipeline configuration to validate
   * @param repoPath The path to the repository
   * @returns true if validation passed (no errors), false otherwise
   */
  static async validateAndReport(config: PipelineConfig, repoPath: string): Promise<boolean> {
    const validator = new PipelineValidator();
    const errors = await validator.validate(config, repoPath);

    if (errors.length === 0) {
      return true;
    }

    const hasErrors = errors.some((e) => e.severity === 'error');
    const hasWarnings = errors.some((e) => e.severity === 'warning');

    console.log('\n📋 Pipeline Validation Results:\n');

    for (const error of errors) {
      const icon = error.severity === 'error' ? '❌' : '⚠️';
      console.log(`${icon} ${error.field}: ${error.message}`);
    }

    if (hasErrors) {
      console.log('\n❌ Pipeline validation failed. Fix errors before running.\n');
      return false;
    }

    if (hasWarnings) {
      console.log('\n⚠️  Pipeline has warnings but can still run.\n');
    }

    return true;
  }
}
