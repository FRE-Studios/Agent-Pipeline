// src/core/pipeline-runner.ts

import { GitManager } from './git-manager.js';
import { BranchManager } from './branch-manager.js';
import { PRCreator } from './pr-creator.js';
import { StateManager } from './state-manager.js';
import { DAGPlanner } from './dag-planner.js';
import { PipelineInitializer } from './pipeline-initializer.js';
import { GroupExecutionOrchestrator } from './group-execution-orchestrator.js';
import { PipelineFinalizer } from './pipeline-finalizer.js';
import { PipelineConfig, PipelineState, PipelineMetadata, ResolvedLoopingConfig, LoopContext, IterationHistoryEntry } from '../config/schema.js';
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
  private loopExecutionDirs?: ResolvedLoopingConfig['directories'];
  private loopMainDirs?: ResolvedLoopingConfig['directories'];

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

    // Reset per-run loop directory tracking
    this.loopExecutionDirs = undefined;
    this.loopMainDirs = undefined;

    // Create loop session first if loop mode might be enabled
    // We need the sessionId to scope directories
    let loopSession: LoopSession | undefined;

    // Determine looping enabled state
    // Priority: --no-loop flag (explicit disable) > pipeline config > disabled
    let loopEnabled: boolean;
    let loopingConfig: ResolvedLoopingConfig;

    if (options.loop === false) {
      // --no-loop flag: force disable
      loopEnabled = false;
      loopingConfig = this.getDefaultLoopingConfig();
    } else {
      // Use pipeline config to determine looping
      loopEnabled = config.looping?.enabled ?? false;
      if (loopEnabled) {
        // Create session now to get sessionId for directory scoping
        loopSession = await this.loopStateManager.startSession(
          options.maxLoopIterations ?? config.looping?.maxIterations ?? 100
        );
        loopingConfig = config.looping as ResolvedLoopingConfig;
      } else {
        loopingConfig = this.getDefaultLoopingConfig();
      }
    }

    // Note: Loop directories are now created in _executeSinglePipeline after init,
    // when we know the worktree path (if any). This enables session-scoped directories
    // in the correct location (worktree or main repo).

    // Set up loop tracking variables
    const maxIterations = options.maxLoopIterations ?? loopingConfig.maxIterations;
    let iterationCount = 0;
    let lastState: PipelineState | undefined;
    let currentConfig = config;
    let currentMetadata = options.loopMetadata;
    let loopTerminationReason: 'natural' | 'limit-reached' | 'failure' = 'natural';

    // Track loop directory paths for worktree copy (set in first iteration)
    let loopDirCreated = false;
    let loopDirs = loopingConfig.directories;

    // Track iteration history for UI display
    const loopIterationHistory: IterationHistoryEntry[] = [];

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

      // Record iteration start for loop context visibility
      if (loopEnabled && loopSession) {
        const pipelineName = this.getPipelineName(currentConfig, currentMetadata);
        await this.loopStateManager.appendIteration(loopSession.sessionId, {
          iterationNumber: iterationCount,
          pipelineName,
          status: 'in-progress'
        });
      }

      // Build loop context for this iteration
      // Note: directories will be updated in _executeSinglePipeline after init
      // when we know the worktree path
      const loopContext: LoopContext | undefined = loopEnabled && loopingConfig.enabled
        ? {
            enabled: true,
            directories: loopDirs,
            currentIteration: iterationCount,
            maxIterations,
            sessionId: loopSession?.sessionId
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
          abortController: options.abortController,
          isFirstLoopIteration: loopEnabled && !loopDirCreated,
          suppressCompletionNotification: loopEnabled
        }
      );

      // After first iteration, mark directories as created and capture resolved paths
      if (loopEnabled && !loopDirCreated && loopContext) {
        loopDirCreated = true;
        // Update active loop directories with resolved execution paths
        loopDirs = loopContext.directories;
      }

      // Build iteration history entry for UI display
      if (loopEnabled && lastState) {
        // Calculate token usage totals
        let totalInput = 0;
        let totalOutput = 0;
        let totalCacheRead = 0;
        for (const stage of lastState.stages) {
          if (stage.tokenUsage) {
            totalInput += stage.tokenUsage.actual_input || 0;
            totalOutput += stage.tokenUsage.output || 0;
            totalCacheRead += stage.tokenUsage.cache_read || 0;
          }
        }

        const historyEntry: IterationHistoryEntry = {
          iterationNumber: iterationCount,
          pipelineName: currentMetadata?.sourcePath
            ? path.basename(currentMetadata.sourcePath, '.yml')
            : currentConfig.name,
          status: lastState.status === 'completed' ? 'completed'
            : lastState.status === 'aborted' ? 'aborted' : 'failed',
          duration: lastState.artifacts.totalDuration,
          commitCount: lastState.stages.filter(s => s.commitSha).length,
          stageCount: lastState.stages.length,
          successfulStages: lastState.stages.filter(s => s.status === 'success').length,
          failedStages: lastState.stages.filter(s => s.status === 'failed').length,
          tokenUsage: totalInput > 0 ? { totalInput, totalOutput, totalCacheRead } : undefined
        };
        loopIterationHistory.push(historyEntry);
        lastState.loopIterationHistory = [...loopIterationHistory];
      }

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
            ? loopDirs.finished
            : loopDirs.failed;
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

        const failureStrategy = currentConfig.execution?.failureStrategy ?? 'stop';
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
      const nextFile = await this._findNextPipelineFile(loopDirs);
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
          loopDirs.running,
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
            loopDirs.failed,
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
      this.notifyStateChange(lastState);
    }

    // Copy loop directory from worktree to main repo if in worktree mode
    if (
      loopEnabled &&
      lastState.artifacts.worktreePath &&
      this.loopExecutionDirs &&
      this.loopMainDirs
    ) {
      try {
        await this.copyLoopDirectories(this.loopExecutionDirs, this.loopMainDirs);
        if (this.shouldLog(interactive)) {
          console.log('📋 Copied loop directories to main repo');
        }
      } catch (error) {
        // Non-fatal: log warning but don't fail
        console.warn(`⚠️  Could not copy loop directories: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Complete loop session if loop mode was enabled
    if (loopEnabled && loopSession) {
      const sessionStatus = lastState.status === 'aborted' ? 'aborted' :
                           loopTerminationReason === 'natural' ? 'completed' :
                           loopTerminationReason === 'limit-reached' ? 'limit-reached' :
                           'failed';
      await this.loopStateManager.completeSession(loopSession.sessionId, sessionStatus);
    }

    // Send loop completion notification for all termination reasons
    if (loopEnabled) {
      const event = lastState.status === 'aborted'
        ? 'pipeline.aborted'
        : loopTerminationReason === 'natural'
          ? 'pipeline.completed'
          : 'pipeline.failed';
      await this.notify({
        event,
        pipelineState: lastState,
        metadata: {
          loopCompleted: loopTerminationReason === 'natural',
          terminationReason: loopTerminationReason,
          totalIterations: iterationCount
        }
      });
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
   * Get default looping config with resolved paths.
   * Uses session-scoped directories under .agent-pipeline/loops/{sessionId}/
   *
   * @param sessionId - Optional session ID for directory scoping. If not provided,
   *                    uses 'default' as a fallback (for backward compatibility).
   */
  private getDefaultLoopingConfig(sessionId?: string): ResolvedLoopingConfig {
    const baseDir = sessionId
      ? `.agent-pipeline/loops/${sessionId}`
      : '.agent-pipeline/loops/default';
    return {
      enabled: true,
      maxIterations: 100,
      directories: this.getSessionLoopDirs(this.repoPath, baseDir),
    };
  }

  private getSessionLoopDirs(
    basePath: string,
    sessionBaseDir: string
  ): ResolvedLoopingConfig['directories'] {
    return {
      pending: path.resolve(basePath, `${sessionBaseDir}/pending`),
      running: path.resolve(basePath, `${sessionBaseDir}/running`),
      finished: path.resolve(basePath, `${sessionBaseDir}/finished`),
      failed: path.resolve(basePath, `${sessionBaseDir}/failed`),
    };
  }

  private resolveLoopDirectories(
    loopContext: LoopContext,
    executionRepoPath: string,
    worktreePath?: string
  ): {
    executionDirs: ResolvedLoopingConfig['directories'];
    mainDirs: ResolvedLoopingConfig['directories'];
    sessionExecutionDirs: ResolvedLoopingConfig['directories'];
  } {
    const sessionId = loopContext.sessionId ?? 'default';
    const sessionBaseDir = `.agent-pipeline/loops/${sessionId}`;
    const sessionMainDirs = this.getSessionLoopDirs(this.repoPath, sessionBaseDir);
    const sessionExecutionDirs = this.getSessionLoopDirs(executionRepoPath, sessionBaseDir);

    const providedDirs = loopContext.directories;
    const mainDirs = {
      pending: providedDirs.pending || sessionMainDirs.pending,
      running: providedDirs.running || sessionMainDirs.running,
      finished: providedDirs.finished || sessionMainDirs.finished,
      failed: providedDirs.failed || sessionMainDirs.failed,
    };

    if (!worktreePath) {
      return { executionDirs: mainDirs, mainDirs, sessionExecutionDirs };
    }

    const executionDirs = {
      pending: this.mapToExecutionDir(mainDirs.pending, executionRepoPath, sessionExecutionDirs.pending),
      running: this.mapToExecutionDir(mainDirs.running, executionRepoPath, sessionExecutionDirs.running),
      finished: this.mapToExecutionDir(mainDirs.finished, executionRepoPath, sessionExecutionDirs.finished),
      failed: this.mapToExecutionDir(mainDirs.failed, executionRepoPath, sessionExecutionDirs.failed),
    };

    return { executionDirs, mainDirs, sessionExecutionDirs };
  }

  private mapToExecutionDir(
    mainDir: string,
    executionRepoPath: string,
    fallbackDir: string
  ): string {
    const relativePath = path.relative(this.repoPath, mainDir);
    const isInsideRepo = relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
    if (!isInsideRepo) {
      return fallbackDir;
    }
    return path.resolve(executionRepoPath, relativePath);
  }

  private areSameLoopDirs(
    left: ResolvedLoopingConfig['directories'],
    right: ResolvedLoopingConfig['directories']
  ): boolean {
    return left.pending === right.pending &&
      left.running === right.running &&
      left.finished === right.finished &&
      left.failed === right.failed;
  }

  private async ensureLoopDirectoriesExist(
    directories: ResolvedLoopingConfig['directories']
  ): Promise<void> {
    const dirs = [
      directories.pending,
      directories.running,
      directories.finished,
      directories.failed,
    ];
    await Promise.all(dirs.map(dir => fs.mkdir(dir, { recursive: true })));
  }

  private async copyLoopDirectories(
    executionDirs: ResolvedLoopingConfig['directories'],
    mainDirs: ResolvedLoopingConfig['directories']
  ): Promise<void> {
    const dirPairs: Array<{ source: string; dest: string }> = [
      { source: executionDirs.pending, dest: mainDirs.pending },
      { source: executionDirs.running, dest: mainDirs.running },
      { source: executionDirs.finished, dest: mainDirs.finished },
      { source: executionDirs.failed, dest: mainDirs.failed },
    ];

    for (const { source, dest } of dirPairs) {
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.cp(source, dest, { recursive: true, force: true });
    }
  }

  /**
   * Finds the next pipeline file in the pending directory.
   * Returns the oldest file by modification time, or undefined if directory is empty.
   */
  private async _findNextPipelineFile(
    loopDirs: ResolvedLoopingConfig['directories']
  ): Promise<string | undefined> {
    try {
      const pendingDir = loopDirs.pending;
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
      isFirstLoopIteration?: boolean;
      suppressCompletionNotification?: boolean;
    }
  ): Promise<PipelineState> {
    const { interactive, verbose, loopContext, loopSessionId, abortController, isFirstLoopIteration, suppressCompletionNotification } = options;

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

    // Create loop directories on first iteration (after we know worktree path)
    if (isFirstLoopIteration && loopContext?.sessionId) {
      const {
        executionDirs,
        mainDirs,
        sessionExecutionDirs
      } = this.resolveLoopDirectories(loopContext, executionRepoPath, worktreePath);

      const usesSessionDirs = this.areSameLoopDirs(executionDirs, sessionExecutionDirs);
      if (usesSessionDirs) {
        await this.loopStateManager.createSessionDirectories(loopContext.sessionId, executionRepoPath);
      } else {
        await this.ensureLoopDirectoriesExist(executionDirs);
      }

      // Update loopContext with execution paths (worktree-aware)
      loopContext.directories = executionDirs;

      // Track loop directories for post-run copy
      this.loopExecutionDirs = executionDirs;
      this.loopMainDirs = mainDirs;

      if (this.shouldLog(interactive)) {
        const baseDir = usesSessionDirs
          ? this.loopStateManager.getSessionQueueDir(loopContext.sessionId, executionRepoPath)
          : executionRepoPath;
        console.log(`📁 Created loop directories under: ${baseDir}`);
      }
    }

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
      this.notifyStateChange.bind(this),
      { suppressCompletionNotification }
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
    const pipelineName = this.getPipelineName(state.pipelineConfig, metadata);
    const iterationNumber = state.loopContext?.currentIteration ?? 1;

    const updated = await this.loopStateManager.updateIteration(sessionId, iterationNumber, {
      pipelineName,
      runId: state.runId,
      status: state.status === 'completed' ? 'completed' : state.status === 'aborted' ? 'aborted' : 'failed',
      duration: state.artifacts.totalDuration,
      triggeredNext
    });

    if (!updated) {
      await this.loopStateManager.appendIteration(sessionId, {
        iterationNumber,
        pipelineName,
        runId: state.runId,
        status: state.status === 'completed' ? 'completed' : state.status === 'aborted' ? 'aborted' : 'failed',
        duration: state.artifacts.totalDuration,
        triggeredNext
      });
    }
  }

  private getPipelineName(config: PipelineConfig, metadata?: PipelineMetadata): string {
    return metadata?.sourcePath
      ? path.basename(metadata.sourcePath, '.yml')
      : config.name;
  }
}
