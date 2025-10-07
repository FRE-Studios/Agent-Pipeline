// src/config/schema.ts

export interface PipelineConfig {
  name: string;
  trigger: 'post-commit' | 'manual';

  // Global settings
  settings?: {
    autoCommit: boolean;              // Auto-commit agent changes
    commitPrefix: string;              // e.g., "[pipeline:stage-name]"
    failureStrategy: 'stop' | 'continue'; // Default failure handling
    preserveWorkingTree: boolean;      // Stash/restore uncommitted changes
    executionMode?: 'sequential' | 'parallel'; // Execution strategy (default: parallel with DAG)
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
}

export interface PipelineState {
  runId: string;
  pipelineConfig: PipelineConfig;
  trigger: {
    type: 'post-commit' | 'manual';
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
