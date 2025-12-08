import { PipelineState, StageExecution } from '../../config/schema.js';
import { simplePipelineConfig, parallelPipelineConfig } from './pipeline-configs.js';

export const successfulStageExecution: StageExecution = {
  stageName: 'test-stage',
  status: 'success',
  startTime: '2024-01-01T00:00:00.000Z',
  endTime: '2024-01-01T00:01:00.000Z',
  duration: 60,
  commitSha: 'abc123def456',
  tokenUsage: {
    estimated_input: 10000,
    actual_input: 10500,
    output: 3500,
    cache_creation: 1000,
    cache_read: 500,
    num_turns: 3,
    thinking_tokens: 5000,
  },
};

export const failedStageExecution: StageExecution = {
  stageName: 'test-stage',
  status: 'failed',
  startTime: '2024-01-01T00:00:00.000Z',
  endTime: '2024-01-01T00:01:00.000Z',
  duration: 60,
  error: {
    message: 'Test error',
    suggestion: 'Fix the test',
  },
};

export const skippedStageExecution: StageExecution = {
  stageName: 'test-stage',
  status: 'skipped',
  startTime: '2024-01-01T00:00:00.000Z',
};

export const runningPipelineState: PipelineState = {
  runId: 'test-run-123',
  pipelineConfig: simplePipelineConfig,
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
  ],
  status: 'running',
  artifacts: {
    initialCommit: 'initial-commit-sha',
    changedFiles: ['file1.ts', 'file2.ts'],
    totalDuration: 60,
  },
};

export const completedPipelineState: PipelineState = {
  runId: 'test-run-456',
  pipelineConfig: simplePipelineConfig,
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
      status: 'success',
      startTime: '2024-01-01T00:01:00.000Z',
      endTime: '2024-01-01T00:02:00.000Z',
      duration: 60,
      commitSha: 'stage-2-commit',
    },
  ],
  status: 'completed',
  artifacts: {
    initialCommit: 'initial-commit-sha',
    finalCommit: 'stage-2-commit',
    changedFiles: ['file1.ts', 'file2.ts'],
    totalDuration: 120,
  },
};

export const failedPipelineState: PipelineState = {
  runId: 'test-run-789',
  pipelineConfig: simplePipelineConfig,
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
        message: 'Agent execution failed',
        suggestion: 'Check agent configuration',
      },
    },
  ],
  status: 'failed',
  artifacts: {
    initialCommit: 'initial-commit-sha',
    finalCommit: 'stage-1-commit',
    changedFiles: ['file1.ts', 'file2.ts'],
    totalDuration: 120,
  },
};

export const parallelPipelineState: PipelineState = {
  runId: 'test-run-parallel',
  pipelineConfig: parallelPipelineConfig,
  trigger: {
    type: 'manual',
    commitSha: 'initial-commit-sha',
    timestamp: '2024-01-01T00:00:00.000Z',
  },
  stages: [
    {
      stageName: 'review',
      status: 'success',
      startTime: '2024-01-01T00:00:00.000Z',
      endTime: '2024-01-01T00:01:00.000Z',
      duration: 60,
      commitSha: 'review-commit',
    },
    {
      stageName: 'security',
      status: 'success',
      startTime: '2024-01-01T00:00:00.000Z',
      endTime: '2024-01-01T00:01:00.000Z',
      duration: 60,
      commitSha: 'security-commit',
    },
    {
      stageName: 'quality',
      status: 'success',
      startTime: '2024-01-01T00:00:00.000Z',
      endTime: '2024-01-01T00:01:00.000Z',
      duration: 60,
      commitSha: 'quality-commit',
    },
  ],
  status: 'running',
  artifacts: {
    initialCommit: 'initial-commit-sha',
    changedFiles: ['file1.ts'],
    totalDuration: 60,
  },
};

export const pipelineStateWithPR: PipelineState = {
  ...completedPipelineState,
  runId: 'test-run-with-pr',
  artifacts: {
    ...completedPipelineState.artifacts,
    pullRequest: {
      url: 'https://github.com/test/repo/pull/123',
      number: 123,
      branch: 'pipeline/test-branch',
    },
  },
};

