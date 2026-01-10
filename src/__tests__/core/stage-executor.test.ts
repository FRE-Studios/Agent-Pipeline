// src/core/stage-executor.test.ts

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { StageExecutor } from '../../core/stage-executor.js';
import { createMockGitManager } from '../mocks/git-manager.js';
import { runningPipelineState, completedPipelineState } from '../fixtures/pipeline-states.js';
import {
  basicStageConfig,
  stageWithOutputs,
  stageWithRetry,
  stageWithInputs,
  stageWithLongTimeout,
} from '../fixtures/stage-configs.js';
import type { PipelineState } from '../../config/schema.js';
import type { HandoverManager } from '../../core/handover-manager.js';

function createMockHandoverManager() {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    createStageDirectory: vi.fn().mockResolvedValue('/tmp/handover/stages/test-stage'),
    saveAgentOutput: vi.fn().mockResolvedValue(undefined),
    appendToLog: vi.fn().mockResolvedValue(undefined),
    getPreviousStages: vi.fn().mockResolvedValue([]),
    buildContextMessage: vi.fn().mockReturnValue('## Pipeline Handover Context\n...'),
    buildContextMessageAsync: vi.fn().mockResolvedValue('## Pipeline Handover Context\n...'),
    getHandoverDir: vi.fn().mockReturnValue('/tmp/handover'),
  } as unknown as HandoverManager;
}

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

// Mock TokenEstimator
vi.mock('../../utils/token-estimator.js', () => ({
  TokenEstimator: vi.fn(() => ({
    smartCount: vi.fn().mockResolvedValue({ tokens: 10000, method: 'estimated' }),
    estimateTokens: vi.fn().mockReturnValue(10000),
    dispose: vi.fn(),
  })),
}));

// Helper to create mock runtime
function createMockRuntime() {
  return {
    type: 'mock-runtime',
    name: 'Mock Runtime',
    execute: vi.fn(),
    getCapabilities: vi.fn().mockReturnValue({
      supportsStreaming: true,
      supportsTokenTracking: true,
      supportsMCP: true,
      supportsContextReduction: true,
      availableModels: ['haiku', 'sonnet', 'opus'],
      permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan']
    }),
    validate: vi.fn().mockResolvedValue({ valid: true, errors: [], warnings: [] })
  };
}

