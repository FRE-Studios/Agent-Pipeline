// src/core/pipeline-runner.ts

import { v4 as uuidv4 } from 'uuid';
import { GitManager } from './git-manager.js';
import { BranchManager } from './branch-manager.js';
import { PRCreator } from './pr-creator.js';
import { StageExecutor } from './stage-executor.js';
import { StateManager } from './state-manager.js';
import { DAGPlanner } from './dag-planner.js';
import { ParallelExecutor } from './parallel-executor.js';
import { ConditionEvaluator } from './condition-evaluator.js';
import { OutputStorageManager } from './output-storage-manager.js';
import { ContextReducer } from './context-reducer.js';
import { TokenEstimator } from '../utils/token-estimator.js';
import { PipelineConfig, PipelineState, AgentStageConfig } from '../config/schema.js';
import { NotificationManager } from '../notifications/notification-manager.js';
import { NotificationContext } from '../notifications/types.js';
import { PipelineFormatter } from '../utils/pipeline-formatter.js';
import { ExecutionGraph } from './types/execution-graph.js';

export class PipelineRunner {
  private gitManager: GitManager;
  private branchManager: BranchManager;
  private prCreator: PRCreator;
  private stateManager: StateManager;
  private dagPlanner: DAGPlanner;
  private conditionEvaluator: ConditionEvaluator;
  private notificationManager?: NotificationManager;
  private dryRun: boolean;
  private repoPath: string;
  private stateUpdateCallbacks: Array<(state: PipelineState) => void> = [];
  private originalBranch: string = '';

  constructor(repoPath: string, dryRun: boolean = false) {
    this.repoPath = repoPath;
    this.gitManager = new GitManager(repoPath);
    this.branchManager = new BranchManager(repoPath);
    this.prCreator = new PRCreator();
    this.stateManager = new StateManager(repoPath);
    this.dagPlanner = new DAGPlanner();
    this.conditionEvaluator = new ConditionEvaluator();
    this.dryRun = dryRun;
  }

  private shouldLog(interactive: boolean): boolean {
    return !interactive;
  }

  private logSkippedStage(
    stageName: string,
    reason: 'disabled' | 'condition',
    conditionText?: string
  ): void {
    if (reason === 'disabled') {
      console.log(`⏭️  Skipping disabled stage: ${stageName}\n`);
    } else {
      console.log(`⏭️  Skipping stage "${stageName}" (condition not met): ${conditionText}\n`);
    }
  }

  private async notifyStageResults(
    executions: import('../config/schema.js').StageExecution[],
    state: PipelineState
  ): Promise<void> {
    for (const execution of executions) {
      if (execution.status === 'success') {
        await this.notify({
          event: 'stage.completed',
          pipelineState: state,
          stage: execution
        });
      } else if (execution.status === 'failed') {
        await this.notify({
          event: 'stage.failed',
          pipelineState: state,
          stage: execution
        });
      }
    }
  }