// Analytics test fixtures - Multiple successful runs
export const analyticsSuccessRun1: PipelineState = {
  runId: 'analytics-success-1',
  pipelineConfig: simplePipelineConfig,
  trigger: {
    type: 'manual',
    commitSha: 'commit-1',
    timestamp: '2024-01-15T10:00:00.000Z',
  },
  stages: [
    {
      stageName: 'stage-1',
      status: 'success',
      startTime: '2024-01-15T10:00:00.000Z',
      endTime: '2024-01-15T10:01:00.000Z',
      duration: 60000,
      commitSha: 'stage-1-commit',
    },
    {
      stageName: 'stage-2',
      status: 'success',
      startTime: '2024-01-15T10:01:00.000Z',
      endTime: '2024-01-15T10:02:00.000Z',
      duration: 60000,
      commitSha: 'stage-2-commit',
    },
  ],
  status: 'completed',
  artifacts: {
    initialCommit: 'commit-1',
    finalCommit: 'stage-2-commit',
    changedFiles: ['file1.ts'],
    totalDuration: 120000,
  },
};

export const analyticsSuccessRun2: PipelineState = {
  runId: 'analytics-success-2',
  pipelineConfig: simplePipelineConfig,
  trigger: {
    type: 'manual',
    commitSha: 'commit-2',
    timestamp: '2024-01-15T14:00:00.000Z',
  },
  stages: [
    {
      stageName: 'stage-1',
      status: 'success',
      startTime: '2024-01-15T14:00:00.000Z',
      endTime: '2024-01-15T14:01:30.000Z',
      duration: 90000,
      commitSha: 'stage-1-commit-2',
    },
    {
      stageName: 'stage-2',
      status: 'success',
      startTime: '2024-01-15T14:01:30.000Z',
      endTime: '2024-01-15T14:03:00.000Z',
      duration: 90000,
      commitSha: 'stage-2-commit-2',
    },
  ],
  status: 'completed',
  artifacts: {
    initialCommit: 'commit-2',
    finalCommit: 'stage-2-commit-2',
    changedFiles: ['file2.ts'],
    totalDuration: 180000,
  },
};

export const analyticsFailedRun1: PipelineState = {
  runId: 'analytics-failed-1',
  pipelineConfig: simplePipelineConfig,
  trigger: {
    type: 'manual',
    commitSha: 'commit-3',
    timestamp: '2024-01-16T09:00:00.000Z',
  },
  stages: [
    {
      stageName: 'stage-1',
      status: 'success',
      startTime: '2024-01-16T09:00:00.000Z',
      endTime: '2024-01-16T09:01:00.000Z',
      duration: 60000,
      commitSha: 'stage-1-commit-3',
    },
    {
      stageName: 'stage-2',
      status: 'failed',
      startTime: '2024-01-16T09:01:00.000Z',
      endTime: '2024-01-16T09:02:00.000Z',
      duration: 60000,
      error: {
        message: 'Connection timeout\nRetry failed after 3 attempts',
        suggestion: 'Check network connection',
      },
    },
  ],
  status: 'failed',
  artifacts: {
    initialCommit: 'commit-3',
    finalCommit: 'stage-1-commit-3',
    changedFiles: ['file3.ts'],
    totalDuration: 120000,
  },
};

export const analyticsFailedRun2: PipelineState = {
  runId: 'analytics-failed-2',
  pipelineConfig: simplePipelineConfig,
  trigger: {
    type: 'manual',
    commitSha: 'commit-4',
    timestamp: '2024-01-16T15:00:00.000Z',
  },
  stages: [
    {
      stageName: 'stage-1',
      status: 'failed',
      startTime: '2024-01-16T15:00:00.000Z',
      endTime: '2024-01-16T15:00:30.000Z',
      duration: 30000,
      error: {
        message: 'Invalid configuration',
        suggestion: 'Verify agent configuration',
      },
    },
  ],
  status: 'failed',
  artifacts: {
    initialCommit: 'commit-4',
    changedFiles: [],
    totalDuration: 30000,
  },
};

