// src/config/schema.ts

import { NotificationConfig } from '../notifications/types.js';

// ─── User-facing types (included in generated JSON Schema) ───────────────

/**
 * Top-level pipeline configuration
 *
 * Defines the full specification for an agent pipeline: trigger, stages,
 * git workflow, execution settings, handover, looping, and notifications.
 */
export interface PipelineConfig {
  /** Unique pipeline name used for branch naming, state files, and logging */
  name: string;
  /** Event that starts the pipeline */
  trigger: 'pre-commit' | 'post-commit' | 'pre-push' | 'post-merge' | 'manual';

  /** Git workflow settings — commits, branches, PRs, worktree isolation */
  git?: GitConfig;

  /** Execution settings — controls runtime behavior */
  execution?: ExecutionConfig;

  /** Handover settings — inter-stage communication */
  handover?: HandoverConfig;

  /** Notification settings — desktop and Slack alerts */
  notifications?: NotificationConfig;

  /** Looping settings — enables continuous pipeline execution */
  looping?: LoopingConfig;

  /** Default runtime for all stages (individual stages can override) */
  runtime?: RuntimeConfig;

  /** Ordered list of agent stages to execute */
  agents: AgentStageConfig[];
}

/**
 * Individual agent stage configuration
 *
 * Each stage runs a single agent file with optional dependencies,
 * retry logic, runtime overrides, and context inputs.
 */
export interface AgentStageConfig {
  /**
   * Unique stage identifier.
   * Used for dependsOn references, handover directories, and logging.
   * To reuse an agent, give each instance a different name (e.g., coder-1, coder-2).
   */
  name: string;
  /** Path to the agent markdown file. Can be reused across stages with different names. */
  agent: string;

  /** Override pipeline-level runtime for this stage */
  runtime?: RuntimeConfig;

  /** Set to false to skip this stage (default: true) */
  enabled?: boolean;
  /** Failure handling: stop pipeline, continue to next stage, or warn and continue (default: inherited from execution.failureStrategy) */
  onFail?: 'stop' | 'continue' | 'warn';
  /** Max execution time in seconds (default: 900 / 15 min). Warnings at 5, 10, 13 min. */
  timeout?: number;

  /** Stage names this stage depends on (DAG edges) */
  dependsOn?: string[];

  /** Retry configuration for transient failures */
  retry?: RetryConfig;

  /** Additional key-value context passed to the agent. Supports {{variable}} interpolation. */
  inputs?: Record<string, string>;
}

/**
 * Retry behavior with configurable backoff
 */
export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts: number;
  /** Backoff strategy between retries */
  backoff: 'exponential' | 'linear' | 'fixed';
  /** Initial delay in milliseconds (default: 1000) */
  initialDelay?: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelay?: number;
}

/**
 * Runtime configuration for agent execution
 *
 * Supports multiple runtime types: 'claude-sdk', 'claude-code-headless',
 * 'codex-headless', 'gemini-headless', 'pi-agent-headless', etc.
 */
export interface RuntimeConfig {
  /** Runtime type identifier (e.g., 'claude-sdk', 'claude-code-headless', 'codex-headless') */
  type: string;
  /** Runtime-specific options (model, maxTurns, maxThinkingTokens, etc.) */
  options?: Record<string, unknown>;
}

/**
 * Git workflow — commits, branches, PRs, worktree isolation
 */
export interface GitConfig {
  /** Auto-commit agent changes after each stage (default: true) */
  autoCommit?: boolean;
  /** Commit message prefix. Supports {{stage}} interpolation (e.g., "[pipeline:{{stage}}]") */
  commitPrefix?: string;

  /** Base branch to create pipeline branches from and PR into (default: 'main') */
  baseBranch?: string;
  /** Branch naming strategy (default: 'reusable'). 'reusable' reuses the same branch, 'unique-per-run' creates a new branch per run, 'unique-and-delete' creates and deletes after merge. */
  branchStrategy?: 'reusable' | 'unique-per-run' | 'unique-and-delete';
  /** Custom branch prefix (default: 'pipeline') */
  branchPrefix?: string;
  /** How to handle completed pipeline work (default: 'none') */
  mergeStrategy?: MergeStrategy;
  /** Pull request settings (only used when mergeStrategy is 'pull-request') */
  pullRequest?: PRConfig;

  /** Worktree settings for pipeline isolation */
  worktree?: WorktreeConfig;
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

/**
 * GitHub pull request settings
 */
export interface PRConfig {
  /** Custom PR title. Supports {{variable}} interpolation. Has smart default if omitted. */
  title?: string;
  /** Custom PR body. Supports {{variable}} interpolation. Defaults to a stage summary. */
  body?: string;
  /** GitHub usernames to request review from */
  reviewers?: string[];
  /** Labels to apply to the PR */
  labels?: string[];
  /** Create as draft PR (default: false) */
  draft?: boolean;
  /** GitHub usernames to assign to the PR */
  assignees?: string[];
  /** Milestone name or number to add the PR to */
  milestone?: string;
  /** Open PR in browser for interactive editing (default: false) */
  web?: boolean;
}

/**
 * Worktree configuration for pipeline isolation
 *
 * Pipelines execute in dedicated git worktrees, leaving the user's working directory untouched.
 */
export interface WorktreeConfig {
  /** Override default worktree directory (default: .agent-pipeline/worktrees) */
  directory?: string;
}

/**
 * Execution configuration — controls pipeline runtime behavior
 */
export interface ExecutionConfig {
  /** Execution strategy: sequential runs stages one-by-one, parallel uses DAG-planned concurrency (default: 'parallel') */
  mode?: 'sequential' | 'parallel';
  /** Default failure handling for stages without explicit onFail (default: 'continue') */
  failureStrategy?: 'stop' | 'continue';
  /** Permission mode for agents (default: 'acceptEdits') */
  permissionMode?: PermissionMode;
}

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
 * Handover configuration — inter-stage communication settings
 */
export interface HandoverConfig {
  /**
   * Base handover directory. RunId is always appended for run isolation.
   * Default: .agent-pipeline/runs/{pipeline-name}-{runId}/
   * Custom example: ".my-handover" → ".my-handover/{runId}/"
   */
  directory?: string;
  /** Path to handover instructions template (default: .agent-pipeline/instructions/handover.md) */
  instructions?: string;
}

/**
 * Pipeline looping for iterative execution
 *
 * When enabled, a loop agent evaluates after each full pipeline run
 * and decides whether to queue the next iteration.
 */
export interface LoopingConfig {
  /** Enable looping for this pipeline */
  enabled: boolean;
  /** Maximum number of loop iterations before stopping (default: 100) */
  maxIterations?: number;
  /** Path to loop instructions template (default: .agent-pipeline/instructions/loop.md) */
  instructions?: string;
  /** Custom directories for loop queue management (defaults to .agent-pipeline/loops/{sessionId}/) */
  directories?: {
    /** Directory for pending loop iterations (default: .agent-pipeline/loops/{sessionId}/pending) */
    pending?: string;
    /** Directory for currently running iteration (default: .agent-pipeline/loops/{sessionId}/running) */
    running?: string;
    /** Directory for completed iterations (default: .agent-pipeline/loops/{sessionId}/finished) */
    finished?: string;
    /** Directory for failed iterations (default: .agent-pipeline/loops/{sessionId}/failed) */
    failed?: string;
  };
}

// ─── Internal types (not included in generated JSON Schema) ──────────────

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