  async runPipeline(
    config: PipelineConfig,
    options: { interactive?: boolean } = {}
  ): Promise<PipelineState> {
    // Initialize notification manager if configured
    if (config.notifications) {
      this.notificationManager = new NotificationManager(config.notifications);
    }

    // Save original branch to return to later
    this.originalBranch = await this.branchManager.getCurrentBranch();

    // Setup pipeline branch if git config exists
    let pipelineBranch: string | undefined;
    if (config.git && !this.dryRun) {
      pipelineBranch = await this.branchManager.setupPipelineBranch(
        config.name,
        uuidv4(), // We'll use this runId for branch naming
        config.git.baseBranch || 'main',
        config.git.branchStrategy || 'reusable',
        config.git.branchPrefix || 'pipeline'
      );

      if (this.shouldLog(options.interactive || false)) {
        console.log(`📍 Running on branch: ${pipelineBranch}\n`);
      }
    }

    const triggerCommit = await this.gitManager.getCurrentCommit();
    const changedFiles = await this.gitManager.getChangedFiles(triggerCommit);

    let state: PipelineState = {
      runId: uuidv4(),
      pipelineConfig: config,
      trigger: {
        type: config.trigger,
        commitSha: triggerCommit,
        timestamp: new Date().toISOString()
      },
      stages: [],
      status: 'running',
      artifacts: {
        initialCommit: triggerCommit,
        changedFiles,
        totalDuration: 0
      }
    };

    // Create StageExecutor and ParallelExecutor for this run
    const stageExecutor = new StageExecutor(this.gitManager, this.dryRun, state.runId, this.repoPath);
    const parallelExecutor = new ParallelExecutor(
      stageExecutor,
      (state) => this.notifyStateChange(state)
    );

    if (this.dryRun) {
      console.log(`\n🧪 DRY RUN MODE - No commits will be created\n`);
    }

    // Show simple console output if not interactive
    if (this.shouldLog(options.interactive || false)) {
      console.log(`\n🚀 Starting pipeline: ${config.name}`);
      console.log(`📦 Run ID: ${state.runId}`);
      console.log(`📝 Trigger commit: ${triggerCommit.substring(0, 7)}\n`);
    }

    // Notify initial state
    this.notifyStateChange(state);

    // Notify pipeline started
    await this.notify({
      event: 'pipeline.started',
      pipelineState: state
    });

    const startTime = Date.now();

    try {
      // Build execution plan using DAG planner
      const executionGraph = this.dagPlanner.buildExecutionPlan(config);
      const executionMode = config.settings?.executionMode || 'parallel';

      if (this.shouldLog(options.interactive || false) && executionGraph.plan.groups.length > 0) {
        console.log(`📊 Execution plan: ${executionGraph.plan.groups.length} groups, max parallelism: ${executionGraph.plan.maxParallelism}`);
        if (executionGraph.validation.warnings.length > 0) {
          console.log(`⚠️  Warnings:\n${executionGraph.validation.warnings.map(w => `   - ${w}`).join('\n')}`);
        }
        console.log('');
      }

      // Execute each group in order
      for (const group of executionGraph.plan.groups) {
        // Filter out disabled stages
        let enabledStages = group.stages.filter(s => s.enabled !== false);
        const disabledStages = group.stages.filter(s => s.enabled === false);

        // Add disabled stages to state
        for (const disabledStage of disabledStages) {
          if (this.shouldLog(options.interactive || false)) {
            this.logSkippedStage(disabledStage.name, 'disabled');
          }
          state.stages.push({
            stageName: disabledStage.name,
            status: 'skipped',
            startTime: new Date().toISOString()
          });
          this.notifyStateChange(state);
        }

        // Evaluate conditions and filter stages
        const stagesToRun: AgentStageConfig[] = [];
        const skippedByCondition: AgentStageConfig[] = [];

        for (const stage of enabledStages) {
          if (stage.condition) {
            const conditionMet = this.conditionEvaluator.evaluate(stage.condition, state);

            if (!conditionMet) {
              if (this.shouldLog(options.interactive || false)) {
                this.logSkippedStage(stage.name, 'condition', stage.condition);
              }
              state.stages.push({
                stageName: stage.name,
                status: 'skipped',
                startTime: new Date().toISOString(),
                conditionEvaluated: true,
                conditionResult: false
              });
              this.notifyStateChange(state);
              skippedByCondition.push(stage);
              continue;
            } else {
              if (this.shouldLog(options.interactive || false)) {
                console.log(`✅ Condition met for stage "${stage.name}": ${stage.condition}`);
              }
            }
          }
          stagesToRun.push(stage);
        }

        // Update enabled stages to only those that should run
        enabledStages = stagesToRun;

        if (enabledStages.length === 0) continue;

        // Log group info
        if (this.shouldLog(options.interactive || false) && enabledStages.length > 1) {
          console.log(`🔀 Running ${enabledStages.length} stages in parallel (group ${group.level})...`);
        }

        // Execute group (parallel or sequential based on mode)
        const shouldRunParallel = executionMode === 'parallel' && enabledStages.length > 1;

        let groupResult;
        if (shouldRunParallel) {
          // Parallel execution
          groupResult = await parallelExecutor.executeParallelGroup(
            enabledStages,
            state,
            (stageName, output) => {
              // Find and update stage in state
              const stageIndex = state.stages.findIndex(s => s.stageName === stageName);
              if (stageIndex >= 0) {
                state.stages[stageIndex].agentOutput = output;
                this.notifyStateChange(state);
              }
            }
          );

          // Add all executions to state
          state.stages.push(...groupResult.executions);

          // Notify for each completed/failed stage
          await this.notifyStageResults(groupResult.executions, state);

        } else {
          // Sequential execution (fallback or explicit mode)
          groupResult = await parallelExecutor.executeSequentialGroup(
            enabledStages,
            state,
            (stageName, output) => {
              const currentStage = state.stages[state.stages.length - 1];
              if (currentStage && currentStage.stageName === stageName) {
                currentStage.agentOutput = output;
                this.notifyStateChange(state);
              }
            }
          );

          // Add all executions to state
          state.stages.push(...groupResult.executions);

          // Notify for each completed/failed stage
          await this.notifyStageResults(groupResult.executions, state);
        }

        // Save state after each group
        await this.stateManager.saveState(state);
        this.notifyStateChange(state);

        // Check if context reduction needed (agent-based strategy)
        if (config.settings?.contextReduction?.enabled &&
            config.settings.contextReduction.strategy === 'agent-based' &&
            config.settings.contextReduction.agentPath) {

          // Get next stage to execute (peek ahead)
          const nextStage = this.getNextStageToExecute(
            executionGraph,
            executionGraph.plan.groups.indexOf(group)
          );

          if (nextStage) {
            // Estimate context size for next stage
            const contextEstimate = await this.estimateNextContext(state, nextStage);

            // Create ContextReducer instance
            const contextReducer = new ContextReducer(
              this.gitManager,
              this.repoPath,
              state.runId
            );

            // Check if reduction needed
            if (contextReducer.shouldReduce(contextEstimate, config.settings.contextReduction)) {
              if (this.shouldLog(options.interactive || false)) {
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
                  config.settings.contextReduction.agentPath
                );

                // Apply reduction to state (if successful)
                if (reducerOutput.status === 'success') {
                  state = contextReducer.applyReduction(state, reducerOutput);

                  // Save reduced state
                  await this.stateManager.saveState(state);
                  this.notifyStateChange(state);

                  if (this.shouldLog(options.interactive || false)) {
                    console.log(`✅ Context reduced successfully\n`);
                  }
                } else {
                  if (this.shouldLog(options.interactive || false)) {
                    console.log(`⚠️  Context reduction failed. Continuing with full context.\n`);
                  }
                }
              } catch (error) {
                // Never let context reduction crash the pipeline
                if (this.shouldLog(options.interactive || false)) {
                  console.warn(`⚠️  Context reduction error: ${error}. Continuing with full context.\n`);
                }
              }
            }
          }
        }

        // Log group result
        if (this.shouldLog(options.interactive || false) && shouldRunParallel) {
          console.log(`📊 ${parallelExecutor.aggregateResults(groupResult)}\n`);
        }

        // Handle group failures
        if (groupResult.anyFailed) {
          const failedStages = groupResult.executions.filter(e => e.status === 'failed');

          for (const failedStage of failedStages) {
            const stageConfig = enabledStages.find(s => s.name === failedStage.stageName);
            const failureStrategy = stageConfig?.onFail || config.settings?.failureStrategy || 'stop';

            if (failureStrategy === 'stop') {
              if (this.shouldLog(options.interactive || false)) {
                console.log(`🛑 Pipeline stopped due to stage failure: ${failedStage.stageName}\n`);
              }
              state.status = 'failed';
              break;
            } else if (failureStrategy === 'continue') {
              if (this.shouldLog(options.interactive || false)) {
                console.log(`⚠️  Stage ${failedStage.stageName} failed but continuing (continue mode)\n`);
              }
            }
          }

          // Stop pipeline if any stage had 'stop' strategy
          if (state.status === 'failed') break;
        }
      }

      if (state.status === 'running') {
        state.status = 'completed';
      }

    } catch (error) {
      state.status = 'failed';
      if (this.shouldLog(options.interactive || false)) {
        console.error(`\n❌ Pipeline failed: ${error}\n`);
      }
    }

