// src/core/stage-executor.ts

import { query } from '@anthropic-ai/claude-agent-sdk';
import * as fs from 'fs/promises';
import { GitManager } from './git-manager.js';
import { AgentStageConfig, StageExecution, PipelineState } from '../config/schema.js';

export class StageExecutor {
  constructor(
    private gitManager: GitManager
  ) {}

  async executeStage(
    stageConfig: AgentStageConfig,
    pipelineState: PipelineState
  ): Promise<StageExecution> {
    const execution: StageExecution = {
      stageName: stageConfig.name,
      status: 'running',
      startTime: new Date().toISOString()
    };

    try {
      // Build context for agent
      const agentContext = this.buildAgentContext(stageConfig, pipelineState);

      // Load agent system prompt
      const systemPrompt = await fs.readFile(stageConfig.agent, 'utf-8');

      // Run agent using SDK query
      console.log(`🤖 Running stage: ${stageConfig.name}...`);
      const result = await this.runAgentWithTimeout(
        agentContext,
        systemPrompt,
        stageConfig.timeout
      );

      execution.agentOutput = result;
      execution.extractedData = this.extractOutputs(result, stageConfig.outputs);

      // Auto-commit if enabled
      const shouldCommit = stageConfig.autoCommit ?? true;
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
      }

      execution.status = 'success';
      execution.endTime = new Date().toISOString();
      execution.duration = this.calculateDuration(execution);

      return execution;

    } catch (error) {
      execution.status = 'failed';
      execution.endTime = new Date().toISOString();
      execution.duration = this.calculateDuration(execution);
      execution.error = {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      };

      console.error(`❌ Stage failed: ${stageConfig.name}`);
      console.error(execution.error.message);

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

---

Please analyze the current repository state and make any necessary changes.
When done, describe what you changed and why.
    `.trim();
  }

  private async runAgentWithTimeout(
    userPrompt: string,
    systemPrompt: string,
    timeoutSeconds?: number
  ): Promise<string> {
    const timeout = (timeoutSeconds || 300) * 1000; // Default 5 minutes

    const runQuery = async () => {
      const q = query({
        prompt: userPrompt,
        options: {
          systemPrompt,
          settingSources: ['project']
        }
      });

      // Collect all assistant messages from the query
      let output = '';
      for await (const message of q) {
        if (message.type === 'assistant') {
          // Extract text from assistant message content
          for (const content of message.message.content) {
            if (content.type === 'text') {
              output += content.text;
            }
          }
        }
      }
      return output;
    };

    return Promise.race([
      runQuery(),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('Agent timeout')), timeout)
      )
    ]);
  }

  private extractOutputs(
    agentOutput: string,
    outputKeys?: string[]
  ): Record<string, any> | undefined {
    if (!outputKeys || outputKeys.length === 0) return undefined;

    // Simple extraction - look for key-value patterns
    // You can make this more sophisticated with structured output
    const extracted: Record<string, any> = {};

    for (const key of outputKeys) {
      const regex = new RegExp(`${key}:\\s*(.+)`, 'i');
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
