// src/core/group-execution-orchestrator.ts

import { GitManager } from './git-manager.js';
import { StageExecutor } from './stage-executor.js';
import { ParallelExecutor } from './parallel-executor.js';
import { StateManager } from './state-manager.js';
import { ConditionEvaluator } from './condition-evaluator.js';
import { ContextReducer } from './context-reducer.js';
import { AgentRuntime } from './types/agent-runtime.js';
import { TokenEstimator } from '../utils/token-estimator.js';
import { PipelineFormatter } from '../utils/pipeline-formatter.js';
import {
  PipelineConfig,
  PipelineState,
  AgentStageConfig,
  StageExecution
} from '../config/schema.js';
import { ExecutionGraph, ExecutionGroup } from './types/execution-graph.js';
import type { ParallelExecutionResult } from './parallel-executor.js';

export interface GroupProcessingResult {
  state: PipelineState;
  shouldStopPipeline: boolean;
}

export class GroupExecutionOrchestrator {
  private conditionEvaluator: ConditionEvaluator;

  constructor(
    private gitManager: GitManager,
    private stateManager: StateManager,
    private repoPath: string,
    private dryRun: boolean,
    private runtime: AgentRuntime,
    private shouldLog: (interactive: boolean) => boolean,
    private stateChangeCallback: (state: PipelineState) => void,
    private notifyStageResultsCallback: (
      executions: StageExecution[],
      state: PipelineState
    ) => Promise<void>
  ) {
    this.conditionEvaluator = new ConditionEvaluator();
  }

