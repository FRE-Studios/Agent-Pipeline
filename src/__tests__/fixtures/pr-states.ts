import { PipelineState } from '../../config/schema.js';
import { simplePipelineConfig } from './pipeline-configs.js';

export const prPipelineStateCompleted: PipelineState = {
  runId: 'pr-run-completed-123',
  pipelineConfig: {
    ...simplePipelineConfig,
    name: 'test-pipeline',
  },
  trigger: {
    type: 'manual',
    commitSha: 'initial-abc123',
    timestamp: '2024-01-01T00:00:00.000Z',
  },
  stages: [
    {
      stageName: 'build',
      status: 'success',
      startTime: '2024-01-01T00:00:00.000Z',
      endTime: '2024-01-01T00:01:30.000Z',
      duration: 90,
      commitSha: 'build-commit-abc123',
      commitMessage: '[pipeline:build] Apply build changes',
    },
    {
      stageName: 'test',
      status: 'success',
      startTime: '2024-01-01T00:01:30.000Z',
      endTime: '2024-01-01T00:03:00.000Z',
      duration: 90,
      commitSha: 'test-commit-def456',
      commitMessage: '[pipeline:test] Apply test changes',
    },
  ],
  status: 'completed',
  artifacts: {
    handoverDir: '.agent-pipeline/runs/pr-run-completed-123',
    initialCommit: 'initial-abc123',
    finalCommit: 'test-commit-def456',
    changedFiles: ['src/index.ts', 'src/utils.ts'],
    totalDuration: 180,
  },
};

export const prPipelineStatePartial: PipelineState = {
  runId: 'pr-run-partial-456',
  pipelineConfig: {
    ...simplePipelineConfig,
    name: 'ci-pipeline',
  },
  trigger: {
    type: 'manual',
    commitSha: 'initial-xyz789',
    timestamp: '2024-01-02T00:00:00.000Z',
  },
  stages: [
    {
      stageName: 'lint',
      status: 'success',
      startTime: '2024-01-02T00:00:00.000Z',
      endTime: '2024-01-02T00:00:30.000Z',
      duration: 30,
      commitSha: 'lint-commit-ghi789',
      commitMessage: '[pipeline:lint] Apply lint fixes',
    },
    {
      stageName: 'build',
      status: 'failed',
      startTime: '2024-01-02T00:00:30.000Z',
      endTime: '2024-01-02T00:01:00.000Z',
      duration: 30,
      error: {
        message: 'Build failed: compilation error',
      },
    },
    {
      stageName: 'deploy',
      status: 'skipped',
      startTime: '2024-01-02T00:01:00.000Z',
    },
  ],
  status: 'failed',
  artifacts: {
    handoverDir: '.agent-pipeline/runs/pr-run-partial-456',
    initialCommit: 'initial-xyz789',
    finalCommit: 'lint-commit-ghi789',
    changedFiles: ['src/main.ts'],
    totalDuration: 60,
  },
};

export const prPipelineStateWithRetries: PipelineState = {
  runId: 'pr-run-retries-789',
  pipelineConfig: {
    ...simplePipelineConfig,
    name: 'flaky-pipeline',
  },
  trigger: {
    type: 'manual',
    commitSha: 'initial-retry-001',
    timestamp: '2024-01-03T00:00:00.000Z',
  },
  stages: [
    {
      stageName: 'flaky-test',
      status: 'success',
      startTime: '2024-01-03T00:00:00.000Z',
      endTime: '2024-01-03T00:02:00.000Z',
      duration: 120,
      retryAttempt: 2,
      commitSha: 'flaky-commit-jkl012',
      commitMessage: '[pipeline:flaky-test] Apply flaky-test changes',
    },
    {
      stageName: 'integration',
      status: 'success',
      startTime: '2024-01-03T00:02:00.000Z',
      endTime: '2024-01-03T00:03:30.000Z',
      duration: 90,
      retryAttempt: 1,
      commitSha: 'integration-commit-mno345',
      commitMessage: '[pipeline:integration] Apply integration changes',
    },
  ],
  status: 'completed',
  artifacts: {
    handoverDir: '.agent-pipeline/runs/pr-run-retries-789',
    initialCommit: 'initial-retry-001',
    finalCommit: 'integration-commit-mno345',
    changedFiles: ['tests/integration.test.ts'],
    totalDuration: 210,
  },
};

export const prPipelineStateSingleStage: PipelineState = {
  runId: 'pr-run-single-999',
  pipelineConfig: {
    ...simplePipelineConfig,
    name: 'simple-check',
  },
  trigger: {
    type: 'manual',
    commitSha: 'initial-single-111',
    timestamp: '2024-01-04T00:00:00.000Z',
  },
  stages: [
    {
      stageName: 'quick-check',
      status: 'success',
      startTime: '2024-01-04T00:00:00.000Z',
      endTime: '2024-01-04T00:00:15.000Z',
      duration: 15,
      commitSha: 'quick-commit-pqr678',
      commitMessage: '[pipeline:quick-check] Apply quick-check changes',
    },
  ],
  status: 'completed',
  artifacts: {
    handoverDir: '.agent-pipeline/runs/pr-run-single-999',
    initialCommit: 'initial-single-111',
    finalCommit: 'quick-commit-pqr678',
    changedFiles: ['README.md'],
    totalDuration: 15,
  },
};

export const prPipelineStateNoCommits: PipelineState = {
  runId: 'pr-run-no-commits-000',
  pipelineConfig: {
    ...simplePipelineConfig,
    name: 'no-commit-pipeline',
  },
  trigger: {
    type: 'manual',
    commitSha: 'initial-no-commit-222',
    timestamp: '2024-01-05T00:00:00.000Z',
  },
  stages: [
    {
      stageName: 'analyze',
      status: 'success',
      startTime: '2024-01-05T00:00:00.000Z',
      endTime: '2024-01-05T00:00:45.000Z',
      duration: 45,
      // No commitSha or commitMessage
    },
    {
      stageName: 'report',
      status: 'success',
      startTime: '2024-01-05T00:00:45.000Z',
      endTime: '2024-01-05T00:01:00.000Z',
      duration: 15,
      // No commitSha or commitMessage
    },
  ],
  status: 'completed',
  artifacts: {
    handoverDir: '.agent-pipeline/runs/pr-run-no-commits-000',
    initialCommit: 'initial-no-commit-222',
    changedFiles: [],
    totalDuration: 60,
  },
};
