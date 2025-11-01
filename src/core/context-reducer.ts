// src/core/context-reducer.ts

import { query, type SettingSource } from '@anthropic-ai/claude-agent-sdk';
import * as fs from 'fs/promises';
import { GitManager } from './git-manager.js';
import { OutputToolBuilder } from './output-tool-builder.js';
import { PipelineState, AgentStageConfig, StageExecution, ContextReductionConfig } from '../config/schema.js';

export class ContextReducer {
  constructor(
    _gitManager: GitManager,
    private repoPath: string,
    _runId: string
  ) {}

  /**
   * Check if context reduction is needed based on token count
   */
  shouldReduce(tokenCount: number, config: ContextReductionConfig): boolean {
    const threshold = config.triggerThreshold || config.maxTokens * 0.9;
    return tokenCount >= threshold;
  }

  /**
   * Run context reduction agent to create intelligent summary
   */
  async runReduction(
    pipelineState: PipelineState,
    upcomingStage: AgentStageConfig,
    reducerAgentPath: string
  ): Promise<StageExecution> {
    const execution: StageExecution = {
      stageName: '__context_reducer__',
      status: 'running',
      startTime: new Date().toISOString(),
      retryAttempt: 0,
      maxRetries: 0
    };

    try {
      // Build context for reducer agent
      const reducerContext = await this.buildReducerContext(
        pipelineState,
        upcomingStage
      );

      // Load reducer agent system prompt
      const systemPrompt = await fs.readFile(reducerAgentPath, 'utf-8');

      // Run reducer agent
      console.log(`🤖 Running context-reducer agent...`);

      const result = await this.runReducerAgent(
        reducerContext,
        systemPrompt,
        pipelineState.pipelineConfig.settings?.permissionMode || 'acceptEdits'
      );

      execution.agentOutput = result.textOutput;
      execution.extractedData = result.extractedData;
      execution.status = 'success';
      execution.endTime = new Date().toISOString();

      // Calculate duration
      if (execution.endTime) {
        const start = new Date(execution.startTime).getTime();
        const end = new Date(execution.endTime).getTime();
        const elapsedSeconds = (end - start) / 1000;
        execution.duration = elapsedSeconds > 0 ? elapsedSeconds : 0.001;
      }

      console.log(`✅ Context reduction completed (${execution.duration?.toFixed(1)}s)`);

      return execution;

    } catch (error) {
      execution.status = 'failed';
      execution.endTime = new Date().toISOString();

      const errorMsg = error instanceof Error ? error.message : String(error);
      execution.error = {
        message: errorMsg,
        timestamp: new Date().toISOString(),
        suggestion: 'Context reduction failed. Continuing with full context.'
      };

      console.error(`❌ Context reducer failed: ${errorMsg}`);
      console.log(`   Continuing with full context...`);

      return execution;
    }
  }

  /**
   * Apply context reduction by replacing older stages with summary
   */
  applyReduction(
    pipelineState: PipelineState,
    reducerOutput: StageExecution
  ): PipelineState {
    // If reduction failed, return original state
    if (reducerOutput.status === 'failed') {
      return pipelineState;
    }

    // Keep recent stages (last 2-3) in full, replace older with summary
    const contextWindow = pipelineState.pipelineConfig.settings?.contextReduction?.contextWindow || 3;
    const recentStages = pipelineState.stages.slice(-contextWindow);

    // Create reduced state with summary replacing older stages
    const reducedState: PipelineState = {
      ...pipelineState,
      stages: [
        // Insert reducer pseudo-stage to mark reduction point
        reducerOutput,
        // Keep recent stages
        ...recentStages
      ]
    };

    return reducedState;
  }

