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
 * Supports multiple runtime types: 'claude-sdk', 'claude-code-headless', 'codex-headless', etc.
 */
export interface RuntimeConfig {
  type: string;                   // Runtime type identifier (e.g., 'claude-sdk', 'claude-code-headless')
  options?: Record<string, unknown>; // Runtime-specific options (model, maxTurns, etc.)
}

export interface LoopingConfig {
  enabled: boolean;
  maxIterations?: number;  // Default: 100
  instructions?: string;   // Path to loop instructions template (default: .agent-pipeline/instructions/loop.md)
  directories?: {          // Optional - defaults to .agent-pipeline/loops/{sessionId}/
    pending?: string;      // Default: .agent-pipeline/loops/{sessionId}/pending
    running?: string;      // Default: .agent-pipeline/loops/{sessionId}/running
    finished?: string;     // Default: .agent-pipeline/loops/{sessionId}/finished
    failed?: string;       // Default: .agent-pipeline/loops/{sessionId}/failed
  };
}

/**
 * Resolved looping config with all paths as absolute
 * Used internally after pipeline loader processes the config
 */
export interface ResolvedLoopingConfig {
  enabled: boolean;
  maxIterations: number;
  instructions?: string;              // Resolved path to loop instructions template
  directories: {
    pending: string;
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
  directories: ResolvedLoopingConfig['directories'];
  currentIteration?: number;
  maxIterations?: number;
  sessionId?: string;      // Loop session UUID for directory scoping
}

/**
 * Iteration history entry for loop UI tracking
 * Used to display completed iterations while current pipeline runs
 */
export interface IterationHistoryEntry {
  iterationNumber: number;
  pipelineName: string;
  status: 'completed' | 'failed' | 'aborted';
  duration: number;
  commitCount: number;
  stageCount: number;
  successfulStages: number;
  failedStages: number;
  tokenUsage?: {
    totalInput: number;
    totalOutput: number;
    totalCacheRead: number;
  };
}

/**
 * Logging context for controlling output verbosity
 * - interactive: true = Ink UI mode, false = console output
 * - verbose: true = show all details (token stats, cache rates, etc.)
 */
export interface LoggingContext {
  interactive: boolean;
  verbose: boolean;
}

/**
 * Merge strategy for pipeline completion
 * - pull-request: Push branch and create GitHub PR
 * - local-merge: Merge branch to baseBranch locally (no remote interaction)
 * - none: No merge action (work stays in branch/worktree)
 *
 * Note: 'unique-and-delete' branchStrategy cannot be used with 'none' mergeStrategy
 */
export type MergeStrategy = 'pull-request' | 'local-merge' | 'none';

export interface GitConfig {
  // Commit settings (moved from settings:)
  autoCommit?: boolean;                   // Auto-commit agent changes (default: true)
  commitPrefix?: string;                  // Commit message prefix, e.g., "[pipeline:{{stage}}]"

  // Branch workflow
  baseBranch?: string;                    // Branch to PR into (default: 'main')
  branchStrategy?: 'reusable' | 'unique-per-run' | 'unique-and-delete'; // Branch naming strategy (default: 'reusable')
  branchPrefix?: string;                  // Custom branch prefix (default: 'pipeline')
  mergeStrategy?: MergeStrategy;          // How to handle completed pipeline (default: 'none')
  pullRequest?: PRConfig;                 // Pull request settings (only used when mergeStrategy: 'pull-request')

