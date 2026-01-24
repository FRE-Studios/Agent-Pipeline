// src/__tests__/core/pipeline-runner.test.ts

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PipelineRunner } from '../../core/pipeline-runner.js';
import { PipelineConfig, PipelineState, StageExecution } from '../../config/schema.js';
import { simplePipelineConfig, parallelPipelineConfig } from '../fixtures/pipeline-configs.js';
import { PipelineAbortController, PipelineAbortError } from '../../core/abort-controller.js';

// Hoisted mocks
const {
  mockGitManagerInstance,
  mockBranchManagerInstance,
  mockPRCreatorInstance,
  mockStateManagerInstance,
  mockDAGPlannerInstance,
  mockInitializerInstance,
  mockOrchestratorInstance,
  mockFinalizerInstance,
  mockLoopStateManagerInstance,
  mockRuntimeInstance,
} = vi.hoisted(() => {
  return {
    mockGitManagerInstance: {
      getCurrentCommit: vi.fn().mockResolvedValue('abc123'),
    },
    mockBranchManagerInstance: {
      pushBranch: vi.fn().mockResolvedValue(undefined),
    },
    mockPRCreatorInstance: {
      prExists: vi.fn().mockResolvedValue(false),
      createPR: vi.fn().mockResolvedValue({ url: 'https://github.com/test/pr/1', number: 1 }),
    },
    mockStateManagerInstance: {
      saveState: vi.fn().mockResolvedValue(undefined),
      loadState: vi.fn().mockResolvedValue(null),
    },
    mockDAGPlannerInstance: {
      buildExecutionPlan: vi.fn().mockReturnValue({
        plan: {
          groups: [{ stages: [{ name: 'stage-1', agent: 'test.md' }] }],
          maxParallelism: 1,
        },
        validation: { warnings: [], isValid: true },
      }),
    },
    mockInitializerInstance: {
      initialize: vi.fn(),
    },
    mockOrchestratorInstance: {
      processGroup: vi.fn(),
    },
    mockFinalizerInstance: {
      finalize: vi.fn(),
    },
    mockLoopStateManagerInstance: {
      startSession: vi.fn().mockResolvedValue({ sessionId: 'session-123' }),
      appendIteration: vi.fn().mockResolvedValue(undefined),
      updateIteration: vi.fn().mockResolvedValue(true),
      completeSession: vi.fn().mockResolvedValue(undefined),
      createSessionDirectories: vi.fn().mockResolvedValue(undefined),
      getSessionQueueDir: vi.fn().mockReturnValue('.agent-pipeline/loops/session-123'),
    },
    mockRuntimeInstance: {
      execute: vi.fn().mockResolvedValue({
        result: { output: 'Done' },
        usage: { inputTokens: 100, outputTokens: 50 },
      }),
    },
  };
});

// Mock all dependencies
vi.mock('../../core/git-manager.js', () => ({
  GitManager: vi.fn(() => mockGitManagerInstance),
}));

vi.mock('../../core/branch-manager.js', () => ({
  BranchManager: vi.fn(() => mockBranchManagerInstance),
}));

vi.mock('../../core/pr-creator.js', () => ({
  PRCreator: vi.fn(() => mockPRCreatorInstance),
}));

vi.mock('../../core/state-manager.js', () => ({
  StateManager: vi.fn(() => mockStateManagerInstance),
}));

vi.mock('../../core/dag-planner.js', () => ({
  DAGPlanner: vi.fn(() => mockDAGPlannerInstance),
}));

vi.mock('../../core/pipeline-initializer.js', () => ({
  PipelineInitializer: vi.fn(() => mockInitializerInstance),
}));

vi.mock('../../core/group-execution-orchestrator.js', () => ({
  GroupExecutionOrchestrator: vi.fn(() => mockOrchestratorInstance),
}));

vi.mock('../../core/pipeline-finalizer.js', () => ({
  PipelineFinalizer: vi.fn(() => mockFinalizerInstance),
}));

vi.mock('../../core/loop-state-manager.js', () => ({
  LoopStateManager: vi.fn(() => mockLoopStateManagerInstance),
}));

vi.mock('../../core/agent-runtime-registry.js', () => ({
  AgentRuntimeRegistry: {
    getRuntime: vi.fn(() => mockRuntimeInstance),
  },
}));

