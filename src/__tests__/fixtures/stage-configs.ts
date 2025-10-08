import { AgentStageConfig } from '../../config/schema.js';

export const basicStageConfig: AgentStageConfig = {
  name: 'test-stage',
  agent: '.claude/agents/test-agent.md',
  timeout: 120,
};

export const stageWithOutputs: AgentStageConfig = {
  name: 'stage-with-outputs',
  agent: '.claude/agents/analyzer.md',
  outputs: ['issues_found', 'severity', 'score'],
  timeout: 180,
};

export const stageWithRetry: AgentStageConfig = {
  name: 'stage-with-retry',
  agent: '.claude/agents/flaky.md',
  retry: {
    maxAttempts: 3,
    backoff: 'exponential',
    initialDelay: 1000,
    maxDelay: 30000,
  },
  timeout: 120,
};

export const stageWithCustomCommit: AgentStageConfig = {
  name: 'custom-commit-stage',
  agent: '.claude/agents/worker.md',
  commitMessage: 'Custom commit message',
  timeout: 120,
};

export const stageWithAutoCommitDisabled: AgentStageConfig = {
  name: 'no-commit-stage',
  agent: '.claude/agents/worker.md',
  autoCommit: false,
  timeout: 120,
};

export const stageWithInputs: AgentStageConfig = {
  name: 'stage-with-inputs',
  agent: '.claude/agents/processor.md',
  inputs: {
    targetFile: 'src/main.ts',
    maxIssues: '10',
    strictMode: 'true',
  },
  timeout: 120,
};

export const stageWithLongTimeout: AgentStageConfig = {
  name: 'long-running-stage',
  agent: '.claude/agents/complex.md',
  timeout: 600, // 10 minutes
};

export const stageWithCondition: AgentStageConfig = {
  name: 'conditional-stage',
  agent: '.claude/agents/conditional.md',
  condition: '{{ stages.previous.outputs.issues_found > 0 }}',
  dependsOn: ['previous'],
  timeout: 120,
};
