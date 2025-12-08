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
 * This runtime is used for internal operations (like context reduction) and can be
 * explicitly configured in pipelines. It leverages the SDK's built-in features like
 * MCP tools, streaming, token tracking, and permission modes.
 *
 * Note: The default runtime for pipeline stages is now claude-code-headless.
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

    // Normalize token usage to standard format
    const tokenUsage = result.tokenUsage
      ? this.normalizeTokenUsage(result.tokenUsage)
      : undefined;

    return {
      textOutput: result.textOutput,
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

}
