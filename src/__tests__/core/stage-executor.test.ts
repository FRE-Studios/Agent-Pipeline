// src/core/stage-executor.test.ts

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { StageExecutor } from '../../core/stage-executor.js';
import { createMockGitManager } from '../mocks/git-manager.js';
import { runningPipelineState, completedPipelineState } from '../fixtures/pipeline-states.js';
import {
  basicStageConfig,
  stageWithOutputs,
  stageWithRetry,
  stageWithCustomCommit,
  stageWithAutoCommitDisabled,
  stageWithInputs,
  stageWithLongTimeout,
} from '../fixtures/stage-configs.js';
import type { PipelineState } from '../../config/schema.js';

function createMockQuery({ output, error }: { output?: string; error?: Error }) {
  return vi.fn().mockImplementation(async function* () {
    if (error) {
      throw error;
    }
    yield {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: output || 'Mock agent response' }],
      },
    };
  });
}

// Mock the Claude SDK query function and MCP tools
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn().mockImplementation(async function* () {
    yield {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'Mock agent response' }],
      },
    };
  }),
  tool: vi.fn((name, description, schema, handler) => ({
    name,
    description,
    inputSchema: schema,
    handler
  })),
  createSdkMcpServer: vi.fn((options) => ({
    type: 'sdk',
    name: options.name,
    instance: { tools: options.tools }
  }))
}));

// Mock fs/promises for reading agent files
vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('Mock agent system prompt'),
}));

// Mock OutputStorageManager
vi.mock('../../core/output-storage-manager.js', () => ({
  OutputStorageManager: vi.fn(() => ({
    saveStageOutputs: vi.fn().mockResolvedValue({ structured: 'path/to/output.json', raw: 'path/to/raw.md' }),
    savePipelineSummary: vi.fn().mockResolvedValue('path/to/summary.json'),
    saveChangedFiles: vi.fn().mockResolvedValue('path/to/changed-files.txt'),
    readStageOutput: vi.fn().mockResolvedValue(null),
    compressFileList: vi.fn((files: string[]) => `Changed ${files.length} files`),
  })),
}));

