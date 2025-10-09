// src/core/output-tool-builder.ts

import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

/**
 * Builds MCP tools for capturing stage outputs.
 * Uses a single reusable MCP server with a generic report_outputs tool.
 */
export class OutputToolBuilder {
  private static mcpServer: ReturnType<typeof createSdkMcpServer> | null = null;

  /**
   * Get or create the singleton MCP server with report_outputs tool.
   * The tool accepts any key-value pairs, allowing flexible output reporting.
   */
  static getMcpServer() {
    if (!this.mcpServer) {
      const reportTool = tool(
        'report_outputs',
        'Report stage outputs for the next pipeline stage. Call this tool when you complete your task to pass data to subsequent stages.',
        {
          // Generic key-value structure - accepts any outputs
          outputs: z.record(z.string(), z.unknown()).describe('Stage outputs as key-value pairs')
        },
        async (_args) => {
          // Handler is a no-op since we capture the tool call in the stream
          return {
            content: [{
              type: 'text',
              text: 'Stage outputs recorded successfully. Your outputs will be available to the next pipeline stage.'
            }]
          };
        }
      );

      this.mcpServer = createSdkMcpServer({
        name: 'pipeline-outputs',
        version: '1.0.0',
        tools: [reportTool]
      });
    }

    return this.mcpServer;
  }

  /**
   * Build context instructions for the agent on how to use report_outputs.
   * Includes the expected output keys if configured.
   */
  static buildOutputInstructions(outputKeys?: string[]): string {
    if (!outputKeys || outputKeys.length === 0) {
      return '';
    }

    return `
## Reporting Outputs

When you complete your task, use the \`report_outputs\` tool to pass data to the next pipeline stage.

**Expected outputs:**
${outputKeys.map(key => `- \`${key}\`: Value for ${key}`).join('\n')}

**Example:**
\`\`\`
report_outputs({
  "outputs": {
    ${outputKeys.map(key => `"${key}": <your-value-here>`).join(',\n    ')}
  }
})
\`\`\`

**Important:** Call this tool even if your outputs are empty. Use appropriate data types (numbers, strings, booleans, objects, arrays).
`.trim();
  }
}
