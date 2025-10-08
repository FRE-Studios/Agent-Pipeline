import { vi } from 'vitest';
import { DAGPlanner } from '../../core/dag-planner.js';
import { ExecutionGraph } from '../../core/types/execution-graph.js';
import { PipelineConfig } from '../../config/schema.js';

export interface MockDAGPlannerConfig {
  executionGraph?: ExecutionGraph;
  shouldThrow?: boolean;
  errorMessage?: string;
}

export function createMockDAGPlanner(config: MockDAGPlannerConfig = {}): DAGPlanner {
  const {
    executionGraph,
    shouldThrow = false,
    errorMessage = 'Invalid pipeline DAG',
  } = config;

  return {
    buildExecutionPlan: vi.fn().mockImplementation((pipelineConfig: PipelineConfig) => {
      if (shouldThrow) {
        throw new Error(errorMessage);
      }

      // Default execution graph if not provided
      if (executionGraph) {
        return executionGraph;
      }

      // Build simple execution plan from config
      const nodes = new Map();
      pipelineConfig.agents.forEach(agent => {
        nodes.set(agent.name, {
          stage: agent,
          dependencies: agent.dependsOn || [],
          dependents: [],
          level: 0
        });
      });

      return {
        nodes,
        adjacencyList: new Map(),
        plan: {
          groups: [{
            level: 0,
            stages: pipelineConfig.agents
          }],
          totalStages: pipelineConfig.agents.length,
          maxParallelism: pipelineConfig.agents.length,
          isSequential: pipelineConfig.agents.length === 1
        },
        validation: {
          valid: true,
          errors: [],
          warnings: []
        }
      };
    }),
    validateDAG: vi.fn().mockReturnValue({
      valid: true,
      errors: [],
      warnings: []
    }),
  } as unknown as DAGPlanner;
}
