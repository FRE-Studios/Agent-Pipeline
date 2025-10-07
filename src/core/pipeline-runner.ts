// src/core/pipeline-runner.ts

import { v4 as uuidv4 } from 'uuid';
import { GitManager } from './git-manager.js';
import { StageExecutor } from './stage-executor.js';
import { StateManager } from './state-manager.js';
import { DAGPlanner } from './dag-planner.js';
import { ParallelExecutor } from './parallel-executor.js';
import { ConditionEvaluator } from './condition-evaluator.js';
import { PipelineConfig, PipelineState, AgentStageConfig } from '../config/schema.js';

export class PipelineRunner {
  private gitManager: GitManager;
  private stageExecutor: StageExecutor;
  private stateManager: StateManager;
  private dagPlanner: DAGPlanner;
  private parallelExecutor: ParallelExecutor;
  private conditionEvaluator: ConditionEvaluator;
  private dryRun: boolean;
  private stateUpdateCallbacks: Array<(state: PipelineState) => void> = [];

  constructor(repoPath: string, dryRun: boolean = false) {
    this.gitManager = new GitManager(repoPath);
    this.stageExecutor = new StageExecutor(this.gitManager, dryRun);
    this.stateManager = new StateManager(repoPath);
    this.dagPlanner = new DAGPlanner();
    this.conditionEvaluator = new ConditionEvaluator();
    this.parallelExecutor = new ParallelExecutor(
      this.stageExecutor,
      (state) => this.notifyStateChange(state)
    );
    this.dryRun = dryRun;
  }

  async runPipeline(
    config: PipelineConfig,
    options: { interactive?: boolean } = {}
  ): Promise<PipelineState> {
    const triggerCommit = await this.gitManager.getCurrentCommit();
    const changedFiles = await this.gitManager.getChangedFiles(triggerCommit);

    const state: PipelineState = {
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

    if (this.dryRun) {
      console.log(`\n🧪 DRY RUN MODE - No commits will be created\n`);
    }

    // Show simple console output if not interactive
    if (!options.interactive) {
      console.log(`\n🚀 Starting pipeline: ${config.name}`);
      console.log(`📦 Run ID: ${state.runId}`);
      console.log(`📝 Trigger commit: ${triggerCommit.substring(0, 7)}\n`);
    }

    // Notify initial state
    this.notifyStateChange(state);

    const startTime = Date.now();

    try {
      // Build execution plan using DAG planner
      const executionGraph = this.dagPlanner.buildExecutionPlan(config);
      const executionMode = config.settings?.executionMode || 'parallel';

      if (!options.interactive && executionGraph.plan.groups.length > 0) {
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
          if (!options.interactive) {
            console.log(`⏭️  Skipping disabled stage: ${disabledStage.name}\n`);
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
              if (!options.interactive) {
                console.log(`⏭️  Skipping stage "${stage.name}" (condition not met): ${stage.condition}\n`);
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
              if (!options.interactive) {
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
        if (!options.interactive && enabledStages.length > 1) {
          console.log(`🔀 Running ${enabledStages.length} stages in parallel (group ${group.level})...`);
        }

        // Execute group (parallel or sequential based on mode)
        const shouldRunParallel = executionMode === 'parallel' && enabledStages.length > 1;

        let groupResult;
        if (shouldRunParallel) {
          // Parallel execution
          groupResult = await this.parallelExecutor.executeParallelGroup(
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

        } else {
          // Sequential execution (fallback or explicit mode)
          groupResult = await this.parallelExecutor.executeSequentialGroup(
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
        }

        // Save state after each group
        await this.stateManager.saveState(state);
        this.notifyStateChange(state);

        // Log group result
        if (!options.interactive && shouldRunParallel) {
          console.log(`📊 ${this.parallelExecutor.aggregateResults(groupResult)}\n`);
        }

        // Handle group failures
        if (groupResult.anyFailed) {
          const failedStages = groupResult.executions.filter(e => e.status === 'failed');

          for (const failedStage of failedStages) {
            const stageConfig = enabledStages.find(s => s.name === failedStage.stageName);
            const failureStrategy = stageConfig?.onFail || config.settings?.failureStrategy || 'stop';

            if (failureStrategy === 'stop') {
              if (!options.interactive) {
                console.log(`🛑 Pipeline stopped due to stage failure: ${failedStage.stageName}\n`);
              }
              state.status = 'failed';
              break;
            } else if (failureStrategy === 'warn') {
              if (!options.interactive) {
                console.log(`⚠️  Stage ${failedStage.stageName} failed but continuing (warn mode)\n`);
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
      if (!options.interactive) {
        console.error(`\n❌ Pipeline failed: ${error}\n`);
      }
    }

    const endTime = Date.now();
    state.artifacts.totalDuration = (endTime - startTime) / 1000;
    state.artifacts.finalCommit = await this.gitManager.getCurrentCommit();

    await this.stateManager.saveState(state);
    this.notifyStateChange(state);

    // Only print summary if not in interactive mode
    if (!options.interactive) {
      this.printSummary(state);
    }

    return state;
  }

  private printSummary(state: PipelineState): void {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Pipeline Summary: ${state.pipelineConfig.name}`);
    console.log(`${'='.repeat(60)}\n`);

    console.log(`Status: ${this.getStatusEmoji(state.status)} ${state.status.toUpperCase()}`);
    console.log(`Duration: ${state.artifacts.totalDuration.toFixed(2)}s`);
    console.log(`Commits: ${state.trigger.commitSha.substring(0, 7)} → ${state.artifacts.finalCommit?.substring(0, 7)}\n`);

    console.log('Stages:');
    for (const stage of state.stages) {
      const emoji = this.getStatusEmoji(stage.status);
      const duration = stage.duration ? `(${stage.duration.toFixed(1)}s)` : '';
      console.log(`  ${emoji} ${stage.stageName} ${duration}`);
      if (stage.commitSha) {
        console.log(`     └─ Commit: ${stage.commitSha.substring(0, 7)}`);
      }
      if (stage.error) {
        console.log(`     └─ Error: ${stage.error.message}`);
      }
    }

    console.log(`\n${'='.repeat(60)}\n`);
  }

  private getStatusEmoji(status: string): string {
    const emojiMap: Record<string, string> = {
      'running': '⏳',
      'success': '✅',
      'completed': '✅',
      'failed': '❌',
      'skipped': '⏭️',
      'pending': '⏸️',
      'partial': '⚠️'
    };
    return emojiMap[status] || '❓';
  }

  private notifyStateChange(state: PipelineState): void {
    for (const callback of this.stateUpdateCallbacks) {
      callback(state);
    }
  }

  onStateChange(callback: (state: PipelineState) => void): void {
    this.stateUpdateCallbacks.push(callback);
  }
}