    const endTime = Date.now();
    state.artifacts.totalDuration = (endTime - startTime) / 1000;
    state.artifacts.finalCommit = await this.gitManager.getCurrentCommit();

    // Save pipeline summary and changed files (if context reduction enabled)
    if (config.settings?.contextReduction?.saveVerboseOutputs !== false) {
      const outputStorageManager = new OutputStorageManager(this.repoPath, state.runId);
      await outputStorageManager.savePipelineSummary(state.stages);
      await outputStorageManager.saveChangedFiles(state.artifacts.changedFiles);
    }

    // Push and create PR if configured
    if (pipelineBranch && config.git?.pullRequest?.autoCreate) {
      await this.handlePRCreation(config, pipelineBranch, state, options.interactive || false);
    }

    await this.stateManager.saveState(state);
    this.notifyStateChange(state);

    // Notify pipeline completion/failure
    const event = state.status === 'completed' ? 'pipeline.completed' : 'pipeline.failed';
    await this.notify({
      event,
      pipelineState: state,
      prUrl: state.artifacts.pullRequest?.url
    });

    // Only print summary if not in interactive mode
    if (this.shouldLog(options.interactive || false)) {
      this.printSummary(state);
    }

    // Return to original branch
    if (pipelineBranch && this.originalBranch && !this.dryRun) {
      if (this.shouldLog(options.interactive || false)) {
        console.log(`\n↩️  Returning to branch: ${this.originalBranch}`);
      }
      await this.branchManager.checkoutBranch(this.originalBranch);
    }