  /**
   * Build context for reducer agent including upcoming agent info
   */
  private async buildReducerContext(
    pipelineState: PipelineState,
    upcomingStage: AgentStageConfig
  ): Promise<string> {
    // Read upcoming agent's file to understand its needs
    let upcomingAgentContent = '';
    try {
      const agentPath = this.resolveAgentPath(upcomingStage.agent);
      upcomingAgentContent = await fs.readFile(agentPath, 'utf-8');
    } catch (error) {
      console.warn(`⚠️  Could not read upcoming agent file: ${upcomingStage.agent}`);
      upcomingAgentContent = 'Agent file not available';
    }

    // Build verbose previous stages context (all outputs)
    const previousStagesContext = pipelineState.stages
      .filter(s => s.status === 'success')
      .map(s => {
        const outputs = s.extractedData
          ? JSON.stringify(s.extractedData, null, 2)
          : 'No outputs';

        return `
### ${s.stageName}
- **Status:** ${s.status}
- **Duration:** ${s.duration?.toFixed(1)}s
- **Commit:** ${s.commitSha || 'No commit'}
- **Outputs:**
\`\`\`json
${outputs}
\`\`\`
- **Agent Response:**
${s.agentOutput || 'No response'}
        `.trim();
      })
      .join('\n\n');

    // Build full context for reducer
    const context = `
# Context Reduction Task

## Pipeline Configuration

**Pipeline Name:** ${pipelineState.pipelineConfig.name}
**Run ID:** ${pipelineState.runId}
**Trigger:** ${pipelineState.trigger.type}
**Total Stages Executed:** ${pipelineState.stages.length}

## Upcoming Stage

**Stage Name:** ${upcomingStage.name}
**Agent File:** ${upcomingStage.agent}

### Agent Definition (What the next agent needs):
\`\`\`markdown
${upcomingAgentContent}
\`\`\`

## Previous Stages (Full Verbose Outputs)

${previousStagesContext}

## Your Task

Analyze all previous stage outputs and create a concise summary that:

1. **Preserves ALL information** that the upcoming agent might need (read its definition above)
2. **Keeps critical metrics** - Numbers, severity levels, counts, scores
3. **Preserves important decisions** - What was done, what was found, what was changed
4. **Removes redundant information** - Verbose details, repeated info, implementation specifics
5. **Reduces token count by 70-80%** while maintaining semantic completeness

## Output Instructions

Use the report_outputs tool with this structure:

\`\`\`javascript
report_outputs({
  outputs: {
    summary: "High-level overview of all previous stages (2-3 sentences)",
    critical_findings: [
      "Finding 1 that upcoming agent needs to know",
      "Finding 2 relevant to next stage",
      "Finding 3 with key metrics"
    ],
    metrics: {
      "stage_name": {
        "key_metric": value,
        "another_metric": value
      }
    },
    stage_summaries: {
      "stage-1": "One sentence summary of stage-1",
      "stage-2": "One sentence summary of stage-2"
    }
  }
})
\`\`\`

Focus on what the **upcoming agent needs to know**, not what previous agents did in detail.
    `.trim();

    return context;
  }

  /**
   * Run reducer agent with timeout
   */
  private async runReducerAgent(
    userPrompt: string,
    systemPrompt: string,
    permissionMode: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' = 'acceptEdits'
  ): Promise<{
    textOutput: string;
    extractedData?: Record<string, unknown>;
  }> {
    const timeout = 300000; // 5 minutes

    const runQuery = async () => {
      let mcpServer: ReturnType<typeof OutputToolBuilder.getMcpServer> | undefined;
      try {
        mcpServer = OutputToolBuilder.getMcpServer();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`⚠️  Failed to initialize output tool server: ${message}`);
      }

      type McpServerInstance = ReturnType<typeof OutputToolBuilder.getMcpServer>;

      const options: {
        systemPrompt: string;
        settingSources: SettingSource[];
        permissionMode: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
        mcpServers?: Record<string, McpServerInstance>;
      } = {
        systemPrompt,
        settingSources: ['project'],
        permissionMode
      };

      if (mcpServer) {
        options.mcpServers = {
          'pipeline-outputs': mcpServer
        };
      }

      const q = query({
        prompt: userPrompt,
        options
      });

      let textOutput = '';
      let toolExtractedData: Record<string, unknown> | undefined;

      for await (const message of q) {
        if (message.type === 'assistant') {
          for (const content of message.message.content) {
            if (content.type === 'text') {
              textOutput += content.text;
            } else if (content.type === 'tool_use' && content.name === 'report_outputs') {
              const toolInput = content.input as { outputs?: Record<string, unknown> };
              if (toolInput.outputs) {
                toolExtractedData = toolInput.outputs;
              }
            }
          }
        }
      }

      return { textOutput, extractedData: toolExtractedData };
    };

    return Promise.race([
      runQuery(),
      new Promise<{ textOutput: string; extractedData?: Record<string, unknown> }>(
        (_, reject) => setTimeout(() => reject(new Error('Context reducer timeout')), timeout)
      )
    ]);
  }

  /**
   * Resolve agent file path (handle relative paths)
   */
  private resolveAgentPath(agentPath: string): string {
    if (agentPath.startsWith('/')) {
      return agentPath;
    }
    return `${this.repoPath}/${agentPath}`;
  }
}
