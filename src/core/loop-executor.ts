// src/core/loop-executor.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import YAML from 'yaml';
import {
  PipelineConfig,
  PipelineState,
  PipelineMetadata,
  ResolvedLoopingConfig,
  LoopContext,
  AgentStageConfig,
  StageExecution
} from '../config/schema.js';
import { InstructionLoader, InstructionContext } from './instruction-loader.js';
import { AgentRuntimeRegistry } from './agent-runtime-registry.js';
import { LoopStateManager } from './loop-state-manager.js';

export class LoopExecutor {
  constructor(
    private repoPath: string,
    private shouldLog: (interactive: boolean) => boolean,
    private stateChangeCallback: (state: PipelineState) => void,
    private loopStateManager: LoopStateManager
  ) {}

  /**
   * Execute the loop agent directly (not through the stage executor chain).
   * Receives only pipeline YAML and loop metadata — no handover, no pipeline context.
   */
  async executeLoopAgent(
    config: PipelineConfig,
    state: PipelineState,
    loopContext: LoopContext,
    loopStageName: string,
    executionRepoPath: string,
    interactive: boolean,
    metadata?: PipelineMetadata
  ): Promise<void> {
    // 1. Add running stage entry to state (for UI tracking)
    const execution: StageExecution = {
      stageName: loopStageName,
      status: 'running',
      startTime: new Date().toISOString(),
      retryAttempt: 0,
      maxRetries: 0
    };
    state.stages.push(execution);
    this.stateChangeCallback(state);  // UI sees "running"

    try {
      // 2. Load loop instructions (system prompt)
      const instructionLoader = new InstructionLoader(this.repoPath);
      const pipelineYaml = await this.readPipelineYaml(config, metadata, executionRepoPath);
      const templateContext: InstructionContext = {
        pendingDir: loopContext.directories.pending,
        currentIteration: loopContext.currentIteration,
        maxIterations: loopContext.maxIterations,
        pipelineName: config.name,
        pipelineYaml
      };
      const systemPrompt = await instructionLoader.loadLoopInstructions(
        config.looping?.instructions, templateContext
      );

      // 3. Minimal user prompt (no handover, no pipeline context)
      const userPrompt = this.buildLoopAgentPrompt(config, loopContext, pipelineYaml);

      // 4. Resolve runtime and execute directly
      const runtimeType = config.runtime?.type || 'claude-code-headless';
      const runtime = AgentRuntimeRegistry.getRuntime(runtimeType);

      if (this.shouldLog(interactive)) {
        console.log('🔁 Running loop agent...');
      }

      const result = await runtime.execute({
        systemPrompt,
        userPrompt,
        options: {
          permissionMode: 'acceptEdits',
          runtimeOptions: { cwd: executionRepoPath }
        }
      });

      // 5. Update execution entry
      execution.status = 'success';
      execution.endTime = new Date().toISOString();
      execution.duration = (Date.now() - new Date(execution.startTime).getTime()) / 1000;
      execution.agentOutput = result.textOutput;
      if (result.tokenUsage) {
        execution.tokenUsage = {
          estimated_input: 0,
          actual_input: result.tokenUsage.inputTokens,
          output: result.tokenUsage.outputTokens,
          cache_creation: result.tokenUsage.cacheCreationTokens,
          cache_read: result.tokenUsage.cacheReadTokens,
          num_turns: result.numTurns,
          thinking_tokens: result.tokenUsage.thinkingTokens
        };
      }
      this.stateChangeCallback(state);  // UI sees "success"

      if (this.shouldLog(interactive)) {
        console.log(`✅ ${loopStageName} (${execution.duration?.toFixed(0) ?? 0}s)`);
      }
    } catch (error) {
      // Non-fatal failure
      execution.status = 'failed';
      execution.endTime = new Date().toISOString();
      execution.duration = (Date.now() - new Date(execution.startTime).getTime()) / 1000;
      execution.error = { message: error instanceof Error ? error.message : String(error) };
      this.stateChangeCallback(state);  // UI sees "failed"

      if (this.shouldLog(interactive)) {
        console.warn(`⚠️  Loop agent error (non-fatal): ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /**
   * Read the pipeline YAML for the loop agent prompt.
   * Tries: metadata.sourcePath → .agent-pipeline/pipelines/{name}.yml → YAML.stringify(config) fallback.
   */
  async readPipelineYaml(
    config: PipelineConfig,
    metadata: PipelineMetadata | undefined,
    executionRepoPath: string
  ): Promise<string> {
    // Try metadata.sourcePath first
    if (metadata?.sourcePath) {
      try {
        return await fs.readFile(metadata.sourcePath, 'utf-8');
      } catch {
        // Fall through
      }
    }

    // Try conventional path
    const conventionalPath = path.join(executionRepoPath, `.agent-pipeline/pipelines/${config.name}.yml`);
    try {
      return await fs.readFile(conventionalPath, 'utf-8');
    } catch {
      // Fall through
    }

    // Fallback: serialize config to YAML
    return YAML.stringify(config);
  }

  /**
   * Build minimal user prompt for loop agent.
   * Contains only pipeline YAML, pending directory, and iteration status.
   */
  buildLoopAgentPrompt(
    config: PipelineConfig,
    loopContext: LoopContext,
    pipelineYaml: string
  ): string {
    return `# Loop Agent Task

## Current Pipeline YAML
\`\`\`yaml
${pipelineYaml}
\`\`\`

## Pending Directory
Write new pipeline YAML files to: \`${loopContext.directories.pending}\`

## Loop Status
Iteration ${loopContext.currentIteration}/${loopContext.maxIterations}
Pipeline: ${config.name}

Decide whether to create a new pipeline YAML file to continue the loop.`;
  }

  /**
   * Injects a loop agent stage into the pipeline config so DAG planner
   * places it in the last execution group. This makes the loop agent
   * visible in the UI as a first-class stage.
   */
  injectLoopStageIntoConfig(
    config: PipelineConfig,
    state: PipelineState
  ): { modifiedConfig: PipelineConfig; loopStageName: string } {
    const loopStageName = this.getUniqueLoopStageName(config, state);

    const loopStage: AgentStageConfig = {
      name: loopStageName,
      agent: '__inline__',
      onFail: 'warn',
      dependsOn: config.agents.map(a => a.name)
    };

    const modifiedConfig: PipelineConfig = {
      ...config,
      agents: [...config.agents, loopStage]
    };

    return { modifiedConfig, loopStageName };
  }

  getUniqueLoopStageName(
    config: PipelineConfig,
    state: PipelineState
  ): string {
    const baseName = 'loop-agent';
    const usedNames = new Set<string>([
      ...config.agents.map((agent) => agent.name),
      ...state.stages.map((stage) => stage.stageName)
    ]);

    if (!usedNames.has(baseName)) {
      return baseName;
    }

    const runIdSuffix = state.runId?.slice(0, 8) ?? 'run';
    let counter = 1;
    let candidate = `${baseName}-${runIdSuffix}`;
    while (usedNames.has(candidate)) {
      candidate = `${baseName}-${runIdSuffix}-${counter}`;
      counter += 1;
    }

    return candidate;
  }

  /**
   * Get default looping config with resolved paths.
   * Uses session-scoped directories under .agent-pipeline/loops/{sessionId}/
   *
   * @param sessionId - Optional session ID for directory scoping. If not provided,
   *                    uses 'default' as a fallback (for backward compatibility).
   */
  getDefaultLoopingConfig(sessionId?: string): ResolvedLoopingConfig {
    const baseDir = sessionId
      ? `.agent-pipeline/loops/${sessionId}`
      : '.agent-pipeline/loops/default';
    return {
      enabled: true,
      maxIterations: 100,
      directories: this.getSessionLoopDirs(this.repoPath, baseDir),
    };
  }

  getSessionLoopDirs(
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

  resolveLoopDirectories(
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

  mapToExecutionDir(
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

  areSameLoopDirs(
    left: ResolvedLoopingConfig['directories'],
    right: ResolvedLoopingConfig['directories']
  ): boolean {
    return left.pending === right.pending &&
      left.running === right.running &&
      left.finished === right.finished &&
      left.failed === right.failed;
  }

  async ensureLoopDirectoriesExist(
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

  async copyLoopDirectories(
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
  async findNextPipelineFile(
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
  async getUniqueFilePath(destDir: string, fileName: string): Promise<string> {
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
  async moveFile(
    sourcePath: string,
    destDir: string,
    fileName: string
  ): Promise<string> {
    const destPath = await this.getUniqueFilePath(destDir, fileName);
    await fs.rename(sourcePath, destPath);
    return destPath;
  }

  /**
   * Records a loop iteration with the correct triggeredNext status
   */
  async recordIteration(
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

  getPipelineName(config: PipelineConfig, metadata?: PipelineMetadata): string {
    return metadata?.sourcePath
      ? path.basename(metadata.sourcePath, '.yml')
      : config.name;
  }
}