export const analyticsMultiDayRun1: PipelineState = {
  runId: 'analytics-multiday-1',
  pipelineConfig: simplePipelineConfig,
  trigger: {
    type: 'manual',
    commitSha: 'commit-5',
    timestamp: '2024-01-17T12:00:00.000Z',
  },
  stages: [
    {
      stageName: 'stage-1',
      status: 'success',
      startTime: '2024-01-17T12:00:00.000Z',
      endTime: '2024-01-17T12:01:00.000Z',
      duration: 60000,
      commitSha: 'stage-1-commit-5',
    },
  ],
  status: 'completed',
  artifacts: {
    initialCommit: 'commit-5',
    finalCommit: 'stage-1-commit-5',
    changedFiles: ['file5.ts'],
    totalDuration: 60000,
  },
};

export const analyticsSameErrorRun: PipelineState = {
  runId: 'analytics-same-error',
  pipelineConfig: simplePipelineConfig,
  trigger: {
    type: 'manual',
    commitSha: 'commit-6',
    timestamp: '2024-01-17T16:00:00.000Z',
  },
  stages: [
    {
      stageName: 'stage-1',
      status: 'failed',
      startTime: '2024-01-17T16:00:00.000Z',
      endTime: '2024-01-17T16:00:30.000Z',
      duration: 30000,
      error: {
        message: 'Connection timeout\nNetwork issue',
        suggestion: 'Check network',
      },
    },
  ],
  status: 'failed',
  artifacts: {
    initialCommit: 'commit-6',
    changedFiles: [],
    totalDuration: 30000,
  },
};

export const analyticsMultiStageRun: PipelineState = {
  runId: 'analytics-multistage',
  pipelineConfig: parallelPipelineConfig,
  trigger: {
    type: 'manual',
    commitSha: 'commit-7',
    timestamp: '2024-01-18T10:00:00.000Z',
  },
  stages: [
    {
      stageName: 'review',
      status: 'success',
      startTime: '2024-01-18T10:00:00.000Z',
      endTime: '2024-01-18T10:02:00.000Z',
      duration: 120000,
      commitSha: 'review-commit',
    },
    {
      stageName: 'security',
      status: 'failed',
      startTime: '2024-01-18T10:00:00.000Z',
      endTime: '2024-01-18T10:01:00.000Z',
      duration: 60000,
      error: {
        message: 'Security vulnerability detected',
        suggestion: 'Fix vulnerabilities',
      },
    },
    {
      stageName: 'quality',
      status: 'success',
      startTime: '2024-01-18T10:02:00.000Z',
      endTime: '2024-01-18T10:03:30.000Z',
      duration: 90000,
      commitSha: 'quality-commit',
    },
  ],
  status: 'partial',
  artifacts: {
    initialCommit: 'commit-7',
    finalCommit: 'quality-commit',
    changedFiles: ['file7.ts'],
    totalDuration: 270000,
  },
};

export const analyticsSkippedStageRun: PipelineState = {
  runId: 'analytics-skipped',
  pipelineConfig: simplePipelineConfig,
  trigger: {
    type: 'manual',
    commitSha: 'commit-8',
    timestamp: '2024-01-18T14:00:00.000Z',
  },
  stages: [
    {
      stageName: 'stage-1',
      status: 'success',
      startTime: '2024-01-18T14:00:00.000Z',
      endTime: '2024-01-18T14:01:00.000Z',
      duration: 60000,
      commitSha: 'stage-1-commit-8',
    },
    {
      stageName: 'stage-2',
      status: 'skipped',
      startTime: '2024-01-18T14:01:00.000Z',
    },
  ],
  status: 'completed',
  artifacts: {
    initialCommit: 'commit-8',
    finalCommit: 'stage-1-commit-8',
    changedFiles: ['file8.ts'],
    totalDuration: 60000,
  },
};
