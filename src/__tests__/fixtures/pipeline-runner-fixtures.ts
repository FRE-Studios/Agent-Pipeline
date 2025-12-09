import { PipelineConfig, PipelineState } from '../../config/schema.js';
import { ExecutionGraph } from '../../core/types/execution-graph.js';

// Pipeline configs for pipeline-runner tests

export const gitWorkflowPipelineConfig: PipelineConfig = {
  name: 'git-workflow-test',
  trigger: 'manual',
  settings: {
    autoCommit: true,
    commitPrefix: '[pipeline:{{stage}}]',
    failureStrategy: 'stop',
    preserveWorkingTree: false,
    executionMode: 'parallel',
  },
  git: {
    baseBranch: 'main',
    branchStrategy: 'reusable',
    branchPrefix: 'pipeline',
    pullRequest: {
      autoCreate: true,
      title: 'Test PR',
      body: 'Test PR body',
      draft: false,
    },
  },
  agents: [
    {
      name: 'build',
      agent: '.claude/agents/build.md',
      timeout: 120,
    },
    {
      name: 'test',
      agent: '.claude/agents/test.md',
      timeout: 120,
    },
  ],
};

export const uniqueBranchStrategyConfig: PipelineConfig = {
  ...gitWorkflowPipelineConfig,
  name: 'unique-branch-test',
  git: {
    ...gitWorkflowPipelineConfig.git!,
    branchStrategy: 'unique-per-run',
  },
};

export const notificationPipelineConfig: PipelineConfig = {
  name: 'notification-test',
  trigger: 'manual',
  settings: {
    autoCommit: true,
    commitPrefix: '[pipeline:{{stage}}]',
    failureStrategy: 'stop',
    preserveWorkingTree: false,
  },
  notifications: {
    enabled: true,
    events: ['pipeline.started', 'pipeline.completed', 'pipeline.failed', 'stage.completed', 'stage.failed', 'pr.created'],
    channels: {
      local: {
        enabled: true,
      },
    },
  },
  agents: [
    {
      name: 'task',
      agent: '.claude/agents/task.md',
      timeout: 120,
    },
  ],
};

export const disabledStagesPipelineConfig: PipelineConfig = {
  name: 'disabled-stages-test',
  trigger: 'manual',
  settings: {
    autoCommit: true,
    commitPrefix: '[pipeline:{{stage}}]',
    failureStrategy: 'stop',
    preserveWorkingTree: false,
  },
  agents: [
    {
      name: 'enabled-stage',
      agent: '.claude/agents/enabled.md',
      timeout: 120,
      enabled: true,
    },
    {
      name: 'disabled-stage',
      agent: '.claude/agents/disabled.md',
      timeout: 120,
      enabled: false,
    },
  ],
};

export const failureStrategyWarnConfig: PipelineConfig = {
  name: 'failure-warn-test',
  trigger: 'manual',
  settings: {
    autoCommit: true,
    commitPrefix: '[pipeline:{{stage}}]',
    failureStrategy: 'continue',
    preserveWorkingTree: false,
  },
  agents: [
    {
      name: 'stage-1',
      agent: '.claude/agents/stage1.md',
      timeout: 120,
    },
    {
      name: 'stage-2',
      agent: '.claude/agents/stage2.md',
      timeout: 120,
    },
  ],
};

export const stageFailureOverrideConfig: PipelineConfig = {
  name: 'stage-override-test',
  trigger: 'manual',
  settings: {
    autoCommit: true,
    commitPrefix: '[pipeline:{{stage}}]',
    failureStrategy: 'continue',
    preserveWorkingTree: false,
  },
  agents: [
    {
      name: 'critical-stage',
      agent: '.claude/agents/critical.md',
      timeout: 120,
      onFail: 'stop', // Override global strategy
    },
    {
      name: 'optional-stage',
      agent: '.claude/agents/optional.md',
      timeout: 120,
      onFail: 'warn',
    },
  ],
};

export const sequentialExecutionConfig: PipelineConfig = {
  name: 'sequential-test',
  trigger: 'manual',
  settings: {
    autoCommit: true,
    commitPrefix: '[pipeline:{{stage}}]',
    executionMode: 'sequential',
    failureStrategy: 'stop',
    preserveWorkingTree: false,
  },
  agents: [
    {
      name: 'stage-1',
      agent: '.claude/agents/stage1.md',
      timeout: 120,
    },
    {
      name: 'stage-2',
      agent: '.claude/agents/stage2.md',
      timeout: 120,
    },
    {
      name: 'stage-3',
      agent: '.claude/agents/stage3.md',
      timeout: 120,
    },
  ],
};

// Execution graphs for DAGPlanner mock

