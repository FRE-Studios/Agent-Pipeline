// src/core/stage-executor.ts

import * as fs from 'fs/promises';
import { GitManager } from './git-manager.js';
import { RetryHandler } from './retry-handler.js';
import { HandoverManager } from './handover-manager.js';
import { AgentRuntime, AgentExecutionRequest } from './types/agent-runtime.js';
import { AgentRuntimeRegistry } from './agent-runtime-registry.js';
import { AgentStageConfig, StageExecution, PipelineState, LoopContext, ClaudeAgentSettings } from '../config/schema.js';
import { PipelineFormatter } from '../utils/pipeline-formatter.js';
import { ErrorFactory } from '../utils/error-factory.js';
import { TokenEstimator } from '../utils/token-estimator.js';
import { InstructionLoader, InstructionContext } from './instruction-loader.js';

export class StageExecutor {
  private retryHandler: RetryHandler;
  private instructionLoader: InstructionLoader | null;

  constructor(
    private gitManager: GitManager,
    private dryRun: boolean,
    private handoverManager: HandoverManager,
    private defaultRuntime?: AgentRuntime,
    private loopContext?: LoopContext,
    repoPath?: string
  ) {
    this.retryHandler = new RetryHandler();
    this.instructionLoader = repoPath ? new InstructionLoader(repoPath) : null;
  }

  /**
   * Build Claude Agent SDK options by merging per-stage and global settings.
   * Only includes properties that are explicitly configured.
   * Returns empty object if no settings configured (trusts SDK defaults).
   */
  private buildClaudeAgentOptions(
    stageConfig: AgentStageConfig,
    pipelineState: PipelineState
  ): Partial<{
    model: 'haiku' | 'sonnet' | 'opus';
    maxTurns: number;
    maxThinkingTokens: number;
  }> {
    const stageSettings = stageConfig.runtime?.options as Partial<ClaudeAgentSettings> | undefined;
    const globalSettings = pipelineState.pipelineConfig.runtime?.options as Partial<ClaudeAgentSettings> | undefined;

    const options: Partial<{
      model: 'haiku' | 'sonnet' | 'opus';
      maxTurns: number;
      maxThinkingTokens: number;
    }> = {};

    // Only add properties if explicitly configured (per-stage overrides global)
    const model = stageSettings?.model || globalSettings?.model;
    if (model) options.model = model;

    const maxTurns = stageSettings?.maxTurns ?? globalSettings?.maxTurns;
    if (maxTurns !== undefined) options.maxTurns = maxTurns;

    const maxThinkingTokens = stageSettings?.maxThinkingTokens ?? globalSettings?.maxThinkingTokens;
    if (maxThinkingTokens !== undefined) options.maxThinkingTokens = maxThinkingTokens;

    return options;
  }

