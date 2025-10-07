// src/core/parallel-executor.ts

import { AgentStageConfig, StageExecution, PipelineState } from '../config/schema.js';
import { StageExecutor } from './stage-executor.js';

export interface ParallelExecutionResult {
  executions: StageExecution[];
  allSucceeded: boolean;
  anyFailed: boolean;
  duration: number;
}

export class ParallelExecutor {
  constructor(
    private stageExecutor: StageExecutor,
    private onStateChange?: (state: PipelineState) => void
  ) {}

  /**
   * Execute multiple stages in parallel
   * @param stages - Stages to execute concurrently
   * @param pipelineState - Current pipeline state
   * @param onOutputUpdate - Callback for streaming output updates
   * @returns Results of all parallel executions
   */
  async executeParallelGroup(
    stages: AgentStageConfig[],
    pipelineState: PipelineState,
    onOutputUpdate?: (stageName: string, output: string) => void
  ): Promise<ParallelExecutionResult> {
    const startTime = Date.now();

    // Create promises for all stages
    const promises = stages.map(async (stageConfig) => {
      // Create stage-specific output callback
      const stageOutputCallback = onOutputUpdate
        ? (output: string) => onOutputUpdate(stageConfig.name, output)
        : undefined;

      return this.stageExecutor.executeStage(
        stageConfig,
        pipelineState,
        stageOutputCallback
      );
    });

    // Execute all stages in parallel using allSettled
    // This ensures all stages complete even if some fail
    const results = await Promise.allSettled(promises);

    // Convert results to StageExecution objects
    const executions: StageExecution[] = results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        // Handle rejected promise
        const stageConfig = stages[index];
        return {
          stageName: stageConfig.name,
          status: 'failed',
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          duration: 0,
          error: {
            message: result.reason?.message || 'Unknown error',
            stack: result.reason?.stack,
            agentPath: stageConfig.agent,
            timestamp: new Date().toISOString()
          }
        };
      }
    });

    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;

    const allSucceeded = executions.every(e => e.status === 'success');
    const anyFailed = executions.some(e => e.status === 'failed');

    return {
      executions,
      allSucceeded,
      anyFailed,
      duration
    };
  }

  /**
   * Execute stages sequentially (fallback for sequential mode)
   * @param stages - Stages to execute one by one
   * @param pipelineState - Current pipeline state
   * @param onOutputUpdate - Callback for streaming output updates
   * @returns Results of all sequential executions
   */
  async executeSequentialGroup(
    stages: AgentStageConfig[],
    pipelineState: PipelineState,
    onOutputUpdate?: (stageName: string, output: string) => void
  ): Promise<ParallelExecutionResult> {
    const startTime = Date.now();
    const executions: StageExecution[] = [];

    for (const stageConfig of stages) {
      const stageOutputCallback = onOutputUpdate
        ? (output: string) => onOutputUpdate(stageConfig.name, output)
        : undefined;

      const execution = await this.stageExecutor.executeStage(
        stageConfig,
        pipelineState,
        stageOutputCallback
      );

      executions.push(execution);

      // Update pipeline state with completed stage
      pipelineState.stages.push(execution);
      if (this.onStateChange) {
        this.onStateChange(pipelineState);
      }
    }

    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;

    const allSucceeded = executions.every(e => e.status === 'success');
    const anyFailed = executions.some(e => e.status === 'failed');

    return {
      executions,
      allSucceeded,
      anyFailed,
      duration
    };
  }

  /**
   * Aggregate results from parallel execution
   * Useful for logging and reporting
   */
  aggregateResults(result: ParallelExecutionResult): string {
    const successful = result.executions.filter(e => e.status === 'success').length;
    const failed = result.executions.filter(e => e.status === 'failed').length;
    const total = result.executions.length;

    return `Completed ${total} stages in ${result.duration.toFixed(1)}s (${successful} succeeded, ${failed} failed)`;
  }
}
