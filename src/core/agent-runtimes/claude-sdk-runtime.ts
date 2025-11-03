// src/core/agent-runtimes/claude-sdk-runtime.ts

import {
  AgentRuntime,
  AgentExecutionRequest,
  AgentExecutionResult,
  AgentRuntimeCapabilities,
  ValidationResult,
  TokenUsage
} from '../types/agent-runtime.js';
import { AgentQueryRunner } from '../agent-query-runner.js';

/**
 * Claude Agent SDK Runtime Implementation
 *
 * Wraps the official Claude Agent SDK (@anthropic-ai/claude-agent-sdk) to provide
 * agent execution via the AgentRuntime interface.
 *
 * This is the default runtime for Agent Pipeline, leveraging the SDK's built-in
 * features like MCP tools, streaming, token tracking, and permission modes.
 */
export class ClaudeSDKRuntime implements AgentRuntime {
  readonly type = 'claude-sdk';
  readonly name = 'Claude Agent SDK';

  private queryRunner: AgentQueryRunner;

  constructor() {
    this.queryRunner = new AgentQueryRunner();
  }

  /**
   * Execute an agent using the Claude Agent SDK
   *
   * @param request - Normalized execution request
   * @returns Normalized execution result with text, extracted data, and token usage
   */
  async execute(request: AgentExecutionRequest): Promise<AgentExecutionResult> {
    const { systemPrompt, userPrompt, options } = request;

    // Execute query using AgentQueryRunner
    const result = await this.queryRunner.runSDKQuery(userPrompt, {
      systemPrompt,
      permissionMode: options.permissionMode,
      model: this.normalizeModel(options.model),
      maxTurns: options.maxTurns,
      maxThinkingTokens: options.maxThinkingTokens,
      onOutputUpdate: options.onOutputUpdate,
      captureTokenUsage: true
    });

    // If no tool call was made, fall back to regex extraction
    let extractedData = result.extractedData;
    if (!extractedData && options.outputKeys && options.outputKeys.length > 0) {
      extractedData = this.extractOutputsRegex(result.textOutput, options.outputKeys);
    }

    // Normalize token usage to standard format
    const tokenUsage = result.tokenUsage
      ? this.normalizeTokenUsage(result.tokenUsage)
      : undefined;

    return {
      textOutput: result.textOutput,
      extractedData,
      tokenUsage,
      numTurns: result.numTurns,
      metadata: {
        runtime: this.type,
        model: options.model
      }
    };
  }

  /**
   * Get capabilities of the Claude SDK runtime
   *
   * @returns Capability information
   */
  getCapabilities(): AgentRuntimeCapabilities {
    return {
      supportsStreaming: true,
      supportsTokenTracking: true,
      supportsMCP: true,
      supportsContextReduction: true,
      availableModels: ['haiku', 'sonnet', 'opus'],
      permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan']
    };
  }

  /**
   * Validate that the SDK runtime is available
   *
   * The SDK is a library dependency, so it's always available.
   *
   * @returns Validation result (always valid)
   */
  async validate(): Promise<ValidationResult> {
    return {
      valid: true,
      errors: [],
      warnings: []
    };
  }

  /**
   * Normalize model name to SDK-compatible format
   *
   * @param model - Model name from options
   * @returns SDK-compatible model name or undefined
   */
  private normalizeModel(model?: string): 'haiku' | 'sonnet' | 'opus' | undefined {
    if (!model) return undefined;

    const lowercased = model.toLowerCase();
    if (lowercased === 'haiku' || lowercased === 'sonnet' || lowercased === 'opus') {
      return lowercased as 'haiku' | 'sonnet' | 'opus';
    }

    return undefined;
  }

  /**
   * Normalize SDK token usage to standard TokenUsage format
   *
   * @param sdkUsage - Token usage from SDK
   * @returns Normalized token usage
   */
  private normalizeTokenUsage(sdkUsage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    thinking_tokens?: number;
  }): TokenUsage {
    return {
      inputTokens: sdkUsage.input_tokens,
      outputTokens: sdkUsage.output_tokens,
      cacheCreationTokens: sdkUsage.cache_creation_input_tokens,
      cacheReadTokens: sdkUsage.cache_read_input_tokens,
      thinkingTokens: sdkUsage.thinking_tokens,
      totalTokens: sdkUsage.input_tokens + sdkUsage.output_tokens
    };
  }

  /**
   * Extract outputs using regex pattern matching (fallback when no MCP tool call)
   *
   * Moved from StageExecutor to centralize extraction logic in the runtime.
   *
   * @param agentOutput - Text output from agent
   * @param outputKeys - Expected output keys to extract
   * @returns Extracted key-value pairs or undefined if none found
   */
  private extractOutputsRegex(
    agentOutput: string,
    outputKeys: string[]
  ): Record<string, unknown> | undefined {
    if (outputKeys.length === 0) return undefined;

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

  /**
   * Escape special regex characters
   *
   * @param string - String to escape
   * @returns Escaped string safe for regex
   */
  private escapeRegex(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