export const simpleExecutionGraph: ExecutionGraph = {
  nodes: new Map([
    ['stage-1', {
      stage: {
        name: 'stage-1',
        agent: '.claude/agents/test-agent.md',
        timeout: 120,
      },
      dependencies: [],
      dependents: ['stage-2'],
      level: 0,
    }],
    ['stage-2', {
      stage: {
        name: 'stage-2',
        agent: '.claude/agents/test-agent-2.md',
        timeout: 120,
      },
      dependencies: ['stage-1'],
      dependents: [],
      level: 1,
    }],
  ]),
  adjacencyList: new Map([
    ['stage-1', []],
    ['stage-2', ['stage-1']],
  ]),
  plan: {
    groups: [
      {
        level: 0,
        stages: [{
          name: 'stage-1',
          agent: '.claude/agents/test-agent.md',
          timeout: 120,
        }],
      },
      {
        level: 1,
        stages: [{
          name: 'stage-2',
          agent: '.claude/agents/test-agent-2.md',
          timeout: 120,
        }],
      },
    ],
    totalStages: 2,
    maxParallelism: 1,
    isSequential: true,
  },
  validation: {
    valid: true,
    errors: [],
    warnings: [],
  },
};

export const disabledStagesExecutionGraph: ExecutionGraph = {
  nodes: new Map([
    ['enabled-stage', {
      stage: {
        name: 'enabled-stage',
        agent: '.claude/agents/enabled.md',
        timeout: 120,
        enabled: true,
      },
      dependencies: [],
      dependents: [],
      level: 0,
    }],
    ['disabled-stage', {
      stage: {
        name: 'disabled-stage',
        agent: '.claude/agents/disabled.md',
        timeout: 120,
        enabled: false,
      },
      dependencies: [],
      dependents: [],
      level: 0,
    }],
  ]),
  adjacencyList: new Map([
    ['enabled-stage', []],
    ['disabled-stage', []],
  ]),
  plan: {
    groups: [
      {
        level: 0,
        stages: [
          {
            name: 'enabled-stage',
            agent: '.claude/agents/enabled.md',
            timeout: 120,
            enabled: true,
          },
          {
            name: 'disabled-stage',
            agent: '.claude/agents/disabled.md',
            timeout: 120,
            enabled: false,
          },
        ],
      },
    ],
    totalStages: 2,
    maxParallelism: 2,
    isSequential: false,
  },
  validation: {
    valid: true,
    errors: [],
    warnings: [],
  },
};

export const conditionalStagesExecutionGraph: ExecutionGraph = {
  nodes: new Map([
    ['code-review', {
      stage: {
        name: 'code-review',
        agent: '.claude/agents/reviewer.md',
      },
      dependencies: [],
      dependents: ['auto-fix', 'celebrate'],
      level: 0,
    }],
    ['auto-fix', {
      stage: {
        name: 'auto-fix',
        agent: '.claude/agents/fixer.md',
        dependsOn: ['code-review'],
      },
      dependencies: ['code-review'],
      dependents: [],
      level: 1,
    }],
    ['celebrate', {
      stage: {
        name: 'celebrate',
        agent: '.claude/agents/celebration.md',
        dependsOn: ['code-review'],
      },
      dependencies: ['code-review'],
      dependents: [],
      level: 1,
    }],
  ]),
  adjacencyList: new Map([
    ['code-review', []],
    ['auto-fix', ['code-review']],
    ['celebrate', ['code-review']],
  ]),
  plan: {
    groups: [
      {
        level: 0,
        stages: [{
          name: 'code-review',
          agent: '.claude/agents/reviewer.md',
        }],
      },
      {
        level: 1,
        stages: [
          {
            name: 'auto-fix',
            agent: '.claude/agents/fixer.md',
            dependsOn: ['code-review'],
          },
          {
            name: 'celebrate',
            agent: '.claude/agents/celebration.md',
            dependsOn: ['code-review'],
          },
        ],
      },
    ],
    totalStages: 3,
    maxParallelism: 2,
    isSequential: false,
  },
  validation: {
    valid: true,
    errors: [],
    warnings: [],
  },
};

export const parallelExecutionGraph: ExecutionGraph = {
  nodes: new Map([
    ['review', {
      stage: {
        name: 'review',
        agent: '.claude/agents/reviewer.md',
      },
      dependencies: [],
      dependents: ['summary'],
      level: 0,
    }],
    ['security', {
      stage: {
        name: 'security',
        agent: '.claude/agents/security.md',
      },
      dependencies: [],
      dependents: ['summary'],
      level: 0,
    }],
    ['quality', {
      stage: {
        name: 'quality',
        agent: '.claude/agents/quality.md',
      },
      dependencies: [],
      dependents: ['summary'],
      level: 0,
    }],
    ['summary', {
      stage: {
        name: 'summary',
        agent: '.claude/agents/summary.md',
        dependsOn: ['review', 'security', 'quality'],
      },
      dependencies: ['review', 'security', 'quality'],
      dependents: [],
      level: 1,
    }],
  ]),
  adjacencyList: new Map([
    ['review', []],
    ['security', []],
    ['quality', []],
    ['summary', ['review', 'security', 'quality']],
  ]),
  plan: {
    groups: [
      {
        level: 0,
        stages: [
          {
            name: 'review',
            agent: '.claude/agents/reviewer.md',
          },
          {
            name: 'security',
            agent: '.claude/agents/security.md',
          },
          {
            name: 'quality',
            agent: '.claude/agents/quality.md',
          },
        ],
      },
      {
        level: 1,
        stages: [{
          name: 'summary',
          agent: '.claude/agents/summary.md',
          dependsOn: ['review', 'security', 'quality'],
        }],
      },
    ],
    totalStages: 4,
    maxParallelism: 3,
    isSequential: false,
  },
  validation: {
    valid: true,
    errors: [],
    warnings: [],
  },
};

