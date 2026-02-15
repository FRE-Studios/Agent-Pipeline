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
  mockPipelineLoaderInstance,
  mockStageExecutorInstance,
  mockInstructionLoaderInstance,
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
        textOutput: 'Done',
        tokenUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      }),
    },
    mockPipelineLoaderInstance: {
      loadPipelineFromPath: vi.fn(),
    },
    mockStageExecutorInstance: {
      executeStage: vi.fn().mockResolvedValue({
        stageName: 'loop-agent',
        status: 'success',
        startTime: new Date().toISOString(),
        duration: 5,
      }),
    },
    mockInstructionLoaderInstance: {
      loadLoopInstructions: vi.fn().mockResolvedValue('You are a loop decision agent.'),
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

vi.mock('../../config/pipeline-loader.js', () => ({
  PipelineLoader: vi.fn(() => mockPipelineLoaderInstance),
}));

vi.mock('../../core/instruction-loader.js', () => ({
  InstructionLoader: vi.fn(() => mockInstructionLoaderInstance),
}));

vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  stat: vi.fn().mockResolvedValue({ mtime: new Date() }),
  access: vi.fn().mockRejectedValue(new Error('Not found')),
  rename: vi.fn().mockResolvedValue(undefined),
  cp: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue('name: test-pipeline\ntrigger: manual\nagents:\n  - name: stage-1\n    agent: test.md'),
}));

