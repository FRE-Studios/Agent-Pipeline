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
  },
  agents: [
    {
      name: 'stage-1',
      agent: '.agent-pipeline/agents/test-agent.md',
      timeout: 120,
    },
    {
      name: 'stage-2',
      agent: '.agent-pipeline/agents/test-agent-2.md',
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
  },
  agents: [
    {
      name: 'review',
      agent: '.agent-pipeline/agents/reviewer.md',
    },
    {
      name: 'security',
      agent: '.agent-pipeline/agents/security.md',
    },
    {
      name: 'quality',
      agent: '.agent-pipeline/agents/quality.md',
    },
    {
      name: 'summary',
      agent: '.agent-pipeline/agents/summary.md',
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
  },
  agents: [
    {
      name: 'code-review',
      agent: '.agent-pipeline/agents/reviewer.md',
    },
    {
      name: 'auto-fix',
      agent: '.agent-pipeline/agents/fixer.md',
      dependsOn: ['code-review'],
    },
    {
      name: 'celebrate',
      agent: '.agent-pipeline/agents/celebration.md',
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
  },
  agents: [
    {
      name: 'flaky-stage',
      agent: '.agent-pipeline/agents/flaky.md',
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
      agent: '.agent-pipeline/agents/a.md',
      dependsOn: ['stage-c'],
    },
    {
      name: 'stage-b',
      agent: '.agent-pipeline/agents/b.md',
      dependsOn: ['stage-a'],
    },
    {
      name: 'stage-c',
      agent: '.agent-pipeline/agents/c.md',
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
      agent: '.agent-pipeline/agents/a.md',
    },
    {
      name: 'duplicate',
      agent: '.agent-pipeline/agents/b.md',
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
      agent: '.agent-pipeline/agents/a.md',
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
  },
  git: {
    baseBranch: 'main',
    branchStrategy: 'reusable',
    branchPrefix: 'pipeline',
    mergeStrategy: 'pull-request',
    pullRequest: {
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
      agent: '.agent-pipeline/agents/reviewer.md',
    },
    {
      name: 'fix',
      agent: '.agent-pipeline/agents/fixer.md',
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
      agent: '.agent-pipeline/agents/test.md',
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
  },
  agents: [
    {
      name: 'sdk-stage-1',
      agent: '.agent-pipeline/agents/stage1.md',
      timeout: 60,
    },
    {
      name: 'sdk-stage-2',
      agent: '.agent-pipeline/agents/stage2.md',
      timeout: 60,
      dependsOn: ['sdk-stage-1'],
    },
    {
      name: 'sdk-stage-3',
      agent: '.agent-pipeline/agents/stage3.md',
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
  },
  agents: [
    {
      name: 'headless-stage-1',
      agent: '.agent-pipeline/agents/stage1.md',
      timeout: 60,
    },
    {
      name: 'headless-stage-2',
      agent: '.agent-pipeline/agents/stage2.md',
      timeout: 60,
      dependsOn: ['headless-stage-1'],
    },
    {
      name: 'headless-stage-3',
      agent: '.agent-pipeline/agents/stage3.md',
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
  },
  agents: [
    {
      name: 'mixed-stage-1',
      agent: '.agent-pipeline/agents/stage1.md',
      timeout: 60,
      runtime: {
        type: 'claude-sdk', // Override to SDK
        options: { model: 'haiku' },
      },
    },
    {
      name: 'mixed-stage-2',
      agent: '.agent-pipeline/agents/stage2.md',
      timeout: 60,
      dependsOn: ['mixed-stage-1'],
      // Uses global default (headless)
    },
    {
      name: 'mixed-stage-3',
      agent: '.agent-pipeline/agents/stage3.md',
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
  },
  agents: [
    {
      name: 'initial-stage',
      agent: '.agent-pipeline/agents/initial.md',
      timeout: 60,
      runtime: {
        type: 'claude-sdk',
      },
    },
    {
      name: 'parallel-sdk',
      agent: '.agent-pipeline/agents/parallel-sdk.md',
      timeout: 60,
      dependsOn: ['initial-stage'],
      runtime: {
        type: 'claude-sdk',
        options: { model: 'haiku' },
      },
    },
    {
      name: 'parallel-headless',
      agent: '.agent-pipeline/agents/parallel-headless.md',
      timeout: 60,
      dependsOn: ['initial-stage'],
      runtime: {
        type: 'claude-code-headless',
      },
    },
    {
      name: 'final-stage',
      agent: '.agent-pipeline/agents/final.md',
      timeout: 60,
      dependsOn: ['parallel-sdk', 'parallel-headless'],
      runtime: {
        type: 'claude-code-headless',
      },
    },
  ],
};
