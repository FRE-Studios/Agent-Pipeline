import { PipelineConfig } from '../../config/schema.js';

export const simplePipelineConfig: PipelineConfig = {
  name: 'simple-test',
  trigger: 'manual',
  runtime: {
    type: 'claude-sdk',
  },
  settings: {
    autoCommit: true,
    commitPrefix: '[pipeline:{{stage}}]',
    failureStrategy: 'stop',
    preserveWorkingTree: false,
  },
  agents: [
    {
      name: 'stage-1',
      agent: '.claude/agents/test-agent.md',
      timeout: 120,
    },
    {
      name: 'stage-2',
      agent: '.claude/agents/test-agent-2.md',
      timeout: 120,
    },
  ],
};

export const parallelPipelineConfig: PipelineConfig = {
  name: 'parallel-test',
  trigger: 'manual',
  runtime: {
    type: 'claude-sdk',
  },
  settings: {
    autoCommit: true,
    commitPrefix: '[pipeline:{{stage}}]',
    executionMode: 'parallel',
    failureStrategy: 'stop',
    preserveWorkingTree: false,
  },
  agents: [
    {
      name: 'review',
      agent: '.claude/agents/reviewer.md',
      outputs: ['issues_found', 'severity'],
    },
    {
      name: 'security',
      agent: '.claude/agents/security.md',
      outputs: ['vulnerabilities'],
    },
    {
      name: 'quality',
      agent: '.claude/agents/quality.md',
      outputs: ['score'],
    },
    {
      name: 'summary',
      agent: '.claude/agents/summary.md',
      dependsOn: ['review', 'security', 'quality'],
    },
  ],
};

export const conditionalPipelineConfig: PipelineConfig = {
  name: 'conditional-test',
  trigger: 'manual',
  runtime: {
    type: 'claude-sdk',
  },
  settings: {
    autoCommit: true,
    commitPrefix: '[pipeline:{{stage}}]',
    executionMode: 'parallel',
    failureStrategy: 'stop',
    preserveWorkingTree: false,
  },
  agents: [
    {
      name: 'code-review',
      agent: '.claude/agents/reviewer.md',
      outputs: ['issues_found', 'severity'],
    },
    {
      name: 'auto-fix',
      agent: '.claude/agents/fixer.md',
      dependsOn: ['code-review'],
      condition: '{{ stages.code-review.outputs.issues_found > 0 }}',
    },
    {
      name: 'celebrate',
      agent: '.claude/agents/celebration.md',
      dependsOn: ['code-review'],
      condition: '{{ stages.code-review.outputs.issues_found == 0 }}',
    },
  ],
};

export const retryPipelineConfig: PipelineConfig = {
  name: 'retry-test',
  trigger: 'manual',
  runtime: {
    type: 'claude-sdk',
  },
  settings: {
    autoCommit: true,
    commitPrefix: '[pipeline:{{stage}}]',
    failureStrategy: 'stop',
    preserveWorkingTree: false,
  },
  agents: [
    {
      name: 'flaky-stage',
      agent: '.claude/agents/flaky.md',
      retry: {
        maxAttempts: 3,
        backoff: 'exponential',
        initialDelay: 1000,
        maxDelay: 30000,
      },
    },
  ],
};

export const invalidPipelineConfig = {
  name: '',
  trigger: 'invalid-trigger',
  agents: [],
} as unknown as PipelineConfig;

export const cyclicDependencyConfig: PipelineConfig = {
  name: 'cyclic-test',
  trigger: 'manual',
  runtime: {
    type: 'claude-sdk',
  },
  agents: [
    {
      name: 'stage-a',
      agent: '.claude/agents/a.md',
      dependsOn: ['stage-c'],
    },
    {
      name: 'stage-b',
      agent: '.claude/agents/b.md',
      dependsOn: ['stage-a'],
    },
    {
      name: 'stage-c',
      agent: '.claude/agents/c.md',
      dependsOn: ['stage-b'],
    },
  ],
};

export const duplicateNamesConfig: PipelineConfig = {
  name: 'duplicate-test',
  trigger: 'manual',
  runtime: {
    type: 'claude-sdk',
  },
  agents: [
    {
      name: 'duplicate',
      agent: '.claude/agents/a.md',
    },
    {
      name: 'duplicate',
      agent: '.claude/agents/b.md',
    },
  ],
};

export const missingDependencyConfig: PipelineConfig = {
  name: 'missing-dep-test',
  trigger: 'manual',
  runtime: {
    type: 'claude-sdk',
  },
  agents: [
    {
      name: 'stage-a',
      agent: '.claude/agents/a.md',
      dependsOn: ['non-existent-stage'],
    },
  ],
};

export const gitWorkflowConfig: PipelineConfig = {
  name: 'git-workflow-test',
  trigger: 'manual',
  runtime: {
    type: 'claude-sdk',
  },
  settings: {
    autoCommit: true,
    commitPrefix: '[pipeline:{{stage}}]',
    executionMode: 'parallel',
    failureStrategy: 'stop',
    preserveWorkingTree: false,
  },
  git: {
    baseBranch: 'main',
    branchStrategy: 'reusable',
    branchPrefix: 'pipeline',
    pullRequest: {
      autoCreate: true,
      title: '🤖 Pipeline: {{pipelineName}}',
      body: 'Automated changes',
      reviewers: ['reviewer1', 'reviewer2'],
      labels: ['automated', 'code-review'],
      draft: false,
    },
  },
  agents: [
    {
      name: 'review',
      agent: '.claude/agents/reviewer.md',
    },
    {
      name: 'fix',
      agent: '.claude/agents/fixer.md',
      dependsOn: ['review'],
    },
  ],
};

export const notificationConfig: PipelineConfig = {
  name: 'notification-test',
  trigger: 'manual',
  runtime: {
    type: 'claude-sdk',
  },
  settings: {
    autoCommit: true,
    commitPrefix: '[pipeline:{{stage}}]',
    failureStrategy: 'stop',
    preserveWorkingTree: false,
  },
  notifications: {
    enabled: true,
    events: ['pipeline.started', 'pipeline.completed', 'pipeline.failed', 'pr.created'],
    channels: {
      local: {
        enabled: true,
        sound: true,
        openUrl: true,
      },
      slack: {
        enabled: true,
        webhookUrl: 'https://hooks.slack.com/services/TEST/WEBHOOK/URL',
        channel: '#notifications',
        mentionOnFailure: ['channel'],
      },
    },
  },
  agents: [
    {
      name: 'test-stage',
      agent: '.claude/agents/test.md',
    },
  ],
};
