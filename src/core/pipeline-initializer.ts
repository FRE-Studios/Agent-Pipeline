// src/core/pipeline-initializer.ts

import { v4 as uuidv4 } from 'uuid';
import { GitManager } from './git-manager.js';
import { WorktreeManager } from './worktree-manager.js';
import { StageExecutor } from './stage-executor.js';
import { ParallelExecutor } from './parallel-executor.js';
import { HandoverManager } from './handover-manager.js';
import { AgentRuntime } from './types/agent-runtime.js';
import { PipelineConfig, PipelineState, LoopContext, PipelineMetadata } from '../config/schema.js';
import { NotificationManager } from '../notifications/notification-manager.js';
import { NotificationContext } from '../notifications/types.js';
import { PipelineAbortController } from './abort-controller.js';

export interface InitializationResult {
  state: PipelineState;
  stageExecutor: StageExecutor;
  parallelExecutor: ParallelExecutor;
  handoverManager: HandoverManager;
  pipelineBranch?: string;
  worktreePath?: string;
  executionRepoPath: string;
  notificationManager?: NotificationManager;
  startTime: number;
  verbose: boolean;
}

export class PipelineInitializer {
  private worktreeManager: WorktreeManager;

  constructor(
    private gitManager: GitManager,
    private repoPath: string,
    private dryRun: boolean,
    private runtime: AgentRuntime
  ) {
    this.worktreeManager = new WorktreeManager(repoPath);
  }

  /**
   * Initialize the entire pipeline with all necessary setup
   */
  async initialize(
    config: PipelineConfig,
    options: {
      interactive?: boolean;
      verbose?: boolean;
      notificationManager?: NotificationManager;
      loopContext?: LoopContext;
      loopSessionId?: string;
      metadata?: PipelineMetadata;
      abortController?: PipelineAbortController;
    },
    notifyCallback: (context: NotificationContext) => Promise<void>,
    stateChangeCallback: (state: PipelineState) => void
  ): Promise<InitializationResult> {
    const verbose = options.verbose ?? false;
    const runId = uuidv4();

    // Setup notification manager
    const notificationManager =
      options.notificationManager ||
      (config.notifications
        ? new NotificationManager(config.notifications)
        : undefined);

    // Setup worktree isolation for pipeline execution
    const isolation = await this.setupWorktreeIsolation(
      config,
      runId,
      options.interactive || false
    );

    // Get trigger commit and changed files from main repo
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

    // Store worktree path in artifacts if using worktree isolation
    if (isolation.worktreePath) {
      state.artifacts.worktreePath = isolation.worktreePath;
    }

    // Create and initialize handover manager
    // In worktree mode: create in worktree (respects agent sandbox), copy to main repo after
    // In non-worktree mode: create directly in main repo
    const handoverRepoPath = isolation.worktreePath || this.repoPath;
    const handoverManager = new HandoverManager(
      handoverRepoPath,
      config.name,
      runId,
      config.handover
    );
    await handoverManager.initialize();

    // Store handover directory in state
    // In worktree mode, this is the worktree path; finalizer will copy to main repo
    state.artifacts.handoverDir = handoverManager.getHandoverDir();

    // Track the main repo destination for copying (only needed in worktree mode)
    if (isolation.worktreePath) {
      const mainRepoHandoverManager = new HandoverManager(
        this.repoPath,
        config.name,
        runId,
        config.handover
      );
      state.artifacts.mainRepoHandoverDir = mainRepoHandoverManager.getHandoverDir();
    }

    // Create executors with worktree-aware configuration
    const stageExecutor = new StageExecutor(
      this.gitManager,
      this.dryRun,
      handoverManager,
      this.runtime,
      options.loopContext,
      this.repoPath,                    // For file-driven instruction loading
      isolation.executionRepoPath,      // Where agents execute (worktree or main repo)
      { interactive: options.interactive ?? true, verbose },
      options.abortController
    );
    const parallelExecutor = new ParallelExecutor(
      stageExecutor,
      stateChangeCallback,
      options.abortController
    );

    // Log startup messages
    this.logStartup(config, state, triggerCommit, isolation, options.interactive || false, verbose);

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
      handoverManager,
      pipelineBranch: isolation.branchName,
      worktreePath: isolation.worktreePath,
      executionRepoPath: isolation.executionRepoPath,
      notificationManager,
      startTime,
      verbose
    };
  }

  /**
   * Setup worktree isolation for pipeline execution.
   * Pipelines execute in dedicated worktrees, leaving user's working directory untouched.
   */
  private async setupWorktreeIsolation(
    config: PipelineConfig,
    runId: string,
    _interactive: boolean
  ): Promise<{ worktreePath?: string; branchName?: string; executionRepoPath: string }> {
    // If no git config or dry run, execute in main repo (no isolation)
    if (!config.git || this.dryRun) {
      return { executionRepoPath: this.repoPath };
    }

    // Get custom worktree directory from git config if configured
    const worktreeDir = config.git?.worktree?.directory;

    // Create worktree manager with custom directory if specified
    const worktreeManager = worktreeDir
      ? new WorktreeManager(this.repoPath, worktreeDir)
      : this.worktreeManager;

    // Setup worktree for pipeline execution
    const result = await worktreeManager.setupPipelineWorktree(
      config.name,
      runId,
      config.git.baseBranch || 'main',
      config.git.branchStrategy || 'reusable',
      config.git.branchPrefix || 'pipeline'
    );

    return {
      worktreePath: result.worktreePath,
      branchName: result.branchName,
      executionRepoPath: result.worktreePath
    };
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
        totalDuration: 0,
        handoverDir: ''
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
    isolation: { worktreePath?: string; branchName?: string; executionRepoPath: string },
    interactive: boolean,
    verbose: boolean
  ): void {
    // Skip all logging in interactive mode (UI handles it)
    if (interactive) {
      return;
    }

    if (this.dryRun) {
      console.log(`\n🧪 DRY RUN MODE - No commits will be created\n`);
    }

    // Minimal startup message for non-interactive
    console.log(`\n🚀 ${config.name} (Run: ${state.runId.substring(0, 8)})`);

    // Show detailed info only in verbose mode
    if (verbose) {
      console.log(`📝 Trigger commit: ${triggerCommit.substring(0, 7)}`);
      if (isolation.worktreePath) {
        console.log(`🌳 Worktree: ${isolation.worktreePath}`);
        console.log(`   Branch: ${isolation.branchName}`);
      }
    }
    console.log('');
  }
}
