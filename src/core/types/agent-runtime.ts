// src/core/types/agent-runtime.ts

import { PipelineAbortController } from '../abort-controller.js';

/**
 * Agent Runtime Abstraction Layer
 *
 * This module defines the core interfaces for agent execution abstraction,
 * enabling Agent Pipeline to support multiple agent backends (SDK, CLI, API, etc.)
 */

/**
 * Core interface that all agent runtimes must implement.
 * Provides a unified API for executing agents regardless of the underlying implementation.
 */
export interface AgentRuntime {
  /** Unique identifier for this runtime type (e.g., 'claude-sdk', 'claude-code-headless') */
  readonly type: string;

  /** Human-readable name for this runtime */
  readonly name: string;

  /**
   * Execute an agent with the given request and return normalized results.
   *
   * @param request - The execution request containing prompt and options
   * @param abortController - Optional abort controller for cancellation support
   * @returns Promise resolving to normalized execution result
   * @throws Error if execution fails or times out
   * @throws PipelineAbortError if execution is aborted
   */
  execute(request: AgentExecutionRequest, abortController?: PipelineAbortController): Promise<AgentExecutionResult>;

  /**
   * Get runtime capabilities to determine what features are supported.
   *
   * @returns Capability information for this runtime
   */
  getCapabilities(): AgentRuntimeCapabilities;

  /**
   * Validate that this runtime is available and properly configured.
   * Used during pipeline initialization to detect missing dependencies.
   *
   * @returns Promise resolving to validation result with errors/warnings
   */
  validate(): Promise<ValidationResult>;
}

/**
 * Request object for agent execution.
 * Contains all information needed to run an agent.
 */
export interface AgentExecutionRequest {
  /** System prompt defining agent behavior and instructions */
  systemPrompt: string;

  /** User prompt containing the task or question */
  userPrompt: string;

  /** Execution options and configuration */
  options: AgentExecutionOptions;
}

/**
 * Options for agent execution.
 * Combines common options with runtime-specific settings.
 */
export interface AgentExecutionOptions {
  // Common options (supported by all runtimes)

  /** Timeout in seconds (optional, runtime may have defaults) */
  timeout?: number;

  /** Expected output keys for structured data extraction */
  outputKeys?: string[];

  /** Permission mode for tool usage */
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';

  // Model and performance options

  /** Model selection (runtime-specific values like 'haiku', 'sonnet', 'opus') */
  model?: string;

  /** Maximum conversation turns to prevent infinite loops */
  maxTurns?: number;

  /** Maximum thinking tokens for extended reasoning models */
  maxThinkingTokens?: number;

  // Callbacks

  /** Optional callback for streaming output updates */
  onOutputUpdate?: (output: string) => void;

  // Runtime-specific options

  /**
   * Runtime-specific configuration options.
   * Passed through to the runtime implementation without validation.
   */
  runtimeOptions?: Record<string, unknown>;
}

/**
 * Normalized result from agent execution.
 * All runtimes must return this structure.
 */
export interface AgentExecutionResult {
  /** Text output from the agent */
  textOutput: string;

  /** Structured data extracted from agent output (via tool calls or parsing) */
  extractedData?: Record<string, unknown>;

  /** Token usage statistics (if supported by runtime) */
  tokenUsage?: TokenUsage;

  /** Number of conversation turns (if supported by runtime) */
  numTurns?: number;

  /** Additional runtime-specific metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Normalized token usage statistics.
 * Provides consistent interface across runtimes with different token tracking.
 */
export interface TokenUsage {
  /** Input tokens consumed */
  inputTokens: number;

  /** Output tokens generated */
  outputTokens: number;

  /** Tokens used for cache creation (if applicable) */
  cacheCreationTokens?: number;

  /** Tokens read from cache (if applicable) */
  cacheReadTokens?: number;

  /** Tokens used for extended thinking (if applicable) */
  thinkingTokens?: number;

  /** Total tokens (input + output, for convenience) */
  totalTokens: number;
}

/**
 * Runtime capability information.
 * Describes what features this runtime supports.
 */
export interface AgentRuntimeCapabilities {
  /** Whether runtime supports streaming output updates */
  supportsStreaming: boolean;

  /** Whether runtime provides token usage statistics */
  supportsTokenTracking: boolean;

  /** Whether runtime supports MCP (Model Context Protocol) tools */
  supportsMCP: boolean;

  /** Whether runtime supports context reduction (some may use session continuation instead) */
  supportsContextReduction: boolean;

  /** Available models for this runtime */
  availableModels: string[];

  /** Supported permission modes */
  permissionModes: string[];
}

/**
 * Result of runtime validation.
 * Contains errors, warnings, and overall validity status.
 */
export interface ValidationResult {
  /** Whether runtime is valid and can be used */
  valid: boolean;

  /** Critical errors that prevent runtime usage */
  errors: string[];

  /** Non-critical warnings (runtime can still be used) */
  warnings: string[];
}
