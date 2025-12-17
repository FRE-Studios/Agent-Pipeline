import { AgentStageConfig } from '../../config/schema.js';

export const basicStageConfig: AgentStageConfig = {
  name: 'test-stage',
  agent: '.agent-pipeline/agents/test-agent.md',
  timeout: 120,
};

export const stageWithOutputs: AgentStageConfig = {
  name: 'stage-with-outputs',
  agent: '.agent-pipeline/agents/analyzer.md',
  timeout: 180,
};

export const stageWithRetry: AgentStageConfig = {
  name: 'stage-with-retry',
  agent: '.agent-pipeline/agents/flaky.md',
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
  agent: '.agent-pipeline/agents/worker.md',
  commitMessage: 'Custom commit message',
  timeout: 120,
};

export const stageWithAutoCommitDisabled: AgentStageConfig = {
  name: 'no-commit-stage',
  agent: '.agent-pipeline/agents/worker.md',
  autoCommit: false,
  timeout: 120,
};

export const stageWithInputs: AgentStageConfig = {
  name: 'stage-with-inputs',
  agent: '.agent-pipeline/agents/processor.md',
  inputs: {
    targetFile: 'src/main.ts',
    maxIssues: '10',
    strictMode: 'true',
  },
  timeout: 120,
};

export const stageWithLongTimeout: AgentStageConfig = {
  name: 'long-running-stage',
  agent: '.agent-pipeline/agents/complex.md',
  timeout: 600, // 10 minutes
};

export const stageWithCondition: AgentStageConfig = {
  name: 'conditional-stage',
  agent: '.agent-pipeline/agents/conditional.md',
  dependsOn: ['previous'],
  timeout: 120,
};

export const stageWithMaxTimeout: AgentStageConfig = {
  name: 'max-timeout-stage',
  agent: '.agent-pipeline/agents/intensive.md',
  timeout: 900, // 15 minutes (default maximum)
};
