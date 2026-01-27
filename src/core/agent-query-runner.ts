// src/core/agent-query-runner.ts

import { query, type SettingSource } from '@anthropic-ai/claude-agent-sdk';

/**
 * Options for SDK query execution
 */
export interface SDKQueryOptions {
  systemPrompt: string;
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
  model?: 'haiku' | 'sonnet' | 'opus';
  maxTurns?: number;
  maxThinkingTokens?: number;
  onOutputUpdate?: (output: string) => void;
  captureTokenUsage?: boolean;
}

/**
 * Result from SDK query execution
 */
export interface SDKQueryResult {
  textOutput: string;
  tokenUsage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    thinking_tokens?: number;
  };
  numTurns?: number;
}

/**
 * Encapsulates Claude Agent SDK query execution logic.
 * Used by claude-sdk-runtime for internal operations.
 */
export class AgentQueryRunner {
  /**
   * Execute a query using the Claude Agent SDK
   *
   * @param userPrompt - The prompt to send to the agent
   * @param options - Configuration options for the query
   * @returns Query result with text output and optional token usage
   */
  async runSDKQuery(
    userPrompt: string,
    options: SDKQueryOptions
  ): Promise<SDKQueryResult> {
    // Build SDK options
    const sdkOptions: {
      systemPrompt: string;
      settingSources: SettingSource[];
      permissionMode: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
      model?: 'haiku' | 'sonnet' | 'opus';
      maxTurns?: number;
      maxThinkingTokens?: number;
    } = {
      systemPrompt: options.systemPrompt,
      settingSources: ['project'],
      permissionMode: options.permissionMode || 'acceptEdits'
    };

    // Add optional Claude Agent SDK settings
    if (options.model) {
      sdkOptions.model = options.model;
    }
    if (options.maxTurns !== undefined) {
      sdkOptions.maxTurns = options.maxTurns;
    }
    if (options.maxThinkingTokens !== undefined) {
      sdkOptions.maxThinkingTokens = options.maxThinkingTokens;
    }

    // Execute query
    const q = query({
      prompt: userPrompt,
      options: sdkOptions
    });

    // Collect results
    let textOutput = '';
    let tokenUsage: SDKQueryResult['tokenUsage'] | undefined;
    let numTurns: number | undefined;

    // Iterate through messages
    for await (const message of q) {
      if (message.type === 'assistant') {
        // Extract text from assistant message content
        for (const content of message.message.content) {
          if (content.type === 'text') {
            textOutput += content.text;
            // Stream output to callback if provided
            if (options.onOutputUpdate) {
              options.onOutputUpdate(textOutput);
            }
          }
        }
      } else if (options.captureTokenUsage && message.type === 'result' && message.subtype === 'success') {
        // Capture token usage and turns from SDK result message (if requested)
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

    return {
      textOutput,
      tokenUsage,
      numTurns
    };
  }
}
