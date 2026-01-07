// src/core/pipeline-runner.ts

import { GitManager } from './git-manager.js';
import { BranchManager } from './branch-manager.js';
import { PRCreator } from './pr-creator.js';
import { StateManager } from './state-manager.js';
import { DAGPlanner } from './dag-planner.js';
import { PipelineInitializer } from './pipeline-initializer.js';
import { GroupExecutionOrchestrator } from './group-execution-orchestrator.js';
import { PipelineFinalizer } from './pipeline-finalizer.js';
import { PipelineConfig, PipelineState, PipelineMetadata, ResolvedLoopingConfig, LoopContext } from '../config/schema.js';
import { NotificationManager } from '../notifications/notification-manager.js';
import { NotificationContext } from '../notifications/types.js';
import { PipelineLoader } from '../config/pipeline-loader.js';
import { LoopStateManager, LoopSession } from './loop-state-manager.js';
import { AgentRuntimeRegistry } from './agent-runtime-registry.js';
import { AgentRuntime } from './types/agent-runtime.js';
import { PipelineAbortController, PipelineAbortError } from './abort-controller.js';
import * as fs from 'fs/promises';
import * as path from 'path';

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
  private runtime: AgentRuntime;
  private stateUpdateCallbacks: Array<(state: PipelineState) => void> = [];
  private loopStateManager: LoopStateManager;

  constructor(repoPath: string, dryRun: boolean = false) {
    this.repoPath = repoPath;
    this.dryRun = dryRun;
    this.gitManager = new GitManager(repoPath);
    this.branchManager = new BranchManager(repoPath);
    this.prCreator = new PRCreator();
    this.stateManager = new StateManager(repoPath);
    this.dagPlanner = new DAGPlanner();
    this.loopStateManager = new LoopStateManager(repoPath);

    // Get Claude Code Headless runtime as the default (primary agent harness)
    // Note: StageExecutor resolves runtime per-stage (stage → pipeline → this default)
    // Note: Pipelines can override by specifying runtime.type in their config
    this.runtime = AgentRuntimeRegistry.getRuntime('claude-code-headless');

    // Initialize orchestration components
    this.initializer = new PipelineInitializer(
      this.gitManager,
      this.repoPath,
      this.dryRun,
      this.runtime
    );

    this.groupOrchestrator = new GroupExecutionOrchestrator(
      this.stateManager,
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

  /**
   * Determines if console logs should be shown.
   * Returns true for non-interactive mode (console output) or verbose mode.
   * Note: verbose flag is passed separately to components for detailed logging control.
   */
  private shouldLog(interactive: boolean): boolean {
    return !interactive;
  }

  private async notifyStageResults(
    executions: import('../config/schema.js').StageExecution[],
    state: PipelineState
  ): Promise<void> {
    const notificationContexts: NotificationContext[] = [];

    for (const execution of executions) {
      if (execution.status === 'success') {
        notificationContexts.push({
          event: 'stage.completed',
          pipelineState: state,
          stage: execution
        });
      } else if (execution.status === 'failed') {
        notificationContexts.push({
          event: 'stage.failed',
          pipelineState: state,
          stage: execution
        });
      }
    }

    if (notificationContexts.length > 0) {
      await Promise.all(notificationContexts.map(context => this.notify(context)));
    }
  }

  async runPipeline(
    config: PipelineConfig,
    options: {
      interactive?: boolean;
      verbose?: boolean;
      loop?: boolean;
      loopMetadata?: PipelineMetadata;
      maxLoopIterations?: number;
      abortController?: PipelineAbortController;
    } = {}
  ): Promise<PipelineState> {
    const interactive = options.interactive || false;
    const verbose = options.verbose || false;
    const notificationManager = config.notifications
      ? new NotificationManager(config.notifications)
      : undefined;

    // Determine looping enabled state
    // Priority: CLI flag (explicit) > pipeline config > disabled
    let loopEnabled: boolean;
    let loopingConfig: ResolvedLoopingConfig;

    if (options.loop === false) {
      // --no-loop flag: force disable
      loopEnabled = false;
      loopingConfig = this.getDefaultLoopingConfig();
    } else if (options.loop === true) {
      // --loop flag: force enable
      loopEnabled = true;
      if (config.looping?.enabled) {
        // Use pipeline's resolved looping config
        loopingConfig = config.looping as ResolvedLoopingConfig;
      } else {
        // No looping config in pipeline - use defaults
        console.warn('⚠️  Loop mode requested but no looping config in pipeline. Using defaults.');
        loopingConfig = this.getDefaultLoopingConfig();
      }
    } else {
      // No CLI flag: auto-loop if pipeline config has looping.enabled: true
      loopEnabled = config.looping?.enabled ?? false;
      loopingConfig = loopEnabled
        ? (config.looping as ResolvedLoopingConfig)
        : this.getDefaultLoopingConfig();
    }

    // Create directories if looping is enabled
    if (loopEnabled) {
      await this.ensureLoopDirectoriesExist(loopingConfig.directories);
    }

    // Set up loop tracking variables
    const maxIterations = options.maxLoopIterations ?? loopingConfig.maxIterations;
    let iterationCount = 0;
    let lastState: PipelineState | undefined;
    let currentConfig = config;
    let currentMetadata = options.loopMetadata;
    let loopTerminationReason: 'natural' | 'limit-reached' | 'failure' = 'natural';

    // Create loop session if loop mode is enabled
    let loopSession: LoopSession | undefined;
    if (loopEnabled) {
      loopSession = this.loopStateManager.startSession(maxIterations);
    }

    // Main loop
    while (true) {
      iterationCount++;

      // Check iteration limit
      if (iterationCount > maxIterations) {
        console.log(`⚠️ Loop limit reached (${maxIterations} iterations). Use --max-loop-iterations to override.`);
        loopTerminationReason = 'limit-reached';
        break;
      }

      // Log iteration in non-interactive mode
      if (this.shouldLog(interactive) && loopEnabled && iterationCount > 1) {
        const pipelineName = currentMetadata?.sourcePath
          ? path.basename(currentMetadata.sourcePath, '.yml')
          : currentConfig.name;
        console.log(`🔁 Loop iteration ${iterationCount}: Running pipeline '${pipelineName}'...`);
      }

      // Build loop context for this iteration
      const loopContext: LoopContext | undefined = loopEnabled && loopingConfig.enabled
        ? {
            enabled: true,
            directories: loopingConfig.directories,
            currentIteration: iterationCount,
            maxIterations
          }
        : undefined;

      // Execute single pipeline
      lastState = await this._executeSinglePipeline(
        currentConfig,
        currentMetadata,
        {
          interactive,
          verbose,
          notificationManager,
          loopContext,
          loopSessionId: loopSession?.sessionId,
          abortController: options.abortController
        }
      );

      // Emit state update for UI (this resets the UI for next iteration)
      this.notifyStateChange(lastState);

      // Log iteration completion in non-interactive mode
      if (this.shouldLog(interactive) && loopEnabled && lastState.status === 'completed') {
        console.log(`✅ Completed iteration ${iterationCount}`);
      }

      // File transitions for queued pipelines only (not seed pipeline)
      if (currentMetadata?.sourceType === 'loop-pending') {
        try {
          const destDir = lastState.status === 'completed'
            ? loopingConfig.directories.finished
            : loopingConfig.directories.failed;
          const fileName = path.basename(currentMetadata.sourcePath);
          await this._moveFile(currentMetadata.sourcePath, destDir, fileName);

          if (this.shouldLog(interactive)) {
            const statusEmoji = lastState.status === 'completed' ? '✅' : '❌';
            console.log(`${statusEmoji} Moved ${fileName} to ${path.basename(destDir)}/`);
          }
        } catch (error) {
          console.error(`⚠️  Failed to move pipeline file: ${error}`);
          // Continue anyway - file management errors shouldn't crash the loop
        }
      }

      // Handle abort - always terminate immediately
      if (lastState.status === 'aborted') {
        if (loopEnabled && loopSession) {
          await this.recordIteration(loopSession.sessionId, lastState, currentMetadata, false);
        }
        if (this.shouldLog(interactive)) {
          console.log('Loop: terminating due to abort');
        }
        break;
      }

      // Handle failures (after file movement)
      if (lastState.status === 'failed') {
        // Record iteration with triggeredNext=false
        if (loopEnabled && loopSession) {
          await this.recordIteration(loopSession.sessionId, lastState, currentMetadata, false);
        }

        const failureStrategy = currentConfig.settings?.failureStrategy ?? 'stop';
        if (failureStrategy === 'stop') {
          loopTerminationReason = 'failure';
          const pipelineName = currentMetadata?.sourcePath
            ? path.basename(currentMetadata.sourcePath, '.yml')
            : currentConfig.name;
          if (this.shouldLog(interactive)) {
            console.log(`Loop: terminating after failure of ${pipelineName}`);
          }
          break;
        }
      }

      // Exit loop if --loop not enabled
      if (!loopEnabled) {
        // Record single iteration with triggeredNext=false
        if (loopSession) {
          await this.recordIteration(loopSession.sessionId, lastState, currentMetadata, false);
        }
        break;
      }

      // Find next pipeline
      const nextFile = await this._findNextPipelineFile(loopingConfig);
      const triggeredNext = nextFile !== undefined;

      // Record iteration with correct triggeredNext status
      if (loopSession) {
        await this.recordIteration(loopSession.sessionId, lastState, currentMetadata, triggeredNext);
      }

      if (!nextFile) {
        if (this.shouldLog(interactive)) {
          console.log('Loop: no pending pipelines, exiting.');
        }
        break;
      }

      // Move next file to running directory
      const fileName = path.basename(nextFile);
      let runningPath: string;
      try {
        runningPath = await this._moveFile(
          nextFile,
          loopingConfig.directories.running,
          fileName
        );
      } catch (error) {
        console.error(`❌ Failed to move ${fileName} to running directory: ${error}`);
        break;
      }

      // Load next pipeline
      try {
        const loader = new PipelineLoader(this.repoPath);
        const result = await loader.loadPipelineFromPath(runningPath);
        currentConfig = result.config;
        currentMetadata = result.metadata;
      } catch (error) {
        console.error(`❌ Failed to load pipeline ${fileName}: ${error}`);
        // Move to failed directory
        try {
          await this._moveFile(
            runningPath,
            loopingConfig.directories.failed,
            fileName
          );
        } catch (moveError) {
          console.error(`⚠️  Failed to move ${fileName} to failed directory: ${moveError}`);
        }
        break;
      }
    }

    // This should never happen, but satisfy TypeScript
    if (!lastState) {
      throw new Error('Pipeline execution completed without a final state');
    }

    // Store termination reason in loopContext instead of mutating state.status
    if (lastState.loopContext) {
      lastState.loopContext.terminationReason = loopTerminationReason;
    }

    // Complete loop session if loop mode was enabled
    if (loopEnabled && loopSession) {
      const sessionStatus = lastState.status === 'aborted' ? 'aborted' :
                           loopTerminationReason === 'natural' ? 'completed' :
                           loopTerminationReason === 'limit-reached' ? 'limit-reached' :
                           'failed';
      await this.loopStateManager.completeSession(loopSession.sessionId, sessionStatus);
    }

    return lastState;
  }

  private notifyStateChange(state: PipelineState): void {
    // Clone state to trigger React re-renders (React uses reference equality)
    const clonedState = {
      ...state,
      stages: [...state.stages],
      artifacts: { ...state.artifacts }
    };
    for (const callback of this.stateUpdateCallbacks) {
      callback(clonedState);
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

  /**
   * Get default looping config with resolved paths
   */
  private getDefaultLoopingConfig(): ResolvedLoopingConfig {
    return {
      enabled: true,
      maxIterations: 100,
      directories: {
        pending: path.resolve(this.repoPath, 'next/pending'),
        running: path.resolve(this.repoPath, 'next/running'),
        finished: path.resolve(this.repoPath, 'next/finished'),
        failed: path.resolve(this.repoPath, 'next/failed'),
      },
    };
  }

  /**
   * Create looping directories if they don't exist
   */
  private async ensureLoopDirectoriesExist(
    directories: ResolvedLoopingConfig['directories']
  ): Promise<void> {
    const dirs = [
      directories.pending,
      directories.running,
      directories.finished,
      directories.failed,
    ];
    for (const dir of dirs) {
      try {
        await fs.mkdir(dir, { recursive: true });
      } catch {
        // Ignore if exists
      }
    }
  }

  /**
   * Finds the next pipeline file in the pending directory.
   * Returns the oldest file by modification time, or undefined if directory is empty.
   */
  private async _findNextPipelineFile(loopingConfig: ResolvedLoopingConfig): Promise<string | undefined> {
    try {
      const pendingDir = loopingConfig.directories.pending;
      const files = await fs.readdir(pendingDir);

      // Filter for YAML files only
      const yamlFiles = files.filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));

      if (yamlFiles.length === 0) {
        return undefined;
      }

      // Get file stats and sort by mtime (oldest first)
      const filesWithStats = await Promise.all(
        yamlFiles.map(async (fileName) => {
          const filePath = path.join(pendingDir, fileName);
          const stats = await fs.stat(filePath);
          return { fileName, filePath, mtime: stats.mtime };
        })
      );

      filesWithStats.sort((a, b) => a.mtime.getTime() - b.mtime.getTime());

      return filesWithStats[0].filePath;
    } catch (error) {
      // If directory doesn't exist or can't be read, return undefined
      return undefined;
    }
  }

  /**
   * Generates a unique file path by appending timestamps if file already exists.
   * Example: task.yml -> task-1698765432.yml
   */
  private async _getUniqueFilePath(destDir: string, fileName: string): Promise<string> {
    const basePath = path.join(destDir, fileName);

    try {
      await fs.access(basePath);
      // File exists, append timestamp
      const ext = path.extname(fileName);
      const nameWithoutExt = path.basename(fileName, ext);
      const timestamp = Date.now();
      const uniqueName = `${nameWithoutExt}-${timestamp}${ext}`;
      return path.join(destDir, uniqueName);
    } catch {
      // File doesn't exist, use original path
      return basePath;
    }
  }

  /**
   * Atomically moves a file from source to destination directory.
   * Handles name collisions by appending timestamps.
   */
  private async _moveFile(
    sourcePath: string,
    destDir: string,
    fileName: string
  ): Promise<string> {
    const destPath = await this._getUniqueFilePath(destDir, fileName);
    await fs.rename(sourcePath, destPath);
    return destPath;
  }

  /**
   * Executes a single pipeline run (one iteration).
   * This method contains the core execution logic extracted for reuse in loop mode.
   */
  private async _executeSinglePipeline(
    config: PipelineConfig,
    metadata: PipelineMetadata | undefined,
    options: {
      interactive: boolean;
      verbose: boolean;
      notificationManager?: NotificationManager;
      loopContext?: LoopContext;
      loopSessionId?: string;
      abortController?: PipelineAbortController;
    }
  ): Promise<PipelineState> {
    const { interactive, verbose, loopContext, loopSessionId, abortController } = options;

    // Create notification manager early so it's available for init failures
    this.notificationManager = options.notificationManager ||
      (config.notifications ? new NotificationManager(config.notifications) : undefined);

    // Phase 1: Initialize pipeline
    let initResult;
    try {
      initResult = await this.initializer.initialize(
        config,
        {
          interactive,
          verbose,
          notificationManager: this.notificationManager,
          loopContext,
          loopSessionId,
          metadata,
          abortController
        },
        this.notify.bind(this),
        this.notifyStateChange.bind(this)
      );
    } catch (error) {
      // Send failure notification for initialization errors (e.g., worktree creation failure)
      const errorMessage = error instanceof Error ? error.message : String(error);
      const now = new Date().toISOString();
      if (this.shouldLog(interactive)) {
        console.error(`\n❌ Pipeline initialization failed: ${errorMessage}\n`);
      }

      // Create minimal failed state for notification
      const failedState: PipelineState = {
        runId: 'init-failed',
        pipelineConfig: config,
        trigger: {
          type: config.trigger,
          commitSha: '',
          timestamp: now
        },
        stages: [
          {
            stageName: 'pipeline-initialization',
            status: 'failed',
            startTime: now,
            endTime: now,
            duration: 0,
            error: {
              message: errorMessage,
              timestamp: now
            }
          }
        ],
        status: 'failed',
        artifacts: {
          initialCommit: '',
          changedFiles: [],
          totalDuration: 0,
          handoverDir: ''
        }
      };

      await this.notify({
        event: 'pipeline.failed',
        pipelineState: failedState,
        metadata: { error: errorMessage }
      });

      return failedState;
    }

    let { state, parallelExecutor, pipelineBranch, worktreePath, executionRepoPath, startTime } = initResult;
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
      const totalGroups = executionGraph.plan.groups.length;
      let abortedAtGroup: number | undefined;

      for (let groupIndex = 0; groupIndex < totalGroups; groupIndex++) {
        // Check for abort before starting next group
        if (abortController?.aborted) {
          state.status = 'aborted';
          abortedAtGroup = groupIndex + 1;
          break;
        }

        const group = executionGraph.plan.groups[groupIndex];
        const isFinalGroup = groupIndex === totalGroups - 1;

        const result = await this.groupOrchestrator.processGroup(
          group,
          state,
          config,
          parallelExecutor,
          interactive,
          initResult.handoverManager,
          { isFinalGroup },
          verbose
        );

        state = result.state;

        // Check for abort after group execution (may have been triggered during execution)
        if (abortController?.aborted) {
          state.status = 'aborted';
          abortedAtGroup = groupIndex + 1;
          break;
        }

        if (result.shouldStopPipeline) {
          state.status = 'failed';
          break;
        }
      }

      // Log abort once after the loop
      if (abortedAtGroup !== undefined && this.shouldLog(interactive)) {
        console.log(`\n⚠️  Pipeline aborted at group ${abortedAtGroup}/${totalGroups}\n`);
      }

      // Set final status if still running
      if (state.status === 'running' && !abortController?.aborted) {
        state.status = 'completed';
      }
    } catch (error) {
      // Handle abort error specially (thrown from deeper in the call stack)
      if (error instanceof PipelineAbortError || abortController?.aborted) {
        state.status = 'aborted';
        if (this.shouldLog(interactive)) {
          console.log(`\n⚠️  Pipeline aborted\n`);
        }
      } else {
        state.status = 'failed';
        if (this.shouldLog(interactive)) {
          console.error(`\n❌ Pipeline failed: ${error}\n`);
        }
      }
    }

    // Phase 3: Finalize pipeline
    state = await this.finalizer.finalize(
      state,
      config,
      pipelineBranch,
      worktreePath,
      executionRepoPath,
      startTime,
      interactive,
      verbose,
      this.notify.bind(this),
      this.notifyStateChange.bind(this)
    );

    return state;
  }

  /**
   * Records a loop iteration with the correct triggeredNext status
   */
  private async recordIteration(
    sessionId: string,
    state: PipelineState,
    metadata: PipelineMetadata | undefined,
    triggeredNext: boolean
  ): Promise<void> {
    const pipelineName = metadata?.sourcePath
      ? path.basename(metadata.sourcePath, '.yml')
      : state.pipelineConfig.name;

    await this.loopStateManager.appendIteration(sessionId, {
      iterationNumber: state.loopContext?.currentIteration ?? 1,
      pipelineName,
      runId: state.runId,
      status: state.status === 'completed' ? 'completed' : state.status === 'aborted' ? 'aborted' : 'failed',
      duration: state.artifacts.totalDuration,
      triggeredNext
    });
  }
}
