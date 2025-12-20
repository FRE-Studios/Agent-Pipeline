// src/core/group-execution-orchestrator.ts

import { ParallelExecutor } from './parallel-executor.js';
import { StateManager } from './state-manager.js';
import { HandoverManager } from './handover-manager.js';
import {
  PipelineConfig,
  PipelineState,
  AgentStageConfig,
  StageExecution
} from '../config/schema.js';
import { ExecutionGroup } from './types/execution-graph.js';
import type { ParallelExecutionResult } from './parallel-executor.js';

export interface GroupProcessingResult {
  state: PipelineState;
  shouldStopPipeline: boolean;
}

export interface GroupContext {
  isFinalGroup: boolean;
}

export class GroupExecutionOrchestrator {
  constructor(
    private stateManager: StateManager,
    private shouldLog: (interactive: boolean) => boolean,
    private stateChangeCallback: (state: PipelineState) => void,
    private notifyStageResultsCallback: (
      executions: StageExecution[],
      state: PipelineState
    ) => Promise<void>
  ) {}

  /**
   * Process a single execution group
   */
  async processGroup(
    group: ExecutionGroup,
    state: PipelineState,
    config: PipelineConfig,
    parallelExecutor: ParallelExecutor,
    interactive: boolean,
    handoverManager?: HandoverManager,
    groupContext?: GroupContext
  ): Promise<GroupProcessingResult> {
    // Filter stages by enabled status
    const { enabledStages } = this.filterDisabledStages(
      group,
      state,
      interactive
    );

    // Evaluate conditions and filter stages
    const stagesToRun = await this.evaluateConditions(
      enabledStages,
      state,
      interactive
    );

    // Skip if no stages to run
    if (stagesToRun.length === 0) {
      return { state, shouldStopPipeline: false };
    }

    // Log group info
    this.logGroupStart(stagesToRun, group, interactive);

    // Execute group (parallel or sequential)
    // Note: ParallelExecutor now manages stage entries directly in state
    // (adds as 'running' at start, updates when complete)
    const executionMode = config.settings?.executionMode || 'parallel';
    const shouldRunParallel = executionMode === 'parallel' && stagesToRun.length > 1;
    const groupResult = await this.executeGroup(
      stagesToRun,
      state,
      executionMode,
      parallelExecutor,
      interactive,
      groupContext
    );

    // Update HANDOVER.md based on execution mode
    if (handoverManager && groupResult.executions.length > 0) {
      const completedStages = groupResult.executions
        .filter(e => e.status === 'success')
        .map(e => e.stageName);

      if (completedStages.length > 0) {
        try {
          if (shouldRunParallel) {
            // Merge all parallel stage outputs into HANDOVER.md
            await handoverManager.mergeParallelOutputs(completedStages);
          } else {
            // Copy the last sequential stage output to HANDOVER.md
            await handoverManager.copyStageToHandover(completedStages[completedStages.length - 1]);
          }
        } catch (error) {
          // Log but don't fail the pipeline for handover issues
          if (this.shouldLog(interactive)) {
            console.warn(`⚠️  Failed to update HANDOVER.md: ${error}`);
          }
        }
      }
    }

    // Notify for each completed/failed stage
    await this.notifyStageResultsCallback(groupResult.executions, state);

    // Save state after group
    await this.stateManager.saveState(state);
    this.stateChangeCallback(state);

    // Log group result
    this.logGroupResult(groupResult, executionMode, stagesToRun, parallelExecutor, interactive);

    // Handle group failures
    const shouldStopPipeline = this.handleGroupFailures(
      groupResult,
      stagesToRun,
      state,
      config,
      interactive
    );

    return { state, shouldStopPipeline };
  }

  /**
   * Filter stages by enabled status
   */
  private filterDisabledStages(
    group: ExecutionGroup,
    state: PipelineState,
    interactive: boolean
  ): { enabledStages: AgentStageConfig[]; disabledStages: AgentStageConfig[] } {
    const enabledStages = group.stages.filter((s) => s.enabled !== false);
    const disabledStages = group.stages.filter((s) => s.enabled === false);

    // Add disabled stages to state
    for (const disabledStage of disabledStages) {
      if (this.shouldLog(interactive)) {
        this.logSkippedStage(disabledStage.name, 'disabled');
      }
      state.stages.push({
        stageName: disabledStage.name,
        status: 'skipped',
        startTime: new Date().toISOString()
      });
      this.stateChangeCallback(state);
    }

    return { enabledStages, disabledStages };
  }

  /**
   * Filter stages (conditionals dropped - just return enabled stages)
   */
  private async evaluateConditions(
    enabledStages: AgentStageConfig[],
    _state: PipelineState,
    _interactive: boolean
  ): Promise<AgentStageConfig[]> {
    // Conditionals have been dropped - return all enabled stages
    return enabledStages;
  }