// Pipeline states for pipeline-runner tests

export const pipelineStateWithPR: PipelineState = {
  runId: 'test-run-with-pr',
  pipelineConfig: gitWorkflowPipelineConfig,
  trigger: {
    type: 'manual',
    commitSha: 'initial-commit-sha',
    timestamp: '2024-01-01T00:00:00.000Z',
  },
  stages: [
    {
      stageName: 'build',
      status: 'success',
      startTime: '2024-01-01T00:00:00.000Z',
      endTime: '2024-01-01T00:01:00.000Z',
      duration: 60,
      commitSha: 'build-commit',
    },
    {
      stageName: 'test',
      status: 'success',
      startTime: '2024-01-01T00:01:00.000Z',
      endTime: '2024-01-01T00:02:00.000Z',
      duration: 60,
      commitSha: 'test-commit',
    },
  ],
  status: 'completed',
  artifacts: {
    handoverDir: '.agent-pipeline/handover/test-run-git-workflow',
    initialCommit: 'initial-commit-sha',
    finalCommit: 'test-commit',
    changedFiles: ['file1.ts', 'file2.ts'],
    totalDuration: 120,
    pullRequest: {
      url: 'https://github.com/test/repo/pull/123',
      number: 123,
      branch: 'pipeline/git-workflow-test',
    },
  },
};

export const failedPipelineState: PipelineState = {
  runId: 'test-run-failed',
  pipelineConfig: failureStrategyWarnConfig,
  trigger: {
    type: 'manual',
    commitSha: 'initial-commit-sha',
    timestamp: '2024-01-01T00:00:00.000Z',
  },
  stages: [
    {
      stageName: 'stage-1',
      status: 'success',
      startTime: '2024-01-01T00:00:00.000Z',
      endTime: '2024-01-01T00:01:00.000Z',
      duration: 60,
      commitSha: 'stage-1-commit',
    },
    {
      stageName: 'stage-2',
      status: 'failed',
      startTime: '2024-01-01T00:01:00.000Z',
      endTime: '2024-01-01T00:02:00.000Z',
      duration: 60,
      error: {
        message: 'Stage 2 failed',
        suggestion: 'Check stage configuration',
      },
    },
  ],
  status: 'failed',
  artifacts: {
    handoverDir: '.agent-pipeline/handover/test-run-failed',
    initialCommit: 'initial-commit-sha',
    finalCommit: 'stage-1-commit',
    changedFiles: ['file1.ts'],
    totalDuration: 120,
  },
};

export const partialSuccessPipelineState: PipelineState = {
  runId: 'test-run-partial',
  pipelineConfig: failureStrategyWarnConfig,
  trigger: {
    type: 'manual',
    commitSha: 'initial-commit-sha',
    timestamp: '2024-01-01T00:00:00.000Z',
  },
  stages: [
    {
      stageName: 'stage-1',
      status: 'failed',
      startTime: '2024-01-01T00:00:00.000Z',
      endTime: '2024-01-01T00:01:00.000Z',
      duration: 60,
      error: {
        message: 'Stage 1 failed but continuing',
      },
    },
    {
      stageName: 'stage-2',
      status: 'success',
      startTime: '2024-01-01T00:01:00.000Z',
      endTime: '2024-01-01T00:02:00.000Z',
      duration: 60,
      commitSha: 'stage-2-commit',
    },
  ],
  status: 'completed',
  artifacts: {
    handoverDir: '.agent-pipeline/handover/test-run-partial',
    initialCommit: 'initial-commit-sha',
    finalCommit: 'stage-2-commit',
    changedFiles: ['file1.ts', 'file2.ts'],
    totalDuration: 120,
  },
};

export const skippedStagesPipelineState: PipelineState = {
  runId: 'test-run-skipped',
  pipelineConfig: disabledStagesPipelineConfig,
  trigger: {
    type: 'manual',
    commitSha: 'initial-commit-sha',
    timestamp: '2024-01-01T00:00:00.000Z',
  },
  stages: [
    {
      stageName: 'enabled-stage',
      status: 'success',
      startTime: '2024-01-01T00:00:00.000Z',
      endTime: '2024-01-01T00:01:00.000Z',
      duration: 60,
      commitSha: 'enabled-stage-commit',
    },
    {
      stageName: 'disabled-stage',
      status: 'skipped',
      startTime: '2024-01-01T00:01:00.000Z',
    },
  ],
  status: 'completed',
  artifacts: {
    handoverDir: '.agent-pipeline/handover/test-run-skipped',
    initialCommit: 'initial-commit-sha',
    finalCommit: 'enabled-stage-commit',
    changedFiles: ['file1.ts'],
    totalDuration: 60,
  },
};