  /**
   * Resolve runtime for a stage based on priority:
   * 1. Stage-level runtime config (highest priority)
   * 2. Pipeline-level runtime config
   * 3. Default runtime (if provided via constructor)
   * 4. Global default: claude-code-headless
   *
   * @param stageConfig - Configuration for the current stage
   * @param pipelineState - Current pipeline state with pipeline-level config
   * @returns Resolved AgentRuntime instance
   * @throws Error if runtime type is invalid or unavailable
   */
  private resolveStageRuntime(
    stageConfig: AgentStageConfig,
    pipelineState: PipelineState
  ): AgentRuntime {
    try {
      // Priority 1: Stage-level runtime
      const stageRuntimeType = stageConfig.runtime?.type;
      if (stageRuntimeType) {
        console.log(`   Using stage-level runtime: ${stageRuntimeType}`);
        return AgentRuntimeRegistry.getRuntime(stageRuntimeType);
      }

      // Priority 2: Pipeline-level runtime
      const pipelineRuntimeType = pipelineState.pipelineConfig.runtime?.type;
      if (pipelineRuntimeType) {
        console.log(`   Using pipeline-level runtime: ${pipelineRuntimeType}`);
        return AgentRuntimeRegistry.getRuntime(pipelineRuntimeType);
      }

      // Priority 3: Use default runtime if provided (from constructor)
      if (this.defaultRuntime) {
        console.log(`   Using injected default runtime`);
        return this.defaultRuntime;
      }

      // Priority 4: Global default (claude-code-headless)
      console.log(`   Using global default runtime: claude-code-headless`);
      return AgentRuntimeRegistry.getRuntime('claude-code-headless');
    } catch (error) {
      const runtimeType = stageConfig.runtime?.type ||
                          pipelineState.pipelineConfig.runtime?.type ||
                          'claude-code-headless';
      throw new Error(
        `Failed to resolve runtime '${runtimeType}': ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Load system prompt from agent file
   * @param agentPath - Path to the agent prompt file
   * @returns System prompt content
   */
  private async loadSystemPrompt(agentPath: string): Promise<string> {
    try {
      return await fs.readFile(agentPath, 'utf-8');
    } catch (error) {
      throw new Error(
        `Failed to load agent prompt from '${agentPath}': ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Build user prompt with pipeline context
   * @param stageConfig - Current stage configuration
   * @param pipelineState - Current pipeline state
   * @returns User prompt with full context
   */
  private async buildUserPrompt(
    stageConfig: AgentStageConfig,
    pipelineState: PipelineState
  ): Promise<string> {
    return this.buildAgentContext(stageConfig, pipelineState);
  }

  async executeStage(
    stageConfig: AgentStageConfig,
    pipelineState: PipelineState,
    onOutputUpdate?: (output: string) => void
  ): Promise<StageExecution> {
    const execution: StageExecution = {
      stageName: stageConfig.name,
      status: 'running',
      startTime: new Date().toISOString(),
      retryAttempt: 0,
      maxRetries: stageConfig.retry?.maxAttempts || 0
    };

    // Resolve runtime for this stage (stage → pipeline → default)
    const runtime = this.resolveStageRuntime(stageConfig, pipelineState);

    // Define the core execution logic
    const executeAttempt = async (): Promise<void> => {
      // Load agent prompts
      const systemPrompt = await this.loadSystemPrompt(stageConfig.agent);
      const userPrompt = await this.buildUserPrompt(stageConfig, pipelineState);

      // Estimate input tokens before execution
      const tokenEstimator = new TokenEstimator();
      const estimatedTokens = tokenEstimator.estimateTokens(userPrompt + systemPrompt);
      tokenEstimator.dispose();

      // Build Claude Agent SDK options (model, maxTurns, maxThinkingTokens)
      const claudeAgentOptions = this.buildClaudeAgentOptions(stageConfig, pipelineState);

      // Run agent using resolved runtime
      const retryInfo = PipelineFormatter.formatRetryInfo(execution.retryAttempt, execution.maxRetries);
      console.log(`🤖 Running stage: ${stageConfig.name}${retryInfo}...`);
      console.log(`   Estimated initial input: ~${PipelineFormatter.formatTokenCount(estimatedTokens)} tokens`);

      const result = await this.runAgentWithTimeout(
        runtime,
        userPrompt,
        systemPrompt,
        stageConfig.timeout,
        pipelineState.pipelineConfig.settings?.permissionMode || 'acceptEdits',
        claudeAgentOptions,
        onOutputUpdate
      );

      execution.agentOutput = result.textOutput;

      // Store token usage (normalized from runtime)
      if (result.tokenUsage) {
        execution.tokenUsage = {
          estimated_input: estimatedTokens,
          actual_input: result.tokenUsage.inputTokens,
          output: result.tokenUsage.outputTokens,
          cache_creation: result.tokenUsage.cacheCreationTokens,
          cache_read: result.tokenUsage.cacheReadTokens,
          num_turns: result.numTurns,
          thinking_tokens: result.tokenUsage.thinkingTokens
        };
      }

      // Save agent output to handover directory
      await this.handoverManager.saveAgentOutput(
        stageConfig.name,
        execution.agentOutput || ''
      );

      // Auto-commit if enabled
      const globalAutoCommit = pipelineState.pipelineConfig.settings?.autoCommit;
      const stageAutoCommit = stageConfig.autoCommit ?? globalAutoCommit ?? true;
      const shouldCommit = stageAutoCommit && !this.dryRun;
      if (shouldCommit) {
        const commitPrefix = pipelineState.pipelineConfig.settings?.commitPrefix;
        const commitSha = await this.gitManager.createPipelineCommit(
          stageConfig.name,
          pipelineState.runId,
          stageConfig.commitMessage,
          commitPrefix
        );

        if (commitSha) {
          execution.commitSha = commitSha;
          execution.commitMessage = await this.gitManager.getCommitMessage(commitSha);
          console.log(`✅ Committed changes: ${commitSha.substring(0, 7)}`);
        } else {
          console.log(`ℹ️  No changes to commit`);
        }
      } else if (this.dryRun && await this.gitManager.hasUncommittedChanges()) {
        console.log(`💡 Would commit changes (dry-run mode)`);
      }
    };

    try {
      // Execute with retry if configured
      await this.retryHandler.executeWithRetry(
        executeAttempt,
        stageConfig.retry,
        (context) => {
          execution.retryAttempt = context.attemptNumber + 1; // +1 because we're about to do this retry
          const delay = context.delays[context.delays.length - 1];
          const errorMsg = context.lastError instanceof Error
            ? context.lastError.message
            : String(context.lastError);
          console.log(
            `⚠️  Stage failed (attempt ${context.attemptNumber + 1}/${context.maxAttempts}). ` +
              `Retrying in ${RetryHandler.formatDelay(delay)}...`
          );
          console.log(`   Error: ${errorMsg}`);
        }
      );

      execution.status = 'success';
      execution.endTime = new Date().toISOString();
      execution.duration = this.calculateDuration(execution);

      // Append to handover log
      await this.handoverManager.appendToLog(
        stageConfig.name,
        'success',
        execution.duration,
        `Completed ${stageConfig.name}`
      );

      // Log completion with token usage
      console.log(`✅ Stage completed: ${stageConfig.name}`);
      if (execution.tokenUsage) {
        console.log(`   ${PipelineFormatter.formatTokenUsage(execution.tokenUsage)} | Duration: ${execution.duration.toFixed(1)}s`);
      } else {
        console.log(`   Duration: ${execution.duration.toFixed(1)}s`);
      }

      return execution;

    } catch (error) {
      execution.status = 'failed';
      execution.endTime = new Date().toISOString();
      execution.duration = this.calculateDuration(execution);

      const errorDetails = ErrorFactory.createStageError(error, stageConfig.agent);
      execution.error = errorDetails;

      // Pretty print error
      const retryInfo = execution.retryAttempt && execution.retryAttempt > 0
        ? ` (after ${execution.retryAttempt} retries)`
        : '';
      console.error(`❌ Stage failed: ${stageConfig.name}${retryInfo}`);
      console.error(`   Error: ${errorDetails.message}`);
      if (errorDetails.agentPath) {
        console.error(`   Agent: ${errorDetails.agentPath}`);
      }
      if (errorDetails.suggestion) {
        console.error(`   💡 ${errorDetails.suggestion}`);
      }

      return execution;
    }
  }

  private async buildAgentContext(
    stageConfig: AgentStageConfig,
    pipelineState: PipelineState
  ): Promise<string> {
    // Get previous successful stages
    const previousStages = await this.handoverManager.getPreviousStages();

    // Get instructions config from pipeline settings
    const instructionsConfig = pipelineState.pipelineConfig.settings?.instructions;

    // Build handover context message from file (async)
    const handoverContext = await this.handoverManager.buildContextMessageAsync(
      stageConfig.name,
      previousStages,
      instructionsConfig?.handover
    );

    // Build loop context section from file (async, if enabled)
    const loopContextSection = await this.buildLoopContextSectionAsync(
      instructionsConfig?.loop,
      pipelineState.pipelineConfig.name
    );

    // Build inputs section - format as readable key: value pairs
    const inputsSection = stageConfig.inputs && Object.keys(stageConfig.inputs).length > 0
      ? `## User Inputs to Help with Your Task\n${Object.entries(stageConfig.inputs).map(([key, value]) => `- **${key}**: ${value}`).join('\n')}`
      : '';

    // Construct full context
    const context = `
# Pipeline Context

**Pipeline Run ID:** ${pipelineState.runId}
**Current Stage:** ${stageConfig.name}
**Trigger Commit:** ${pipelineState.trigger.commitSha}

${handoverContext}

${loopContextSection}

${inputsSection}
    `.trim();

    return context;
  }

  /**
   * Update loop context dynamically (for per-group context changes)
   */
  updateLoopContext(updates: Partial<LoopContext>): void {
    if (this.loopContext) {
      this.loopContext = { ...this.loopContext, ...updates };
    }
  }

  private async buildLoopContextSectionAsync(customPath?: string, pipelineName?: string): Promise<string> {
    // Only inject loop context if enabled AND in final group
    if (!this.loopContext?.enabled || !this.loopContext?.isFinalGroup) {
      return '';
    }

    // Use InstructionLoader if available, otherwise fall back to hardcoded
    if (this.instructionLoader) {
      const context: InstructionContext = {
        pendingDir: this.loopContext.directories.pending,
        currentIteration: this.loopContext.currentIteration,
        maxIterations: this.loopContext.maxIterations,
        pipelineName
      };
      return this.instructionLoader.loadLoopInstructions(customPath, context);
    }

    // Fallback to hardcoded template (for backwards compatibility)
    const pipelineRef = pipelineName
      ? `Reference: \`.agent-pipeline/pipelines/${pipelineName}.yml\``
      : 'Use same format as `.agent-pipeline/pipelines/`';

    return `
## Pipeline Looping

This pipeline is running in LOOP MODE. You are in the FINAL stage group.

**When to Create a Next Pipeline:**
Create a pipeline in the pending directory ONLY when:
1. You discovered unexpected new work outside your current scope
2. You are finishing a phase in a multi-phase plan and more phases remain
   - Create a pipeline for the NEXT PHASE ONLY (not all remaining phases)

**When NOT to Create a Next Pipeline:**
- Your task is complete with no follow-up needed
- The work is a simple fix that doesn't warrant a new pipeline
- Subsequent work is better handled by a human

**To queue the next pipeline:**
- Write a valid pipeline YAML to: \`${this.loopContext.directories.pending}\`
- Automatically picked up after this pipeline completes
- ${pipelineRef}

**Loop status:** Iteration ${this.loopContext.currentIteration}/${this.loopContext.maxIterations}
`.trim();
  }


  private async runAgentWithTimeout(
    runtime: AgentRuntime,
    userPrompt: string,
    systemPrompt: string,
    timeoutSeconds?: number,
    permissionMode: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' = 'acceptEdits',
    claudeAgentOptions?: Partial<{
      model: 'haiku' | 'sonnet' | 'opus';
      maxTurns: number;
      maxThinkingTokens: number;
    }>,
    onOutputUpdate?: (output: string) => void
  ): Promise<{
    textOutput: string;
    tokenUsage?: {
      inputTokens: number;
      outputTokens: number;
      cacheCreationTokens?: number;
      cacheReadTokens?: number;
      thinkingTokens?: number;
    };
    numTurns?: number;
  }> {
    const timeout = (timeoutSeconds || 900) * 1000; // Default 15 minutes

    // Tiered warning thresholds (non-blocking)
    const warningThresholds = [
      { time: 300 * 1000, label: '5 minutes' },   // 5 minutes
      { time: 600 * 1000, label: '10 minutes' },  // 10 minutes
      { time: 780 * 1000, label: '13 minutes' }   // 13 minutes (final warning)
    ];

    const warningTimers: NodeJS.Timeout[] = [];

    const runQuery = async () => {
      // Set up tiered warning system
      warningThresholds.forEach(({ time, label }) => {
        if (time < timeout) {
          const timer = setTimeout(() => {
            console.warn(`⚠️  Agent still running after ${label}. Hard timeout at ${(timeout / 1000 / 60).toFixed(0)} minutes.`);
          }, time);
          warningTimers.push(timer);
        }
      });

      // Build agent execution request using runtime abstraction
      const request: AgentExecutionRequest = {
        systemPrompt,
        userPrompt,
        options: {
          timeout: timeoutSeconds,
          permissionMode,
          model: claudeAgentOptions?.model,
          maxTurns: claudeAgentOptions?.maxTurns,
          maxThinkingTokens: claudeAgentOptions?.maxThinkingTokens,
          onOutputUpdate
        }
      };

      // Execute using resolved runtime (handles MCP tools and/or CLI execution based on runtime type)
      const result = await runtime.execute(request);

      // Clean up warning timers on successful completion
      warningTimers.forEach(timer => clearTimeout(timer));

      return result;
    };

    const timeoutMinutes = Math.round(timeout / 1000 / 60);
    const timeoutPromise = new Promise<{
      textOutput: string;
      tokenUsage?: {
        inputTokens: number;
        outputTokens: number;
        cacheCreationTokens?: number;
        cacheReadTokens?: number;
        thinkingTokens?: number;
      };
      numTurns?: number;
    }>((_, reject) =>
      setTimeout(() => {
        // Clean up warning timers on timeout
        warningTimers.forEach(timer => clearTimeout(timer));
        reject(new Error(`Agent timeout after ${timeoutMinutes} minutes`));
      }, timeout)
    );

    return Promise.race([runQuery(), timeoutPromise]);
  }

  private calculateDuration(execution: StageExecution): number {
    if (!execution.endTime) return 0;
    const start = new Date(execution.startTime).getTime();
    const end = new Date(execution.endTime).getTime();
    return (end - start) / 1000; // seconds
  }
}