  /**
   * Execute a group of stages (parallel or sequential)
   */
  private async executeGroup(
    stagesToRun: AgentStageConfig[],
    state: PipelineState,
    executionMode: 'parallel' | 'sequential',
    parallelExecutor: ParallelExecutor,
    _interactive: boolean,
    groupContext?: GroupContext
  ) {
    const shouldRunParallel =
      executionMode === 'parallel' && stagesToRun.length > 1;

    // Helper to update tool activity as a rolling array (max 3 items)
    const updateToolActivity = (stageName: string, activity: string) => {
      const stageIndex = state.stages.findIndex(
        (s) => s.stageName === stageName
      );
      if (stageIndex >= 0) {
        const stage = state.stages[stageIndex];
        if (!stage.toolActivity) {
          stage.toolActivity = [];
        }
        stage.toolActivity.push(activity);
        // Keep only the last 3 items
        if (stage.toolActivity.length > 3) {
          stage.toolActivity = stage.toolActivity.slice(-3);
        }
        this.stateChangeCallback(state);
      }
    };

    if (shouldRunParallel) {
      // Parallel execution
      return await parallelExecutor.executeParallelGroup(
        stagesToRun,
        state,
        updateToolActivity,
        groupContext
      );
    } else {
      // Sequential execution
      return await parallelExecutor.executeSequentialGroup(
        stagesToRun,
        state,
        updateToolActivity,
        groupContext
      );
    }
  }

  /**
   * Handle group failures based on failure strategy
   */
  private handleGroupFailures(
    groupResult: ParallelExecutionResult,
    stagesToRun: AgentStageConfig[],
    state: PipelineState,
    config: PipelineConfig,
    interactive: boolean
  ): boolean {
    if (!groupResult.anyFailed) {
      return false;
    }

    const failedStages = groupResult.executions.filter(
      (e: StageExecution) => e.status === 'failed'
    );

    for (const failedStage of failedStages) {
      const stageConfig = stagesToRun.find(
        (s) => s.name === failedStage.stageName
      );
      const failureStrategy =
        stageConfig?.onFail || config.settings?.failureStrategy || 'stop';

      switch (failureStrategy) {
        case 'stop': {
          if (this.shouldLog(interactive)) {
            console.log(
              `🛑 Pipeline stopped due to stage failure: ${failedStage.stageName}\n`
            );
          }
          return true;
        }
        case 'continue': {
          if (this.shouldLog(interactive)) {
            console.log(
              `⚠️  Stage ${failedStage.stageName} failed but continuing (continue mode)\n`
            );
          }
          if (state.status === 'running') {
            state.status = 'partial';
          }
          break;
        }
        case 'warn': {
          if (this.shouldLog(interactive)) {
            console.log(
              `⚠️  Stage ${failedStage.stageName} failed (warn mode) - continuing pipeline\n`
            );
          }
          if (state.status === 'running') {
            state.status = 'partial';
          }
          break;
        }
        default: {
          if (this.shouldLog(interactive)) {
            console.log(
              `🛑 Pipeline stopped due to stage failure: ${failedStage.stageName} (unrecognized failure strategy "${failureStrategy}")\n`
            );
          }
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Log skipped stage
   */
  private logSkippedStage(
    stageName: string,
    reason: 'disabled' | 'condition',
    conditionText?: string
  ): void {
    if (reason === 'disabled') {
      console.log(`⏭️  Skipping disabled stage: ${stageName}\n`);
    } else {
      console.log(
        `⏭️  Skipping stage "${stageName}" (condition not met): ${conditionText}\n`
      );
    }
  }

  /**
   * Log group start
   */
  private logGroupStart(
    stagesToRun: AgentStageConfig[],
    group: ExecutionGroup,
    interactive: boolean
  ): void {
    if (this.shouldLog(interactive) && stagesToRun.length > 1) {
      console.log(
        `🔀 Running ${stagesToRun.length} stages in parallel (group ${group.level})...`
      );
    }
  }

  /**
   * Log group result
   */
  private logGroupResult(
    groupResult: any,
    executionMode: 'parallel' | 'sequential',
    stagesToRun: AgentStageConfig[],
    parallelExecutor: ParallelExecutor,
    interactive: boolean
  ): void {
    const shouldRunParallel =
      executionMode === 'parallel' && stagesToRun.length > 1;

    if (this.shouldLog(interactive) && shouldRunParallel) {
      console.log(`📊 ${parallelExecutor.aggregateResults(groupResult)}\n`);
    }
  }
}