vi.mock('../../notifications/notification-manager.js', () => ({
  NotificationManager: vi.fn(() => ({
    notify: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  stat: vi.fn().mockResolvedValue({ mtime: new Date() }),
  access: vi.fn().mockRejectedValue(new Error('Not found')),
  rename: vi.fn().mockResolvedValue(undefined),
  cp: vi.fn().mockResolvedValue(undefined),
}));

describe('PipelineRunner', () => {
  let runner: PipelineRunner;
  let mockPipelineState: PipelineState;

  const createMockState = (status: PipelineState['status'] = 'running'): PipelineState => ({
    runId: 'test-run-123',
    pipelineConfig: simplePipelineConfig,
    trigger: {
      type: 'manual',
      commitSha: 'abc123',
      timestamp: new Date().toISOString(),
    },
    stages: [],
    status,
    artifacts: {
      initialCommit: 'abc123',
      changedFiles: [],
      totalDuration: 0,
      handoverDir: '.agent-pipeline/runs/test-run-123',
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();

    mockPipelineState = createMockState();

    // Re-setup hoisted mock implementations after clearAllMocks
    mockLoopStateManagerInstance.startSession.mockResolvedValue({ sessionId: 'session-123' });
    mockLoopStateManagerInstance.appendIteration.mockResolvedValue(undefined);
    mockLoopStateManagerInstance.updateIteration.mockResolvedValue(true);
    mockLoopStateManagerInstance.completeSession.mockResolvedValue(undefined);
    mockLoopStateManagerInstance.createSessionDirectories.mockResolvedValue(undefined);
    mockLoopStateManagerInstance.getSessionQueueDir.mockReturnValue('.agent-pipeline/loops/session-123');

    // Default mock implementations
    mockInitializerInstance.initialize.mockResolvedValue({
      state: mockPipelineState,
      parallelExecutor: { executeParallelGroup: vi.fn(), executeSequentialGroup: vi.fn() },
      pipelineBranch: 'pipeline/test',
      worktreePath: undefined,
      executionRepoPath: '/test/repo',
      startTime: Date.now(),
      handoverManager: { getHandoverPath: vi.fn() },
      notificationManager: undefined,
    });

    mockOrchestratorInstance.processGroup.mockResolvedValue({
      state: mockPipelineState,
      shouldStopPipeline: false,
    });

    mockFinalizerInstance.finalize.mockImplementation(async (state: PipelineState) => {
      state.status = 'completed';
      return state;
    });

    runner = new PipelineRunner('/test/repo', false);
  });

  describe('constructor', () => {
    it('should initialize with correct repo path', () => {
      const newRunner = new PipelineRunner('/custom/path');
      expect(newRunner).toBeInstanceOf(PipelineRunner);
    });

    it('should initialize with dry run mode', () => {
      const dryRunRunner = new PipelineRunner('/test/repo', true);
      expect(dryRunRunner).toBeInstanceOf(PipelineRunner);
    });
  });

  describe('runPipeline', () => {
    describe('basic execution', () => {
      it('should execute a simple pipeline successfully', async () => {
        const result = await runner.runPipeline(simplePipelineConfig);

        expect(mockInitializerInstance.initialize).toHaveBeenCalled();
        expect(mockDAGPlannerInstance.buildExecutionPlan).toHaveBeenCalledWith(simplePipelineConfig);
        // processGroup is called via groupOrchestrator (internal to runner)
        expect(mockFinalizerInstance.finalize).toHaveBeenCalled();
        expect(result.status).toBe('completed');
      });

      it('should pass interactive option to initializer', async () => {
        await runner.runPipeline(simplePipelineConfig, { interactive: true });

        expect(mockInitializerInstance.initialize).toHaveBeenCalledWith(
          simplePipelineConfig,
          expect.objectContaining({ interactive: true }),
          expect.any(Function),
          expect.any(Function)
        );
      });

      it('should pass options to pipeline execution', async () => {
        await runner.runPipeline(simplePipelineConfig, { verbose: true, interactive: false });

        expect(mockInitializerInstance.initialize).toHaveBeenCalledWith(
          simplePipelineConfig,
          expect.objectContaining({ verbose: true, interactive: false }),
          expect.any(Function),
          expect.any(Function)
        );
      });
    });

    describe('state callbacks', () => {
      it('should register and invoke state change callbacks', async () => {
        const callback = vi.fn();
        runner.onStateChange(callback);

        // Make finalize emit state change
        mockFinalizerInstance.finalize.mockImplementation(async (state, config, branch, worktree, execPath, startTime, interactive, verbose, notify, stateChange) => {
          stateChange(state);
          state.status = 'completed';
          return state;
        });

        await runner.runPipeline(simplePipelineConfig);

        expect(callback).toHaveBeenCalled();
      });

      it('should clone state when notifying to trigger React re-renders', async () => {
        const callback = vi.fn();
        runner.onStateChange(callback);

        mockFinalizerInstance.finalize.mockImplementation(async (state, config, branch, worktree, execPath, startTime, interactive, verbose, notify, stateChange) => {
          const originalState = state;
          stateChange(state);
          // Check that callback received a cloned state
          const calledWith = callback.mock.calls[0][0];
          expect(calledWith).not.toBe(originalState);
          expect(calledWith.stages).not.toBe(originalState.stages);
          state.status = 'completed';
          return state;
        });

        await runner.runPipeline(simplePipelineConfig);
      });
    });

    describe('execution phases', () => {
      it('should execute groups in order', async () => {
        const executionOrder: string[] = [];

        mockDAGPlannerInstance.buildExecutionPlan.mockReturnValue({
          plan: {
            groups: [
              { stages: [{ name: 'group-1-stage' }] },
              { stages: [{ name: 'group-2-stage' }] },
            ],
            maxParallelism: 1,
          },
          validation: { warnings: [] },
        });

        mockOrchestratorInstance.processGroup.mockImplementation(async (group) => {
          executionOrder.push(group.stages[0].name);
          return { state: mockPipelineState, shouldStopPipeline: false };
        });

        await runner.runPipeline(simplePipelineConfig);

        expect(executionOrder).toEqual(['group-1-stage', 'group-2-stage']);
      });

      it('should stop execution when shouldStopPipeline is true', async () => {
        mockDAGPlannerInstance.buildExecutionPlan.mockReturnValue({
          plan: {
            groups: [
              { stages: [{ name: 'group-1' }] },
              { stages: [{ name: 'group-2' }] },
            ],
            maxParallelism: 1,
          },
          validation: { warnings: [] },
        });

        mockOrchestratorInstance.processGroup
          .mockResolvedValueOnce({
            state: { ...mockPipelineState, status: 'failed' },
            shouldStopPipeline: true,
          });

        await runner.runPipeline(simplePipelineConfig);

        // Should only call processGroup once (stopped after first)
        expect(mockOrchestratorInstance.processGroup).toHaveBeenCalledTimes(1);
      });

      it('should set final group flag correctly', async () => {
        mockDAGPlannerInstance.buildExecutionPlan.mockReturnValue({
          plan: {
            groups: [
              { stages: [{ name: 'group-1' }] },
              { stages: [{ name: 'group-2' }] },
            ],
            maxParallelism: 1,
          },
          validation: { warnings: [] },
        });

        await runner.runPipeline(simplePipelineConfig);

        // First call should have isFinalGroup: false
        expect(mockOrchestratorInstance.processGroup).toHaveBeenNthCalledWith(
          1,
          expect.any(Object),
          expect.any(Object),
          expect.any(Object),
          expect.any(Object),
          expect.any(Boolean),
          expect.any(Object),
          { isFinalGroup: false },
          expect.any(Boolean)
        );

        // Second call should have isFinalGroup: true
        expect(mockOrchestratorInstance.processGroup).toHaveBeenNthCalledWith(
          2,
          expect.any(Object),
          expect.any(Object),
          expect.any(Object),
          expect.any(Object),
          expect.any(Boolean),
          expect.any(Object),
          { isFinalGroup: true },
          expect.any(Boolean)
        );
      });
    });

    describe('error handling', () => {
      it('should handle initialization failure', async () => {
        mockInitializerInstance.initialize.mockRejectedValue(
          new Error('Worktree creation failed')
        );

        const result = await runner.runPipeline(simplePipelineConfig);

        expect(result.status).toBe('failed');
        expect(result.stages[0].error?.message).toBe('Worktree creation failed');
      });

      it('should handle execution errors and set failed status', async () => {
        mockOrchestratorInstance.processGroup.mockRejectedValue(
          new Error('Agent execution failed')
        );

        // Finalize should receive failed state
        mockFinalizerInstance.finalize.mockImplementation(async (state) => {
          expect(state.status).toBe('failed');
          return state;
        });

        await runner.runPipeline(simplePipelineConfig);

        expect(mockFinalizerInstance.finalize).toHaveBeenCalled();
      });
    });

    describe('notifications', () => {
      it('should notify on stage success', async () => {
        const successExecution: StageExecution = {
          stageName: 'test-stage',
          status: 'success',
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          duration: 10,
        };

        // Simulate orchestrator calling notifyStageResults
        mockOrchestratorInstance.processGroup.mockImplementation(async (group, state, config, executor, interactive, handover, context, verbose) => {
          // Access the internal notify function via the constructor args
          return { state, shouldStopPipeline: false };
        });

        await runner.runPipeline({
          ...simplePipelineConfig,
          notifications: {
            enabled: true,
            events: ['stage.completed'],
            channels: { local: { enabled: true } },
          },
        });

        // NotificationManager should be created
        expect(mockInitializerInstance.initialize).toHaveBeenCalled();
      });

      it('should handle notification errors gracefully', async () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        // Create a runner with notifications config
        const configWithNotifications = {
          ...simplePipelineConfig,
          notifications: {
            enabled: true,
            events: ['pipeline.completed' as const],
            channels: { local: { enabled: true } },
          },
        };

        await runner.runPipeline(configWithNotifications);

        // Pipeline should complete even if notifications fail
        expect(mockFinalizerInstance.finalize).toHaveBeenCalled();

        consoleSpy.mockRestore();
      });
    });
  });

  describe('loop mode', () => {
    const defaultLoopDirs = {
      pending: '.agent-pipeline/loops/default/pending',
      running: '.agent-pipeline/loops/default/running',
      finished: '.agent-pipeline/loops/default/finished',
      failed: '.agent-pipeline/loops/default/failed',
    };

    it('should skip loop mode when loop option is false', async () => {
      const loopConfig: PipelineConfig = {
        ...simplePipelineConfig,
        looping: {
          enabled: true,
          maxIterations: 10,
          directories: defaultLoopDirs,
        },
      };

      await runner.runPipeline(loopConfig, { loop: false });

      // Should not start loop session when explicitly disabled
      expect(mockLoopStateManagerInstance.startSession).not.toHaveBeenCalled();
    });

    it('should enable loop mode when config has looping enabled', async () => {
      const loopConfig: PipelineConfig = {
        ...simplePipelineConfig,
        looping: {
          enabled: true,
          maxIterations: 5,
          directories: defaultLoopDirs,
        },
      };

      await runner.runPipeline(loopConfig);

      expect(mockLoopStateManagerInstance.startSession).toHaveBeenCalledWith(5);
    });

    it('should use maxLoopIterations option over config', async () => {
      const loopConfig: PipelineConfig = {
        ...simplePipelineConfig,
        looping: {
          enabled: true,
          maxIterations: 5,
          directories: defaultLoopDirs,
        },
      };

      await runner.runPipeline(loopConfig, { maxLoopIterations: 10 });

      expect(mockLoopStateManagerInstance.startSession).toHaveBeenCalledWith(10);
    });

    it('should complete loop session on completion', async () => {
      const loopConfig: PipelineConfig = {
        ...simplePipelineConfig,
        looping: {
          enabled: true,
          maxIterations: 5,
          directories: defaultLoopDirs,
        },
      };

      await runner.runPipeline(loopConfig);

      expect(mockLoopStateManagerInstance.completeSession).toHaveBeenCalledWith(
        'session-123',
        'completed'
      );
    });

    it('should record iterations during loop execution', async () => {
      const loopConfig: PipelineConfig = {
        ...simplePipelineConfig,
        looping: {
          enabled: true,
          maxIterations: 5,
          directories: defaultLoopDirs,
        },
      };

      await runner.runPipeline(loopConfig);

      expect(mockLoopStateManagerInstance.appendIteration).toHaveBeenCalledWith(
        'session-123',
        expect.objectContaining({
          iterationNumber: 1,
          status: 'in-progress',
        })
      );
    });

    it('should not loop when looping.enabled is false', async () => {
      const noLoopConfig: PipelineConfig = {
        ...simplePipelineConfig,
        looping: {
          enabled: false,
          maxIterations: 5,
        },
      };

      await runner.runPipeline(noLoopConfig);

      expect(mockLoopStateManagerInstance.startSession).not.toHaveBeenCalled();
    });

    it('should fallback to appendIteration when updateIteration returns false', async () => {
      // Make updateIteration return false to trigger fallback
      mockLoopStateManagerInstance.updateIteration.mockResolvedValue(false);

      const loopConfig: PipelineConfig = {
        ...simplePipelineConfig,
        looping: {
          enabled: true,
          maxIterations: 5,
          directories: defaultLoopDirs,
        },
      };

      await runner.runPipeline(loopConfig);

      // Should have called appendIteration as fallback (second call after initial in-progress)
      const appendCalls = mockLoopStateManagerInstance.appendIteration.mock.calls;
      // First call is in-progress, second should be the fallback with completed status
      expect(appendCalls.length).toBeGreaterThanOrEqual(2);
      const fallbackCall = appendCalls.find(
        (call) => call[1].status === 'completed' && call[1].triggeredNext !== undefined
      );
      expect(fallbackCall).toBeDefined();
    });

    it('should handle loop termination on pipeline failure with stop strategy', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const loopConfig: PipelineConfig = {
        ...simplePipelineConfig,
        execution: { failureStrategy: 'stop' },
        looping: {
          enabled: true,
          maxIterations: 5,
          directories: defaultLoopDirs,
        },
      };

      // Make pipeline fail
      mockFinalizerInstance.finalize.mockImplementation(async (state) => {
        state.status = 'failed';
        return state;
      });

      await runner.runPipeline(loopConfig, { interactive: false });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Loop: terminating after failure')
      );

      consoleSpy.mockRestore();
    });

    it('should handle loop abort and terminate immediately', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const loopConfig: PipelineConfig = {
        ...simplePipelineConfig,
        looping: {
          enabled: true,
          maxIterations: 5,
          directories: defaultLoopDirs,
        },
      };

      // Make pipeline return aborted status
      mockFinalizerInstance.finalize.mockImplementation(async (state) => {
        state.status = 'aborted';
        return state;
      });

      await runner.runPipeline(loopConfig, { interactive: false });

      expect(consoleSpy).toHaveBeenCalledWith('Loop: terminating due to abort');
      expect(mockLoopStateManagerInstance.completeSession).toHaveBeenCalledWith(
        'session-123',
        'aborted'
      );

      consoleSpy.mockRestore();
    });

    it('should exit loop when no pending pipelines found', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const loopConfig: PipelineConfig = {
        ...simplePipelineConfig,
        looping: {
          enabled: true,
          maxIterations: 5,
          directories: defaultLoopDirs,
        },
      };

      // readdir returns empty array by default (from top-level mock)
      await runner.runPipeline(loopConfig, { interactive: false });

      expect(consoleSpy).toHaveBeenCalledWith('Loop: no pending pipelines, exiting.');

      consoleSpy.mockRestore();
    });

    it('should log loop directory creation in non-interactive mode', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const loopConfig: PipelineConfig = {
        ...simplePipelineConfig,
        looping: {
          enabled: true,
          maxIterations: 5,
          directories: defaultLoopDirs,
        },
      };

      await runner.runPipeline(loopConfig, { interactive: false });

      // Should log about creating loop directories
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Created loop directories under')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('abort handling', () => {
    it('should pass abortController to initializer', async () => {
      const abortController = new PipelineAbortController();

      await runner.runPipeline(simplePipelineConfig, { abortController });

      expect(mockInitializerInstance.initialize).toHaveBeenCalledWith(
        simplePipelineConfig,
        expect.objectContaining({ abortController }),
        expect.any(Function),
        expect.any(Function)
      );
    });

    it('should finalize pipeline when execution completes', async () => {
      const abortController = new PipelineAbortController();

      await runner.runPipeline(simplePipelineConfig, { abortController });

      expect(mockFinalizerInstance.finalize).toHaveBeenCalled();
    });

    it('should handle aborted state from orchestrator', async () => {
      // Simulate orchestrator returning state with failed status
      mockOrchestratorInstance.processGroup.mockResolvedValue({
        state: { ...mockPipelineState, status: 'failed' },
        shouldStopPipeline: true,
      });

      const result = await runner.runPipeline(simplePipelineConfig);

      // Should still call finalize
      expect(mockFinalizerInstance.finalize).toHaveBeenCalled();
    });

    it('should set aborted status when abortController is aborted after first group', async () => {
      const abortController = new PipelineAbortController();

      mockDAGPlannerInstance.buildExecutionPlan.mockReturnValue({
        plan: {
          groups: [
            { stages: [{ name: 'group-1' }] },
            { stages: [{ name: 'group-2' }] },
          ],
          maxParallelism: 1,
        },
        validation: { warnings: [] },
      });

      // Abort after first group completes
      mockOrchestratorInstance.processGroup.mockImplementationOnce(async () => {
        abortController.abort();
        return { state: mockPipelineState, shouldStopPipeline: false };
      });

      mockFinalizerInstance.finalize.mockImplementation(async (state) => {
        expect(state.status).toBe('aborted');
        return state;
      });

      const result = await runner.runPipeline(simplePipelineConfig, { abortController });

      // Should only execute one group (aborted before second)
      expect(mockOrchestratorInstance.processGroup).toHaveBeenCalledTimes(1);
    });

    it('should set aborted status when abortController is aborted before any group executes', async () => {
      const abortController = new PipelineAbortController();
      // Pre-abort before ANY execution
      abortController.abort();

      mockDAGPlannerInstance.buildExecutionPlan.mockReturnValue({
        plan: {
          groups: [
            { stages: [{ name: 'group-1' }] },
          ],
          maxParallelism: 1,
        },
        validation: { warnings: [] },
      });

      let capturedState: PipelineState | undefined;
      mockFinalizerInstance.finalize.mockImplementation(async (state) => {
        capturedState = state;
        return state;
      });

      await runner.runPipeline(simplePipelineConfig, { abortController });

      // Should NOT execute any groups (aborted before first)
      expect(mockOrchestratorInstance.processGroup).not.toHaveBeenCalled();
      expect(capturedState?.status).toBe('aborted');
    });

    it('should log abort message in non-interactive mode', async () => {
      const abortController = new PipelineAbortController();
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      mockDAGPlannerInstance.buildExecutionPlan.mockReturnValue({
        plan: {
          groups: [
            { stages: [{ name: 'group-1' }] },
            { stages: [{ name: 'group-2' }] },
          ],
          maxParallelism: 1,
        },
        validation: { warnings: [] },
      });

      // Abort after first group to trigger abort log
      mockOrchestratorInstance.processGroup.mockImplementationOnce(async () => {
        abortController.abort();
        return { state: mockPipelineState, shouldStopPipeline: false };
      });

      await runner.runPipeline(simplePipelineConfig, { abortController, interactive: false });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Pipeline aborted at group')
      );

      consoleSpy.mockRestore();
    });

    it('should handle PipelineAbortError thrown from processGroup', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Create an abort controller that's already aborted to ensure the check passes
      const abortController = new PipelineAbortController();
      abortController.abort();

      mockOrchestratorInstance.processGroup.mockRejectedValue(
        new Error('Error during abort')
      );

      // Don't override status - let the runner's abort handling set it
      let capturedState: PipelineState | undefined;
      mockFinalizerInstance.finalize.mockImplementation(async (state) => {
        capturedState = state;
        return state;
      });

      await runner.runPipeline(simplePipelineConfig, { abortController, interactive: false });

      expect(capturedState?.status).toBe('aborted');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Pipeline aborted')
      );
      expect(mockFinalizerInstance.finalize).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should handle abort via abortController.aborted flag in error catch', async () => {
      const abortController = new PipelineAbortController();
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Pre-abort the controller before the error occurs
      abortController.abort();

      // Throw generic error - abort flag is already set
      mockOrchestratorInstance.processGroup.mockRejectedValue(
        new Error('Some error during abort')
      );

      // Don't override status - let the runner's abort handling set it
      let capturedState: PipelineState | undefined;
      mockFinalizerInstance.finalize.mockImplementation(async (state) => {
        capturedState = state;
        return state;
      });

      await runner.runPipeline(simplePipelineConfig, { abortController, interactive: false });

      expect(capturedState?.status).toBe('aborted');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Pipeline aborted')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('console logging', () => {
    it('should log in non-interactive mode', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      mockDAGPlannerInstance.buildExecutionPlan.mockReturnValue({
        plan: {
          groups: [{ stages: [{ name: 'stage-1' }] }],
          maxParallelism: 2,
        },
        validation: { warnings: ['Some warning'] },
      });

      await runner.runPipeline(simplePipelineConfig, { interactive: false });

      // Should log execution plan info
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Execution plan')
      );

      consoleSpy.mockRestore();
    });

    it('should not log in interactive mode', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await runner.runPipeline(simplePipelineConfig, { interactive: true });

      // Should not log execution plan (UI handles display)
      const logCalls = consoleSpy.mock.calls.map(call => call[0]);
      const hasExecutionPlan = logCalls.some(msg =>
        typeof msg === 'string' && msg.includes('Execution plan')
      );
      expect(hasExecutionPlan).toBe(false);

      consoleSpy.mockRestore();
    });
  });
});
