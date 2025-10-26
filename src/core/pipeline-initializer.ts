// src/core/pipeline-initializer.ts

import { v4 as uuidv4 } from 'uuid';
import { GitManager } from './git-manager.js';
import { BranchManager } from './branch-manager.js';
import { StageExecutor } from './stage-executor.js';
import { ParallelExecutor } from './parallel-executor.js';
import { PipelineConfig, PipelineState, LoopContext, PipelineMetadata } from '../config/schema.js';
import { NotificationManager } from '../notifications/notification-manager.js';
import { NotificationContext } from '../notifications/types.js';

export interface InitializationResult {
  state: PipelineState;
  stageExecutor: StageExecutor;
  parallelExecutor: ParallelExecutor;
  pipelineBranch?: string;
  originalBranch: string;
  notificationManager?: NotificationManager;
  startTime: number;
}

export class PipelineInitializer {
  constructor(
    private gitManager: GitManager,
    private branchManager: BranchManager,
    private repoPath: string,
    private dryRun: boolean
  ) {}

  /**
   * Initialize the entire pipeline with all necessary setup
   */
  async initialize(
    config: PipelineConfig,
    options: {
      interactive?: boolean;
      notificationManager?: NotificationManager;
      loopContext?: LoopContext;
      loopSessionId?: string;
      metadata?: PipelineMetadata;
    },
    notifyCallback: (context: NotificationContext) => Promise<void>,
    stateChangeCallback: (state: PipelineState) => void
  ): Promise<InitializationResult> {
    const runId = uuidv4();

    // Setup notification manager
    const notificationManager =
      options.notificationManager ||
      (config.notifications
        ? new NotificationManager(config.notifications)
        : undefined);

    // Save original branch to return to later
    const originalBranch = await this.branchManager.getCurrentBranch();

    // Setup pipeline branch if git config exists
    const pipelineBranch = await this.setupBranchIsolation(
      config,
      runId,
      options.interactive || false
    );

    // Get trigger commit and changed files
    const triggerCommit = await this.gitManager.getCurrentCommit();
    const changedFiles = await this.gitManager.getChangedFiles(triggerCommit);

    // Create initial state
    const state = this.createInitialState(
      config,
      runId,
      triggerCommit,
      changedFiles,
      options.loopContext,
      options.loopSessionId,
      options.metadata
    );

    // Create executors
    const stageExecutor = new StageExecutor(
      this.gitManager,
      this.dryRun,
      state.runId,
      this.repoPath,
      options.loopContext
    );
    const parallelExecutor = new ParallelExecutor(
      stageExecutor,
      stateChangeCallback
    );

    // Log startup messages
    this.logStartup(config, state, triggerCommit, options.interactive || false);

    // Notify initial state
    stateChangeCallback(state);

    // Notify pipeline started
    await notifyCallback({
      event: 'pipeline.started',
      pipelineState: state
    });

    const startTime = Date.now();

    return {
      state,
      stageExecutor,
      parallelExecutor,
      pipelineBranch,
      originalBranch,
      notificationManager,
      startTime
    };
  }

  /**
   * Setup branch isolation for pipeline execution
   */
  private async setupBranchIsolation(
    config: PipelineConfig,
    runId: string,
    interactive: boolean
  ): Promise<string | undefined> {
    if (!config.git || this.dryRun) {
      return undefined;
    }

    const pipelineBranch = await this.branchManager.setupPipelineBranch(
      config.name,
      runId,
      config.git.baseBranch || 'main',
      config.git.branchStrategy || 'reusable',
      config.git.branchPrefix || 'pipeline'
    );

    if (!interactive) {
      console.log(`📍 Running on branch: ${pipelineBranch}\n`);
    }

    return pipelineBranch;
  }

  /**
   * Create initial pipeline state
   */
  private createInitialState(
    config: PipelineConfig,
    runId: string,
    triggerCommit: string,
    changedFiles: string[],
    loopContext?: LoopContext,
    loopSessionId?: string,
    metadata?: PipelineMetadata
  ): PipelineState {
    // Always populate loopContext (with enabled: true/false)
    const stateLoopContext = loopContext
      ? {
          enabled: true,
          currentIteration: loopContext.currentIteration ?? 1,
          maxIterations: loopContext.maxIterations ?? 100,
          loopSessionId: loopSessionId ?? '',
          pipelineSource: (metadata?.sourceType ?? 'library') as 'library' | 'loop-pending',
          terminationReason: undefined as 'natural' | 'limit-reached' | 'failure' | undefined
        }
      : {
          enabled: false,
          currentIteration: 1,
          maxIterations: 100,
          loopSessionId: '',
          pipelineSource: 'library' as 'library' | 'loop-pending',
          terminationReason: undefined as 'natural' | 'limit-reached' | 'failure' | undefined
        };

    return {
      runId,
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
      },
      loopContext: stateLoopContext
    };
  }

  /**
   * Log startup messages to console
   */
  private logStartup(
    config: PipelineConfig,
    state: PipelineState,
    triggerCommit: string,
    interactive: boolean
  ): void {
    if (this.dryRun) {
      console.log(`\n🧪 DRY RUN MODE - No commits will be created\n`);
    }

    // Show simple console output if not interactive
    if (!interactive) {
      console.log(`\n🚀 Starting pipeline: ${config.name}`);
      console.log(`📦 Run ID: ${state.runId}`);
      console.log(`📝 Trigger commit: ${triggerCommit.substring(0, 7)}\n`);
    }
  }
}
