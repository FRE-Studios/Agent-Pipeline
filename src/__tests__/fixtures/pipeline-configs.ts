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
    },
    {
      name: 'security',
      agent: '.claude/agents/security.md',
    },
    {
      name: 'quality',
      agent: '.claude/agents/quality.md',
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
    },
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

// Phase 7.3: Multi-Runtime Integration Test Fixtures

export const sdkOnlyPipelineConfig: PipelineConfig = {
  name: 'sdk-only-test',
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
      name: 'sdk-stage-1',
      agent: '.claude/agents/stage1.md',
      timeout: 60,
    },
    {
      name: 'sdk-stage-2',
      agent: '.claude/agents/stage2.md',
      timeout: 60,
      dependsOn: ['sdk-stage-1'],
    },
    {
      name: 'sdk-stage-3',
      agent: '.claude/agents/stage3.md',
      timeout: 60,
      dependsOn: ['sdk-stage-2'],
    },
  ],
};

export const headlessOnlyPipelineConfig: PipelineConfig = {
  name: 'headless-only-test',
  trigger: 'manual',
  runtime: {
    type: 'claude-code-headless',
  },
  settings: {
    autoCommit: true,
    commitPrefix: '[pipeline:{{stage}}]',
    failureStrategy: 'stop',
    preserveWorkingTree: false,
  },
  agents: [
    {
      name: 'headless-stage-1',
      agent: '.claude/agents/stage1.md',
      timeout: 60,
    },
    {
      name: 'headless-stage-2',
      agent: '.claude/agents/stage2.md',
      timeout: 60,
      dependsOn: ['headless-stage-1'],
    },
    {
      name: 'headless-stage-3',
      agent: '.claude/agents/stage3.md',
      timeout: 60,
      dependsOn: ['headless-stage-2'],
    },
  ],
};

export const mixedRuntimePipelineConfig: PipelineConfig = {
  name: 'mixed-runtime-test',
  trigger: 'manual',
  runtime: {
    type: 'claude-code-headless', // Global default
  },
  settings: {
    autoCommit: true,
    commitPrefix: '[pipeline:{{stage}}]',
    failureStrategy: 'stop',
    preserveWorkingTree: false,
  },
  agents: [
    {
      name: 'mixed-stage-1',
      agent: '.claude/agents/stage1.md',
      timeout: 60,
      runtime: {
        type: 'claude-sdk', // Override to SDK
        options: { model: 'haiku' },
      },
    },
    {
      name: 'mixed-stage-2',
      agent: '.claude/agents/stage2.md',
      timeout: 60,
      dependsOn: ['mixed-stage-1'],
      // Uses global default (headless)
    },
    {
      name: 'mixed-stage-3',
      agent: '.claude/agents/stage3.md',
      timeout: 60,
      dependsOn: ['mixed-stage-2'],
      runtime: {
        type: 'claude-sdk', // Override back to SDK
        options: { model: 'sonnet' },
      },
    },
  ],
};

export const parallelMixedPipelineConfig: PipelineConfig = {
  name: 'parallel-mixed-test',
  trigger: 'manual',
  settings: {
    autoCommit: true,
    commitPrefix: '[pipeline:{{stage}}]',
    executionMode: 'parallel',
    failureStrategy: 'stop',
    preserveWorkingTree: false,
  },
  agents: [
    {
      name: 'initial-stage',
      agent: '.claude/agents/initial.md',
      timeout: 60,
      runtime: {
        type: 'claude-sdk',
      },
    },
    {
      name: 'parallel-sdk',
      agent: '.claude/agents/parallel-sdk.md',
      timeout: 60,
      dependsOn: ['initial-stage'],
      runtime: {
        type: 'claude-sdk',
        options: { model: 'haiku' },
      },
    },
    {
      name: 'parallel-headless',
      agent: '.claude/agents/parallel-headless.md',
      timeout: 60,
      dependsOn: ['initial-stage'],
      runtime: {
        type: 'claude-code-headless',
      },
    },
    {
      name: 'final-stage',
      agent: '.claude/agents/final.md',
      timeout: 60,
      dependsOn: ['parallel-sdk', 'parallel-headless'],
      runtime: {
        type: 'claude-code-headless',
      },
    },
  ],
};
