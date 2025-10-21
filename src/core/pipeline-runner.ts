// src/core/pipeline-runner.ts

import { GitManager } from './git-manager.js';
import { BranchManager } from './branch-manager.js';
import { PRCreator } from './pr-creator.js';
import { StateManager } from './state-manager.js';
import { DAGPlanner } from './dag-planner.js';
import { PipelineInitializer } from './pipeline-initializer.js';
import { GroupExecutionOrchestrator } from './group-execution-orchestrator.js';
import { PipelineFinalizer } from './pipeline-finalizer.js';
import { PipelineConfig, PipelineState } from '../config/schema.js';
import { NotificationManager } from '../notifications/notification-manager.js';
import { NotificationContext } from '../notifications/types.js';

export class PipelineRunner {
  private gitManager: GitManager;
  private branchManager: BranchManager;
  private prCreator: PRCreator;
  private stateManager: StateManager;
  private dagPlanner: DAGPlanner;
  private initializer: PipelineInitializer;
  private groupOrchestrator: GroupExecutionOrchestrator;
  private finalizer: PipelineFinalizer;
  private notificationManager?: NotificationManager;
  private dryRun: boolean;
  private repoPath: string;
  private stateUpdateCallbacks: Array<(state: PipelineState) => void> = [];

  constructor(repoPath: string, dryRun: boolean = false) {
    this.repoPath = repoPath;
    this.dryRun = dryRun;
    this.gitManager = new GitManager(repoPath);
    this.branchManager = new BranchManager(repoPath);
    this.prCreator = new PRCreator();
    this.stateManager = new StateManager(repoPath);
    this.dagPlanner = new DAGPlanner();

    // Initialize orchestration components
    this.initializer = new PipelineInitializer(
      this.gitManager,
      this.branchManager,
      this.repoPath,
      this.dryRun
    );

    this.groupOrchestrator = new GroupExecutionOrchestrator(
      this.gitManager,
      this.stateManager,
      this.repoPath,
      this.dryRun,
      this.shouldLog.bind(this),
      this.notifyStateChange.bind(this),
      this.notifyStageResults.bind(this)
    );

    this.finalizer = new PipelineFinalizer(
      this.gitManager,
      this.branchManager,
      this.prCreator,
      this.stateManager,
      this.repoPath,
      this.dryRun,
      this.shouldLog.bind(this)
    );
  }

  private shouldLog(interactive: boolean): boolean {
    return !interactive;
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
    const interactive = options.interactive || false;
    this.notificationManager = config.notifications
      ? new NotificationManager(config.notifications)
      : undefined;

    // Phase 1: Initialize pipeline
    const initResult = await this.initializer.initialize(
      config,
      { interactive, notificationManager: this.notificationManager },
      this.notify.bind(this),
      this.notifyStateChange.bind(this)
    );

    let { state, parallelExecutor, pipelineBranch, originalBranch, startTime } = initResult;
    this.notificationManager = initResult.notificationManager;

    try {
      // Build execution plan using DAG planner
      const executionGraph = this.dagPlanner.buildExecutionPlan(config);

      if (this.shouldLog(interactive) && executionGraph.plan.groups.length > 0) {
        console.log(
          `📊 Execution plan: ${executionGraph.plan.groups.length} groups, ` +
          `max parallelism: ${executionGraph.plan.maxParallelism}`
        );
        if (executionGraph.validation.warnings.length > 0) {
          console.log(
            `⚠️  Warnings:\n${executionGraph.validation.warnings.map(w => `   - ${w}`).join('\n')}`
          );
        }
        console.log('');
      }

      // Phase 2: Execute each group in order
      for (const group of executionGraph.plan.groups) {
        const result = await this.groupOrchestrator.processGroup(
          group,
          state,
          config,
          executionGraph,
          parallelExecutor,
          interactive
        );

        state = result.state;

        if (result.shouldStopPipeline) {
          state.status = 'failed';
          break;
        }
      }

      // Set final status if still running
      if (state.status === 'running') {
        state.status = 'completed';
      }
    } catch (error) {
      state.status = 'failed';
      if (this.shouldLog(interactive)) {
        console.error(`\n❌ Pipeline failed: ${error}\n`);
      }
    }

    // Phase 3: Finalize pipeline
    state = await this.finalizer.finalize(
      state,
      config,
      pipelineBranch,
      originalBranch,
      startTime,
      interactive,
      this.notify.bind(this),
      this.notifyStateChange.bind(this)
    );

    return state;
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
      const failures = results.filter((r) => !r.success);
      if (failures.length > 0) {
        console.warn('⚠️  Some notifications failed:');
        failures.forEach((f) => console.warn(`   ${f.channel}: ${f.error}`));
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
