// src/core/parallel-executor.ts

import { AgentStageConfig, StageExecution, PipelineState } from '../config/schema.js';
import { StageExecutor } from './stage-executor.js';
import { ErrorFactory } from '../utils/error-factory.js';

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

  private emitStateChange(state: PipelineState): void {
    if (this.onStateChange) {
      this.onStateChange(state);
    }
  }

  private createFailedExecution(
    stageConfig: AgentStageConfig,
    reason: unknown
  ): StageExecution {
    const timestamp = new Date().toISOString();
    return {
      stageName: stageConfig.name,
      status: 'failed',
      startTime: timestamp,
      endTime: timestamp,
      duration: 0,
      error: ErrorFactory.createStageError(reason, stageConfig.agent)
    };
  }

  private createStageCallback(
    stageName: string,
    onOutputUpdate?: (stageName: string, output: string) => void
  ): ((output: string) => void) | undefined {
    return onOutputUpdate
      ? (output: string) => onOutputUpdate(stageName, output)
      : undefined;
  }

  private buildExecutionResult(
    executions: StageExecution[],
    startTime: number
  ): ParallelExecutionResult {
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
      const stageOutputCallback = this.createStageCallback(stageConfig.name, onOutputUpdate);

      try {
        const execution = await this.stageExecutor.executeStage(
          stageConfig,
          pipelineState,
          stageOutputCallback
        );
        this.emitStateChange(pipelineState);
        return execution;
      } catch (error) {
        this.emitStateChange(pipelineState);
        throw error;
      }
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
        return this.createFailedExecution(stageConfig, result.reason);
      }
    });

    return this.buildExecutionResult(executions, startTime);
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
      const stageOutputCallback = this.createStageCallback(stageConfig.name, onOutputUpdate);
      try {
        const execution = await this.stageExecutor.executeStage(
          stageConfig,
          pipelineState,
          stageOutputCallback
        );
        executions.push(execution);
        this.emitStateChange(pipelineState);
      } catch (error) {
        const failedExecution = this.createFailedExecution(stageConfig, error);
        executions.push(failedExecution);
        this.emitStateChange(pipelineState);
      }
    }

    return this.buildExecutionResult(executions, startTime);
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