    return state;
  }

  private printSummary(state: PipelineState): void {
    console.log(PipelineFormatter.formatSummary(state));
  }

  private async handlePRCreation(
    config: PipelineConfig,
    branchName: string,
    state: PipelineState,
    interactive: boolean
  ): Promise<void> {
    try {
      // Push branch to remote
      await this.branchManager.pushBranch(branchName);

      // Check if PR already exists
      const exists = await this.prCreator.prExists(branchName);
      if (exists) {
        if (this.shouldLog(interactive)) {
          console.log(`\n✅ Pull request already exists for ${branchName}`);
          console.log(`   View it with: gh pr view ${branchName}`);
        }
        return;
      }

      // Create PR
      const prConfig = config.git!.pullRequest!;
      const result = await this.prCreator.createPR(
        branchName,
        config.git?.baseBranch || 'main',
        prConfig,
        state
      );

      if (this.shouldLog(interactive)) {
        console.log(`\n✅ Pull Request created: ${result.url}`);
      }

      // Save PR info to state
      state.artifacts.pullRequest = {
        url: result.url,
        number: result.number,
        branch: branchName
      };

      await this.stateManager.saveState(state);

      // Notify PR created
      await this.notify({
        event: 'pr.created',
        pipelineState: state,
        prUrl: result.url
      });

    } catch (error) {
      if (this.shouldLog(interactive)) {
        console.error(`\n❌ Failed to create PR: ${error instanceof Error ? error.message : String(error)}`);
        console.log(`   Branch ${branchName} has been pushed to remote.`);
        console.log(`   You can create the PR manually with: gh pr create`);
      }
    }
  }

  private notifyStateChange(state: PipelineState): void {
    for (const callback of this.stateUpdateCallbacks) {
      callback(state);
    }
  }

  private async notify(context: NotificationContext): Promise<void> {
    if (!this.notificationManager) {
      return;
    }

    try {
      const results = await this.notificationManager.notify(context);

      // Log failed notifications (but don't fail the pipeline)
      const failures = results.filter(r => !r.success);
      if (failures.length > 0) {
        console.warn('⚠️  Some notifications failed:');
        failures.forEach(f => console.warn(`   ${f.channel}: ${f.error}`));
      }
    } catch (error) {
      // Never let notifications crash the pipeline
      console.warn('⚠️  Notification error:', error);
    }
  }

  onStateChange(callback: (state: PipelineState) => void): void {
    this.stateUpdateCallbacks.push(callback);
  }

  /**
   * Get next stage to execute (peek ahead)
   */
  private getNextStageToExecute(
    executionGraph: ExecutionGraph,
    currentGroupIndex: number
  ): AgentStageConfig | null {
    // Look at next group
    const nextGroupIndex = currentGroupIndex + 1;
    if (nextGroupIndex >= executionGraph.plan.groups.length) {
      return null; // No more stages
    }

    const nextGroup = executionGraph.plan.groups[nextGroupIndex];

    // Return first enabled stage from next group
    const enabledStage = nextGroup.stages.find(s => s.enabled !== false);
    return enabledStage || null;
  }

  /**
   * Estimate context token count for next stage
   */
  private async estimateNextContext(
    state: PipelineState,
    nextStage: AgentStageConfig
  ): Promise<number> {
    // Build a mock StageExecutor to use its buildAgentContext method
    const stageExecutor = new StageExecutor(
      this.gitManager,
      this.dryRun,
      state.runId,
      this.repoPath
    );

    try {
      // Build context as it would be for the next stage
      const context = await (stageExecutor as any).buildAgentContext(nextStage, state);

      // Estimate token count
      const tokenEstimator = new TokenEstimator();
      const estimate = tokenEstimator.estimateTokens(context);
      tokenEstimator.dispose();

      return estimate;
    } catch (error) {
      // If estimation fails, return safe default (below threshold)
      return 0;
    }
  }
}
