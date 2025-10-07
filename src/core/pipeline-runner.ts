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
import { PipelineConfig, PipelineState, AgentStageConfig } from '../config/schema.js';
import { NotificationManager } from '../notifications/notification-manager.js';
import { NotificationContext } from '../notifications/types.js';

export class PipelineRunner {
  private gitManager: GitManager;
  private branchManager: BranchManager;
  private prCreator: PRCreator;
  private stageExecutor: StageExecutor;
  private stateManager: StateManager;
  private dagPlanner: DAGPlanner;
  private parallelExecutor: ParallelExecutor;
  private conditionEvaluator: ConditionEvaluator;
  private notificationManager?: NotificationManager;
  private dryRun: boolean;
  private stateUpdateCallbacks: Array<(state: PipelineState) => void> = [];
  private originalBranch: string = '';

  constructor(repoPath: string, dryRun: boolean = false) {
    this.gitManager = new GitManager(repoPath);
    this.branchManager = new BranchManager(repoPath);
    this.prCreator = new PRCreator();
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
    // Initialize notification manager
    this.notificationManager = new NotificationManager(config.notifications);

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

      if (!options.interactive) {
        console.log(`📍 Running on branch: ${pipelineBranch}\n`);
      }
    }

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

          // Notify for each completed/failed stage
          for (const execution of groupResult.executions) {
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
    if (!options.interactive) {
      this.printSummary(state);
    }

    // Return to original branch
    if (pipelineBranch && this.originalBranch && !this.dryRun) {
      if (!options.interactive) {
        console.log(`\n↩️  Returning to branch: ${this.originalBranch}`);
      }
      await this.branchManager.checkoutBranch(this.originalBranch);
    }

    return state;
  }

  private printSummary(state: PipelineState): void {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Pipeline Summary: ${state.pipelineConfig.name}`);
    console.log(`${'='.repeat(60)}\n`);

    console.log(`Status: ${this.getStatusEmoji(state.status)} ${state.status.toUpperCase()}`);
    console.log(`Duration: ${state.artifacts.totalDuration.toFixed(2)}s`);
    console.log(`Commits: ${state.trigger.commitSha.substring(0, 7)} → ${state.artifacts.finalCommit?.substring(0, 7)}`);

    if (state.artifacts.pullRequest) {
      console.log(`Pull Request: ${state.artifacts.pullRequest.url}`);
    }

    console.log('');

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
        if (!interactive) {
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

      if (!interactive) {
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
      if (!interactive) {
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
}
