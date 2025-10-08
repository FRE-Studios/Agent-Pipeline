import { PipelineState, StageExecution } from '../../config/schema.js';
import { simplePipelineConfig, parallelPipelineConfig } from './pipeline-configs.js';

export const successfulStageExecution: StageExecution = {
  stageName: 'test-stage',
  status: 'success',
  startTime: '2024-01-01T00:00:00.000Z',
  endTime: '2024-01-01T00:01:00.000Z',
  duration: 60,
  commitSha: 'abc123def456',
  extractedData: {
    issues_found: 0,
    severity: 'low',
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
    code: 'TEST_ERROR',
    suggestion: 'Fix the test',
  },
};

export const skippedStageExecution: StageExecution = {
  stageName: 'test-stage',
  status: 'skipped',
  startTime: '2024-01-01T00:00:00.000Z',
  conditionEvaluated: true,
  conditionResult: false,
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
      extractedData: {
        result: 'success',
      },
    },
    {
      stageName: 'stage-2',
      status: 'success',
      startTime: '2024-01-01T00:01:00.000Z',
      endTime: '2024-01-01T00:02:00.000Z',
      duration: 60,
      commitSha: 'stage-2-commit',
      extractedData: {
        result: 'success',
      },
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
        code: 'AGENT_ERROR',
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
      extractedData: {
        issues_found: 3,
        severity: 'medium',
      },
    },
    {
      stageName: 'security',
      status: 'success',
      startTime: '2024-01-01T00:00:00.000Z',
      endTime: '2024-01-01T00:01:00.000Z',
      duration: 60,
      commitSha: 'security-commit',
      extractedData: {
        vulnerabilities: 0,
      },
    },
    {
      stageName: 'quality',
      status: 'success',
      startTime: '2024-01-01T00:00:00.000Z',
      endTime: '2024-01-01T00:01:00.000Z',
      duration: 60,
      commitSha: 'quality-commit',
      extractedData: {
        score: 85,
      },
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