  /**
   * Process a single execution group
   */
  async processGroup(
    group: ExecutionGroup,
    state: PipelineState,
    config: PipelineConfig,
    executionGraph: ExecutionGraph,
    parallelExecutor: ParallelExecutor,
    interactive: boolean
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
    const executionMode = config.settings?.executionMode || 'parallel';
    const groupResult = await this.executeGroup(
      stagesToRun,
      state,
      executionMode,
      parallelExecutor,
      interactive
    );

    // Add executions to state
    state.stages.push(...groupResult.executions);

    // Notify for each completed/failed stage
    await this.notifyStageResultsCallback(groupResult.executions, state);

    // Save state after group
    await this.stateManager.saveState(state);
    this.stateChangeCallback(state);

    // Check if context reduction needed
    await this.handleContextReduction(
      state,
      config,
      executionGraph,
      executionGraph.plan.groups.indexOf(group),
      interactive
    );

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
   * Evaluate conditions for stages
   */
  private async evaluateConditions(
    enabledStages: AgentStageConfig[],
    state: PipelineState,
    interactive: boolean
  ): Promise<AgentStageConfig[]> {
    const stagesToRun: AgentStageConfig[] = [];

    for (const stage of enabledStages) {
      if (stage.condition) {
        const conditionMet = this.conditionEvaluator.evaluate(
          stage.condition,
          state
        );

        if (!conditionMet) {
          if (this.shouldLog(interactive)) {
            this.logSkippedStage(stage.name, 'condition', stage.condition);
          }
          state.stages.push({
            stageName: stage.name,
            status: 'skipped',
            startTime: new Date().toISOString(),
            conditionEvaluated: true,
            conditionResult: false
          });
          this.stateChangeCallback(state);
          continue;
        } else {
          if (this.shouldLog(interactive)) {
            console.log(
              `✅ Condition met for stage "${stage.name}": ${stage.condition}`
            );
          }
        }
      }
      stagesToRun.push(stage);
    }

    return stagesToRun;
  }

  /**
   * Execute a group of stages (parallel or sequential)
   */
  private async executeGroup(
    stagesToRun: AgentStageConfig[],
    state: PipelineState,
    executionMode: 'parallel' | 'sequential',
    parallelExecutor: ParallelExecutor,
    _interactive: boolean
  ) {
    const shouldRunParallel =
      executionMode === 'parallel' && stagesToRun.length > 1;

    if (shouldRunParallel) {
      // Parallel execution
      return await parallelExecutor.executeParallelGroup(
        stagesToRun,
        state,
        (stageName, output) => {
          const stageIndex = state.stages.findIndex(
            (s) => s.stageName === stageName
          );
          if (stageIndex >= 0) {
            state.stages[stageIndex].agentOutput = output;
            this.stateChangeCallback(state);
          }
        }
      );
    } else {
      // Sequential execution
      return await parallelExecutor.executeSequentialGroup(
        stagesToRun,
        state,
        (stageName, output) => {
          const currentStage = state.stages[state.stages.length - 1];
          if (currentStage && currentStage.stageName === stageName) {
            currentStage.agentOutput = output;
            this.stateChangeCallback(state);
          }
        }
      );
    }
  }

  /**
   * Handle context reduction if needed (agent-based strategy)
   */
  private async handleContextReduction(
    state: PipelineState,
    config: PipelineConfig,
    executionGraph: ExecutionGraph,
    currentGroupIndex: number,
    interactive: boolean
  ): Promise<void> {
    const contextReductionConfig = config.settings?.contextReduction;

    if (
      !contextReductionConfig?.enabled ||
      contextReductionConfig.strategy !== 'agent-based' ||
      !contextReductionConfig.agentPath
    ) {
      return;
    }

    // Get next stage to execute (peek ahead)
    const nextStage = this.getNextStageToExecute(
      executionGraph,
      currentGroupIndex
    );

    if (!nextStage) {
      return;
    }

    // Estimate context size for next stage
    const contextEstimate = await this.estimateNextContext(state, nextStage);

    // Create ContextReducer instance
    const contextReducer = new ContextReducer(
      this.gitManager,
      this.repoPath,
      state.runId,
      this.runtime
    );

    // Check if reduction needed
    if (
      contextReducer.shouldReduce(contextEstimate, contextReductionConfig)
    ) {
      if (this.shouldLog(interactive)) {
        console.log(
          `⚠️  Context approaching limit (${PipelineFormatter.formatTokenCount(contextEstimate)} tokens). ` +
            `Running context reducer...\n`
        );
      }

      try {
        // Run reduction
        const reducerOutput = await contextReducer.runReduction(
          state,
          nextStage,
          contextReductionConfig.agentPath
        );

        // Apply reduction to state (if successful)
        if (reducerOutput.status === 'success') {
          // Modify state by reference
          const reducedState = contextReducer.applyReduction(
            state,
            reducerOutput
          );
          state.stages = reducedState.stages;

          // Save reduced state
          await this.stateManager.saveState(state);
          this.stateChangeCallback(state);

          if (this.shouldLog(interactive)) {
            console.log(`✅ Context reduced successfully\n`);
          }
        } else {
          if (this.shouldLog(interactive)) {
            console.log(
              `⚠️  Context reduction failed. Continuing with full context.\n`
            );
          }
        }
      } catch (error) {
        // Never let context reduction crash the pipeline
        if (this.shouldLog(interactive)) {
          console.warn(
            `⚠️  Context reduction error: ${error}. Continuing with full context.\n`
          );
        }
      }
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
   * Get next stage to execute (peek ahead)
   */
  private getNextStageToExecute(
    executionGraph: ExecutionGraph,
    currentGroupIndex: number
  ): AgentStageConfig | null {
    const nextGroupIndex = currentGroupIndex + 1;
    if (nextGroupIndex >= executionGraph.plan.groups.length) {
      return null;
    }

    const nextGroup = executionGraph.plan.groups[nextGroupIndex];
    const enabledStage = nextGroup.stages.find((s) => s.enabled !== false);
    return enabledStage || null;
  }

  /**
   * Estimate context token count for next stage
   */
  private async estimateNextContext(
    state: PipelineState,
    nextStage: AgentStageConfig
  ): Promise<number> {
    const stageExecutor = new StageExecutor(
      this.gitManager,
      this.dryRun,
      state.runId,
      this.repoPath,
      this.runtime  // Optional: used for context estimation
    );

    try {
      const context = await (stageExecutor as any).buildAgentContext(
        nextStage,
        state
      );
      const tokenEstimator = new TokenEstimator();
      const estimate = tokenEstimator.estimateTokens(context);
      tokenEstimator.dispose();
      return estimate;
    } catch (error) {
      return 0;
    }
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