  // Worktree isolation (moved from settings.worktree)
  worktree?: WorktreeConfig;              // Worktree settings for pipeline isolation
}

export interface PRConfig {
  title?: string;                         // Custom PR title (has smart default)
  body?: string;                          // Custom PR body (has smart default with stage summary)
  reviewers?: string[];                   // GitHub usernames to request review from
  labels?: string[];                      // Labels to apply to PR
  draft?: boolean;                        // Create as draft PR
  assignees?: string[];                   // Assign to specific users
  milestone?: string;                     // Add to milestone
  web?: boolean;                          // Open in browser for interactive editing
}

/**
 * Worktree configuration for pipeline isolation
 * Pipelines execute in dedicated git worktrees, leaving user's working directory untouched
 */
export interface WorktreeConfig {
  directory?: string;                     // Override default .agent-pipeline/worktrees
}

/**
 * Execution configuration - controls pipeline runtime behavior
 */
export interface ExecutionConfig {
  mode?: 'sequential' | 'parallel';       // Execution strategy (default: parallel with DAG)
  failureStrategy?: 'stop' | 'continue';  // Default failure handling (default: continue)
  permissionMode?: PermissionMode;        // Permission mode for agents (default: 'acceptEdits')
}

/**
 * Handover configuration - inter-stage communication settings
 */
export interface HandoverConfig {
  directory?: string;                     // Base handover directory. RunId is always appended for run isolation.
                                          // Default: .agent-pipeline/runs/{pipeline-name}-{runId}/
                                          // Custom example: ".my-handover" → ".my-handover/{runId}/"
  instructions?: string;                  // Path to handover instructions template (default: .agent-pipeline/instructions/handover.md)
}

export interface PipelineConfig {
  name: string;
  trigger: 'pre-commit' | 'post-commit' | 'pre-push' | 'post-merge' | 'manual';

  // Git workflow settings (optional) - includes commits, branches, PRs, worktree
  git?: GitConfig;

  // Execution settings (optional) - controls runtime behavior
  execution?: ExecutionConfig;

  // Handover settings (optional) - inter-stage communication
  handover?: HandoverConfig;

  // Notification settings (optional)
  notifications?: NotificationConfig;

  // Looping settings (optional) - enables continuous pipeline execution
  looping?: LoopingConfig;

  // Runtime configuration (optional, defaults to claude-code-headless)
  runtime?: RuntimeConfig;

  // Agent stages
  agents: AgentStageConfig[];
}

export interface RetryConfig {
  maxAttempts: number;                 // Max retry attempts (default: 3)
  backoff: 'exponential' | 'linear' | 'fixed'; // Backoff strategy
  initialDelay?: number;               // Initial delay in ms (default: 1000)
  maxDelay?: number;                   // Max delay in ms (default: 30000)
}

export interface AgentStageConfig {
  name: string;                        // Unique stage identifier. Used for dependsOn, handover dirs, and logging.
                                       // To reuse an agent, use different names (e.g., coder-1, coder-2).
  agent: string;                       // Path to agent file. Can be reused across stages with different names.

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

  status: 'running' | 'completed' | 'failed' | 'partial' | 'aborted';

  artifacts: {
    handoverDir: string;                  // Path to handover directory (worktree path if in worktree mode)
    mainRepoHandoverDir?: string;         // Main repo handover path (set only in worktree mode, for copying)
    loopDir?: string;                     // Loop session dir (worktree path if in worktree mode, only set when looping)
    mainRepoLoopDir?: string;             // Main repo loop dir (set only in worktree mode, for copying after session)
    logPath?: string;                     // Path to pipeline log file (.agent-pipeline/logs/{pipelineName}.log)
    initialCommit: string;
    finalCommit?: string;
    changedFiles: string[];
    totalDuration: number;
    worktreePath?: string;                // Absolute path to execution worktree
    pullRequest?: {                       // Pull request info (if created)
      url: string;
      number: number;
      branch: string;
    };
    prError?: string;                     // PR creation error message (if failed)
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

  // Loop iteration history (for UI display of completed iterations)
  loopIterationHistory?: IterationHistoryEntry[];
}

export interface StageExecution {
  stageName: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';

  startTime: string;
  endTime?: string;
  duration?: number;

  commitSha?: string;                  // Commit created by this stage
  commitMessage?: string;

  agentInput?: string;                 // Full prompt sent to agent (system + user)
  agentOutput?: string;                // Raw agent response
  toolActivity?: string[];             // Rolling tool activity log (max 3 recent items)

  // Token usage tracking
  tokenUsage?: {
    estimated_input: number;           // Estimated initial input tokens (from TokenEstimator)
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
