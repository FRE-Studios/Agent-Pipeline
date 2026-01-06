// src/core/parallel-executor.ts

import { AgentStageConfig, StageExecution, PipelineState } from '../config/schema.js';
import { StageExecutor } from './stage-executor.js';
import { ErrorFactory } from '../utils/error-factory.js';
import { PipelineAbortController, PipelineAbortError } from './abort-controller.js';

export interface ParallelExecutionResult {
  executions: StageExecution[];
  allSucceeded: boolean;
  anyFailed: boolean;
  duration: number;
}

export class ParallelExecutor {
  constructor(
    private stageExecutor: StageExecutor,
    private onStateChange?: (state: PipelineState) => void,
    private abortController?: PipelineAbortController
  ) {}

  private emitStateChange(state: PipelineState): void {
    if (this.onStateChange) {
      this.onStateChange(state);
    }
  }

  /**
   * Check if abort has been requested
   */
  private isAborted(): boolean {
    return this.abortController?.aborted ?? false;
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
   * Add a stage as 'running' to the pipeline state
   */
  private addRunningStage(
    stageConfig: AgentStageConfig,
    pipelineState: PipelineState
  ): void {
    pipelineState.stages.push({
      stageName: stageConfig.name,
      status: 'running',
      startTime: new Date().toISOString(),
      retryAttempt: 0,
      maxRetries: stageConfig.retry?.maxAttempts || 0
    });
  }

  /**
   * Update an existing stage entry in the pipeline state
   */
  private updateStageInState(
    execution: StageExecution,
    pipelineState: PipelineState
  ): void {
    const index = pipelineState.stages.findIndex(
      s => s.stageName === execution.stageName
    );
    if (index >= 0) {
      pipelineState.stages[index] = execution;
    }
  }

  /**
   * Execute multiple stages in parallel
   * @param stages - Stages to execute concurrently
   * @param pipelineState - Current pipeline state
   * @param onOutputUpdate - Callback for streaming output updates
   * @param groupContext - Group execution context (e.g., isFinalGroup for loop mode)
   * @returns Results of all parallel executions
   */
  async executeParallelGroup(
    stages: AgentStageConfig[],
    pipelineState: PipelineState,
    onOutputUpdate?: (stageName: string, output: string) => void,
    groupContext?: { isFinalGroup: boolean }
  ): Promise<ParallelExecutionResult> {
    const startTime = Date.now();

    // Update loop context with group position (for final-group-only loop injection)
    if (groupContext?.isFinalGroup !== undefined) {
      this.stageExecutor.updateLoopContext({ isFinalGroup: groupContext.isFinalGroup });
    }

    // Add all stages as 'running' to state before execution starts
    for (const stageConfig of stages) {
      this.addRunningStage(stageConfig, pipelineState);
    }
    this.emitStateChange(pipelineState);

    // Create promises for all stages - each promise resolves to StageExecution
    // (never rejects, failures are returned as StageExecution with status='failed')
    const promises = stages.map(async (stageConfig): Promise<StageExecution> => {
      const stageOutputCallback = this.createStageCallback(stageConfig.name, onOutputUpdate);

      try {
        const execution = await this.stageExecutor.executeStage(
          stageConfig,
          pipelineState,
          stageOutputCallback
        );
        // Update the existing stage entry in state
        this.updateStageInState(execution, pipelineState);
        this.emitStateChange(pipelineState);
        return execution;
      } catch (error) {
        // Don't rethrow - return the failed execution directly
        const failedExecution = this.createFailedExecution(stageConfig, error);
        this.updateStageInState(failedExecution, pipelineState);
        this.emitStateChange(pipelineState);
        return failedExecution;
      }
    });

    // Execute all stages in parallel
    const executions = await Promise.all(promises);

    return this.buildExecutionResult(executions, startTime);
  }

  /**
   * Execute stages sequentially (fallback for sequential mode)
   * @param stages - Stages to execute one by one
   * @param pipelineState - Current pipeline state
   * @param onOutputUpdate - Callback for streaming output updates
   * @param groupContext - Group execution context (e.g., isFinalGroup for loop mode)
   * @returns Results of all sequential executions
   */
  async executeSequentialGroup(
    stages: AgentStageConfig[],
    pipelineState: PipelineState,
    onOutputUpdate?: (stageName: string, output: string) => void,
    groupContext?: { isFinalGroup: boolean }
  ): Promise<ParallelExecutionResult> {
    const startTime = Date.now();
    const executions: StageExecution[] = [];

    // Update loop context with group position (for final-group-only loop injection)
    if (groupContext?.isFinalGroup !== undefined) {
      this.stageExecutor.updateLoopContext({ isFinalGroup: groupContext.isFinalGroup });
    }

    for (const stageConfig of stages) {
      // Check if abort was requested before starting next stage
      if (this.isAborted()) {
        // Skip remaining stages - mark them as skipped
        const skipTimestamp = new Date().toISOString();
        const skippedExecution: StageExecution = {
          stageName: stageConfig.name,
          status: 'skipped',
          startTime: skipTimestamp,
          endTime: skipTimestamp,
          duration: 0
        };
        executions.push(skippedExecution);
        pipelineState.stages.push(skippedExecution);
        this.emitStateChange(pipelineState);
        continue; // Skip to next stage (which will also be skipped)
      }

      // Add stage as 'running' before execution starts
      this.addRunningStage(stageConfig, pipelineState);
      this.emitStateChange(pipelineState);

      const stageOutputCallback = this.createStageCallback(stageConfig.name, onOutputUpdate);
      try {
        const execution = await this.stageExecutor.executeStage(
          stageConfig,
          pipelineState,
          stageOutputCallback
        );
        executions.push(execution);
        // Update existing stage entry
        this.updateStageInState(execution, pipelineState);
        this.emitStateChange(pipelineState);
      } catch (error) {
        // Check if this is an abort error
        if (error instanceof PipelineAbortError) {
          const abortedExecution: StageExecution = {
            stageName: stageConfig.name,
            status: 'failed',
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            duration: 0,
            error: { message: 'Stage aborted', timestamp: new Date().toISOString() }
          };
          executions.push(abortedExecution);
          this.updateStageInState(abortedExecution, pipelineState);
          this.emitStateChange(pipelineState);
          break; // Stop processing more stages
        }

        const failedExecution = this.createFailedExecution(stageConfig, error);
        executions.push(failedExecution);
        this.updateStageInState(failedExecution, pipelineState);
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
