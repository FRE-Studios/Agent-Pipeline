// src/config/schema.ts

import { NotificationConfig } from '../notifications/types.js';

/**
 * Permission mode for agent execution
 * - default: Prompts for permission based on .claude/settings.json rules
 * - acceptEdits: Auto-accepts file edits (Write, Edit tools) while respecting allow/deny rules
 * - bypassPermissions: Bypasses all permission checks (use with caution)
 * - plan: Read-only mode, no actual execution
 *
 * @default 'acceptEdits' - Optimized for automated workflows
 */
export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';

/**
 * Claude Agent SDK model types
 */
export type ClaudeModelName = 'haiku' | 'sonnet' | 'opus';

/**
 * Claude Agent SDK specific settings (optional)
 * If omitted, the SDK uses its own defaults
 */
export interface ClaudeAgentSettings {
  model?: ClaudeModelName;        // Model selection for cost/performance optimization
  maxTurns?: number;              // Maximum conversation turns (prevents runaway agents)
  maxThinkingTokens?: number;     // Extended thinking budget for complex reasoning
}

/**
 * Runtime configuration for agent execution
 * Supports multiple runtime types: 'claude-sdk', 'claude-code-headless', etc.
 */
export interface RuntimeConfig {
  type: string;                   // Runtime type identifier (e.g., 'claude-sdk', 'claude-code-headless')
  options?: Record<string, unknown>; // Runtime-specific options (model, maxTurns, etc.)
}

export interface LoopingConfig {
  enabled: boolean;
  maxIterations?: number;  // Default: 100
  directories: {
    pending: string;    // Absolute paths
    running: string;
    finished: string;
    failed: string;
  };
}

export interface PipelineMetadata {
  sourcePath: string;              // Absolute path to YAML file
  sourceType: 'library' | 'loop-pending';
  loadedAt: string;                // ISO timestamp
}

export interface LoopContext {
  enabled: boolean;
  directories: LoopingConfig['directories'];
  currentIteration?: number;
  maxIterations?: number;
}

export interface GitConfig {
  baseBranch?: string;                    // Branch to PR into (default: 'main')
  branchStrategy?: 'reusable' | 'unique-per-run'; // Branch naming strategy (default: 'reusable')
  branchPrefix?: string;                  // Custom branch prefix (default: 'pipeline')
  pullRequest?: PRConfig;                 // Pull request configuration
}

export interface PRConfig {
  autoCreate?: boolean;                   // Auto-create PR when pipeline completes
  title?: string;                         // Custom PR title (has smart default)
  body?: string;                          // Custom PR body (has smart default with stage summary)
  reviewers?: string[];                   // GitHub usernames to request review from
  labels?: string[];                      // Labels to apply to PR
  draft?: boolean;                        // Create as draft PR
  assignees?: string[];                   // Assign to specific users
  milestone?: string;                     // Add to milestone
  web?: boolean;                          // Open in browser for interactive editing
}

export interface PipelineConfig {
  name: string;
  trigger: 'pre-commit' | 'post-commit' | 'pre-push' | 'post-merge' | 'manual';

  // Git workflow settings (optional)
  git?: GitConfig;

  // Notification settings (optional)
  notifications?: NotificationConfig;

  // Runtime configuration (optional, defaults to claude-code-headless)
  runtime?: RuntimeConfig;

  // Global settings
  settings?: {
    autoCommit: boolean;              // Auto-commit agent changes
    commitPrefix: string;              // e.g., "[pipeline:stage-name]"
    failureStrategy: 'stop' | 'continue'; // Default failure handling
    preserveWorkingTree: boolean;      // Stash/restore uncommitted changes
    executionMode?: 'sequential' | 'parallel'; // Execution strategy (default: parallel with DAG)
    permissionMode?: PermissionMode;   // Permission mode for agents (default: 'acceptEdits')
    saveVerboseOutputs?: boolean;      // Save pipeline summaries to .agent-pipeline/outputs/ (default: true)
    handover?: {
      directory?: string;             // Handover directory (default: {pipeline-name}-{runId}/)
    };
  };

  agents: AgentStageConfig[];
}

export interface RetryConfig {
  maxAttempts: number;                 // Max retry attempts (default: 3)
  backoff: 'exponential' | 'linear' | 'fixed'; // Backoff strategy
  initialDelay?: number;               // Initial delay in ms (default: 1000)
  maxDelay?: number;                   // Max delay in ms (default: 30000)
}

export interface AgentStageConfig {
  name: string;                        // Stage identifier
  agent: string;                       // Path to agent file (e.g. .agent-pipeline/agents/xyz.md)

  // Runtime configuration (per-stage override)
  runtime?: RuntimeConfig;             // Override pipeline-level runtime for this stage

  // Stage-specific behavior
  enabled?: boolean;                   // Skip if false
  onFail?: 'stop' | 'continue' | 'warn';
  timeout?: number;                    // Max execution time (seconds). Default: 900 (15 min). Warnings at 5, 10, 13 min.

  // Dependencies
  dependsOn?: string[];                // Stage names this stage depends on

  // Retry behavior
  retry?: RetryConfig;                 // Retry configuration

  // Commit control
  autoCommit?: boolean;                // Override global setting
  commitMessage?: string;              // Custom commit message template

  // Context passing
  inputs?: Record<string, string>;     // Additional context for agent
}

export interface PipelineState {
  runId: string;
  pipelineConfig: PipelineConfig;
  trigger: {
    type: 'pre-commit' | 'post-commit' | 'pre-push' | 'post-merge' | 'manual';
    commitSha: string;                 // Commit that triggered pipeline
    timestamp: string;
  };

  stages: StageExecution[];

  status: 'running' | 'completed' | 'failed' | 'partial';

  artifacts: {
    handoverDir: string;                  // Path to handover directory
    initialCommit: string;
    finalCommit?: string;
    changedFiles: string[];
    totalDuration: number;
    pullRequest?: {                       // Pull request info (if created)
      url: string;
      number: number;
      branch: string;
    };
  };

  // Loop context (for UI/observability when running in loop mode)
  loopContext?: {
    enabled: boolean;
    currentIteration: number;           // 1-indexed
    maxIterations: number;
    loopSessionId: string;              // UUID (generated in Part F)
    pipelineSource: 'library' | 'loop-pending';
    terminationReason?: 'natural' | 'limit-reached' | 'failure';
  };
}

export interface StageExecution {
  stageName: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';

  startTime: string;
  endTime?: string;
  duration?: number;

  commitSha?: string;                  // Commit created by this stage
  commitMessage?: string;

  agentOutput?: string;                // Raw agent response
  toolActivity?: string[];             // Rolling tool activity log (max 3 recent items)

  // Token usage tracking
  tokenUsage?: {
    estimated_input: number;           // Estimated input tokens (from TokenEstimator)
    actual_input: number;              // Actual input tokens (from SDK)
    output: number;                    // Output tokens (from SDK)
    cache_creation?: number;           // Cache creation tokens (from SDK)
    cache_read?: number;               // Cache read tokens (from SDK)
    num_turns?: number;                // Actual conversation turns used (from SDK)
    thinking_tokens?: number;          // Extended thinking tokens used (from SDK, if available)
  };

  // Retry tracking
  retryAttempt?: number;               // Current retry attempt (0 = first try)
  maxRetries?: number;                 // Max retry attempts configured

  error?: {
    message: string;
    stack?: string;
    agentPath?: string;
    timestamp?: string;
    suggestion?: string;
  };
}
