// src/core/stage-executor.ts

import { query } from '@anthropic-ai/claude-agent-sdk';
import * as fs from 'fs/promises';
import { GitManager } from './git-manager.js';
import { RetryHandler } from './retry-handler.js';
import { OutputToolBuilder } from './output-tool-builder.js';
import { AgentStageConfig, StageExecution, PipelineState } from '../config/schema.js';
import { PipelineFormatter } from '../utils/pipeline-formatter.js';
import { ErrorFactory } from '../utils/error-factory.js';

export class StageExecutor {
  private retryHandler: RetryHandler;

  constructor(
    private gitManager: GitManager,
    private dryRun: boolean = false
  ) {
    this.retryHandler = new RetryHandler();
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
      const agentContext = this.buildAgentContext(stageConfig, pipelineState);

      // Load agent system prompt
      const systemPrompt = await fs.readFile(stageConfig.agent, 'utf-8');

      // Run agent using SDK query
      const retryInfo = PipelineFormatter.formatRetryInfo(execution.retryAttempt, execution.maxRetries);
      console.log(`🤖 Running stage: ${stageConfig.name}${retryInfo}...`);

      const result = await this.runAgentWithTimeout(
        agentContext,
        systemPrompt,
        stageConfig.timeout,
        stageConfig.outputs,
        onOutputUpdate
      );

      execution.agentOutput = result.textOutput;
      execution.extractedData = result.extractedData;

      // Auto-commit if enabled
      const shouldCommit = (stageConfig.autoCommit ?? true) && !this.dryRun;
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

  private buildAgentContext(
    stageConfig: AgentStageConfig,
    pipelineState: PipelineState
  ): string {
    const previousStages = pipelineState.stages
      .filter(s => s.status === 'success')
      .map(s => ({
        name: s.stageName,
        output: s.extractedData || {},
        commit: s.commitSha
      }));

    const outputInstructions = OutputToolBuilder.buildOutputInstructions(stageConfig.outputs);

    return `
# Pipeline Context

**Pipeline Run ID:** ${pipelineState.runId}
**Current Stage:** ${stageConfig.name}
**Trigger Commit:** ${pipelineState.trigger.commitSha}

## Previous Stages
${previousStages.map(s => `
### ${s.name}
- Commit: ${s.commit}
- Output: ${JSON.stringify(s.output, null, 2)}
`).join('\n')}

## Changed Files
${pipelineState.artifacts.changedFiles.join('\n')}

## Your Task
${JSON.stringify(stageConfig.inputs || {}, null, 2)}

${outputInstructions ? `\n${outputInstructions}\n` : ''}

---

Please analyze the current repository state and make any necessary changes.
When done, describe what you changed and why.
    `.trim();
  }

  private async runAgentWithTimeout(
    userPrompt: string,
    systemPrompt: string,
    timeoutSeconds?: number,
    outputKeys?: string[],
    onOutputUpdate?: (output: string) => void
  ): Promise<{ textOutput: string; extractedData?: Record<string, unknown> }> {
    const timeout = (timeoutSeconds || 300) * 1000; // Default 5 minutes

    const runQuery = async () => {
      // Get MCP server with report_outputs tool
      const mcpServer = OutputToolBuilder.getMcpServer();

      const q = query({
        prompt: userPrompt,
        options: {
          systemPrompt,
          settingSources: ['project'],
          mcpServers: {
            'pipeline-outputs': mcpServer
          }
        }
      });

      // Collect assistant messages and tool calls
      let textOutput = '';
      let toolExtractedData: Record<string, unknown> | undefined;

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
        }
      }

      // If no tool call was made, fall back to regex extraction
      let extractedData = toolExtractedData;
      if (!extractedData && outputKeys && outputKeys.length > 0) {
        extractedData = this.extractOutputs(textOutput, outputKeys);
      }

      return { textOutput, extractedData };
    };

    return Promise.race([
      runQuery(),
      new Promise<{ textOutput: string; extractedData?: Record<string, unknown> }>((_, reject) =>
        setTimeout(() => reject(new Error('Agent timeout')), timeout)
      )
    ]);
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