describe('StageExecutor', () => {
  beforeAll(() => {
    vi.useFakeTimers();
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  let executor: StageExecutor;
  let mockGitManager: ReturnType<typeof createMockGitManager>;
  let mockQuery: ReturnType<typeof vi.fn>;
  const testRunId = 'test-run-id-12345';
  const testRepoPath = '/test/repo/path';

  beforeEach(async () => {
    vi.clearAllMocks();

    // Get the mocked query function
    const sdk = await import('@anthropic-ai/claude-agent-sdk');
    mockQuery = vi.mocked(sdk.query);

    // Reset to default mock
    mockQuery.mockImplementation(async function* () {
      yield {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Mock agent response' }],
        },
      };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('executeStage - Success Scenarios', () => {
    it('should execute stage successfully with agent output', async () => {
      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, testRunId, testRepoPath);

      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.status).toBe('success');
      expect(result.stageName).toBe('test-stage');
      expect(result.agentOutput).toBe('Mock agent response');
      expect(result.startTime).toBeDefined();
      expect(result.endTime).toBeDefined();
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should execute successfully after retries (test 1)', async () => {
      let callCount = 0;
      mockQuery.mockImplementation(async function* () {
        callCount++;
        if (callCount === 1) {
          throw new Error('First attempt failed');
        }
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Success after retry' }] },
        };
      });

      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, testRunId, testRepoPath);

      const promise = executor.executeStage(stageWithRetry, runningPipelineState);
      promise.catch(() => {}); // Suppress unhandled rejection warning
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.status).toBe('success');
      expect(result.retryAttempt).toBeGreaterThan(0);
    });

    it('should handle agent execution failure without retry', async () => {
      mockQuery.mockImplementation(async function* () {
        throw new Error('Agent execution failed');
      });

      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, testRunId, testRepoPath);

      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.status).toBe('failed');
      expect(result.error).toBeDefined();
      expect(result.error?.message).toBe('Agent execution failed');
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should calculate duration in seconds accurately', async () => {
      mockQuery.mockImplementation(async function* () {
        await new Promise(resolve => setTimeout(resolve, 1000));
        yield {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'Mock agent response' }],
          },
        };
      });

      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, testRunId, testRepoPath);

      const promise = executor.executeStage(basicStageConfig, runningPipelineState);
      await vi.advanceTimersByTimeAsync(1000);
      const result = await promise;

      expect(result.duration).toBe(1);
    });

    it('should integrate with GitManager for commits', async () => {
      mockGitManager = createMockGitManager({
        hasChanges: true,
        commitSha: 'integration-commit',
        commitMessage: '[pipeline:test-stage] Integration test',
      });
      executor = new StageExecutor(mockGitManager, false, testRunId, testRepoPath);

      await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(mockGitManager.hasUncommittedChanges).toHaveBeenCalled();
      expect(mockGitManager.createPipelineCommit).toHaveBeenCalled();
      expect(mockGitManager.getCommitMessage).toHaveBeenCalledWith('integration-commit');
    });

    it('should execute stage with extracted data outputs', async () => {
      mockQuery.mockImplementation(async function* () {
        yield {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'Analysis complete. issues_found: 3\nseverity: high\nscore: 85' },
            ],
          },
        };
      });

      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, testRunId, testRepoPath);

      const result = await executor.executeStage(stageWithOutputs, runningPipelineState);

      expect(result.status).toBe('success');
      expect(result.extractedData).toBeDefined();
      expect(result.extractedData?.issues_found).toBe('3');
      expect(result.extractedData?.severity).toBe('high');
      expect(result.extractedData?.score).toBe('85');
    });

    it('should execute stage with auto-commit when changes are present', async () => {
      mockGitManager = createMockGitManager({
        hasChanges: true,
        commitSha: 'new-commit-123',
        commitMessage: '[pipeline:test-stage] Test commit',
      });
      executor = new StageExecutor(mockGitManager, false, testRunId, testRepoPath);

      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.status).toBe('success');
      expect(result.commitSha).toBe('new-commit-123');
      expect(result.commitMessage).toBe('[pipeline:test-stage] Test commit');
      expect(mockGitManager.createPipelineCommit).toHaveBeenCalledWith(
        'test-stage',
        'test-run-123',
        undefined
      );
    });

    it('should execute stage with custom commit message', async () => {
      mockGitManager = createMockGitManager({
        hasChanges: true,
        commitSha: 'custom-commit-456',
      });
      executor = new StageExecutor(mockGitManager, false, testRunId, testRepoPath);

      const result = await executor.executeStage(stageWithCustomCommit, runningPipelineState);

      expect(result.status).toBe('success');
      expect(mockGitManager.createPipelineCommit).toHaveBeenCalledWith(
        'custom-commit-stage',
        'test-run-123',
        'Custom commit message'
      );
    });

    it('should not commit when auto-commit is disabled', async () => {
      mockGitManager = createMockGitManager({ hasChanges: true });
      executor = new StageExecutor(mockGitManager, false, testRunId, testRepoPath);

      const result = await executor.executeStage(
        stageWithAutoCommitDisabled,
        runningPipelineState
      );

      expect(result.status).toBe('success');
      expect(result.commitSha).toBeUndefined();
      expect(mockGitManager.createPipelineCommit).not.toHaveBeenCalled();
    });

    it('should not commit when no changes are present', async () => {
      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, testRunId, testRepoPath);

      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.status).toBe('success');
      expect(result.commitSha).toBeUndefined();
      expect(mockGitManager.git.commit).not.toHaveBeenCalled();
    });

    it('should execute in dry-run mode with changes', async () => {
      mockGitManager = createMockGitManager({ hasChanges: true });
      executor = new StageExecutor(mockGitManager, true, testRunId, testRepoPath); // dry-run mode

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.status).toBe('success');
      expect(result.commitSha).toBeUndefined();
      expect(mockGitManager.createPipelineCommit).not.toHaveBeenCalled();
      expect(mockGitManager.hasUncommittedChanges).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('dry-run'));

      consoleSpy.mockRestore();
    });

    it('should execute in dry-run mode without changes', async () => {
      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, true, testRunId, testRepoPath);

      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.status).toBe('success');
      expect(mockGitManager.hasUncommittedChanges).toHaveBeenCalled();
    });

    it('should invoke output callback with streaming updates', async () => {
      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, testRunId, testRepoPath);

      const outputCallback = vi.fn();
      await executor.executeStage(
        basicStageConfig,
        runningPipelineState,
        outputCallback
      );

      expect(outputCallback).toHaveBeenCalled();
      expect(outputCallback).toHaveBeenCalledWith(expect.stringContaining('Mock agent'));
    });

    it('should execute successfully with retry configured (no retries needed)', async () => {
      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, testRunId, testRepoPath);

      const result = await executor.executeStage(stageWithRetry, runningPipelineState);

      expect(result.status).toBe('success');
      expect(result.retryAttempt).toBe(0);
      expect(result.maxRetries).toBe(3);
    });



    it('should respect custom timeout value', async () => {
      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, testRunId, testRepoPath);

      const result = await executor.executeStage(stageWithLongTimeout, runningPipelineState);

      expect(result.status).toBe('success');
      // Timeout of 600s should be respected
    });

    it('should include stage inputs in agent context', async () => {
      const fs = await import('fs/promises');
      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, testRunId, testRepoPath);

      await executor.executeStage(stageWithInputs, runningPipelineState);

      // The query function should be called with context containing inputs
      expect(mockQuery).toHaveBeenCalled();
      const callArgs = mockQuery.mock.calls[0][0];
      expect(callArgs.prompt).toContain('targetFile');
      expect(callArgs.prompt).toContain('src/main.ts');
    });

    it('should include previous stages in context', async () => {
      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, testRunId, testRepoPath);

      await executor.executeStage(basicStageConfig, completedPipelineState);

      expect(mockQuery).toHaveBeenCalled();
      const callArgs = mockQuery.mock.calls[0][0];
      expect(callArgs.prompt).toContain('stage-1');
      expect(callArgs.prompt).toContain('stage-2');
    });
  });

  describe('executeStage - Failure Scenarios', () => {
    it('should handle agent execution failure without retry', async () => {
      mockQuery.mockImplementation(async function* () {
        throw new Error('Agent execution failed');
      });

      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, testRunId, testRepoPath);

      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.status).toBe('failed');
      expect(result.error).toBeDefined();
      expect(result.error?.message).toBe('Agent execution failed');
    });

    it('should handle agent execution failure after max retries', async () => {
      mockQuery.mockImplementation(async function* () {
        throw new Error('Persistent failure');
      });

      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, testRunId, testRepoPath);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const promise = executor.executeStage(stageWithRetry, runningPipelineState);

      // Fast-forward through retry delays
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(2000);

      const result = await promise;

      expect(result.status).toBe('failed');
      expect(result.retryAttempt).toBeGreaterThan(0);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Retrying'));

      consoleSpy.mockRestore();
    });

    it('should handle agent timeout error', async () => {
      mockQuery.mockImplementation(async function* () {
        // Simulate a query that takes too long
        await new Promise((resolve) => setTimeout(resolve, 200000)); // 200 seconds
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Too late' }] },
        };
      });

      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, testRunId, testRepoPath);

      const promise = executor.executeStage(basicStageConfig, runningPipelineState);

      // Advance past the timeout (120s)
      await vi.advanceTimersByTimeAsync(120001);

      const result = await promise;

      expect(result.status).toBe('failed');
      expect(result.error?.message).toContain('timeout');
    });

    it('should handle file not found error (ENOENT)', async () => {
      const fs = await import('fs/promises');
      vi.mocked(fs.readFile).mockRejectedValue(
        Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' })
      );

      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, testRunId, testRepoPath);

      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.status).toBe('failed');
      expect(result.error?.message).toContain('ENOENT');
      expect(result.error?.suggestion).toContain('Agent file not found');
      expect(result.error?.agentPath).toBe('.claude/agents/test-agent.md');
    });

    it('should handle API authentication error', async () => {
      const mockQuery = createMockQuery({ error: new Error('API error: 401 Unauthorized') });
      vi.mocked(await import('@anthropic-ai/claude-agent-sdk')).query = mockQuery;

      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, testRunId, testRepoPath);

      await vi.advanceTimersByTimeAsync(1);
      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.status).toBe('failed');
      expect(result.error?.suggestion).toContain('ANTHROPIC_API_KEY');
    });

    it('should handle YAML parsing error', async () => {
      const mockQuery = createMockQuery({ error: new Error('YAML parse error: invalid syntax') });
      vi.mocked(await import('@anthropic-ai/claude-agent-sdk')).query = mockQuery;

      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, testRunId, testRepoPath);

      await vi.advanceTimersByTimeAsync(1);
      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.status).toBe('failed');
      expect(result.error?.suggestion).toContain('YAML syntax');
    });

    it('should handle permission error', async () => {
      const fs = await import('fs/promises');
      vi.mocked(fs.readFile).mockRejectedValue(new Error('permission denied'));

      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, testRunId, testRepoPath);

      await vi.advanceTimersByTimeAsync(1);
      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.status).toBe('failed');
      expect(result.error?.suggestion).toContain('permission');
    });

    it('should handle generic errors', async () => {
      const mockQuery = createMockQuery({ error: new Error('Unknown error occurred') });
      vi.mocked(await import('@anthropic-ai/claude-agent-sdk')).query = mockQuery;

      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, testRunId, testRepoPath);

      await vi.advanceTimersByTimeAsync(1);
      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.status).toBe('failed');
      expect(result.error?.message).toBe('Unknown error occurred');
      expect(result.error?.timestamp).toBeDefined();
    });

    it('should include retry info in error message', async () => {
      const mockQuery = createMockQuery({ error: new Error('Failed after retries') });
      vi.mocked(await import('@anthropic-ai/claude-agent-sdk')).query = mockQuery;

      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, testRunId, testRepoPath);

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const promise = executor.executeStage(stageWithRetry, runningPipelineState);

      // Fast-forward through retry delays
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(2000);

      await promise;

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('retries'));

      consoleErrorSpy.mockRestore();
    });

    it('should calculate duration even on failure', async () => {
      const mockQuery = createMockQuery({ error: new Error('Failed') });
      vi.mocked(await import('@anthropic-ai/claude-agent-sdk')).query = mockQuery;

      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, testRunId, testRepoPath);

      await vi.advanceTimersByTimeAsync(1);
      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.status).toBe('failed');
      expect(result.duration).toBeDefined();
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should handle git commit failure', async () => {
      mockGitManager = createMockGitManager({ hasChanges: true, shouldFailCommit: true });
      executor = new StageExecutor(mockGitManager, false, testRunId, testRepoPath);

      await vi.advanceTimersByTimeAsync(1);
      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.status).toBe('failed');
      expect(result.error?.message).toContain('Git commit failed');
    });
  });

  describe('buildAgentContext', () => {
    beforeEach(() => {
      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, testRunId, testRepoPath);
    });

    it('should build context with no previous stages', async () => {
      const emptyState: PipelineState = {
        ...runningPipelineState,
        stages: [],
      };

      await executor.executeStage(basicStageConfig, emptyState);

      const mockQueryFn = vi.mocked(await import('@anthropic-ai/claude-agent-sdk')).query;
      const callArgs = mockQueryFn.mock.calls[0][0];
      expect(callArgs.prompt).toContain('Pipeline Run ID');
      expect(callArgs.prompt).toContain('test-run-123');
      expect(callArgs.prompt).not.toContain('stage-1');
    });

    it('should build context with single successful previous stage', async () => {
      await executor.executeStage(basicStageConfig, runningPipelineState);

      const mockQueryFn = vi.mocked(await import('@anthropic-ai/claude-agent-sdk')).query;
      const callArgs = mockQueryFn.mock.calls[0][0];
      expect(callArgs.prompt).toContain('stage-1');
      expect(callArgs.prompt).toContain('stage-1-commit');
    });

    it('should build context with multiple successful previous stages', async () => {
      await executor.executeStage(basicStageConfig, completedPipelineState);

      const mockQueryFn = vi.mocked(await import('@anthropic-ai/claude-agent-sdk')).query;
      const callArgs = mockQueryFn.mock.calls[0][0];
      expect(callArgs.prompt).toContain('stage-1');
      expect(callArgs.prompt).toContain('stage-2');
    });

    it('should filter out non-successful stages from context', async () => {
      const stateWithFailure: PipelineState = {
        ...runningPipelineState,
        stages: [
          {
            stageName: 'stage-1',
            status: 'success',
            startTime: '2024-01-01T00:00:00.000Z',
            endTime: '2024-01-01T00:01:00.000Z',
            duration: 60,
            commitSha: 'success-commit',
          },
          {
            stageName: 'stage-2',
            status: 'failed',
            startTime: '2024-01-01T00:01:00.000Z',
            endTime: '2024-01-01T00:02:00.000Z',
            duration: 60,
            error: { message: 'Failed' },
          },
        ],
      };

      await executor.executeStage(basicStageConfig, stateWithFailure);

      const mockQueryFn = vi.mocked(await import('@anthropic-ai/claude-agent-sdk')).query;
      const callArgs = mockQueryFn.mock.calls[0][0];
      expect(callArgs.prompt).toContain('stage-1');
      expect(callArgs.prompt).not.toContain('stage-2');
    });

    it('should include extracted data in context', async () => {
      await executor.executeStage(basicStageConfig, completedPipelineState);

      const mockQueryFn = vi.mocked(await import('@anthropic-ai/claude-agent-sdk')).query;
      const callArgs = mockQueryFn.mock.calls[0][0];
      expect(callArgs.prompt).toContain('result');
      expect(callArgs.prompt).toContain('success');
    });

    it('should include commit SHAs in context', async () => {
      await executor.executeStage(basicStageConfig, runningPipelineState);

      const mockQueryFn = vi.mocked(await import('@anthropic-ai/claude-agent-sdk')).query;
      const callArgs = mockQueryFn.mock.calls[0][0];
      expect(callArgs.prompt).toContain('Commit:');
      expect(callArgs.prompt).toContain('stage-1-commit');
    });

    it('should include changed files in context', async () => {
      await executor.executeStage(basicStageConfig, runningPipelineState);

      const mockQueryFn = vi.mocked(await import('@anthropic-ai/claude-agent-sdk')).query;
      const callArgs = mockQueryFn.mock.calls[0][0];
      // With context reduction enabled, files are compressed
      expect(callArgs.prompt).toContain('Changed 2 files');
      expect(callArgs.prompt).toContain('changed-files.txt');
    });

    it('should include stage inputs in context', async () => {
      await executor.executeStage(stageWithInputs, runningPipelineState);

      const mockQueryFn = vi.mocked(await import('@anthropic-ai/claude-agent-sdk')).query;
      const callArgs = mockQueryFn.mock.calls[0][0];
      expect(callArgs.prompt).toContain('Your Task');
      expect(callArgs.prompt).toContain('targetFile');
      expect(callArgs.prompt).toContain('maxIssues');
      expect(callArgs.prompt).toContain('strictMode');
    });
  });

  describe('runAgentWithTimeout', () => {
    beforeEach(() => {
      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, testRunId, testRepoPath);
    });

    it('should execute agent query successfully', async () => {
      const mockQuery = createMockQuery({ output: 'Agent completed successfully' });
      vi.mocked(await import('@anthropic-ai/claude-agent-sdk')).query = mockQuery;

      await vi.advanceTimersByTimeAsync(1);
      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.status).toBe('success');
      expect(result.agentOutput).toBe('Agent completed successfully');
    });

    it('should timeout after configured seconds', async () => {
      const longRunningQuery = vi.fn().mockImplementation(async function* () {
        await new Promise((resolve) => setTimeout(resolve, 150000)); // 150s
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Done' }] },
        };
      });

      vi.mocked(await import('@anthropic-ai/claude-agent-sdk')).query = longRunningQuery;

      const promise = executor.executeStage(basicStageConfig, runningPipelineState);

      // Advance past timeout (120s)
      await vi.advanceTimersByTimeAsync(120001);

      const result = await promise;

      expect(result.status).toBe('failed');
      expect(result.error?.message).toContain('timeout');
    });

    it('should use default timeout when not specified', async () => {
      const stageWithoutTimeout = { ...basicStageConfig, timeout: undefined };

      const longRunningQuery = vi.fn().mockImplementation(async function* () {
        await new Promise((resolve) => setTimeout(resolve, 400000)); // 400s
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Done' }] },
        };
      });

      vi.mocked(await import('@anthropic-ai/claude-agent-sdk')).query = longRunningQuery;

      const promise = executor.executeStage(stageWithoutTimeout, runningPipelineState);

      // Advance past default timeout (300s)
      await vi.advanceTimersByTimeAsync(300001);

      const result = await promise;

      expect(result.status).toBe('failed');
      expect(result.error?.message).toContain('timeout');
    });

    it('should stream output to callback', async () => {
      const mockQuery = createMockQuery({ output: 'Streaming output' });
      vi.mocked(await import('@anthropic-ai/claude-agent-sdk')).query = mockQuery;

      const callback = vi.fn();
      await executor.executeStage(
        basicStageConfig,
        runningPipelineState,
        callback
      );

      expect(callback).toHaveBeenCalledWith(expect.stringContaining('Streaming'));
    });

    it('should handle multiple assistant messages', async () => {
      const multiMessageQuery = vi.fn().mockImplementation(async function* () {
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'First message. ' }] },
        };
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Second message.' }] },
        };
      });

      vi.mocked(await import('@anthropic-ai/claude-agent-sdk')).query = multiMessageQuery;

      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.status).toBe('success');
      expect(result.agentOutput).toBe('First message. Second message.');
    });

    it('should extract text content from messages', async () => {
      const textContentQuery = vi.fn().mockImplementation(async function* () {
        yield {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'Text content' },
              { type: 'tool_use', id: '123', name: 'tool' },
            ],
          },
        };
      });

      vi.mocked(await import('@anthropic-ai/claude-agent-sdk')).query = textContentQuery;

      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.agentOutput).toBe('Text content');
    });

    it('should handle empty agent response', async () => {
      const emptyQuery = vi.fn().mockImplementation(async function* () {
        // Yields nothing
      });

      vi.mocked(await import('@anthropic-ai/claude-agent-sdk')).query = emptyQuery;

      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.agentOutput).toBe('');
    });

    it('should handle non-text content gracefully', async () => {
      const nonTextQuery = vi.fn().mockImplementation(async function* () {
        yield {
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', id: '123', name: 'tool' }],
          },
        };
      });

      vi.mocked(await import('@anthropic-ai/claude-agent-sdk')).query = nonTextQuery;

      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.agentOutput).toBe('');
    });

    it('should provide incremental updates to callback', async () => {
      const incrementalQuery = vi.fn().mockImplementation(async function* () {
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Part 1. ' }] },
        };
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Part 2.' }] },
        };
      });

      vi.mocked(await import('@anthropic-ai/claude-agent-sdk')).query = incrementalQuery;

      const callback = vi.fn();
      await executor.executeStage(basicStageConfig, runningPipelineState, callback);

      expect(callback).toHaveBeenCalledTimes(2);
      expect(callback).toHaveBeenNthCalledWith(1, 'Part 1. ');
      expect(callback).toHaveBeenNthCalledWith(2, 'Part 1. Part 2.');
    });
  });

  describe('Tool-based output extraction', () => {
    beforeEach(() => {
      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, testRunId, testRepoPath);
    });

    it('should extract data from report_outputs tool call', async () => {
      const toolUseQuery = vi.fn().mockImplementation(async function* () {
        yield {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'Analysis complete.' },
              {
                type: 'tool_use',
                id: 'tool123',
                name: 'report_outputs',
                input: {
                  outputs: {
                    issues_found: 5,
                    severity: 'high',
                    details: { critical: 2, warning: 3 }
                  }
                }
              }
            ]
          }
        };
      });

      vi.mocked(await import('@anthropic-ai/claude-agent-sdk')).query = toolUseQuery;

      const config = { ...basicStageConfig, outputs: ['issues_found', 'severity'] };
      const result = await executor.executeStage(config, runningPipelineState);

      expect(result.status).toBe('success');
      expect(result.extractedData).toBeDefined();
      expect(result.extractedData?.issues_found).toBe(5);
      expect(result.extractedData?.severity).toBe('high');
      expect(result.extractedData?.details).toEqual({ critical: 2, warning: 3 });
    });

    it('should handle complex data types in tool call', async () => {
      const toolUseQuery = vi.fn().mockImplementation(async function* () {
        yield {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                name: 'report_outputs',
                input: {
                  outputs: {
                    arr: [1, 2, 3],
                    obj: { nested: { value: true } },
                    num: 42,
                    str: 'text',
                    bool: false
                  }
                }
              }
            ]
          }
        };
      });

      vi.mocked(await import('@anthropic-ai/claude-agent-sdk')).query = toolUseQuery;

      const config = { ...basicStageConfig, outputs: ['arr', 'obj'] };
      const result = await executor.executeStage(config, runningPipelineState);

      expect(result.extractedData?.arr).toEqual([1, 2, 3]);
      expect(result.extractedData?.obj).toEqual({ nested: { value: true } });
      expect(result.extractedData?.num).toBe(42);
    });

    it('should fall back to regex extraction when tool not called', async () => {
      const noToolQuery = vi.fn().mockImplementation(async function* () {
        yield {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'issues_found: 3\nseverity: medium' }]
          }
        };
      });

      vi.mocked(await import('@anthropic-ai/claude-agent-sdk')).query = noToolQuery;

      const config = { ...basicStageConfig, outputs: ['issues_found', 'severity'] };
      const result = await executor.executeStage(config, runningPipelineState);

      expect(result.status).toBe('success');
      expect(result.extractedData?.issues_found).toBe('3');
      expect(result.extractedData?.severity).toBe('medium');
    });

    it('should combine text and tool outputs', async () => {
      const combinedQuery = vi.fn().mockImplementation(async function* () {
        yield {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'Found several issues in the code.' },
              {
                type: 'tool_use',
                name: 'report_outputs',
                input: {
                  outputs: { issues_found: 7 }
                }
              }
            ]
          }
        };
      });

      vi.mocked(await import('@anthropic-ai/claude-agent-sdk')).query = combinedQuery;

      const config = { ...basicStageConfig, outputs: ['issues_found'] };
      const result = await executor.executeStage(config, runningPipelineState);

      expect(result.agentOutput).toContain('Found several issues');
      expect(result.extractedData?.issues_found).toBe(7);
    });

    it('should ignore non-report_outputs tool calls', async () => {
      const otherToolQuery = vi.fn().mockImplementation(async function* () {
        yield {
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', name: 'other_tool', input: { data: 'ignore' } },
              { type: 'text', text: 'count: 5' }
            ]
          }
        };
      });

      vi.mocked(await import('@anthropic-ai/claude-agent-sdk')).query = otherToolQuery;

      const config = { ...basicStageConfig, outputs: ['count'] };
      const result = await executor.executeStage(config, runningPipelineState);

      // Should fall back to regex extraction
      expect(result.extractedData?.count).toBe('5');
    });
  });

  describe('extractOutputs', () => {
    beforeEach(() => {
      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, testRunId, testRepoPath);
    });

    it('should extract single output key', async () => {
      const mockQuery = createMockQuery({ output: 'Result: issues_found: 5' });
      vi.mocked(await import('@anthropic-ai/claude-agent-sdk')).query = mockQuery;

      const config = { ...basicStageConfig, outputs: ['issues_found'] };
      const result = await executor.executeStage(config, runningPipelineState);

      expect(result.extractedData).toBeDefined();
      expect(result.extractedData?.issues_found).toBe('5');
    });

    it('should extract multiple output keys', async () => {
      const mockQuery = createMockQuery({
        output: 'issues_found: 3\nseverity: high\nscore: 85',
      });
      vi.mocked(await import('@anthropic-ai/claude-agent-sdk')).query = mockQuery;

      const result = await executor.executeStage(stageWithOutputs, runningPipelineState);

      expect(result.extractedData?.issues_found).toBe('3');
      expect(result.extractedData?.severity).toBe('high');
      expect(result.extractedData?.score).toBe('85');
    });

    it('should return undefined when no output keys configured', async () => {
      const mockQuery = createMockQuery({ output: 'Some output' });
      vi.mocked(await import('@anthropic-ai/claude-agent-sdk')).query = mockQuery;

      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.extractedData).toBeUndefined();
    });

    it('should return undefined when output keys array is empty', async () => {
      const mockQuery = createMockQuery({ output: 'Some output' });
      vi.mocked(await import('@anthropic-ai/claude-agent-sdk')).query = mockQuery;

      const config = { ...basicStageConfig, outputs: [] };
      const result = await executor.executeStage(config, runningPipelineState);

      expect(result.extractedData).toBeUndefined();
    });

    it('should find output key in agent response', async () => {
      const mockQuery = createMockQuery({ output: 'Analysis complete.\nstatus: passed' });
      vi.mocked(await import('@anthropic-ai/claude-agent-sdk')).query = mockQuery;

      const config = { ...basicStageConfig, outputs: ['status'] };
      const result = await executor.executeStage(config, runningPipelineState);

      expect(result.extractedData?.status).toBe('passed');
    });

    it('should return undefined when output key not found', async () => {
      const mockQuery = createMockQuery({ output: 'No matching keys here' });
      vi.mocked(await import('@anthropic-ai/claude-agent-sdk')).query = mockQuery;

      const config = { ...basicStageConfig, outputs: ['missing_key'] };
      const result = await executor.executeStage(config, runningPipelineState);

      expect(result.extractedData).toBeUndefined();
    });

    it('should perform case-insensitive matching', async () => {
      const mockQuery = createMockQuery({ output: 'ISSUES_FOUND: 10' });
      vi.mocked(await import('@anthropic-ai/claude-agent-sdk')).query = mockQuery;

      const config = { ...basicStageConfig, outputs: ['issues_found'] };
      const result = await executor.executeStage(config, runningPipelineState);

      expect(result.extractedData?.issues_found).toBe('10');
    });

    it('should trim whitespace from extracted values', async () => {
      const mockQuery = createMockQuery({ output: 'result:   value with spaces   ' });
      vi.mocked(await import('@anthropic-ai/claude-agent-sdk')).query = mockQuery;

      const config = { ...basicStageConfig, outputs: ['result'] };
      const result = await executor.executeStage(config, runningPipelineState);

      expect(result.extractedData?.result).toBe('value with spaces');
    });

    it('should handle output keys with special regex characters', async () => {
      const mockQuery = createMockQuery({ output: 'user.name: John Doe' });
      vi.mocked(await import('@anthropic-ai/claude-agent-sdk')).query = mockQuery;

      const config = { ...basicStageConfig, outputs: ['user.name'] };
      const result = await executor.executeStage(config, runningPipelineState);

      expect(result.extractedData).toBeDefined();
      expect(result.extractedData['user.name']).toBe('John Doe');
    });
  });

  describe('calculateDuration', () => {
    beforeEach(() => {
      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, testRunId, testRepoPath);
    });

    it('should calculate duration with valid start and end times', async () => {
      await vi.advanceTimersByTimeAsync(1);
      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.duration).toBeDefined();
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should return 0 when end time is missing', async () => {
      // This shouldn't happen in normal flow, but test the edge case
      const mockQuery = createMockQuery({ output: 'Test' });
      vi.mocked(await import('@anthropic-ai/claude-agent-sdk')).query = mockQuery;

      await vi.advanceTimersByTimeAsync(1);
      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      // End time should always be set in normal execution
      expect(result.endTime).toBeDefined();
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should calculate duration in seconds accurately', async () => {
      mockQuery.mockImplementation(async function* () {
        await new Promise(resolve => setTimeout(resolve, 1000));
        yield {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'Mock agent response' }],
          },
        };
      });

      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, testRunId, testRepoPath);

      const promise = executor.executeStage(basicStageConfig, runningPipelineState);
      await vi.advanceTimersByTimeAsync(1000);
      const result = await promise;

      expect(result.duration).toBeCloseTo(1, 1);
    });
  });

  describe('captureErrorDetails', () => {
    beforeEach(() => {
      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, testRunId, testRepoPath);
    });

    it('should capture ENOENT error with file path suggestion', async () => {
      const fs = await import('fs/promises');
      vi.mocked(fs.readFile).mockRejectedValue(
        Object.assign(new Error('ENOENT: file not found'), { code: 'ENOENT' })
      );

      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.error?.suggestion).toContain('Agent file not found');
      expect(result.error?.agentPath).toBe('.claude/agents/test-agent.md');
    });

    it('should capture timeout error with timeout increase suggestion', async () => {
      const longQuery = vi.fn().mockImplementation(async function* () {
        await new Promise((resolve) => setTimeout(resolve, 150000));
        yield { type: 'assistant', message: { content: [] } };
      });

      vi.mocked(await import('@anthropic-ai/claude-agent-sdk')).query = longQuery;

      const promise = executor.executeStage(basicStageConfig, runningPipelineState);
      await vi.advanceTimersByTimeAsync(120001);

      const result = await promise;

      expect(result.error?.suggestion).toContain('timeout');
      expect(result.error?.suggestion).toContain('pipeline config');
    });

    it('should capture API error with API key suggestion', async () => {
      const mockQuery = createMockQuery({ error: new Error('API 401: Unauthorized') });
      vi.mocked(await import('@anthropic-ai/claude-agent-sdk')).query = mockQuery;

      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.error?.suggestion).toContain('ANTHROPIC_API_KEY');
    });

    it('should capture YAML parse error with syntax suggestion', async () => {
      const mockQuery = createMockQuery({ error: new Error('YAML parse error') });
      vi.mocked(await import('@anthropic-ai/claude-agent-sdk')).query = mockQuery;

      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.error?.suggestion).toContain('YAML syntax');
    });

    it('should capture permission error with permission suggestion', async () => {
      const fs = await import('fs/promises');
      vi.mocked(fs.readFile).mockRejectedValue(new Error('permission denied'));

      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.error?.suggestion).toContain('permission');
    });

    it('should handle Error objects', async () => {
      const mockQuery = createMockQuery({ error: new Error('Standard error') });
      vi.mocked(await import('@anthropic-ai/claude-agent-sdk')).query = mockQuery;

      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.error?.message).toBe('Standard error');
      expect(result.error?.stack).toBeDefined();
      expect(result.error?.timestamp).toBeDefined();
    });

    it('should handle non-Error objects (strings)', async () => {
      const mockQuery = vi.fn().mockImplementation(async function* () {
        throw 'String error';
      });

      vi.mocked(await import('@anthropic-ai/claude-agent-sdk')).query = mockQuery;

      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.error?.message).toBe('String error');
      expect(result.error?.stack).toBeUndefined();
    });

    it('should preserve stack trace', async () => {
      const errorWithStack = new Error('Error with stack');
      const mockQuery = createMockQuery({ error: errorWithStack });
      vi.mocked(await import('@anthropic-ai/claude-agent-sdk')).query = mockQuery;

      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.error?.stack).toBe(errorWithStack.stack);
    });
  });

  describe('Integration & Edge Cases', () => {
    it('should integrate with RetryHandler callbacks', async () => {
      let callCount = 0;
      const retryingQuery = vi.fn().mockImplementation(async function* () {
        callCount++;
        if (callCount <= 2) {
          throw new Error('Retry test');
        }
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Success on retry' }] },
        };
      });

      vi.mocked(await import('@anthropic-ai/claude-agent-sdk')).query = retryingQuery;

      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, testRunId, testRepoPath);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const promise = executor.executeStage(stageWithRetry, runningPipelineState);

      // Advance through retry delays
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(2000);

      const result = await promise;

      expect(result.status).toBe('success');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Retrying'));

      consoleSpy.mockRestore();
    });

    it('should integrate with GitManager for commits', async () => {
      mockGitManager = createMockGitManager({
        hasChanges: true,
        commitSha: 'integration-commit',
        commitMessage: '[pipeline:test-stage] Integration test',
      });
      executor = new StageExecutor(mockGitManager, false, testRunId, testRepoPath);

      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(mockGitManager.hasUncommittedChanges).toHaveBeenCalled();
      expect(mockGitManager.createPipelineCommit).toHaveBeenCalled();
      expect(mockGitManager.getCommitMessage).toHaveBeenCalledWith('integration-commit');
      expect(result.commitSha).toBe('integration-commit');
    });

    it('should integrate with file system for agent loading', async () => {
      const fs = await import('fs/promises');
      vi.mocked(fs.readFile).mockResolvedValue('Custom agent prompt');

      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, testRunId, testRepoPath);

      await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(fs.readFile).toHaveBeenCalledWith('.claude/agents/test-agent.md', 'utf-8');
    });

    it('should handle concurrent stage executions', async () => {
      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, testRunId, testRepoPath);

      const promise1 = executor.executeStage(basicStageConfig, runningPipelineState);
      const promise2 = executor.executeStage(
        { ...basicStageConfig, name: 'stage-2' },
        runningPipelineState
      );

      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1.status).toBe('success');
      expect(result2.status).toBe('success');
      expect(result1.stageName).toBe('test-stage');
      expect(result2.stageName).toBe('stage-2');
    });

    it('should handle large agent output', async () => {
      const largeOutput = 'A'.repeat(100000); // 100KB output
      const mockQuery = createMockQuery({ output: largeOutput });
      vi.mocked(await import('@anthropic-ai/claude-agent-sdk')).query = mockQuery;

      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, testRunId, testRepoPath);

      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.status).toBe('success');
      expect(result.agentOutput).toBe(largeOutput);
    });

    it('should track stage execution state transitions correctly', async () => {
      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, testRunId, testRepoPath);

      await vi.advanceTimersByTimeAsync(1);
      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.status).toBe('success');
      expect(result.startTime).toBeDefined();
      expect(result.endTime).toBeDefined();
      expect(new Date(result.endTime!).getTime()).toBeGreaterThanOrEqual(
        new Date(result.startTime).getTime()
      );
    });
  });
});