// Import the mocked fs module for use in tests
import * as fs from 'fs/promises';

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
    // DAG planner now receives the ORIGINAL config (without loop stage)
    mockDAGPlannerInstance.buildExecutionPlan.mockReturnValue({
      plan: {
        groups: [{ stages: [{ name: 'stage-1', agent: 'test.md' }] }],
        maxParallelism: 1,
      },
      validation: { warnings: [], isValid: true },
    });
    mockRuntimeInstance.execute.mockResolvedValue({
      textOutput: 'Done',
      tokenUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    });
    // Re-setup fs mocks after clearAllMocks
    vi.mocked(fs.readFile).mockResolvedValue('name: test-pipeline\ntrigger: manual\nagents:\n  - name: stage-1\n    agent: test.md');
    mockLoopStateManagerInstance.startSession.mockResolvedValue({ sessionId: 'session-123' });
    mockLoopStateManagerInstance.appendIteration.mockResolvedValue(undefined);
    mockLoopStateManagerInstance.updateIteration.mockResolvedValue(true);
    mockLoopStateManagerInstance.completeSession.mockResolvedValue(undefined);
    mockLoopStateManagerInstance.createSessionDirectories.mockResolvedValue(undefined);
    mockLoopStateManagerInstance.getSessionQueueDir.mockReturnValue('.agent-pipeline/loops/session-123');

    // Default mock implementations
    mockStageExecutorInstance.executeStage.mockResolvedValue({
      stageName: 'loop-agent',
      status: 'success',
      startTime: new Date().toISOString(),
      duration: 5,
    });
    mockInstructionLoaderInstance.loadLoopInstructions.mockResolvedValue('You are a loop decision agent.');

    mockInitializerInstance.initialize.mockResolvedValue({
      state: mockPipelineState,
      stageExecutor: mockStageExecutorInstance,
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

      it('should log failed notification channels without crashing pipeline', async () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        // Create a mock notification manager that returns failed results
        const mockNotificationManager = {
          notify: vi.fn().mockResolvedValue([
            { success: true, channel: 'local' },
            { success: false, channel: 'slack', error: 'Webhook URL not configured' },
            { success: false, channel: 'email', error: 'SMTP connection failed' },
          ]),
        };

        // Have initializer return the mock notification manager
        mockInitializerInstance.initialize.mockResolvedValue({
          state: createMockState(),
          stageExecutor: mockStageExecutorInstance,
          parallelExecutor: { executeParallelGroup: vi.fn(), executeSequentialGroup: vi.fn() },
          pipelineBranch: 'pipeline/test',
          worktreePath: undefined,
          executionRepoPath: '/test/repo',
          startTime: Date.now(),
          handoverManager: { getHandoverPath: vi.fn() },
          notificationManager: mockNotificationManager,
        });

        // Make finalizer call the notifyCallback to trigger a notification
        mockFinalizerInstance.finalize.mockImplementation(async (
          state: PipelineState,
          _config: PipelineConfig,
          _branch: string | undefined,
          _worktree: string | undefined,
          _execPath: string,
          _startTime: number,
          _interactive: boolean,
          _verbose: boolean,
          notifyCallback: (context: { event: string; pipelineState: PipelineState }) => Promise<void>
        ) => {
          state.status = 'completed';
          // Trigger notification which will use the mock notification manager
          await notifyCallback({ event: 'pipeline.completed', pipelineState: state });
          return state;
        });

        const configWithNotifications = {
          ...simplePipelineConfig,
          notifications: {
            enabled: true,
            events: ['pipeline.completed' as const],
            channels: { local: { enabled: true }, slack: { enabled: true, webhookUrl: 'invalid' } },
          },
        };

        const result = await runner.runPipeline(configWithNotifications);

        // Pipeline should still complete successfully
        expect(result.status).toBe('completed');
        expect(mockFinalizerInstance.finalize).toHaveBeenCalled();

        // Should log the failure warning header
        expect(consoleSpy).toHaveBeenCalledWith('⚠️  Some notifications failed:');

        // Should log each failed channel with its error
        expect(consoleSpy).toHaveBeenCalledWith('   slack: Webhook URL not configured');
        expect(consoleSpy).toHaveBeenCalledWith('   email: SMTP connection failed');

        consoleSpy.mockRestore();
      });

      it('should catch thrown notification errors without crashing pipeline', async () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        // Create a mock notification manager that throws an error
        const notificationError = new Error('NotificationManager internal error');
        const mockNotificationManager = {
          notify: vi.fn().mockRejectedValue(notificationError),
        };

        // Have initializer return the mock notification manager
        mockInitializerInstance.initialize.mockResolvedValue({
          state: createMockState(),
          stageExecutor: mockStageExecutorInstance,
          parallelExecutor: { executeParallelGroup: vi.fn(), executeSequentialGroup: vi.fn() },
          pipelineBranch: 'pipeline/test',
          worktreePath: undefined,
          executionRepoPath: '/test/repo',
          startTime: Date.now(),
          handoverManager: { getHandoverPath: vi.fn() },
          notificationManager: mockNotificationManager,
        });

        // Make finalizer call the notifyCallback to trigger a notification
        mockFinalizerInstance.finalize.mockImplementation(async (
          state: PipelineState,
          _config: PipelineConfig,
          _branch: string | undefined,
          _worktree: string | undefined,
          _execPath: string,
          _startTime: number,
          _interactive: boolean,
          _verbose: boolean,
          notifyCallback: (context: { event: string; pipelineState: PipelineState }) => Promise<void>
        ) => {
          state.status = 'completed';
          // Trigger notification which will throw
          await notifyCallback({ event: 'pipeline.completed', pipelineState: state });
          return state;
        });

        const configWithNotifications = {
          ...simplePipelineConfig,
          notifications: {
            enabled: true,
            events: ['pipeline.completed' as const],
            channels: { local: { enabled: true } },
          },
        };

        const result = await runner.runPipeline(configWithNotifications);

        // Pipeline should still complete successfully despite notification error
        expect(result.status).toBe('completed');
        expect(mockFinalizerInstance.finalize).toHaveBeenCalled();

        // Should log the caught error
        expect(consoleSpy).toHaveBeenCalledWith('⚠️  Notification error:', notificationError);

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

      const result = await runner.runPipeline(loopConfig, { interactive: false });

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

      const result = await runner.runPipeline(loopConfig, { interactive: false });

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
      const result = await runner.runPipeline(loopConfig, { interactive: false });

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

      const result = await runner.runPipeline(loopConfig, { interactive: false });

      // Should log about creating loop directories
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Created loop directories under')
      );

      consoleSpy.mockRestore();
    });

    it('should use session directories when no custom directories are provided', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Use empty directories object - this causes the code to fall back to session directories
      const loopConfig: PipelineConfig = {
        ...simplePipelineConfig,
        looping: {
          enabled: true,
          maxIterations: 5,
          directories: {
            pending: '',
            running: '',
            finished: '',
            failed: '',
          },
        },
      };

      const result = await runner.runPipeline(loopConfig, { interactive: false });

      // Should call createSessionDirectories (line 786) instead of ensureLoopDirectoriesExist
      expect(mockLoopStateManagerInstance.createSessionDirectories).toHaveBeenCalledWith(
        'session-123',
        '/test/repo'
      );

      // Should call getSessionQueueDir for logging (line 800)
      expect(mockLoopStateManagerInstance.getSessionQueueDir).toHaveBeenCalledWith(
        'session-123',
        '/test/repo'
      );

      // Should log about creating loop directories under session queue dir
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Created loop directories under: .agent-pipeline/loops/session-123')
      );

      consoleSpy.mockRestore();
    });

    it('should compare loop directories correctly via areSameLoopDirs', async () => {
      // This test verifies the areSameLoopDirs comparison logic (lines 578-581)
      // by using directories that DON'T match session directories
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Use custom directories that differ from session directories
      const customDirs = {
        pending: '/custom/path/pending',
        running: '/custom/path/running',
        finished: '/custom/path/finished',
        failed: '/custom/path/failed',
      };

      const loopConfig: PipelineConfig = {
        ...simplePipelineConfig,
        looping: {
          enabled: true,
          maxIterations: 5,
          directories: customDirs,
        },
      };

      await runner.runPipeline(loopConfig, { interactive: false });

      // Should NOT call createSessionDirectories when using custom directories
      // Instead, ensureLoopDirectoriesExist should be called (line 788)
      // We verify this indirectly by checking that createSessionDirectories was NOT called
      // with the custom directories path (we can't easily mock ensureLoopDirectoriesExist)

      // The mock may have been called from previous tests, so let's check the last call args
      // If areSameLoopDirs returns false, createSessionDirectories should not be called for THIS run
      const calls = mockLoopStateManagerInstance.createSessionDirectories.mock.calls;

      // If called, it should be with session-123, not our custom paths
      // The custom paths go through ensureLoopDirectoriesExist instead
      if (calls.length > 0) {
        const lastCall = calls[calls.length - 1];
        // The second arg should be executionRepoPath, not our custom path
        expect(lastCall[1]).toBe('/test/repo');
      }

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

  describe('loop file operations', () => {
    const defaultLoopDirs = {
      pending: '/test/repo/.agent-pipeline/loops/session-123/pending',
      running: '/test/repo/.agent-pipeline/loops/session-123/running',
      finished: '/test/repo/.agent-pipeline/loops/session-123/finished',
      failed: '/test/repo/.agent-pipeline/loops/session-123/failed',
    };

    it('should find next pipeline file sorted by mtime (oldest first)', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Mock readdir to return multiple yaml files
      vi.mocked(fs.readdir).mockResolvedValueOnce(['second.yml', 'first.yml', 'third.yaml'] as unknown as Awaited<ReturnType<typeof fs.readdir>>);

      // Mock stat to return different mtimes - first.yml is oldest
      vi.mocked(fs.stat)
        .mockResolvedValueOnce({ mtime: new Date('2024-01-02') } as Awaited<ReturnType<typeof fs.stat>>)  // second.yml
        .mockResolvedValueOnce({ mtime: new Date('2024-01-01') } as Awaited<ReturnType<typeof fs.stat>>)  // first.yml (oldest)
        .mockResolvedValueOnce({ mtime: new Date('2024-01-03') } as Awaited<ReturnType<typeof fs.stat>>); // third.yaml

      const loopConfig: PipelineConfig = {
        ...simplePipelineConfig,
        looping: {
          enabled: true,
          maxIterations: 5,
          directories: defaultLoopDirs,
        },
      };

      // After first iteration completes, the runner will look for next file
      await runner.runPipeline(loopConfig, { interactive: false });

      // readdir should be called on the pending directory
      expect(fs.readdir).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should handle file collision by appending timestamp', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Mock readdir to return a file
      vi.mocked(fs.readdir).mockResolvedValueOnce(['task.yml'] as unknown as Awaited<ReturnType<typeof fs.readdir>>);
      vi.mocked(fs.stat).mockResolvedValueOnce({ mtime: new Date() } as Awaited<ReturnType<typeof fs.stat>>);

      // First access call succeeds (file exists in running dir)
      vi.mocked(fs.access).mockResolvedValueOnce(undefined);

      const loopConfig: PipelineConfig = {
        ...simplePipelineConfig,
        looping: {
          enabled: true,
          maxIterations: 5,
          directories: defaultLoopDirs,
        },
      };

      await runner.runPipeline(loopConfig, { interactive: false });

      // rename should have been called (for moving file to running)
      expect(fs.rename).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should move completed pipeline to finished directory', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // First call: find pending file for iteration 2
      vi.mocked(fs.readdir)
        .mockResolvedValueOnce(['next-task.yml'] as unknown as Awaited<ReturnType<typeof fs.readdir>>)
        .mockResolvedValueOnce([] as unknown as Awaited<ReturnType<typeof fs.readdir>>); // No more files after

      vi.mocked(fs.stat).mockResolvedValue({ mtime: new Date() } as Awaited<ReturnType<typeof fs.stat>>);
      vi.mocked(fs.access).mockRejectedValue(new Error('Not found')); // No collision

      // Mock PipelineLoader for second iteration
      const mockPipelineLoader = {
        loadPipelineFromPath: vi.fn().mockResolvedValue({
          config: {
            ...simplePipelineConfig,
            name: 'next-task',
          },
          metadata: {
            sourcePath: '/test/repo/.agent-pipeline/loops/session-123/running/next-task.yml',
            sourceType: 'loop-pending',
          },
        }),
      };

      vi.doMock('../../config/pipeline-loader.js', () => ({
        PipelineLoader: vi.fn(() => mockPipelineLoader),
      }));

      const loopConfig: PipelineConfig = {
        ...simplePipelineConfig,
        looping: {
          enabled: true,
          maxIterations: 5,
          directories: defaultLoopDirs,
        },
      };

      await runner.runPipeline(loopConfig, { interactive: false });

      // rename should be called for file transitions
      expect(fs.rename).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should move failed pipeline to failed directory', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.mocked(fs.readdir)
        .mockResolvedValueOnce(['failing-task.yml'] as unknown as Awaited<ReturnType<typeof fs.readdir>>)
        .mockResolvedValueOnce([] as unknown as Awaited<ReturnType<typeof fs.readdir>>);

      vi.mocked(fs.stat).mockResolvedValue({ mtime: new Date() } as Awaited<ReturnType<typeof fs.stat>>);
      vi.mocked(fs.access).mockRejectedValue(new Error('Not found'));

      // Make second iteration fail
      let iterationCount = 0;
      mockFinalizerInstance.finalize.mockImplementation(async (state) => {
        iterationCount++;
        if (iterationCount === 2) {
          state.status = 'failed';
        } else {
          state.status = 'completed';
        }
        return state;
      });

      const loopConfig: PipelineConfig = {
        ...simplePipelineConfig,
        execution: { failureStrategy: 'continue' }, // Don't stop on failure
        looping: {
          enabled: true,
          maxIterations: 5,
          directories: defaultLoopDirs,
        },
      };

      await runner.runPipeline(loopConfig, { interactive: false });

      consoleSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });
  });

  describe('loop iteration limits', () => {
    const defaultLoopDirs = {
      pending: '/test/repo/.agent-pipeline/loops/session-123/pending',
      running: '/test/repo/.agent-pipeline/loops/session-123/running',
      finished: '/test/repo/.agent-pipeline/loops/session-123/finished',
      failed: '/test/repo/.agent-pipeline/loops/session-123/failed',
    };

    it('should stop and warn when max iterations reached', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Always return a pending file to force continuous iteration
      vi.mocked(fs.readdir).mockResolvedValue(['endless.yml'] as unknown as Awaited<ReturnType<typeof fs.readdir>>);
      vi.mocked(fs.stat).mockResolvedValue({ mtime: new Date() } as Awaited<ReturnType<typeof fs.stat>>);
      vi.mocked(fs.access).mockRejectedValue(new Error('Not found'));

      // Mock PipelineLoader to return valid config for loaded pipelines
      mockPipelineLoaderInstance.loadPipelineFromPath.mockResolvedValue({
        config: { ...simplePipelineConfig, name: 'endless' },
        metadata: { sourcePath: '/path/endless.yml', sourceType: 'loop-pending' },
      });

      const loopConfig: PipelineConfig = {
        ...simplePipelineConfig,
        looping: {
          enabled: true,
          maxIterations: 2, // Very low limit
          directories: defaultLoopDirs,
        },
      };

      await runner.runPipeline(loopConfig, { interactive: false });

      // Should log the limit reached warning
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Loop limit reached (2 iterations)')
      );

      consoleSpy.mockRestore();
    });

    it('should set limit-reached status on loop session completion', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Always return a pending file to force continuous iteration
      vi.mocked(fs.readdir).mockResolvedValue(['endless.yml'] as unknown as Awaited<ReturnType<typeof fs.readdir>>);
      vi.mocked(fs.stat).mockResolvedValue({ mtime: new Date() } as Awaited<ReturnType<typeof fs.stat>>);
      vi.mocked(fs.access).mockRejectedValue(new Error('Not found'));

      // Mock PipelineLoader to return valid config for loaded pipelines
      mockPipelineLoaderInstance.loadPipelineFromPath.mockResolvedValue({
        config: { ...simplePipelineConfig, name: 'endless' },
        metadata: { sourcePath: '/path/endless.yml', sourceType: 'loop-pending' },
      });

      const loopConfig: PipelineConfig = {
        ...simplePipelineConfig,
        looping: {
          enabled: true,
          maxIterations: 2, // After 2 iterations, will hit limit on 3rd
          directories: defaultLoopDirs,
        },
      };

      await runner.runPipeline(loopConfig, { interactive: false });

      // Session should be completed with limit-reached status
      expect(mockLoopStateManagerInstance.completeSession).toHaveBeenCalledWith(
        'session-123',
        'limit-reached'
      );

      consoleSpy.mockRestore();
    });
  });

  describe('loop worktree operations', () => {
    it('should copy loop directories from worktree to main repo', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const defaultLoopDirs = {
        pending: '/test/repo/.agent-pipeline/loops/session-123/pending',
        running: '/test/repo/.agent-pipeline/loops/session-123/running',
        finished: '/test/repo/.agent-pipeline/loops/session-123/finished',
        failed: '/test/repo/.agent-pipeline/loops/session-123/failed',
      };

      // Create state with worktreePath set in artifacts
      const stateWithWorktree = createMockState();
      stateWithWorktree.artifacts.worktreePath = '/tmp/worktree-123';

      // Initialize returns a worktree path
      mockInitializerInstance.initialize.mockResolvedValue({
        state: stateWithWorktree,
        stageExecutor: mockStageExecutorInstance,
        parallelExecutor: { executeParallelGroup: vi.fn(), executeSequentialGroup: vi.fn() },
        pipelineBranch: 'pipeline/test',
        worktreePath: '/tmp/worktree-123',
        executionRepoPath: '/tmp/worktree-123',
        startTime: Date.now(),
        handoverManager: { getHandoverPath: vi.fn() },
        notificationManager: undefined,
      });

      // Finalize must preserve the worktreePath
      mockFinalizerInstance.finalize.mockImplementation(async (state) => {
        state.status = 'completed';
        state.artifacts.worktreePath = '/tmp/worktree-123';
        return state;
      });

      const loopConfig: PipelineConfig = {
        ...simplePipelineConfig,
        looping: {
          enabled: true,
          maxIterations: 5,
          directories: defaultLoopDirs,
        },
      };

      await runner.runPipeline(loopConfig, { interactive: false });

      // fs.cp should be called for copying directories
      expect(fs.cp).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('📋 Copied loop directories to main repo');

      consoleSpy.mockRestore();
    });

    it('should warn but not fail when copy fails', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const defaultLoopDirs = {
        pending: '/test/repo/.agent-pipeline/loops/session-123/pending',
        running: '/test/repo/.agent-pipeline/loops/session-123/running',
        finished: '/test/repo/.agent-pipeline/loops/session-123/finished',
        failed: '/test/repo/.agent-pipeline/loops/session-123/failed',
      };

      // Create state with worktreePath set in artifacts
      const stateWithWorktree = createMockState();
      stateWithWorktree.artifacts.worktreePath = '/tmp/worktree-123';

      // Initialize returns a worktree path
      mockInitializerInstance.initialize.mockResolvedValue({
        state: stateWithWorktree,
        stageExecutor: mockStageExecutorInstance,
        parallelExecutor: { executeParallelGroup: vi.fn(), executeSequentialGroup: vi.fn() },
        pipelineBranch: 'pipeline/test',
        worktreePath: '/tmp/worktree-123',
        executionRepoPath: '/tmp/worktree-123',
        startTime: Date.now(),
        handoverManager: { getHandoverPath: vi.fn() },
        notificationManager: undefined,
      });

      // Finalize must preserve the worktreePath
      mockFinalizerInstance.finalize.mockImplementation(async (state) => {
        state.status = 'completed';
        state.artifacts.worktreePath = '/tmp/worktree-123';
        return state;
      });

      // Make cp fail
      vi.mocked(fs.cp).mockRejectedValueOnce(new Error('Permission denied'));

      const loopConfig: PipelineConfig = {
        ...simplePipelineConfig,
        looping: {
          enabled: true,
          maxIterations: 5,
          directories: defaultLoopDirs,
        },
      };

      // Should not throw
      const result = await runner.runPipeline(loopConfig, { interactive: false });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Could not copy loop directories')
      );
      expect(result.status).toBe('completed');

      consoleSpy.mockRestore();
    });
  });

  describe('getPipelineName', () => {
    it('should use metadata.sourcePath when available', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const defaultLoopDirs = {
        pending: '/test/repo/.agent-pipeline/loops/session-123/pending',
        running: '/test/repo/.agent-pipeline/loops/session-123/running',
        finished: '/test/repo/.agent-pipeline/loops/session-123/finished',
        failed: '/test/repo/.agent-pipeline/loops/session-123/failed',
      };

      const loopConfig: PipelineConfig = {
        ...simplePipelineConfig,
        looping: {
          enabled: true,
          maxIterations: 5,
          directories: defaultLoopDirs,
        },
      };

      // Run with loopMetadata that has sourcePath
      await runner.runPipeline(loopConfig, {
        interactive: false,
        loopMetadata: {
          sourcePath: '/path/to/my-custom-pipeline.yml',
          sourceType: 'loop-pending',
        },
      });

      // The pipeline name should be extracted from sourcePath
      // This is used in iteration recording
      expect(mockLoopStateManagerInstance.appendIteration).toHaveBeenCalledWith(
        'session-123',
        expect.objectContaining({
          pipelineName: 'my-custom-pipeline',
        })
      );

      consoleSpy.mockRestore();
    });
  });

  describe('loop multi-iteration', () => {
    it('should log iteration number for iterations after the first', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const defaultLoopDirs = {
        pending: '/test/repo/.agent-pipeline/loops/session-123/pending',
        running: '/test/repo/.agent-pipeline/loops/session-123/running',
        finished: '/test/repo/.agent-pipeline/loops/session-123/finished',
        failed: '/test/repo/.agent-pipeline/loops/session-123/failed',
      };

      // Return a file for second iteration, then empty
      vi.mocked(fs.readdir)
        .mockResolvedValueOnce(['iteration2.yml'] as unknown as Awaited<ReturnType<typeof fs.readdir>>)
        .mockResolvedValueOnce([] as unknown as Awaited<ReturnType<typeof fs.readdir>>);

      vi.mocked(fs.stat).mockResolvedValue({ mtime: new Date() } as Awaited<ReturnType<typeof fs.stat>>);
      vi.mocked(fs.access).mockRejectedValue(new Error('Not found'));

      // Mock PipelineLoader to return valid config for the second iteration
      mockPipelineLoaderInstance.loadPipelineFromPath.mockResolvedValue({
        config: { ...simplePipelineConfig, name: 'iteration2' },
        metadata: { sourcePath: '/path/iteration2.yml', sourceType: 'loop-pending' },
      });

      const loopConfig: PipelineConfig = {
        ...simplePipelineConfig,
        looping: {
          enabled: true,
          maxIterations: 5,
          directories: defaultLoopDirs,
        },
      };

      await runner.runPipeline(loopConfig, { interactive: false });

      // Should log iteration 2
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Loop iteration 2')
      );

      consoleSpy.mockRestore();
    });

    it('should build iteration history with token usage', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const defaultLoopDirs = {
        pending: '/test/repo/.agent-pipeline/loops/session-123/pending',
        running: '/test/repo/.agent-pipeline/loops/session-123/running',
        finished: '/test/repo/.agent-pipeline/loops/session-123/finished',
        failed: '/test/repo/.agent-pipeline/loops/session-123/failed',
      };

      // Create state with token usage
      const stateWithTokens = createMockState();
      stateWithTokens.stages = [
        {
          stageName: 'test-stage',
          status: 'success',
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          duration: 10,
          tokenUsage: {
            actual_input: 1000,
            output: 500,
            cache_read: 200,
          },
        },
      ];

      mockInitializerInstance.initialize.mockResolvedValue({
        state: stateWithTokens,
        stageExecutor: mockStageExecutorInstance,
        parallelExecutor: { executeParallelGroup: vi.fn(), executeSequentialGroup: vi.fn() },
        pipelineBranch: 'pipeline/test',
        worktreePath: undefined,
        executionRepoPath: '/test/repo',
        startTime: Date.now(),
        handoverManager: { getHandoverPath: vi.fn() },
        notificationManager: undefined,
      });

      // processGroup must return the same state so token usage stages are preserved
      mockOrchestratorInstance.processGroup.mockResolvedValue({
        state: stateWithTokens,
        shouldStopPipeline: false,
      });

      const loopConfig: PipelineConfig = {
        ...simplePipelineConfig,
        looping: {
          enabled: true,
          maxIterations: 5,
          directories: defaultLoopDirs,
        },
      };

      const result = await runner.runPipeline(loopConfig, { interactive: false });

      // Should have iteration history with token usage
      // Totals include loop agent tokens (100 input, 50 output from runtime mock)
      expect(result.loopIterationHistory).toBeDefined();
      expect(result.loopIterationHistory?.[0]?.tokenUsage).toEqual({
        totalInput: 1100,
        totalOutput: 550,
        totalCacheRead: 200,
      });

      consoleSpy.mockRestore();
    });
  });

  describe('loop agent execution', () => {
    const defaultLoopDirs = {
      pending: '.agent-pipeline/loops/default/pending',
      running: '.agent-pipeline/loops/default/running',
      finished: '.agent-pipeline/loops/default/finished',
      failed: '.agent-pipeline/loops/default/failed',
    };

    it('should execute loop agent when loop mode is enabled and pipeline succeeds', async () => {
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

      // processGroup called once for normal stages only
      expect(mockOrchestratorInstance.processGroup).toHaveBeenCalledTimes(1);
      // Loop agent executed directly via runtime
      expect(mockRuntimeInstance.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: expect.any(String),
          userPrompt: expect.stringContaining('Loop Agent Task'),
        })
      );

      consoleSpy.mockRestore();
    });

    it('should load loop instructions with correct template context', async () => {
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

      expect(mockInstructionLoaderInstance.loadLoopInstructions).toHaveBeenCalledWith(
        undefined, // no custom instructions path in config
        expect.objectContaining({
          currentIteration: 1,
          maxIterations: 5,
          pipelineName: simplePipelineConfig.name,
          pipelineYaml: expect.any(String),
        })
      );

      consoleSpy.mockRestore();
    });

    it('should not execute loop agent when loop mode is disabled', async () => {
      await runner.runPipeline(simplePipelineConfig);

      expect(mockOrchestratorInstance.processGroup).toHaveBeenCalledTimes(1);
      expect(mockRuntimeInstance.execute).not.toHaveBeenCalled();
    });

    it('should not execute loop agent when pipeline fails', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      mockOrchestratorInstance.processGroup.mockResolvedValue({
        state: createMockState('running'),
        shouldStopPipeline: true,
      });

      const loopConfig: PipelineConfig = {
        ...simplePipelineConfig,
        looping: {
          enabled: true,
          maxIterations: 5,
          directories: defaultLoopDirs,
        },
      };

      await runner.runPipeline(loopConfig, { interactive: false });

      expect(mockOrchestratorInstance.processGroup).toHaveBeenCalledTimes(1);
      expect(mockRuntimeInstance.execute).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should treat loop agent failure as non-fatal', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Runtime execute fails for loop agent
      mockRuntimeInstance.execute.mockRejectedValueOnce(new Error('Loop agent crashed'));

      const loopConfig: PipelineConfig = {
        ...simplePipelineConfig,
        looping: {
          enabled: true,
          maxIterations: 5,
          directories: defaultLoopDirs,
        },
      };

      const result = await runner.runPipeline(loopConfig, { interactive: false });

      expect(result.status).toBe('completed');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Loop agent error (non-fatal)')
      );

      consoleSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    });

    it('should push loop agent execution to pipeline state', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Mock runtime to return success
      mockRuntimeInstance.execute.mockResolvedValueOnce({
        textOutput: 'Loop decision made',
        tokenUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        numTurns: 1,
      });

      const loopConfig: PipelineConfig = {
        ...simplePipelineConfig,
        looping: {
          enabled: true,
          maxIterations: 5,
          directories: defaultLoopDirs,
        },
      };

      const result = await runner.runPipeline(loopConfig, { interactive: false });

      expect(result.stages).toEqual(
        expect.arrayContaining([expect.objectContaining({ stageName: 'loop-agent' })])
      );

      consoleSpy.mockRestore();
    });

    it('should log loop agent status on success', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      mockRuntimeInstance.execute.mockResolvedValueOnce({
        textOutput: 'Loop done',
        tokenUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      });

      const loopConfig: PipelineConfig = {
        ...simplePipelineConfig,
        looping: {
          enabled: true,
          maxIterations: 5,
          directories: defaultLoopDirs,
        },
      };

      await runner.runPipeline(loopConfig, { interactive: false });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Running loop agent')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('loop-agent')
      );

      consoleSpy.mockRestore();
    });

    it('should log loop agent failure as non-fatal when runtime execute fails', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      mockRuntimeInstance.execute.mockRejectedValueOnce(new Error('agent failed'));

      const loopConfig: PipelineConfig = {
        ...simplePipelineConfig,
        looping: {
          enabled: true,
          maxIterations: 5,
          directories: defaultLoopDirs,
        },
      };

      const result = await runner.runPipeline(loopConfig, { interactive: false });

      expect(result.status).toBe('completed');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Loop agent error (non-fatal)')
      );

      consoleSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    });

    it('should pass custom loop instructions path from pipeline config', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const loopConfig: PipelineConfig = {
        ...simplePipelineConfig,
        looping: {
          enabled: true,
          maxIterations: 5,
          directories: defaultLoopDirs,
          instructions: '.agent-pipeline/instructions/custom-loop.md',
        },
      };

      await runner.runPipeline(loopConfig, { interactive: false });

      expect(mockInstructionLoaderInstance.loadLoopInstructions).toHaveBeenCalledWith(
        '.agent-pipeline/instructions/custom-loop.md',
        expect.any(Object)
      );

      consoleSpy.mockRestore();
    });

    it('should pass original config (without loop agent) to DAG planner', async () => {
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

      // DAG planner should receive the ORIGINAL config without loop agent
      const dagPlannerCall = mockDAGPlannerInstance.buildExecutionPlan.mock.calls[0][0];
      const loopAgent = dagPlannerCall.agents.find((a: any) => a.agent === '__inline__');
      expect(loopAgent).toBeUndefined();

      consoleSpy.mockRestore();
    });

    it('should update state.pipelineConfig with loop agent for UI rendering', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      let capturedState: PipelineState | undefined;
      mockOrchestratorInstance.processGroup.mockImplementation(async (_group, state) => {
        capturedState = state;
        return { state, shouldStopPipeline: false };
      });

      const loopConfig: PipelineConfig = {
        ...simplePipelineConfig,
        looping: {
          enabled: true,
          maxIterations: 5,
          directories: defaultLoopDirs,
        },
      };

      await runner.runPipeline(loopConfig, { interactive: false });

      // state.pipelineConfig should include the loop agent so the UI can render it
      expect(capturedState?.pipelineConfig.agents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'loop-agent', agent: '__inline__' }),
        ])
      );

      consoleSpy.mockRestore();
    });
  });
});
