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

  // Global settings
  settings?: {
    autoCommit: boolean;              // Auto-commit agent changes
    commitPrefix: string;              // e.g., "[pipeline:stage-name]"
    failureStrategy: 'stop' | 'continue'; // Default failure handling
    preserveWorkingTree: boolean;      // Stash/restore uncommitted changes
    executionMode?: 'sequential' | 'parallel'; // Execution strategy (default: parallel with DAG)
    contextReduction?: ContextReductionConfig; // Context reduction settings
    permissionMode?: PermissionMode;   // Permission mode for agents (default: 'acceptEdits')
    claudeAgent?: ClaudeAgentSettings; // Claude Agent SDK specific settings (optional)
  };

  agents: AgentStageConfig[];
}

export interface RetryConfig {
  maxAttempts: number;                 // Max retry attempts (default: 3)
  backoff: 'exponential' | 'linear' | 'fixed'; // Backoff strategy
  initialDelay?: number;               // Initial delay in ms (default: 1000)
  maxDelay?: number;                   // Max delay in ms (default: 30000)
}

export interface ContextReductionConfig {
  enabled: boolean;                    // Enable context reduction (default: true)
  maxTokens: number;                   // Max context tokens (default: 50000)
  strategy: 'summary-based' | 'agent-based'; // Reduction strategy (default: 'summary-based')

  // Summary-based strategy options
  contextWindow?: number;              // Number of recent stages to include in full (default: 3)
  requireSummary?: boolean;            // Require summary field from agents (default: true)
  saveVerboseOutputs?: boolean;        // Save full outputs to files (default: true)
  compressFileList?: boolean;          // Compress changed files list (default: true)

  // Agent-based strategy options
  agentPath?: string;                  // Path to context reducer agent
  triggerThreshold?: number;           // Token count to trigger reduction (default: 45000)
}

export interface AgentStageConfig {
  name: string;                        // Stage identifier
  agent: string;                       // Path to .claude/agents/xyz.md

  // Stage-specific behavior
  enabled?: boolean;                   // Skip if false
  onFail?: 'stop' | 'continue' | 'warn';
  timeout?: number;                    // Max execution time (seconds)

  // Dependencies and conditions
  dependsOn?: string[];                // Stage names this stage depends on
  condition?: string;                  // Template expression (e.g., "{{ stages.code-review.outputs.issues > 0 }}")

  // Retry behavior
  retry?: RetryConfig;                 // Retry configuration

  // Commit control
  autoCommit?: boolean;                // Override global setting
  commitMessage?: string;              // Custom commit message template

  // Context passing
  inputs?: Record<string, string>;     // Additional context for agent
  outputs?: string[];                  // Keys to extract from agent response

  // Claude Agent SDK settings (per-stage overrides)
  claudeAgent?: ClaudeAgentSettings;   // Override global Claude SDK settings for this stage
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
  extractedData?: Record<string, any>; // Parsed outputs

  // Output file paths (for context reduction)
  outputFiles?: {
    structured: string;                // Path: .agent-pipeline/outputs/{runId}/{stage}-output.json
    raw: string;                       // Path: .agent-pipeline/outputs/{runId}/{stage}-raw.md
  };

  // Token usage tracking
  tokenUsage?: {
    estimated_input: number;           // Estimated input tokens (from TokenEstimator)
    actual_input: number;              // Actual input tokens (from SDK)
    output: number;                    // Output tokens (from SDK)
    cache_creation?: number;           // Cache creation tokens (from SDK)
    cache_read?: number;               // Cache read tokens (from SDK)
  };

  // Retry tracking
  retryAttempt?: number;               // Current retry attempt (0 = first try)
  maxRetries?: number;                 // Max retry attempts configured

  // Conditional execution
  conditionEvaluated?: boolean;        // Was a condition evaluated?
  conditionResult?: boolean;           // Result of condition evaluation

  error?: {
    message: string;
    stack?: string;
    agentPath?: string;
    timestamp?: string;
    suggestion?: string;
  };
}