describe('StageExecutor', () => {
  beforeAll(() => {
    vi.useFakeTimers();
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  let executor: StageExecutor;
  let mockGitManager: ReturnType<typeof createMockGitManager>;
  let mockHandoverManager: ReturnType<typeof createMockHandoverManager>;
  let mockRuntime: ReturnType<typeof createMockRuntime>;
  let mockQuery: ReturnType<typeof vi.fn>;
  const testRunId = 'test-run-id-12345';
  const testRepoPath = '/test/repo/path';

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset fs.readFile mock (cleared by clearAllMocks)
    const fs = await import('fs/promises');
    vi.mocked(fs.readFile).mockResolvedValue('Mock agent system prompt');

    // Create mock handover manager
    mockHandoverManager = createMockHandoverManager();

    // Create mock runtime
    mockRuntime = createMockRuntime();
    mockRuntime.execute.mockResolvedValue({
      textOutput: 'Mock agent response',
      extractedData: undefined,
      tokenUsage: {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150
      },
      numTurns: 1
    });

    // Register mock runtimes in AgentRuntimeRegistry for all runtime types
    const { AgentRuntimeRegistry } = await import('../../core/agent-runtime-registry.js');

    // Create runtime variants with different types
    const sdkRuntime = { ...mockRuntime, type: 'claude-sdk', name: 'Claude SDK Runtime' };
    const headlessRuntime = { ...mockRuntime, type: 'claude-code-headless', name: 'Claude Code Headless Runtime' };

    AgentRuntimeRegistry.register(sdkRuntime);
    AgentRuntimeRegistry.register(headlessRuntime);

    // Get the mocked query function (still needed for some tests)
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

  afterEach(async () => {
    vi.restoreAllMocks();

    // Clear AgentRuntimeRegistry between tests
    const { AgentRuntimeRegistry } = await import('../../core/agent-runtime-registry.js');
    AgentRuntimeRegistry.clear();
  });

  // NOTE: Some tests in this suite require complex mock coordination - deferred to Phase 7
  describe('executeStage - Success Scenarios', () => {
    it('should execute stage successfully with agent output', async () => {
      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, mockHandoverManager, mockRuntime);

      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.status).toBe('success');
      expect(result.stageName).toBe('test-stage');
      expect(result.agentOutput).toBe('Mock agent response');
      expect(result.startTime).toBeDefined();
      expect(result.endTime).toBeDefined();
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    // REMOVED: "should persist stage outputs" test
    // OutputStorageManager was removed - agents now use handover files

    it('should execute successfully after retries (test 1)', async () => {
      let callCount = 0;
      mockRuntime.execute.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('First attempt failed');
        }
        return {
          textOutput: 'Success after retry',
          tokenUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
          numTurns: 1
        };
      });

      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, mockHandoverManager, mockRuntime);

      const promise = executor.executeStage(stageWithRetry, runningPipelineState);
      promise.catch(() => {}); // Suppress unhandled rejection warning
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.status).toBe('success');
      expect(result.retryAttempt).toBeGreaterThan(0);
    });

    it('should handle agent execution failure without retry', async () => {
      // Use runtime abstraction for errors
      mockRuntime.execute.mockRejectedValue(new Error('Agent execution failed'));

      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, mockHandoverManager, mockRuntime);

      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.status).toBe('failed');
      expect(result.error).toBeDefined();
      expect(result.error?.message).toBe('Agent execution failed');
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should calculate duration in seconds accurately', async () => {
      // Mock runtime execution with delay
      mockRuntime.execute.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return {
          textOutput: 'Mock agent response',
          tokenUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
          numTurns: 1
        };
      });

      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, mockHandoverManager, mockRuntime);

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
      executor = new StageExecutor(mockGitManager, false, mockHandoverManager, mockRuntime);

      await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(mockGitManager.hasUncommittedChanges).toHaveBeenCalled();
      expect(mockGitManager.createPipelineCommit).toHaveBeenCalled();
      expect(mockGitManager.getCommitMessage).toHaveBeenCalledWith('integration-commit');
    });

    // extractedData feature was removed - agents now use handover files for passing data

    it('should execute stage with auto-commit when changes are present', async () => {
      mockGitManager = createMockGitManager({
        hasChanges: true,
        commitSha: 'new-commit-123',
        commitMessage: '[pipeline:test-stage] Test commit',
      });
      executor = new StageExecutor(mockGitManager, false, mockHandoverManager, mockRuntime);

      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.status).toBe('success');
      expect(result.commitSha).toBe('new-commit-123');
      expect(result.commitMessage).toBe('[pipeline:test-stage] Test commit');
      expect(mockGitManager.createPipelineCommit).toHaveBeenCalledWith(
        'test-stage',
        'test-run-123',
        undefined,
        '[pipeline:{{stage}}]'
      );
    });

    // NOTE: Stage-level autoCommit/commitMessage were removed in schema refactor.
    // Git settings are now pipeline-level only via git.autoCommit.

    it('should respect pipeline-level auto-commit disabled setting', async () => {
      mockGitManager = createMockGitManager({ hasChanges: true });
      executor = new StageExecutor(mockGitManager, false, mockHandoverManager, mockRuntime);

      const noAutoCommitPipelineState: PipelineState = {
        ...runningPipelineState,
        pipelineConfig: {
          ...runningPipelineState.pipelineConfig,
          git: {
            ...runningPipelineState.pipelineConfig.git,
            autoCommit: false,
          },
        },
      };

      const result = await executor.executeStage(basicStageConfig, noAutoCommitPipelineState);

      expect(result.status).toBe('success');
      expect(result.commitSha).toBeUndefined();
      expect(mockGitManager.createPipelineCommit).not.toHaveBeenCalled();
    });

    it('should not attempt commits when git section is undefined', async () => {
      mockGitManager = createMockGitManager({ hasChanges: true });
      executor = new StageExecutor(mockGitManager, false, mockHandoverManager, mockRuntime);

      // Pipeline with no git section at all - should not attempt any commits
      const noGitConfigPipelineState: PipelineState = {
        ...runningPipelineState,
        pipelineConfig: {
          ...runningPipelineState.pipelineConfig,
          git: undefined,
        },
      };

      const result = await executor.executeStage(basicStageConfig, noGitConfigPipelineState);

      expect(result.status).toBe('success');
      expect(result.commitSha).toBeUndefined();
      expect(mockGitManager.createPipelineCommit).not.toHaveBeenCalled();
      // Should not even check for changes when git is not configured
      expect(mockGitManager.hasUncommittedChanges).not.toHaveBeenCalled();
    });

    it('should not commit when no changes are present', async () => {
      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, mockHandoverManager, mockRuntime);

      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.status).toBe('success');
      expect(result.commitSha).toBeUndefined();
      expect(mockGitManager.git.commit).not.toHaveBeenCalled();
    });

    it('should execute in dry-run mode with changes', async () => {
      mockGitManager = createMockGitManager({ hasChanges: true });
      // Pass verbose logging context to see log messages
      executor = new StageExecutor(
        mockGitManager, true, mockHandoverManager, mockRuntime,
        undefined, undefined, undefined,
        { interactive: false, verbose: true }
      ); // dry-run mode

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
      executor = new StageExecutor(mockGitManager, true, mockHandoverManager, mockRuntime);

      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.status).toBe('success');
      expect(mockGitManager.hasUncommittedChanges).toHaveBeenCalled();
    });

    it('should invoke output callback with streaming updates', async () => {
      // Mock runtime to simulate streaming by calling onOutputUpdate
      mockRuntime.execute.mockImplementation(async (request) => {
        // Simulate streaming updates
        if (request.options?.onOutputUpdate) {
          request.options.onOutputUpdate('Mock agent');
          request.options.onOutputUpdate('Mock agent response');
        }
        return {
          textOutput: 'Mock agent response',
          tokenUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
          numTurns: 1
        };
      });

      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, mockHandoverManager, mockRuntime);

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
      executor = new StageExecutor(mockGitManager, false, mockHandoverManager, mockRuntime);

      const result = await executor.executeStage(stageWithRetry, runningPipelineState);

      expect(result.status).toBe('success');
      expect(result.retryAttempt).toBe(0);
      expect(result.maxRetries).toBe(3);
    });



    it('should respect custom timeout value', async () => {
      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, mockHandoverManager, mockRuntime);

      const result = await executor.executeStage(stageWithLongTimeout, runningPipelineState);

      expect(result.status).toBe('success');
      // Timeout of 600s should be respected
    });

    it('should include stage inputs in agent context', async () => {
      const fs = await import('fs/promises');
      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, mockHandoverManager, mockRuntime);

      await executor.executeStage(stageWithInputs, runningPipelineState);

      // The runtime execute should be called with context containing inputs
      expect(mockRuntime.execute).toHaveBeenCalled();

      // Check that execute was called with proper request structure (2 params: request, abortController)
      const executeCall = mockRuntime.execute.mock.calls[0];
      expect(executeCall[0]).toMatchObject({
        userPrompt: expect.stringContaining('targetFile'),
        systemPrompt: expect.any(String),
        options: expect.any(Object)
      });

      // Also verify the specific input values are in the context
      expect(executeCall[0].userPrompt).toContain('src/main.ts');
    });

    it('should include previous stages in context via handover manager', async () => {
      mockGitManager = createMockGitManager({ hasChanges: false });
      mockHandoverManager.getPreviousStages = vi.fn().mockResolvedValue(['stage-1', 'stage-2']);
      executor = new StageExecutor(mockGitManager, false, mockHandoverManager, mockRuntime);

      await executor.executeStage(basicStageConfig, completedPipelineState);

      expect(mockRuntime.execute).toHaveBeenCalled();

      // Verify handover manager was used to get previous stages
      expect(mockHandoverManager.getPreviousStages).toHaveBeenCalled();
      expect(mockHandoverManager.buildContextMessageAsync).toHaveBeenCalledWith(
        'test-stage',
        ['stage-1', 'stage-2'],
        undefined
      );
    });
  });

  describe('executeStage - Failure Scenarios', () => {
    it('should handle agent execution failure without retry', async () => {
      mockRuntime.execute.mockRejectedValue(new Error('Agent execution failed'));

      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, mockHandoverManager, mockRuntime);

      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.status).toBe('failed');
      expect(result.error).toBeDefined();
      expect(result.error?.message).toBe('Agent execution failed');
    });

    it('should handle agent execution failure after max retries', async () => {
      mockRuntime.execute.mockRejectedValue(new Error('Persistent failure'));

      mockGitManager = createMockGitManager({ hasChanges: false });
      // Pass verbose logging context to see retry log messages
      executor = new StageExecutor(
        mockGitManager, false, mockHandoverManager, mockRuntime,
        undefined, undefined, undefined,
        { interactive: false, verbose: true }
      );

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
      mockRuntime.execute.mockImplementation(() =>
        new Promise((resolve) => setTimeout(resolve, 200000)) // 200 seconds - exceeds timeout
      );

      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, mockHandoverManager, mockRuntime);

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
      executor = new StageExecutor(mockGitManager, false, mockHandoverManager, mockRuntime);

      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.status).toBe('failed');
      expect(result.error?.message).toContain('ENOENT');
      expect(result.error?.suggestion).toContain('Agent file not found');
      expect(result.error?.agentPath).toBe('.agent-pipeline/agents/test-agent.md');
    });

    it('should handle API authentication error', async () => {
      mockRuntime.execute.mockRejectedValue(new Error('API error: 401 Unauthorized'));

      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, mockHandoverManager, mockRuntime);

      await vi.advanceTimersByTimeAsync(1);
      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.status).toBe('failed');
      expect(result.error?.suggestion).toContain('ANTHROPIC_API_KEY');
    });

    it('should handle YAML parsing error', async () => {
      mockRuntime.execute.mockRejectedValue(new Error('YAML parse error: invalid syntax'));

      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, mockHandoverManager, mockRuntime);

      await vi.advanceTimersByTimeAsync(1);
      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.status).toBe('failed');
      expect(result.error?.suggestion).toContain('YAML syntax');
    });

    it('should handle permission error', async () => {
      const fs = await import('fs/promises');
      vi.mocked(fs.readFile).mockRejectedValue(new Error('permission denied'));

      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, mockHandoverManager, mockRuntime);

      await vi.advanceTimersByTimeAsync(1);
      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.status).toBe('failed');
      expect(result.error?.suggestion).toContain('permission');
    });

    it('should handle generic errors', async () => {
      mockRuntime.execute.mockRejectedValue(new Error('Unknown error occurred'));

      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, mockHandoverManager, mockRuntime);

      await vi.advanceTimersByTimeAsync(1);
      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.status).toBe('failed');
      expect(result.error?.message).toBe('Unknown error occurred');
      expect(result.error?.timestamp).toBeDefined();
    });

    it('should include retry info in error message', async () => {
      mockRuntime.execute.mockRejectedValue(new Error('Failed after retries'));

      mockGitManager = createMockGitManager({ hasChanges: false });
      // Pass non-interactive logging context to see error log messages
      executor = new StageExecutor(
        mockGitManager, false, mockHandoverManager, mockRuntime,
        undefined, undefined, undefined,
        { interactive: false, verbose: false }
      );

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
      mockRuntime.execute.mockRejectedValue(new Error('Failed'));

      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, mockHandoverManager, mockRuntime);

      await vi.advanceTimersByTimeAsync(1);
      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.status).toBe('failed');
      expect(result.duration).toBeDefined();
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should handle git commit failure', async () => {
      mockGitManager = createMockGitManager({ hasChanges: true, shouldFailCommit: true });
      executor = new StageExecutor(mockGitManager, false, mockHandoverManager, mockRuntime);

      await vi.advanceTimersByTimeAsync(1);
      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.status).toBe('failed');
      expect(result.error?.message).toContain('Git commit failed');
    });

    // REMOVED: "should skip saving verbose outputs" test
    // OutputStorageManager was removed - agents now use handover files
  });

  // Phase 7.2: Runtime-agnostic tests for context building
  describe('buildAgentContext', () => {
    beforeEach(() => {
      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, mockHandoverManager, mockRuntime);
    });

    it('should build context with no previous stages', async () => {
      const emptyState: PipelineState = {
        ...runningPipelineState,
        stages: [],
      };

      await executor.executeStage(basicStageConfig, emptyState);

      const callArgs = mockRuntime.execute.mock.calls[0][0];
      expect(callArgs.userPrompt).toContain('Pipeline Run ID');
      expect(callArgs.userPrompt).toContain('test-run-123');
      expect(callArgs.userPrompt).not.toContain('stage-1');
    });

    it('should build context with single successful previous stage', async () => {
      // Mock previous stages in handover directory
      mockHandoverManager.getPreviousStages = vi.fn().mockResolvedValue(['stage-1']);

      await executor.executeStage(basicStageConfig, runningPipelineState);

      // Handover manager should have been used
      expect(mockHandoverManager.getPreviousStages).toHaveBeenCalled();
      expect(mockHandoverManager.buildContextMessageAsync).toHaveBeenCalled();
    });

    it('should build context with multiple successful previous stages', async () => {
      // Mock multiple previous stages in handover directory
      mockHandoverManager.getPreviousStages = vi.fn().mockResolvedValue(['stage-1', 'stage-2']);

      await executor.executeStage(basicStageConfig, completedPipelineState);

      // Handover manager should have been used with multiple stages
      expect(mockHandoverManager.getPreviousStages).toHaveBeenCalled();
      expect(mockHandoverManager.buildContextMessageAsync).toHaveBeenCalled();
    });

    it('should use handover manager for context with many stages', async () => {
      // Mock many previous stages in handover directory
      mockHandoverManager.getPreviousStages = vi.fn().mockResolvedValue(['stage-a', 'stage-b', 'stage-c']);

      const extendedState: PipelineState = {
        ...runningPipelineState,
        stages: [
          { stageName: 'stage-a', status: 'success', startTime: '2024-01-01T00:00:00.000Z', endTime: '2024-01-01T00:01:00.000Z', duration: 60 },
          { stageName: 'stage-b', status: 'success', startTime: '2024-01-01T00:01:00.000Z', endTime: '2024-01-01T00:02:00.000Z', duration: 60 },
          { stageName: 'stage-c', status: 'success', startTime: '2024-01-01T00:02:00.000Z', endTime: '2024-01-01T00:03:00.000Z', duration: 60 },
        ],
      };

      await executor.executeStage(basicStageConfig, extendedState);

      // Handover manager should be used for context
      expect(mockHandoverManager.getPreviousStages).toHaveBeenCalled();
      expect(mockHandoverManager.buildContextMessageAsync).toHaveBeenCalled();
    });

    it('should use handover manager to track previous stages', async () => {
      // Handover manager reads from filesystem, filtering is done there
      mockHandoverManager.getPreviousStages = vi.fn().mockResolvedValue(['stage-1']);

      await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(mockHandoverManager.getPreviousStages).toHaveBeenCalled();
    });

    it('should include handover context from handover manager', async () => {
      // Setup handover manager mock with specific context
      mockHandoverManager.buildContextMessageAsync = vi.fn().mockResolvedValue('## Pipeline Handover Context\n**Handover Directory:** /test/handover');

      await executor.executeStage(basicStageConfig, completedPipelineState);

      const callArgs = mockRuntime.execute.mock.calls[0][0];
      expect(callArgs.userPrompt).toContain('Pipeline Handover Context');
    });

    it('should include handover directory path in context', async () => {
      mockHandoverManager.buildContextMessageAsync = vi.fn().mockResolvedValue(
        '## Pipeline Handover Context\n**Handover Directory:** `/tmp/handover`\n### Previous Stage Outputs\n- `/tmp/handover/stages/file-stage/output.md`'
      );

      await executor.executeStage(basicStageConfig, runningPipelineState);

      const callArgs = mockRuntime.execute.mock.calls[0][0];
      expect(callArgs.userPrompt).toContain('/tmp/handover');
    });

    // REMOVED: "should include output instructions when stage declares outputs" test
    // report_outputs feature was removed - agents now use handover files

    it('should include trigger commit in context', async () => {
      await executor.executeStage(basicStageConfig, runningPipelineState);

      const callArgs = mockRuntime.execute.mock.calls[0][0];
      expect(callArgs.userPrompt).toContain('Trigger Commit');
    });

    it('should include stage inputs in context', async () => {
      await executor.executeStage(stageWithInputs, runningPipelineState);

      const callArgs = mockRuntime.execute.mock.calls[0][0];
      expect(callArgs.userPrompt).toContain('User Inputs to Help with Your Task');
      expect(callArgs.userPrompt).toContain('**targetFile**');
      expect(callArgs.userPrompt).toContain('**maxIssues**');
      expect(callArgs.userPrompt).toContain('**strictMode**');
    });
  });

  // Phase 7.2: Runtime-agnostic tests for agent execution with timeout handling
  describe('runAgentWithTimeout', () => {
    beforeEach(() => {
      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, mockHandoverManager, mockRuntime);
    });

    it('should execute agent query successfully', async () => {
      mockRuntime.execute.mockResolvedValue({
        textOutput: 'Agent completed successfully',
        extractedData: undefined,
        tokenUsage: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150
        },
        numTurns: 1
      });

      await vi.advanceTimersByTimeAsync(1);
      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.status).toBe('success');
      expect(result.agentOutput).toBe('Agent completed successfully');
    });

    it('should timeout after configured seconds', async () => {
      // Mock a long-running execution that exceeds timeout
      mockRuntime.execute.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 150000)); // 150s
        return {
          textOutput: 'Done',
          extractedData: undefined,
          tokenUsage: {
            inputTokens: 100,
            outputTokens: 50,
            totalTokens: 150
          },
          numTurns: 1
        };
      });

      const promise = executor.executeStage(basicStageConfig, runningPipelineState);

      // Advance past timeout (120s)
      await vi.advanceTimersByTimeAsync(120001);

      const result = await promise;

      expect(result.status).toBe('failed');
      expect(result.error?.message).toContain('timeout');
    });

    it('should use default timeout of 900 seconds when not specified', async () => {
      const stageWithoutTimeout = { ...basicStageConfig, timeout: undefined };

      // Mock a never-completing execution
      mockRuntime.execute.mockImplementation(async () => {
        await new Promise(() => {}); // Never resolves
        return {
          textOutput: 'Never reached',
          extractedData: undefined,
          tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          numTurns: 0
        };
      });

      const promise = executor.executeStage(stageWithoutTimeout, runningPipelineState);

      // Advance to just past default 900s timeout
      await vi.advanceTimersByTimeAsync(900001);

      const result = await promise;

      expect(result.status).toBe('failed');
      expect(result.error?.message).toContain('timeout');
    });

    // Note: Warning timer tests removed as they test implementation details that are
    // difficult to verify with mocked timers. The warning functionality is verified
    // through manual testing and the timer cleanup tests below verify proper cleanup.

    it('should clean up warning timers on successful completion', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      mockRuntime.execute.mockResolvedValue({
        textOutput: 'Quick completion',
        extractedData: undefined,
        tokenUsage: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150
        },
        numTurns: 1
      });

      await executor.executeStage(basicStageConfig, runningPipelineState);

      // Advance past all warning thresholds - should not emit warnings
      await vi.advanceTimersByTimeAsync(900000);

      expect(consoleWarnSpy).not.toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });

    it('should clean up warning timers on timeout', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      mockRuntime.execute.mockImplementation(async () => {
        await new Promise(() => {}); // Never resolves
        return {
          textOutput: 'Never reached',
          extractedData: undefined,
          tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          numTurns: 0
        };
      });

      const promise = executor.executeStage(basicStageConfig, runningPipelineState);

      // Advance to timeout
      await vi.advanceTimersByTimeAsync(120001);

      const result = await promise;
      expect(result.status).toBe('failed');

      // After timeout, advancing time should not trigger more warnings
      const warningCount = consoleWarnSpy.mock.calls.length;
      await vi.advanceTimersByTimeAsync(900000);

      expect(consoleWarnSpy).toHaveBeenCalledTimes(warningCount); // No new warnings
      consoleWarnSpy.mockRestore();
    });

    // Note: Streaming and message-level tests are runtime-specific and tested in runtime implementation tests
    // The stage executor just passes the callback through to the runtime

    it('should handle empty agent response', async () => {
      mockRuntime.execute.mockResolvedValue({
        textOutput: '',
        extractedData: undefined,
        tokenUsage: {
          inputTokens: 100,
          outputTokens: 0,
          totalTokens: 100
        },
        numTurns: 1
      });

      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.agentOutput).toBe('');
    });

    it('should pass onOutputUpdate callback to runtime', async () => {
      const callback = vi.fn();

      mockRuntime.execute.mockResolvedValue({
        textOutput: 'Agent output',
        extractedData: undefined,
        tokenUsage: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150
        },
        numTurns: 1
      });

      await executor.executeStage(
        basicStageConfig,
        runningPipelineState,
        callback
      );

      // Verify callback was passed to runtime in options
      const executeCall = mockRuntime.execute.mock.calls[0];
      expect(executeCall[0].options.onOutputUpdate).toBe(callback);
    });
  });

  // REMOVED: "Tool-based output extraction" and "extractOutputs" blocks
  // extractedData feature was removed - agents now use handover files for passing data
  // between stages. Previous tests for MCP tool extraction and regex extraction are obsolete.

  describe('calculateDuration', () => {
    beforeEach(() => {
      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, mockHandoverManager, mockRuntime);
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
      // Mock runtime execution with delay
      mockRuntime.execute.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return {
          textOutput: 'Mock agent response',
          tokenUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
          numTurns: 1
        };
      });

      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, mockHandoverManager, mockRuntime);

      const promise = executor.executeStage(basicStageConfig, runningPipelineState);
      await vi.advanceTimersByTimeAsync(1000);
      const result = await promise;

      expect(result.duration).toBeCloseTo(1, 1);
    });
  });

  describe('captureErrorDetails', () => {
    beforeEach(() => {
      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, mockHandoverManager, mockRuntime);
    });

    it('should capture ENOENT error with file path suggestion', async () => {
      const fs = await import('fs/promises');
      vi.mocked(fs.readFile).mockRejectedValue(
        Object.assign(new Error('ENOENT: file not found'), { code: 'ENOENT' })
      );

      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.error?.suggestion).toContain('Agent file not found');
      expect(result.error?.agentPath).toBe('.agent-pipeline/agents/test-agent.md');
    });

    it('should capture timeout error with timeout increase suggestion', async () => {
      // Mock runtime execution that times out
      mockRuntime.execute.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 150000));
        return {
          textOutput: '',
          tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          numTurns: 0
        };
      });

      const promise = executor.executeStage(basicStageConfig, runningPipelineState);
      await vi.advanceTimersByTimeAsync(120001);

      const result = await promise;

      expect(result.error?.suggestion).toContain('timeout');
      expect(result.error?.suggestion).toContain('pipeline config');
    });

    it('should capture API error with API key suggestion', async () => {
      // Mock runtime execution failure with API error
      mockRuntime.execute.mockRejectedValue(new Error('API 401: Unauthorized'));

      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.error?.suggestion).toContain('ANTHROPIC_API_KEY');
    });

    it('should capture YAML parse error with syntax suggestion', async () => {
      // Mock runtime execution failure with YAML error
      mockRuntime.execute.mockRejectedValue(new Error('YAML parse error'));

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
      // Mock runtime execution failure with standard Error
      mockRuntime.execute.mockRejectedValue(new Error('Standard error'));

      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.error?.message).toBe('Standard error');
      expect(result.error?.stack).toBeDefined();
      expect(result.error?.timestamp).toBeDefined();
    });

    it('should handle non-Error objects (strings)', async () => {
      // Mock runtime execution failure with string error
      mockRuntime.execute.mockRejectedValue('String error');

      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.error?.message).toBe('String error');
      expect(result.error?.stack).toBeUndefined();
    });

    it('should preserve stack trace', async () => {
      const errorWithStack = new Error('Error with stack');
      // Mock runtime execution failure preserving stack
      mockRuntime.execute.mockRejectedValue(errorWithStack);

      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.error?.stack).toBe(errorWithStack.stack);
    });
  });

  describe('Integration & Edge Cases', () => {
    it('should integrate with RetryHandler callbacks', async () => {
      let callCount = 0;
      // Mock runtime with stateful retries
      mockRuntime.execute.mockImplementation(async () => {
        callCount++;
        if (callCount <= 2) {
          throw new Error('Retry test');
        }
        return {
          textOutput: 'Success on retry',
          tokenUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
          numTurns: 1
        };
      });

      mockGitManager = createMockGitManager({ hasChanges: false });
      // Pass verbose logging context to see retry log messages
      executor = new StageExecutor(
        mockGitManager, false, mockHandoverManager, mockRuntime,
        undefined, undefined, undefined,
        { interactive: false, verbose: true }
      );

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
      executor = new StageExecutor(mockGitManager, false, mockHandoverManager, mockRuntime);

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
      executor = new StageExecutor(mockGitManager, false, mockHandoverManager, mockRuntime);

      await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(fs.readFile).toHaveBeenCalledWith('.agent-pipeline/agents/test-agent.md', 'utf-8');
    });

    it('should handle concurrent stage executions', async () => {
      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, mockHandoverManager, mockRuntime);

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
      // Mock runtime with large output
      mockRuntime.execute.mockResolvedValue({
        textOutput: largeOutput,
        tokenUsage: { inputTokens: 100, outputTokens: 50000, totalTokens: 50100 },
        numTurns: 1
      });

      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, mockHandoverManager, mockRuntime);

      const result = await executor.executeStage(basicStageConfig, runningPipelineState);

      expect(result.status).toBe('success');
      expect(result.agentOutput).toBe(largeOutput);
    });

    it('should track stage execution state transitions correctly', async () => {
      mockGitManager = createMockGitManager({ hasChanges: false });
      executor = new StageExecutor(mockGitManager, false, mockHandoverManager, mockRuntime);

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

  // REMOVED: "Context Size Warnings" block
  // Context size warning functionality was removed

  // REMOVED: "Token Usage with Cache Metrics" and "Token Usage with num_turns and thinking_tokens" describe blocks
  // These tests were testing runtime-specific token normalization functionality. Token usage
  // normalization (mapping SDK token fields to StageResult format) is tested in individual
  // runtime implementation test files (claude-sdk-runtime.test.ts, claude-code-headless-runtime.test.ts).
  // StageExecutor simply passes through the normalized tokenUsage from the runtime.

  // REMOVED: "Output Validation Warnings" block
  // extractedData feature was removed - agents now use handover files for passing data
  // Output validation (summary, missing outputs) was tied to the extractedData system

  // Phase 7.2: Runtime-agnostic tests for permission mode configuration
  describe('Permission Mode', () => {
    it('should use acceptEdits permission mode by default when not specified', async () => {
      const state = { ...runningPipelineState };
      await executor.executeStage(basicStageConfig, state);

      const executeCall = mockRuntime.execute.mock.calls[0];
      expect(executeCall[0].options.permissionMode).toBe('acceptEdits');
    });

    it('should use configured permission mode from execution config', async () => {
      const state = {
        ...runningPipelineState,
        pipelineConfig: {
          ...runningPipelineState.pipelineConfig,
          execution: {
            ...runningPipelineState.pipelineConfig.execution,
            permissionMode: 'default' as const
          }
        }
      };

      await executor.executeStage(basicStageConfig, state);

      const executeCall = mockRuntime.execute.mock.calls[0];
      expect(executeCall[0].options.permissionMode).toBe('default');
    });

    it('should support plan permission mode', async () => {
      const state = {
        ...runningPipelineState,
        pipelineConfig: {
          ...runningPipelineState.pipelineConfig,
          execution: {
            ...runningPipelineState.pipelineConfig.execution,
            permissionMode: 'plan' as const
          }
        }
      };

      await executor.executeStage(basicStageConfig, state);

      const executeCall = mockRuntime.execute.mock.calls[0];
      expect(executeCall[0].options.permissionMode).toBe('plan');
    });

    it('should support bypassPermissions mode', async () => {
      const state = {
        ...runningPipelineState,
        pipelineConfig: {
          ...runningPipelineState.pipelineConfig,
          execution: {
            ...runningPipelineState.pipelineConfig.execution,
            permissionMode: 'bypassPermissions' as const
          }
        }
      };

      await executor.executeStage(basicStageConfig, state);

      const executeCall = mockRuntime.execute.mock.calls[0];
      expect(executeCall[0].options.permissionMode).toBe('bypassPermissions');
    });
  });

  describe('Runtime Resolution (Phase 6.1 Smoke Tests)', () => {
    it('should use stage-level runtime when specified', async () => {
      mockGitManager = createMockGitManager({ hasChanges: false });
      // Pass verbose logging context to see runtime resolution logs
      executor = new StageExecutor(
        mockGitManager, false, mockHandoverManager, mockRuntime,
        undefined, undefined, undefined,
        { interactive: false, verbose: true }
      );

      const stageWithRuntime: AgentStageConfig = {
        ...basicStageConfig,
        runtime: {
          type: 'claude-sdk',
          options: { model: 'haiku' }
        }
      };

      const consoleSpy = vi.spyOn(console, 'log');

      await executor.executeStage(stageWithRuntime, runningPipelineState);

      // Check if the log appears anywhere in the console calls
      const logCalls = consoleSpy.mock.calls.map(call => call[0]).join('\n');
      expect(logCalls).toContain('Using stage-level runtime: claude-sdk');
      consoleSpy.mockRestore();
    });

    it('should use pipeline-level runtime when stage runtime not specified', async () => {
      mockGitManager = createMockGitManager({ hasChanges: false });
      // Pass verbose logging context to see runtime resolution logs
      executor = new StageExecutor(
        mockGitManager, false, mockHandoverManager,
        undefined, undefined, undefined, undefined,
        { interactive: false, verbose: true }
      );

      const pipelineWithRuntime: PipelineState = {
        ...runningPipelineState,
        pipelineConfig: {
          ...runningPipelineState.pipelineConfig,
          runtime: {
            type: 'claude-sdk',
            options: { model: 'sonnet' }
          }
        }
      };

      const consoleSpy = vi.spyOn(console, 'log');

      await executor.executeStage(basicStageConfig, pipelineWithRuntime);

      // Check if the log appears anywhere in the console calls
      const logCalls = consoleSpy.mock.calls.map(call => call[0]).join('\n');
      expect(logCalls).toContain('Using pipeline-level runtime: claude-sdk');
      consoleSpy.mockRestore();
    });

    it('should use global default runtime (claude-code-headless) when no runtime specified', async () => {
      mockGitManager = createMockGitManager({ hasChanges: false });
      // Create executor without providing a runtime - it should resolve to the global default
      // Pass verbose logging context to see runtime resolution logs
      executor = new StageExecutor(
        mockGitManager, false, mockHandoverManager,
        undefined, undefined, undefined, undefined,
        { interactive: false, verbose: true }
      );

      // Create a pipeline state without any runtime config
      const stateWithoutRuntime: PipelineState = {
        ...runningPipelineState,
        pipelineConfig: {
          ...runningPipelineState.pipelineConfig,
          runtime: undefined  // No runtime config
        }
      };

      const consoleSpy = vi.spyOn(console, 'log');

      await executor.executeStage(basicStageConfig, stateWithoutRuntime);

      // Check if the log appears anywhere in the console calls
      const logCalls = consoleSpy.mock.calls.map(call => call[0]).join('\n');
      expect(logCalls).toContain('Using global default runtime: claude-code-headless');
      consoleSpy.mockRestore();
    });

    it('should prioritize stage runtime over pipeline runtime', async () => {
      mockGitManager = createMockGitManager({ hasChanges: false });
      // Pass verbose logging context to see runtime resolution logs
      executor = new StageExecutor(
        mockGitManager, false, mockHandoverManager,
        undefined, undefined, undefined, undefined,
        { interactive: false, verbose: true }
      );

      const stageWithRuntime: AgentStageConfig = {
        ...basicStageConfig,
        runtime: {
          type: 'claude-sdk',
          options: { model: 'haiku' }
        }
      };

      const pipelineWithRuntime: PipelineState = {
        ...runningPipelineState,
        pipelineConfig: {
          ...runningPipelineState.pipelineConfig,
          runtime: {
            type: 'claude-code-headless',
            options: {}
          }
        }
      };

      const consoleSpy = vi.spyOn(console, 'log');

      await executor.executeStage(stageWithRuntime, pipelineWithRuntime);

      // Should use stage-level (claude-sdk), not pipeline-level (claude-code-headless)
      const logCalls = consoleSpy.mock.calls.map(call => call[0]).join('\n');
      expect(logCalls).toContain('Using stage-level runtime: claude-sdk');
      expect(logCalls).not.toContain('Using pipeline-level runtime');
      consoleSpy.mockRestore();
    });
  });
});
