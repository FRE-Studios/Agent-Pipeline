// src/validators/dag-validator.ts

import { DAGPlanner } from '../core/dag-planner.js';
import { Validator, ValidationContext } from './types.js';

/**
 * Validates DAG structure: dependencies, cycles, and parallel execution limits.
 * Uses a single DAGPlanner instance for all validations.
 */
export class DAGValidator implements Validator {
  readonly name = 'dag';
  readonly priority = 2 as const; // P2 - runs after agent validation

  shouldRun(context: ValidationContext): boolean {
    const hasAgents = (context.config.agents?.length ?? 0) > 0;
    return hasAgents;
  }

  async validate(context: ValidationContext): Promise<void> {
    const { config, errors } = context;
    if (!config.agents || config.agents.length === 0) return;

    // Single DAGPlanner instance for all validations
    const planner = new DAGPlanner();

    // Validate DAG structure (cycles, missing dependencies)
    const dagValidation = planner.validateDAG(config);

    for (const error of dagValidation.errors) {
      errors.push({
        field: 'agents.dependsOn',
        message: error,
        severity: 'error',
      });
    }

    for (const warning of dagValidation.warnings) {
      errors.push({
        field: 'agents.dependsOn',
        message: warning,
        severity: 'warning',
      });
    }

    // Only check parallel limits if DAG is valid
    if (dagValidation.valid) {
      this.validateParallelLimits(config, errors, planner);
    }
  }

  private validateParallelLimits(
    config: ValidationContext['config'],
    errors: ValidationContext['errors'],
    planner: DAGPlanner
  ): void {
    let graph;
    try {
      graph = planner.buildExecutionPlan(config);
    } catch {
      // Skip parallel limit checks if the execution plan can't be built.
      return;
    }
    const maxParallel = graph.plan.maxParallelism;

    if (maxParallel > 10) {
      errors.push({
        field: 'agents',
        message: `Pipeline has ${maxParallel} stages running in parallel. Consider adding dependencies to limit concurrency and avoid rate limits`,
        severity: 'warning',
      });
    }
  }
}
