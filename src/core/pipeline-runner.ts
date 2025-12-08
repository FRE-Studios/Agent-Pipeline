// src/core/pipeline-runner.ts

import { GitManager } from './git-manager.js';
import { BranchManager } from './branch-manager.js';
import { PRCreator } from './pr-creator.js';
import { StateManager } from './state-manager.js';
import { DAGPlanner } from './dag-planner.js';
import { PipelineInitializer } from './pipeline-initializer.js';
import { GroupExecutionOrchestrator } from './group-execution-orchestrator.js';
import { PipelineFinalizer } from './pipeline-finalizer.js';
import { PipelineConfig, PipelineState, PipelineMetadata, LoopingConfig, LoopContext } from '../config/schema.js';
import { NotificationManager } from '../notifications/notification-manager.js';
import { NotificationContext } from '../notifications/types.js';
import { ProjectConfigLoader } from '../config/project-config-loader.js';
import { PipelineLoader } from '../config/pipeline-loader.js';
import { LoopStateManager, LoopSession } from './loop-state-manager.js';
import { AgentRuntimeRegistry } from './agent-runtime-registry.js';
import { AgentRuntime } from './types/agent-runtime.js';
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
  private projectConfigLoader: ProjectConfigLoader;
  private loopStateManager: LoopStateManager;

  constructor(repoPath: string, dryRun: boolean = false) {
    this.repoPath = repoPath;
    this.dryRun = dryRun;
    this.gitManager = new GitManager(repoPath);
    this.branchManager = new BranchManager(repoPath);
    this.prCreator = new PRCreator();
    this.stateManager = new StateManager(repoPath);
    this.dagPlanner = new DAGPlanner();
    this.projectConfigLoader = new ProjectConfigLoader(repoPath);
    this.loopStateManager = new LoopStateManager(repoPath);

    // Get Claude Code Headless runtime as the default (primary agent harness)
    // Note: StageExecutor resolves runtime per-stage (stage → pipeline → this default)
    // Note: Pipelines can override by specifying runtime.type in their config
    this.runtime = AgentRuntimeRegistry.getRuntime('claude-code-headless');

    // Initialize orchestration components
    this.initializer = new PipelineInitializer(
      this.gitManager,
      this.branchManager,
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
    options: {
      interactive?: boolean;
      loop?: boolean;
      loopMetadata?: PipelineMetadata;
      maxLoopIterations?: number;
    } = {}
  ): Promise<PipelineState> {
    const interactive = options.interactive || false;
    const notificationManager = config.notifications
      ? new NotificationManager(config.notifications)
      : undefined;

    // Load and validate looping config
    const loopingConfig = await this.projectConfigLoader.loadLoopingConfig();

    // Short-circuit if --loop set but config disables it
    let loopEnabled = options.loop || false;
    if (loopEnabled && !loopingConfig.enabled) {
      console.warn('⚠️  Loop mode requested but looping is disabled in config');
      loopEnabled = false;
    }

    // Set up loop tracking variables
    const maxIterations = options.maxLoopIterations ?? loopingConfig.maxIterations ?? 100;
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
          notificationManager,
          loopContext,
          loopSessionId: loopSession?.sessionId
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

      // Handle failures (after file movement)
      if (lastState.status === 'failed') {
        // Record iteration with triggeredNext=false
        if (loopEnabled && loopSession) {
          await this.recordIteration(loopSession.sessionId, lastState, currentMetadata, false);
        }
        loopTerminationReason = 'failure';
        const pipelineName = currentMetadata?.sourcePath
          ? path.basename(currentMetadata.sourcePath, '.yml')
          : currentConfig.name;
        if (this.shouldLog(interactive)) {
          console.log(`Loop: terminating after failure of ${pipelineName}`);
        }
        break;
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
      const sessionStatus = loopTerminationReason === 'natural' ? 'completed' :
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
   * Finds the next pipeline file in the pending directory.
   * Returns the oldest file by modification time, or undefined if directory is empty.
   */
  private async _findNextPipelineFile(loopingConfig: LoopingConfig): Promise<string | undefined> {
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
      notificationManager?: NotificationManager;
      loopContext?: LoopContext;
      loopSessionId?: string;
    }
  ): Promise<PipelineState> {
    const { interactive, loopContext, loopSessionId } = options;
    this.notificationManager = options.notificationManager;

    // Phase 1: Initialize pipeline
    const initResult = await this.initializer.initialize(
      config,
      {
        interactive,
        notificationManager: this.notificationManager,
        loopContext,
        loopSessionId,
        metadata
      },
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
      status: state.status === 'completed' ? 'completed' : 'failed',
      duration: state.artifacts.totalDuration,
      triggeredNext
    });
  }
}
