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
  };

  agents: AgentStageConfig[];
}

export interface AgentStageConfig {
  name: string;                        // Stage identifier
  agent: string;                       // Path to .claude/agents/xyz.md

  // Stage-specific behavior
  enabled?: boolean;                   // Skip if false
  onFail?: 'stop' | 'continue' | 'warn';
  timeout?: number;                    // Max execution time (seconds)

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

  error?: {
    message: string;
    stack?: string;
  };
}
