// src/core/stage-executor.ts

import { query } from '@anthropic-ai/claude-agent-sdk';
import * as fs from 'fs/promises';
import { GitManager } from './git-manager.js';
import { RetryHandler } from './retry-handler.js';
import { OutputToolBuilder } from './output-tool-builder.js';
import { OutputStorageManager } from './output-storage-manager.js';
import { AgentStageConfig, StageExecution, PipelineState, LoopContext } from '../config/schema.js';
import { PipelineFormatter } from '../utils/pipeline-formatter.js';
import { ErrorFactory } from '../utils/error-factory.js';
import { TokenEstimator } from '../utils/token-estimator.js';

export class StageExecutor {
  private retryHandler: RetryHandler;
  private outputStorageManager: OutputStorageManager;

  constructor(
    private gitManager: GitManager,
    private dryRun: boolean = false,
    runId: string,
    repoPath: string,
    private loopContext?: LoopContext
  ) {
    this.retryHandler = new RetryHandler();
    this.outputStorageManager = new OutputStorageManager(repoPath, runId);
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
    const stageSettings = stageConfig.claudeAgent;
    const globalSettings = pipelineState.pipelineConfig.settings?.claudeAgent;

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

    // Define the core execution logic
    const executeAttempt = async (): Promise<void> => {
      // Build context for agent
      const agentContext = await this.buildAgentContext(stageConfig, pipelineState);

      // Load agent system prompt
      const systemPrompt = await fs.readFile(stageConfig.agent, 'utf-8');

      // Estimate input tokens before execution
      const tokenEstimator = new TokenEstimator();
      const estimatedTokens = tokenEstimator.estimateTokens(agentContext + systemPrompt);
      tokenEstimator.dispose();

      // Build Claude Agent SDK options (model, maxTurns, maxThinkingTokens)
      const claudeAgentOptions = this.buildClaudeAgentOptions(stageConfig, pipelineState);

      // Run agent using SDK query
      const retryInfo = PipelineFormatter.formatRetryInfo(execution.retryAttempt, execution.maxRetries);
      console.log(`🤖 Running stage: ${stageConfig.name}${retryInfo}...`);
      console.log(`   Estimated input: ~${PipelineFormatter.formatTokenCount(estimatedTokens)} tokens`);

      const result = await this.runAgentWithTimeout(
        agentContext,
        systemPrompt,
        stageConfig.timeout,
        stageConfig.outputs,
        pipelineState.pipelineConfig.settings?.permissionMode || 'acceptEdits',
        claudeAgentOptions,
        onOutputUpdate
      );

      execution.agentOutput = result.textOutput;
      execution.extractedData = result.extractedData;

      // Store token usage
      if (result.tokenUsage) {
        execution.tokenUsage = {
          estimated_input: estimatedTokens,
          actual_input: result.tokenUsage.input_tokens,
          output: result.tokenUsage.output_tokens,
          cache_creation: result.tokenUsage.cache_creation_input_tokens,
          cache_read: result.tokenUsage.cache_read_input_tokens,
          num_turns: result.numTurns,
          thinking_tokens: result.tokenUsage.thinking_tokens
        };
      }

      // Validate outputs
      const contextReductionConfig = pipelineState.pipelineConfig.settings?.contextReduction;
      const requireSummary = contextReductionConfig?.requireSummary ?? true;

      if (execution.extractedData) {
        // Warn if summary is missing when required
        if (requireSummary && !execution.extractedData.summary) {
          console.warn(
            `⚠️  Stage '${stageConfig.name}' did not provide 'summary' field. ` +
            `Context reduction may be less effective for downstream stages.`
          );
        }

        // Warn if expected outputs are missing
        if (stageConfig.outputs && stageConfig.outputs.length > 0) {
          const missing = stageConfig.outputs.filter(key => !(key in execution.extractedData!));
          if (missing.length > 0) {
            console.warn(
              `⚠️  Stage '${stageConfig.name}' did not provide expected outputs: ${missing.join(', ')}`
            );
          }
        }
      } else if (stageConfig.outputs && stageConfig.outputs.length > 0) {
        // Agent didn't call report_outputs and regex extraction also failed
        console.warn(
          `⚠️  Stage '${stageConfig.name}' did not call report_outputs tool. ` +
          `Expected outputs: ${stageConfig.outputs.join(', ')}`
        );
      }

      // Save outputs to files (if enabled)
      if (pipelineState.pipelineConfig.settings?.contextReduction?.saveVerboseOutputs !== false) {
        const outputFiles = await this.outputStorageManager.saveStageOutputs(
          stageConfig.name,
          execution.extractedData,
          execution.agentOutput || ''
        );
        execution.outputFiles = outputFiles;
      }

      // Auto-commit if enabled
      const globalAutoCommit = pipelineState.pipelineConfig.settings?.autoCommit;
      const stageAutoCommit = stageConfig.autoCommit ?? globalAutoCommit ?? true;
      const shouldCommit = stageAutoCommit && !this.dryRun;
      if (shouldCommit) {
        const commitSha = await this.gitManager.createPipelineCommit(
          stageConfig.name,
          pipelineState.runId,
          stageConfig.commitMessage
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
    // Load config with sensible defaults
    const config = pipelineState.pipelineConfig.settings?.contextReduction || {
      enabled: true,
      maxTokens: 50000,
      strategy: 'summary-based' as const,
      contextWindow: 3,
      requireSummary: true,
      saveVerboseOutputs: true,
      compressFileList: true
    };

    // Filter successful previous stages
    const previousStages = pipelineState.stages.filter(s => s.status === 'success');

    // Apply context window
    const contextWindow = config.contextWindow || 3;
    const recentStages = previousStages.slice(-contextWindow);
    const olderStages = previousStages.slice(0, -contextWindow);

    // Build recent stages context (summaries + key metrics)
    const recentStagesContext = this.buildRecentStagesContext(recentStages, pipelineState.runId);

    // Build older stages summary (file references only)
    const olderStagesContext = this.buildOlderStagesContext(olderStages, pipelineState.runId);

    // Handle changed files (compressed or full)
    const changedFilesContext = config.compressFileList
      ? this.buildCompressedFilesContext(pipelineState)
      : this.buildFullFilesContext(pipelineState);

    // Build output instructions
    const outputInstructions = OutputToolBuilder.buildOutputInstructions(stageConfig.outputs);

    // Build loop context section if enabled
    const loopContextSection = this.buildLoopContextSection();

    // Construct full context
    const context = `
# Pipeline Context

**Pipeline Run ID:** ${pipelineState.runId}
**Current Stage:** ${stageConfig.name}
**Trigger Commit:** ${pipelineState.trigger.commitSha}

${recentStagesContext}

${olderStagesContext}

${changedFilesContext}

${loopContextSection}

## Your Task
${JSON.stringify(stageConfig.inputs || {}, null, 2)}

${outputInstructions ? `\n${outputInstructions}\n` : ''}

---
**Note:** Use the Read tool to access full outputs if you need detailed information.
    `.trim();

    // Check token count and warn if needed
    if (config.enabled) {
      await this.checkContextTokens(context, config);
    }

    return context;
  }

  private buildRecentStagesContext(
    recentStages: import('../config/schema.js').StageExecution[],
    _runId: string
  ): string {
    if (recentStages.length === 0) return '';

    const stageContexts = recentStages.map(s => {
      // Extract summary (if exists)
      const summary = s.extractedData?.summary
        ? String(s.extractedData.summary)
        : 'No summary provided';

      // Extract key metrics (all outputs except summary)
      const keyMetrics = Object.entries(s.extractedData || {})
        .filter(([key]) => key !== 'summary')
        .map(([key, value]) => `${key}=${value}`)
        .join(', ');

      // Build file reference (if saved)
      const fileReference = s.outputFiles?.structured
        ? `- **Full Output:** ${s.outputFiles.structured}`
        : '';

      return `
### ${s.stageName}
- **Summary:** ${summary}
${keyMetrics ? `- **Key Metrics:** ${keyMetrics}` : ''}
- **Commit:** ${s.commitSha || 'No commit'}
${fileReference}
      `.trim();
    }).join('\n\n');

    return `## Previous Stages (Last ${recentStages.length} in context window)\n\n${stageContexts}`;
  }

  private buildOlderStagesContext(
    olderStages: import('../config/schema.js').StageExecution[],
    runId: string
  ): string {
    if (olderStages.length === 0) return '';

    const stageNames = olderStages.map(s => s.stageName).join(', ');
    return `## Earlier Stages\nStages ${stageNames} completed. Full history: .agent-pipeline/outputs/${runId}/pipeline-summary.json\n`;
  }

  private buildCompressedFilesContext(pipelineState: PipelineState): string {
    const compressed = this.outputStorageManager.compressFileList(
      pipelineState.artifacts.changedFiles
    );

    return `## Changed Files Summary
${compressed}
Full list: .agent-pipeline/outputs/${pipelineState.runId}/changed-files.txt`;
  }

  private buildFullFilesContext(pipelineState: PipelineState): string {
    const files = pipelineState.artifacts.changedFiles.join('\n');
    return `## Changed Files\n${files}`;
  }

  private buildLoopContextSection(): string {
    if (!this.loopContext?.enabled) {
      return '';
    }

    return `
## Pipeline Looping

This pipeline is running in LOOP MODE. After completion, the orchestrator will check for the next pipeline to run.

**To queue the next pipeline:**
- Write a valid pipeline YAML file to: \`${this.loopContext.directories.pending}\`
- The file will be automatically picked up and executed after this pipeline completes
- Use the same format as regular pipeline definitions in \`.agent-pipeline/pipelines/\`

**Current loop status:**
- Iteration: ${this.loopContext.currentIteration}/${this.loopContext.maxIterations}
- Pending directory: \`${this.loopContext.directories.pending}\`

**Note:** Only create a next pipeline if your analysis determines follow-up work is needed.
`.trim();
  }

  private async checkContextTokens(
    context: string,
    config: { enabled: boolean; maxTokens: number }
  ): Promise<void> {
    const tokenEstimator = new TokenEstimator();
    const { tokens, method } = await tokenEstimator.smartCount(context, config.maxTokens);
    tokenEstimator.dispose();

    const percentage = (tokens / config.maxTokens) * 100;

    if (tokens > config.maxTokens) {
      console.warn(
        `⚠️  Context size (${PipelineFormatter.formatTokenCount(tokens)} tokens, ${percentage.toFixed(0)}%) ` +
        `exceeds limit (${PipelineFormatter.formatTokenCount(config.maxTokens)}). ` +
        `Consider reducing contextWindow or using agent-based reduction.`
      );
    } else if (tokens > config.maxTokens * 0.8) {
      console.log(
        `ℹ️  Context size: ${PipelineFormatter.formatTokenCount(tokens)} tokens ` +
        `(${method}, ${percentage.toFixed(0)}% of limit, approaching threshold)`
      );
    }
  }

  private async runAgentWithTimeout(
    userPrompt: string,
    systemPrompt: string,
    timeoutSeconds?: number,
    outputKeys?: string[],
    permissionMode: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' = 'acceptEdits',
    claudeAgentOptions?: Partial<{
      model: 'haiku' | 'sonnet' | 'opus';
      maxTurns: number;
      maxThinkingTokens: number;
    }>,
    onOutputUpdate?: (output: string) => void
  ): Promise<{
    textOutput: string;
    extractedData?: Record<string, unknown>;
    tokenUsage?: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
      thinking_tokens?: number;
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

      // Get MCP server with report_outputs tool
      const mcpServer = OutputToolBuilder.getMcpServer();

      const q = query({
        prompt: userPrompt,
        options: {
          systemPrompt,
          settingSources: ['project'],
          permissionMode,
          // Only include Claude Agent SDK options if explicitly configured
          ...(claudeAgentOptions?.model && { model: claudeAgentOptions.model }),
          ...(claudeAgentOptions?.maxTurns !== undefined && { maxTurns: claudeAgentOptions.maxTurns }),
          ...(claudeAgentOptions?.maxThinkingTokens !== undefined && { maxThinkingTokens: claudeAgentOptions.maxThinkingTokens }),
          mcpServers: {
            'pipeline-outputs': mcpServer
          }
        }
      });

      // Collect assistant messages, tool calls, and token usage
      let textOutput = '';
      let toolExtractedData: Record<string, unknown> | undefined;
      let tokenUsage: {
        input_tokens: number;
        output_tokens: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
        thinking_tokens?: number;
      } | undefined;
      let numTurns: number | undefined;

      for await (const message of q) {
        if (message.type === 'assistant') {
          // Extract both text and tool calls from assistant message content
          for (const content of message.message.content) {
            if (content.type === 'text') {
              textOutput += content.text;
              // Stream output to callback if provided
              if (onOutputUpdate) {
                onOutputUpdate(textOutput);
              }
            } else if (content.type === 'tool_use' && content.name === 'report_outputs') {
              // Capture tool call arguments as extracted data
              const toolInput = content.input as { outputs?: Record<string, unknown> };
              if (toolInput.outputs) {
                toolExtractedData = toolInput.outputs;
              }
            }
          }
        } else if (message.type === 'result' && message.subtype === 'success') {
          // Capture token usage and turns from SDK result message
          numTurns = message.num_turns;
          tokenUsage = {
            input_tokens: message.usage.input_tokens,
            output_tokens: message.usage.output_tokens,
            cache_creation_input_tokens: message.usage.cache_creation_input_tokens,
            cache_read_input_tokens: message.usage.cache_read_input_tokens,
            // Check if thinking_tokens exists in usage (extended thinking models)
            thinking_tokens: (message.usage as any).thinking_tokens
          };
        }
      }

      // If no tool call was made, fall back to regex extraction
      let extractedData = toolExtractedData;
      if (!extractedData && outputKeys && outputKeys.length > 0) {
        extractedData = this.extractOutputs(textOutput, outputKeys);
      }

      // Clean up warning timers on successful completion
      warningTimers.forEach(timer => clearTimeout(timer));

      return { textOutput, extractedData, tokenUsage, numTurns };
    };

    const timeoutPromise = new Promise<{
      textOutput: string;
      extractedData?: Record<string, unknown>;
      tokenUsage?: {
        input_tokens: number;
        output_tokens: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
        thinking_tokens?: number;
      };
      numTurns?: number;
    }>((_, reject) =>
      setTimeout(() => {
        // Clean up warning timers on timeout
        warningTimers.forEach(timer => clearTimeout(timer));
        reject(new Error('Agent timeout'));
      }, timeout)
    );

    return Promise.race([runQuery(), timeoutPromise]);
  }

  private escapeRegex(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
  }

  private extractOutputs(
    agentOutput: string,
    outputKeys?: string[]
  ): Record<string, unknown> | undefined {
    if (!outputKeys || outputKeys.length === 0) return undefined;

    const extracted: Record<string, unknown> = {};

    for (const key of outputKeys) {
      const escapedKey = this.escapeRegex(key);
      const regex = new RegExp(`${escapedKey}:\\s*(.+)`, 'i');
      const match = agentOutput.match(regex);
      if (match) {
        extracted[key] = match[1].trim();
      }
    }

    return Object.keys(extracted).length > 0 ? extracted : undefined;
  }

  private calculateDuration(execution: StageExecution): number {
    if (!execution.endTime) return 0;
    const start = new Date(execution.startTime).getTime();
    const end = new Date(execution.endTime).getTime();
    return (end - start) / 1000; // seconds
  }
}
