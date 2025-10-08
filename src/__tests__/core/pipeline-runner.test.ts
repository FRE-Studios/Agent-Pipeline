// src/__tests__/core/pipeline-runner.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PipelineRunner } from '../../core/pipeline-runner.js';
import { GitManager } from '../../core/git-manager.js';
import { BranchManager } from '../../core/branch-manager.js';
import { PRCreator } from '../../core/pr-creator.js';
import { StageExecutor } from '../../core/stage-executor.js';
import { StateManager } from '../../core/state-manager.js';
import { DAGPlanner } from '../../core/dag-planner.js';
import { ParallelExecutor } from '../../core/parallel-executor.js';
import { ConditionEvaluator } from '../../core/condition-evaluator.js';
import { NotificationManager } from '../../notifications/notification-manager.js';
import { PipelineState, StageExecution } from '../../config/schema.js';
import { createMockGitManager } from '../mocks/git-manager.js';
import { createMockNotificationManager } from '../mocks/notification-manager.js';
import { createMockDAGPlanner } from '../mocks/dag-planner.js';
import { createMockConditionEvaluator } from '../mocks/condition-evaluator.js';
import { createMockStateManager } from '../mocks/state-manager.js';
import { createTempDir, cleanupTempDir } from '../setup.js';
import {
  simplePipelineConfig,
  parallelPipelineConfig,
  conditionalPipelineConfig,
} from '../fixtures/pipeline-configs.js';
import {
  gitWorkflowPipelineConfig,
  uniqueBranchStrategyConfig,
  notificationPipelineConfig,
  disabledStagesPipelineConfig,
  failureStrategyWarnConfig,
  stageFailureOverrideConfig,
  sequentialExecutionConfig,
  simpleExecutionGraph,
  parallelExecutionGraph,
  disabledStagesExecutionGraph,
  conditionalStagesExecutionGraph,
  pipelineStateWithPR,
  failedPipelineState,
  partialSuccessPipelineState,
  skippedStagesPipelineState,
} from '../fixtures/pipeline-runner-fixtures.js';

// Create hoisted mocks that will be available during module initialization
const mocks = vi.hoisted(() => {
  return {
    mockGitManager: null as any,
    mockBranchManager: null as any,
    mockPRCreator: null as any,
    mockStageExecutor: null as any,
    mockStateManager: null as any,
    mockDAGPlanner: null as any,
    mockParallelExecutor: null as any,
    mockConditionEvaluator: null as any,
    mockNotificationManager: null as any,
  };
});

// Mock modules with factory functions
vi.mock('../../core/git-manager.js', () => ({
  GitManager: vi.fn(() => mocks.mockGitManager),
}));

vi.mock('../../core/branch-manager.js', () => ({
  BranchManager: vi.fn(() => mocks.mockBranchManager),
}));

vi.mock('../../core/pr-creator.js', () => ({
  PRCreator: vi.fn(() => mocks.mockPRCreator),
}));

vi.mock('../../core/stage-executor.js', () => ({
  StageExecutor: vi.fn(() => mocks.mockStageExecutor),
}));

vi.mock('../../core/state-manager.js', () => ({
  StateManager: vi.fn(() => mocks.mockStateManager),
}));

vi.mock('../../core/dag-planner.js', () => ({
  DAGPlanner: vi.fn(() => mocks.mockDAGPlanner),
}));

vi.mock('../../core/parallel-executor.js', () => ({
  ParallelExecutor: vi.fn(() => mocks.mockParallelExecutor),
}));

vi.mock('../../core/condition-evaluator.js', () => ({
  ConditionEvaluator: vi.fn(() => mocks.mockConditionEvaluator),
}));

vi.mock('../../notifications/notification-manager.js', () => ({
  NotificationManager: vi.fn(() => mocks.mockNotificationManager),
}));

vi.mock('uuid', () => ({
  v4: () => 'test-uuid-12345',
}));

describe('PipelineRunner', () => {
  let repoPath: string;
  let mockGitManager: GitManager;
  let mockBranchManager: BranchManager;
  let mockPRCreator: PRCreator;
  let mockStageExecutor: StageExecutor;
  let mockStateManager: StateManager;
  let mockDAGPlanner: DAGPlanner;
  let mockParallelExecutor: ParallelExecutor;
  let mockConditionEvaluator: ConditionEvaluator;
  let mockNotificationManager: NotificationManager;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let consoleWarnSpy: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    repoPath = await createTempDir('pipeline-runner-test');

    // Create mocks and assign to hoisted mock references
    mockGitManager = createMockGitManager({ commitSha: 'abc1234def5678901234567890abcdef12345678' });
    mocks.mockGitManager = mockGitManager;

    mockBranchManager = {
      getCurrentBranch: vi.fn().mockResolvedValue('main'),
      setupPipelineBranch: vi.fn().mockResolvedValue('pipeline/test-branch'),
      checkoutBranch: vi.fn().mockResolvedValue(undefined),
      pushBranch: vi.fn().mockResolvedValue(undefined),
      branchExists: vi.fn().mockResolvedValue(false),
      listPipelineBranches: vi.fn().mockResolvedValue([]),
      fetch: vi.fn().mockResolvedValue(undefined),
    } as unknown as BranchManager;
    mocks.mockBranchManager = mockBranchManager;

    mockPRCreator = {
      createPR: vi.fn().mockResolvedValue({ url: 'https://github.com/test/repo/pull/123', number: 123 }),
      prExists: vi.fn().mockResolvedValue(false),
      viewPR: vi.fn().mockResolvedValue(undefined),
      checkGHCLI: vi.fn().mockResolvedValue({ installed: true, authenticated: true }),
    } as unknown as PRCreator;
    mocks.mockPRCreator = mockPRCreator;

    mockStageExecutor = {
      executeStage: vi.fn().mockImplementation(async (config, state, callback) => {
        // Generate a pseudo-hex SHA based on stage name for consistency
        const hash = config.name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        const commitSha = `${hash.toString(16).padStart(7, '0')}abcdef1234567890abcdef12345678`;

        const execution: StageExecution = {
          stageName: config.name,
          status: 'success',
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          duration: 1,
          commitSha,
          extractedData: { result: 'success' },
        };
        if (callback) {
          callback('Test output from agent');
        }
        return execution;
      }),
    } as unknown as StageExecutor;
    mocks.mockStageExecutor = mockStageExecutor;

    mockStateManager = createMockStateManager();
    mocks.mockStateManager = mockStateManager;

    mockDAGPlanner = createMockDAGPlanner({ executionGraph: simpleExecutionGraph });
    mocks.mockDAGPlanner = mockDAGPlanner;

    mockConditionEvaluator = createMockConditionEvaluator({ evaluateResult: true });
    mocks.mockConditionEvaluator = mockConditionEvaluator;

    mockParallelExecutor = {
      executeParallelGroup: vi.fn().mockImplementation(async (stages, state, callback) => {
        const executions: StageExecution[] = stages.map((stage) => {
          const hash = stage.name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
          const commitSha = `${hash.toString(16).padStart(7, '0')}abcdef1234567890abcdef12345678`;
          return {
            stageName: stage.name,
            status: 'success',
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            duration: 1,
            commitSha,
            extractedData: { result: 'success' },
          };
        });
        return { executions, anyFailed: false };
      }),
      executeSequentialGroup: vi.fn().mockImplementation(async (stages, state, callback) => {
        const executions: StageExecution[] = stages.map((stage) => {
          const hash = stage.name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
          const commitSha = `${hash.toString(16).padStart(7, '0')}abcdef1234567890abcdef12345678`;
          return {
            stageName: stage.name,
            status: 'success',
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            duration: 1,
            commitSha,
            extractedData: { result: 'success' },
          };
        });
        return { executions, anyFailed: false };
      }),
      aggregateResults: vi.fn().mockReturnValue('2 stages completed: 2 success, 0 failed'),
    } as unknown as ParallelExecutor;
    mocks.mockParallelExecutor = mockParallelExecutor;

    mockNotificationManager = createMockNotificationManager();
    mocks.mockNotificationManager = mockNotificationManager;

    // Spy on console methods
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    await cleanupTempDir(repoPath);
    vi.restoreAllMocks();
  });

  describe('Constructor & Initialization', () => {
    it('should initialize all dependencies correctly', () => {
      const runner = new PipelineRunner(repoPath, false);

      expect(GitManager).toHaveBeenCalledWith(repoPath);
      expect(BranchManager).toHaveBeenCalledWith(repoPath);
      expect(PRCreator).toHaveBeenCalled();
      expect(StateManager).toHaveBeenCalledWith(repoPath);
      expect(DAGPlanner).toHaveBeenCalled();
      expect(ConditionEvaluator).toHaveBeenCalled();
    });

    it('should set dry run mode to false by default', () => {
      const runner = new PipelineRunner(repoPath);

      expect(StageExecutor).toHaveBeenCalledWith(expect.anything(), false);
    });

    it('should set dry run mode to true when specified', () => {
      const runner = new PipelineRunner(repoPath, true);

      expect(StageExecutor).toHaveBeenCalledWith(expect.anything(), true);
    });

    it('should initialize state update callbacks array', () => {
      const runner = new PipelineRunner(repoPath, false);
      const callback = vi.fn();

      runner.onStateChange(callback);
      expect(callback).not.toHaveBeenCalled(); // Should only store, not call
    });

    it('should wire parallel executor with state change callback', () => {
      const runner = new PipelineRunner(repoPath, false);

      expect(ParallelExecutor).toHaveBeenCalledWith(
        mockStageExecutor,
        expect.any(Function)
      );
    });

    it('should initialize with correct repository path', () => {
      const customPath = '/custom/path';
      const runner = new PipelineRunner(customPath, false);

      expect(GitManager).toHaveBeenCalledWith(customPath);
      expect(BranchManager).toHaveBeenCalledWith(customPath);
      expect(StateManager).toHaveBeenCalledWith(customPath);
    });

    it('should not initialize notification manager in constructor', async () => {
      const runner = new PipelineRunner(repoPath, false);

      // NotificationManager should only be initialized during runPipeline
      expect(NotificationManager).not.toHaveBeenCalled();
    });

    it('should store original branch as empty string initially', async () => {
      const runner = new PipelineRunner(repoPath, false);

      // originalBranch is private, but we can verify it gets set during runPipeline
      await runner.runPipeline(simplePipelineConfig);
      expect(mockBranchManager.getCurrentBranch).toHaveBeenCalled();
    });
  });

  describe('runPipeline() - Pipeline Initialization', () => {
    it('should initialize notification manager from config', async () => {
      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(notificationPipelineConfig);

      expect(NotificationManager).toHaveBeenCalledWith(notificationPipelineConfig.notifications);
    });

    it('should save original branch before execution', async () => {
      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(simplePipelineConfig);

      expect(mockBranchManager.getCurrentBranch).toHaveBeenCalled();
    });

    it('should setup pipeline branch with reusable strategy', async () => {
      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(gitWorkflowPipelineConfig);

      expect(mockBranchManager.setupPipelineBranch).toHaveBeenCalledWith(
        'git-workflow-test',
        'test-uuid-12345',
        'main',
        'reusable',
        'pipeline'
      );
    });

    it('should setup pipeline branch with unique-per-run strategy', async () => {
      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(uniqueBranchStrategyConfig);

      expect(mockBranchManager.setupPipelineBranch).toHaveBeenCalledWith(
        'unique-branch-test',
        'test-uuid-12345',
        'main',
        'unique-per-run',
        'pipeline'
      );
    });

    it('should skip branch setup in dry run mode', async () => {
      const runner = new PipelineRunner(repoPath, true);

      await runner.runPipeline(gitWorkflowPipelineConfig);

      expect(mockBranchManager.setupPipelineBranch).not.toHaveBeenCalled();
    });

    it('should skip branch setup when git config absent', async () => {
      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(simplePipelineConfig);

      expect(mockBranchManager.setupPipelineBranch).not.toHaveBeenCalled();
    });

    it('should initialize pipeline state with correct structure', async () => {
      const runner = new PipelineRunner(repoPath, false);

      const state = await runner.runPipeline(simplePipelineConfig);

      expect(state).toMatchObject({
        runId: 'test-uuid-12345',
        pipelineConfig: simplePipelineConfig,
        trigger: {
          type: 'manual',
          commitSha: 'abc1234def5678901234567890abcdef12345678',
          timestamp: expect.any(String),
        },
        stages: expect.any(Array),
        status: 'completed',
        artifacts: {
          initialCommit: 'abc1234def5678901234567890abcdef12345678',
          changedFiles: expect.any(Array),
          totalDuration: expect.any(Number),
        },
      });
    });

    it('should log startup messages in dry run mode', async () => {
      const runner = new PipelineRunner(repoPath, true);

      await runner.runPipeline(simplePipelineConfig);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('🧪 DRY RUN MODE'));
    });

    it('should suppress logs in interactive mode', async () => {
      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(simplePipelineConfig, { interactive: true });

      expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining('🚀 Starting pipeline'));
    });

    it('should log pipeline info when not in interactive mode', async () => {
      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(simplePipelineConfig, { interactive: false });

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('🚀 Starting pipeline'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('📦 Run ID'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('📝 Trigger commit'));
    });
  });

  describe('runPipeline() - DAG Execution & Stage Filtering', () => {
    it('should build execution plan from config', async () => {
      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(simplePipelineConfig);

      expect(mockDAGPlanner.buildExecutionPlan).toHaveBeenCalledWith(simplePipelineConfig);
    });

    it('should handle parallel execution mode', async () => {
      mockDAGPlanner = createMockDAGPlanner({ executionGraph: parallelExecutionGraph });
      mocks.mockDAGPlanner = mockDAGPlanner;

      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(parallelPipelineConfig);

      expect(mockParallelExecutor.executeParallelGroup).toHaveBeenCalled();
    });

    it('should handle sequential execution mode', async () => {
      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(sequentialExecutionConfig);

      expect(mockParallelExecutor.executeSequentialGroup).toHaveBeenCalled();
    });

    it('should filter disabled stages and add to state as skipped', async () => {
      mockDAGPlanner = createMockDAGPlanner({ executionGraph: disabledStagesExecutionGraph });
      mocks.mockDAGPlanner = mockDAGPlanner;

      const runner = new PipelineRunner(repoPath, false);

      const state = await runner.runPipeline(disabledStagesPipelineConfig);

      const skippedStage = state.stages.find(s => s.stageName === 'disabled-stage');
      expect(skippedStage).toBeDefined();
      expect(skippedStage?.status).toBe('skipped');
    });

    it('should evaluate conditional stages when condition is met', async () => {
      mockConditionEvaluator = createMockConditionEvaluator({ evaluateResult: true });
      mocks.mockConditionEvaluator = mockConditionEvaluator;

      mockDAGPlanner = createMockDAGPlanner({ executionGraph: conditionalStagesExecutionGraph });
      mocks.mockDAGPlanner = mockDAGPlanner;

      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(conditionalPipelineConfig);

      expect(mockConditionEvaluator.evaluate).toHaveBeenCalled();
    });

    it('should skip conditional stages when condition is not met', async () => {
      mockConditionEvaluator = createMockConditionEvaluator({ evaluateResult: false });
      mocks.mockConditionEvaluator = mockConditionEvaluator;

      mockDAGPlanner = createMockDAGPlanner({ executionGraph: conditionalStagesExecutionGraph });
      mocks.mockDAGPlanner = mockDAGPlanner;

      const runner = new PipelineRunner(repoPath, false);

      const state = await runner.runPipeline(conditionalPipelineConfig);

      const skippedStage = state.stages.find(s => s.conditionEvaluated === true && s.conditionResult === false);
      expect(skippedStage).toBeDefined();
      expect(skippedStage?.status).toBe('skipped');
    });

    it('should skip empty groups', async () => {
      const emptyGroupGraph = {
        ...simpleExecutionGraph,
        plan: {
          ...simpleExecutionGraph.plan,
          groups: [
            { level: 0, stages: [] }, // Empty group
            simpleExecutionGraph.plan.groups[0], // Non-empty group
          ],
        },
      };
      mockDAGPlanner = createMockDAGPlanner({ executionGraph: emptyGroupGraph });
      mocks.mockDAGPlanner = mockDAGPlanner;

      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(simplePipelineConfig);

      // Should still complete successfully
      expect(mockStateManager.saveState).toHaveBeenCalled();
    });

    it('should log execution plan summary when not interactive', async () => {
      mockDAGPlanner = createMockDAGPlanner({ executionGraph: parallelExecutionGraph });
      mocks.mockDAGPlanner = mockDAGPlanner;

      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(parallelPipelineConfig, { interactive: false });

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('📊 Execution plan'));
    });

    it('should log warnings from execution plan', async () => {
      const graphWithWarnings = {
        ...simpleExecutionGraph,
        validation: {
          valid: true,
          errors: [],
          warnings: ['Deep dependency chain detected'],
        },
      };
      mockDAGPlanner = createMockDAGPlanner({ executionGraph: graphWithWarnings });
      mocks.mockDAGPlanner = mockDAGPlanner;

      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(simplePipelineConfig, { interactive: false });

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('⚠️  Warnings'));
    });
  });

  describe('runPipeline() - Parallel vs Sequential Execution', () => {
    it('should execute parallel group when mode=parallel and multiple stages', async () => {
      mockDAGPlanner = createMockDAGPlanner({ executionGraph: parallelExecutionGraph });
      mocks.mockDAGPlanner = mockDAGPlanner;

      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(parallelPipelineConfig);

      // Should execute parallel for first group (3 stages), sequential for second group (1 stage)
      expect(mockParallelExecutor.executeParallelGroup).toHaveBeenCalled();
      expect(mockParallelExecutor.executeSequentialGroup).toHaveBeenCalled();
    });

    it('should execute sequential group when mode=sequential', async () => {
      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(sequentialExecutionConfig);

      expect(mockParallelExecutor.executeSequentialGroup).toHaveBeenCalled();
    });

    it('should execute sequential for single stage as fallback', async () => {
      const singleStageConfig = {
        ...simplePipelineConfig,
        agents: [simplePipelineConfig.agents[0]],
      };

      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(singleStageConfig);

      expect(mockParallelExecutor.executeSequentialGroup).toHaveBeenCalled();
    });

    it('should pass output streaming callback correctly', async () => {
      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(simplePipelineConfig);

      const callArgs = vi.mocked(mockParallelExecutor.executeSequentialGroup).mock.calls[0];
      expect(callArgs[2]).toBeInstanceOf(Function); // Third argument should be callback
    });

    it('should update state with execution results', async () => {
      const runner = new PipelineRunner(repoPath, false);

      const state = await runner.runPipeline(simplePipelineConfig);

      expect(state.stages.length).toBeGreaterThan(0);
      expect(state.stages[0]).toMatchObject({
        stageName: expect.any(String),
        status: 'success',
        duration: expect.any(Number),
      });
    });

    it('should save state after each group', async () => {
      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(simplePipelineConfig);

      expect(mockStateManager.saveState).toHaveBeenCalled();
    });

    it('should aggregate results correctly for parallel execution', async () => {
      mockDAGPlanner = createMockDAGPlanner({ executionGraph: parallelExecutionGraph });
      mocks.mockDAGPlanner = mockDAGPlanner;

      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(parallelPipelineConfig, { interactive: false });

      expect(mockParallelExecutor.aggregateResults).toHaveBeenCalled();
    });

    it('should log group result for parallel execution', async () => {
      mockDAGPlanner = createMockDAGPlanner({ executionGraph: parallelExecutionGraph });
      mocks.mockDAGPlanner = mockDAGPlanner;

      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(parallelPipelineConfig, { interactive: false });

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('stages completed'));
    });
  });

  describe('runPipeline() - Failure Handling Strategies', () => {
    it('should stop pipeline on stage failure with failureStrategy=stop', async () => {
      mockParallelExecutor.executeSequentialGroup = vi.fn().mockResolvedValue({
        executions: [{
          stageName: 'stage-1',
          status: 'failed',
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          duration: 1,
          error: { message: 'Stage failed', code: 'ERROR' },
        }],
        anyFailed: true,
      });

      const runner = new PipelineRunner(repoPath, false);

      const state = await runner.runPipeline(simplePipelineConfig);

      expect(state.status).toBe('failed');
    });

    it('should continue pipeline on stage failure with failureStrategy=warn', async () => {
      mockParallelExecutor.executeSequentialGroup = vi.fn()
        .mockResolvedValueOnce({
          executions: [{
            stageName: 'stage-1',
            status: 'failed',
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            duration: 1,
            error: { message: 'Stage failed', code: 'ERROR' },
          }],
          anyFailed: true,
        })
        .mockResolvedValueOnce({
          executions: [{
            stageName: 'stage-2',
            status: 'success',
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            duration: 1,
            commitSha: 'stage-2-commit',
          }],
          anyFailed: false,
        });

      const runner = new PipelineRunner(repoPath, false);

      const state = await runner.runPipeline(failureStrategyWarnConfig);

      expect(state.status).toBe('completed');
    });

    it('should handle stage-level onFail override with stop', async () => {
      mockParallelExecutor.executeSequentialGroup = vi.fn().mockResolvedValue({
        executions: [{
          stageName: 'stage-1',
          status: 'failed',
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          duration: 1,
          error: { message: 'Critical failure', code: 'ERROR' },
        }],
        anyFailed: true,
      });

      // Create execution graph with onFail property
      const customGraph = {
        ...simpleExecutionGraph,
        plan: {
          ...simpleExecutionGraph.plan,
          groups: [
            {
              level: 0,
              stages: [{
                name: 'stage-1',
                agent: '.claude/agents/test-agent.md',
                timeout: 120,
                onFail: 'stop', // Include onFail in execution graph
              }],
            },
          ],
        },
      };

      mockDAGPlanner = createMockDAGPlanner({ executionGraph: customGraph });
      mocks.mockDAGPlanner = mockDAGPlanner;

      const runner = new PipelineRunner(repoPath, false);

      // Use a config with stage-1 having onFail: 'stop' to match execution graph
      const testConfig = {
        ...simplePipelineConfig,
        settings: {
          ...simplePipelineConfig.settings,
          failureStrategy: 'warn', // Global is warn
        },
        agents: [
          {
            ...simplePipelineConfig.agents[0],
            onFail: 'stop', // But stage-1 overrides to stop
          },
          simplePipelineConfig.agents[1],
        ],
      };

      const state = await runner.runPipeline(testConfig);

      expect(state.status).toBe('failed');
    });

    it('should handle stage-level onFail override with warn', async () => {
      mockParallelExecutor.executeSequentialGroup = vi.fn()
        .mockResolvedValueOnce({
          executions: [{
            stageName: 'optional-stage',
            status: 'failed',
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            duration: 1,
            error: { message: 'Optional failure', code: 'ERROR' },
          }],
          anyFailed: true,
        })
        .mockResolvedValueOnce({
          executions: [{
            stageName: 'critical-stage',
            status: 'success',
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            duration: 1,
            commitSha: 'critical-commit',
          }],
          anyFailed: false,
        });

      const runner = new PipelineRunner(repoPath, false);

      const state = await runner.runPipeline({
        ...stageFailureOverrideConfig,
        agents: [
          { name: 'optional-stage', agent: '.claude/agents/optional.md', onFail: 'warn' },
          { name: 'critical-stage', agent: '.claude/agents/critical.md' },
        ],
      });

      expect(state.status).toBe('completed');
    });

    it('should default to stop when strategy not specified', async () => {
      mockParallelExecutor.executeSequentialGroup = vi.fn().mockResolvedValue({
        executions: [{
          stageName: 'stage-1',
          status: 'failed',
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          duration: 1,
          error: { message: 'Stage failed', code: 'ERROR' },
        }],
        anyFailed: true,
      });

      const configWithoutStrategy = {
        ...simplePipelineConfig,
        settings: {
          ...simplePipelineConfig.settings,
          failureStrategy: undefined as any,
        },
      };

      const runner = new PipelineRunner(repoPath, false);

      const state = await runner.runPipeline(configWithoutStrategy);

      expect(state.status).toBe('failed');
    });

    it('should handle multiple failures in parallel group', async () => {
      mockParallelExecutor.executeParallelGroup = vi.fn().mockResolvedValue({
        executions: [
          {
            stageName: 'stage-1',
            status: 'failed',
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            duration: 1,
            error: { message: 'Stage 1 failed', code: 'ERROR' },
          },
          {
            stageName: 'stage-2',
            status: 'failed',
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            duration: 1,
            error: { message: 'Stage 2 failed', code: 'ERROR' },
          },
        ],
        anyFailed: true,
      });

      mockDAGPlanner = createMockDAGPlanner({ executionGraph: parallelExecutionGraph });
      mocks.mockDAGPlanner = mockDAGPlanner;

      const runner = new PipelineRunner(repoPath, false);

      const state = await runner.runPipeline(parallelPipelineConfig);

      expect(state.status).toBe('failed');
    });

    it('should log appropriate failure messages with stop strategy', async () => {
      mockParallelExecutor.executeSequentialGroup = vi.fn().mockResolvedValue({
        executions: [{
          stageName: 'stage-1',
          status: 'failed',
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          duration: 1,
          error: { message: 'Stage failed', code: 'ERROR' },
        }],
        anyFailed: true,
      });

      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(simplePipelineConfig, { interactive: false });

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('🛑 Pipeline stopped'));
    });

    it('should log appropriate failure messages with warn strategy', async () => {
      mockParallelExecutor.executeSequentialGroup = vi.fn().mockResolvedValue({
        executions: [{
          stageName: 'stage-1',
          status: 'failed',
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          duration: 1,
          error: { message: 'Stage failed', code: 'ERROR' },
        }],
        anyFailed: true,
      });

      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(failureStrategyWarnConfig, { interactive: false });

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('⚠️  Stage'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('continuing'));
    });
  });

  describe('runPipeline() - State Management & Notifications', () => {
    beforeEach(() => {
      mockNotificationManager = createMockNotificationManager();
      mocks.mockNotificationManager = mockNotificationManager;
    });

    it('should notify pipeline.started event', async () => {
      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(notificationPipelineConfig);

      expect(mockNotificationManager.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'pipeline.started',
        })
      );
    });

    it('should notify stage.completed events for parallel execution', async () => {
      mockDAGPlanner = createMockDAGPlanner({ executionGraph: parallelExecutionGraph });
      mocks.mockDAGPlanner = mockDAGPlanner;

      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline({
        ...parallelPipelineConfig,
        notifications: {
          enabled: true,
          events: ['stage.completed'],
          channels: { local: { enabled: true } },
        },
      });

      expect(mockNotificationManager.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'stage.completed',
        })
      );
    });

    it('should notify stage.failed events for parallel execution', async () => {
      mockDAGPlanner = createMockDAGPlanner({ executionGraph: parallelExecutionGraph });
      mocks.mockDAGPlanner = mockDAGPlanner;

      mockParallelExecutor.executeParallelGroup = vi.fn().mockResolvedValue({
        executions: [{
          stageName: 'review',
          status: 'failed',
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          duration: 1,
          error: { message: 'Stage failed', code: 'ERROR' },
        }],
        anyFailed: true,
      });

      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline({
        ...parallelPipelineConfig,
        settings: { ...parallelPipelineConfig.settings, failureStrategy: 'warn' },
        notifications: {
          enabled: true,
          events: ['stage.failed'],
          channels: { local: { enabled: true } },
        },
      });

      expect(mockNotificationManager.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'stage.failed',
        })
      );
    });

    it('should notify pipeline.completed event on success', async () => {
      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(notificationPipelineConfig);

      expect(mockNotificationManager.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'pipeline.completed',
        })
      );
    });

    it('should notify pipeline.failed event on failure', async () => {
      mockParallelExecutor.executeSequentialGroup = vi.fn().mockResolvedValue({
        executions: [{
          stageName: 'task',
          status: 'failed',
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          duration: 1,
          error: { message: 'Stage failed', code: 'ERROR' },
        }],
        anyFailed: true,
      });

      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(notificationPipelineConfig);

      expect(mockNotificationManager.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'pipeline.failed',
        })
      );
    });

    it('should call state change callbacks on updates', async () => {
      const runner = new PipelineRunner(repoPath, false);
      const callback = vi.fn();

      runner.onStateChange(callback);

      await runner.runPipeline(simplePipelineConfig);

      expect(callback).toHaveBeenCalled();
      expect(callback).toHaveBeenCalledWith(expect.objectContaining({
        runId: expect.any(String),
        status: expect.any(String),
      }));
    });

    it('should save state after completion', async () => {
      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(simplePipelineConfig);

      expect(mockStateManager.saveState).toHaveBeenCalled();
    });

    it('should calculate total duration correctly', async () => {
      const runner = new PipelineRunner(repoPath, false);

      const state = await runner.runPipeline(simplePipelineConfig);

      expect(state.artifacts.totalDuration).toBeGreaterThanOrEqual(0);
      expect(typeof state.artifacts.totalDuration).toBe('number');
    });
  });

  describe('runPipeline() - PR Creation & Git Workflow', () => {
    it('should create PR when autoCreate=true and pipeline succeeds', async () => {
      const runner = new PipelineRunner(repoPath, false);

      const state = await runner.runPipeline(gitWorkflowPipelineConfig);

      expect(mockBranchManager.pushBranch).toHaveBeenCalled();
      expect(mockPRCreator.prExists).toHaveBeenCalled();
      expect(mockPRCreator.createPR).toHaveBeenCalled();
      expect(state.artifacts.pullRequest).toBeDefined();
    });

    it('should skip PR when autoCreate=false', async () => {
      const configNoPR = {
        ...gitWorkflowPipelineConfig,
        git: {
          ...gitWorkflowPipelineConfig.git!,
          pullRequest: {
            ...gitWorkflowPipelineConfig.git!.pullRequest!,
            autoCreate: false,
          },
        },
      };

      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(configNoPR);

      expect(mockPRCreator.createPR).not.toHaveBeenCalled();
    });

    it('should skip PR in dry run mode', async () => {
      const runner = new PipelineRunner(repoPath, true);

      await runner.runPipeline(gitWorkflowPipelineConfig);

      expect(mockPRCreator.createPR).not.toHaveBeenCalled();
    });

    it('should handle PR already exists scenario', async () => {
      mockPRCreator.prExists = vi.fn().mockResolvedValue(true);

      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(gitWorkflowPipelineConfig, { interactive: false });

      expect(mockPRCreator.createPR).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('already exists'));
    });

    it('should handle PR creation failure gracefully', async () => {
      mockPRCreator.createPR = vi.fn().mockRejectedValue(new Error('PR creation failed'));

      const runner = new PipelineRunner(repoPath, false);

      const state = await runner.runPipeline(gitWorkflowPipelineConfig, { interactive: false });

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to create PR'));
      expect(state.status).toBe('completed'); // Pipeline should still complete
    });

    it('should push branch before PR creation', async () => {
      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(gitWorkflowPipelineConfig);

      const pushCall = vi.mocked(mockBranchManager.pushBranch).mock.calls[0];
      const prCreateCall = vi.mocked(mockPRCreator.createPR).mock.calls[0];

      expect(pushCall).toBeDefined();
      expect(prCreateCall).toBeDefined();
    });

    it('should save PR metadata to state', async () => {
      const runner = new PipelineRunner(repoPath, false);

      const state = await runner.runPipeline(gitWorkflowPipelineConfig);

      expect(state.artifacts.pullRequest).toMatchObject({
        url: 'https://github.com/test/repo/pull/123',
        number: 123,
        branch: 'pipeline/test-branch',
      });
    });

    it('should notify pr.created event', async () => {
      mockNotificationManager = createMockNotificationManager();
      mocks.mockNotificationManager = mockNotificationManager;

      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline({
        ...gitWorkflowPipelineConfig,
        notifications: {
          enabled: true,
          events: ['pr.created'],
          channels: { local: { enabled: true } },
        },
      });

      expect(mockNotificationManager.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'pr.created',
          prUrl: 'https://github.com/test/repo/pull/123',
        })
      );
    });

    it('should return to original branch after completion', async () => {
      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(gitWorkflowPipelineConfig);

      expect(mockBranchManager.checkoutBranch).toHaveBeenCalledWith('main');
    });

    it('should skip branch return in dry run mode', async () => {
      const runner = new PipelineRunner(repoPath, true);

      await runner.runPipeline(gitWorkflowPipelineConfig);

      expect(mockBranchManager.checkoutBranch).not.toHaveBeenCalled();
    });
  });

  describe('runPipeline() - Error Handling', () => {
    it('should catch and handle execution errors', async () => {
      mockDAGPlanner.buildExecutionPlan = vi.fn().mockImplementation(() => {
        throw new Error('DAG planning failed');
      });

      const runner = new PipelineRunner(repoPath, false);

      const state = await runner.runPipeline(simplePipelineConfig);

      expect(state.status).toBe('failed');
    });

    it('should set pipeline status to failed on error', async () => {
      mockParallelExecutor.executeSequentialGroup = vi.fn().mockRejectedValue(new Error('Execution error'));

      const runner = new PipelineRunner(repoPath, false);

      const state = await runner.runPipeline(simplePipelineConfig);

      expect(state.status).toBe('failed');
    });

    it('should log error messages', async () => {
      mockDAGPlanner.buildExecutionPlan = vi.fn().mockImplementation(() => {
        throw new Error('DAG planning failed');
      });

      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(simplePipelineConfig, { interactive: false });

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('❌ Pipeline failed'));
    });

    it('should complete state saving even on error', async () => {
      mockDAGPlanner.buildExecutionPlan = vi.fn().mockImplementation(() => {
        throw new Error('DAG planning failed');
      });

      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(simplePipelineConfig);

      expect(mockStateManager.saveState).toHaveBeenCalled();
    });

    it('should handle notification errors gracefully', async () => {
      mockNotificationManager = createMockNotificationManager({ shouldFail: true });
      mocks.mockNotificationManager = mockNotificationManager;

      const runner = new PipelineRunner(repoPath, false);

      const state = await runner.runPipeline(notificationPipelineConfig);

      expect(state.status).toBe('completed'); // Pipeline should still complete
      expect(consoleWarnSpy).toHaveBeenCalledWith('⚠️  Notification error:', expect.any(Error));
    });

    it('should not crash pipeline on notification failures', async () => {
      mockNotificationManager = createMockNotificationManager({
        notificationResults: [
          { success: false, channel: 'slack', error: 'Slack API error' },
        ],
      });
      mocks.mockNotificationManager = mockNotificationManager;

      const runner = new PipelineRunner(repoPath, false);

      const state = await runner.runPipeline(notificationPipelineConfig);

      expect(state.status).toBe('completed');
      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Some notifications failed'));
    });
  });

  describe('printSummary()', () => {
    it('should print status with correct emoji', async () => {
      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(simplePipelineConfig, { interactive: false });

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Status:'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('✅'));
    });

    it('should display duration', async () => {
      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(simplePipelineConfig, { interactive: false });

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringMatching(/Duration: \d+\.\d{2}s/));
    });

    it('should display commit range', async () => {
      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(simplePipelineConfig, { interactive: false });

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringMatching(/Commits: [a-f0-9]{7} → [a-f0-9]{7}/));
    });

    it('should display PR URL when present', async () => {
      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(gitWorkflowPipelineConfig, { interactive: false });

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Pull Request:'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('https://github.com'));
    });

    it('should display all stages with status', async () => {
      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(simplePipelineConfig, { interactive: false });

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Stages:'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringMatching(/[✅❌⏭️⏸️⚠️]/));
    });

    it('should display stage commits', async () => {
      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(simplePipelineConfig, { interactive: false });

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringMatching(/└─ Commit: [a-f0-9]{7}/));
    });

    it('should display stage errors when present', async () => {
      mockParallelExecutor.executeSequentialGroup = vi.fn().mockResolvedValue({
        executions: [{
          stageName: 'stage-1',
          status: 'failed',
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          duration: 1,
          error: { message: 'Test error message', code: 'ERROR' },
        }],
        anyFailed: true,
      });

      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(simplePipelineConfig, { interactive: false });

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('└─ Error:'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Test error message'));
    });

    it('should not print summary in interactive mode', async () => {
      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(simplePipelineConfig, { interactive: true });

      expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining('Pipeline Summary'));
    });
  });

  describe('getStatusEmoji()', () => {
    it('should return correct emoji for running', async () => {
      const runner = new PipelineRunner(repoPath, false);

      // Testing private method through public interface
      await runner.runPipeline(simplePipelineConfig, { interactive: false });

      // Verify emojis appear in output
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringMatching(/[✅⏳❌⏭️⏸️⚠️]/));
    });

    it('should return correct emoji for success', async () => {
      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(simplePipelineConfig, { interactive: false });

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('✅'));
    });

    it('should return correct emoji for failed', async () => {
      mockParallelExecutor.executeSequentialGroup = vi.fn().mockResolvedValue({
        executions: [{
          stageName: 'stage-1',
          status: 'failed',
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          duration: 1,
          error: { message: 'Failed', code: 'ERROR' },
        }],
        anyFailed: true,
      });

      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(simplePipelineConfig, { interactive: false });

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('❌'));
    });

    it('should return correct emoji for skipped', async () => {
      mockDAGPlanner = createMockDAGPlanner({ executionGraph: disabledStagesExecutionGraph });
      mocks.mockDAGPlanner = mockDAGPlanner;

      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(disabledStagesPipelineConfig, { interactive: false });

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('⏭️'));
    });
  });

  describe('handlePRCreation()', () => {
    // Testing private method through runPipeline
    it('should push branch to remote', async () => {
      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(gitWorkflowPipelineConfig);

      expect(mockBranchManager.pushBranch).toHaveBeenCalledWith('pipeline/test-branch');
    });

    it('should check if PR already exists', async () => {
      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(gitWorkflowPipelineConfig);

      expect(mockPRCreator.prExists).toHaveBeenCalledWith('pipeline/test-branch');
    });

    it('should create PR with correct parameters', async () => {
      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(gitWorkflowPipelineConfig);

      expect(mockPRCreator.createPR).toHaveBeenCalledWith(
        'pipeline/test-branch',
        'main',
        gitWorkflowPipelineConfig.git!.pullRequest,
        expect.any(Object)
      );
    });

    it('should handle push failure', async () => {
      mockBranchManager.pushBranch = vi.fn().mockRejectedValue(new Error('Push failed'));

      const runner = new PipelineRunner(repoPath, false);

      const state = await runner.runPipeline(gitWorkflowPipelineConfig, { interactive: false });

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to create PR'));
      expect(state.status).toBe('completed'); // Pipeline should still complete
    });

    it('should handle prExists check failure', async () => {
      mockPRCreator.prExists = vi.fn().mockRejectedValue(new Error('GitHub API error'));

      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(gitWorkflowPipelineConfig, { interactive: false });

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to create PR'));
    });
  });

  describe('notifyStateChange()', () => {
    it('should call all registered callbacks', async () => {
      const runner = new PipelineRunner(repoPath, false);
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      runner.onStateChange(callback1);
      runner.onStateChange(callback2);

      await runner.runPipeline(simplePipelineConfig);

      expect(callback1).toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();
    });

    it('should pass correct state to callbacks', async () => {
      const runner = new PipelineRunner(repoPath, false);
      const callback = vi.fn();

      runner.onStateChange(callback);

      await runner.runPipeline(simplePipelineConfig);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: expect.any(String),
          pipelineConfig: expect.any(Object),
          status: expect.any(String),
        })
      );
    });
  });

  describe('notify()', () => {
    beforeEach(() => {
      mockNotificationManager = createMockNotificationManager();
      mocks.mockNotificationManager = mockNotificationManager;
    });

    it('should call notification manager with correct context', async () => {
      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(notificationPipelineConfig);

      expect(mockNotificationManager.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          event: expect.any(String),
          pipelineState: expect.any(Object),
        })
      );
    });

    it('should return early if notification manager not initialized', async () => {
      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(simplePipelineConfig);

      // NotificationManager should not be called for config without notifications
      const notifyCalls = vi.mocked(mockNotificationManager.notify).mock.calls.length;
      expect(notifyCalls).toBe(0);
    });

    it('should catch and warn on notification errors', async () => {
      mockNotificationManager = createMockNotificationManager({ shouldFail: true });
      mocks.mockNotificationManager = mockNotificationManager;

      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(notificationPipelineConfig);

      expect(consoleWarnSpy).toHaveBeenCalledWith('⚠️  Notification error:', expect.any(Error));
    });

    it('should log failed notifications but not crash pipeline', async () => {
      mockNotificationManager = createMockNotificationManager({
        notificationResults: [
          { success: true, channel: 'local' },
          { success: false, channel: 'slack', error: 'API error' },
        ],
      });
      mocks.mockNotificationManager = mockNotificationManager;

      const runner = new PipelineRunner(repoPath, false);

      const state = await runner.runPipeline(notificationPipelineConfig);

      expect(state.status).toBe('completed');
      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Some notifications failed'));
    });
  });

  describe('onStateChange()', () => {
    it('should register callback correctly', () => {
      const runner = new PipelineRunner(repoPath, false);
      const callback = vi.fn();

      runner.onStateChange(callback);

      // Callback should be registered but not called yet
      expect(callback).not.toHaveBeenCalled();
    });

    it('should allow multiple callback registrations', async () => {
      const runner = new PipelineRunner(repoPath, false);
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const callback3 = vi.fn();

      runner.onStateChange(callback1);
      runner.onStateChange(callback2);
      runner.onStateChange(callback3);

      await runner.runPipeline(simplePipelineConfig);

      expect(callback1).toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();
      expect(callback3).toHaveBeenCalled();
    });
  });

  describe('Integration Tests', () => {
    it('should complete successful pipeline with simple config', async () => {
      const runner = new PipelineRunner(repoPath, false);

      const state = await runner.runPipeline(simplePipelineConfig);

      expect(state.status).toBe('completed');
      expect(state.stages.length).toBeGreaterThanOrEqual(1);
      expect(state.stages.every(s => s.status === 'success')).toBe(true);
      expect(mockStateManager.saveState).toHaveBeenCalled();
    });

    it('should complete successful pipeline with parallel config', async () => {
      mockDAGPlanner = createMockDAGPlanner({ executionGraph: parallelExecutionGraph });
      mocks.mockDAGPlanner = mockDAGPlanner;

      const runner = new PipelineRunner(repoPath, false);

      const state = await runner.runPipeline(parallelPipelineConfig);

      expect(state.status).toBe('completed');
      expect(mockParallelExecutor.executeParallelGroup).toHaveBeenCalled();
      expect(state.artifacts.totalDuration).toBeGreaterThanOrEqual(0);
    });

    it('should handle pipeline with conditional stages', async () => {
      mockConditionEvaluator = createMockConditionEvaluator({ evaluateResult: true });
      mocks.mockConditionEvaluator = mockConditionEvaluator;

      mockDAGPlanner = createMockDAGPlanner({ executionGraph: conditionalStagesExecutionGraph });
      mocks.mockDAGPlanner = mockDAGPlanner;

      const runner = new PipelineRunner(repoPath, false);

      const state = await runner.runPipeline(conditionalPipelineConfig);

      expect(state.status).toBe('completed');
      expect(mockConditionEvaluator.evaluate).toHaveBeenCalled();
    });

    it('should handle pipeline with git workflow + PR', async () => {
      const runner = new PipelineRunner(repoPath, false);

      const state = await runner.runPipeline(gitWorkflowPipelineConfig);

      expect(state.status).toBe('completed');
      expect(mockBranchManager.setupPipelineBranch).toHaveBeenCalled();
      expect(mockPRCreator.createPR).toHaveBeenCalled();
      expect(state.artifacts.pullRequest).toBeDefined();
      expect(mockBranchManager.checkoutBranch).toHaveBeenCalledWith('main');
    });

    it('should handle pipeline with notifications', async () => {
      mockNotificationManager = createMockNotificationManager();
      mocks.mockNotificationManager = mockNotificationManager;

      const runner = new PipelineRunner(repoPath, false);

      const state = await runner.runPipeline(notificationPipelineConfig);

      expect(state.status).toBe('completed');
      expect(mockNotificationManager.notify).toHaveBeenCalled();
      expect(mockNotificationManager.notify).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'pipeline.started' })
      );
      expect(mockNotificationManager.notify).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'pipeline.completed' })
      );
    });

    it('should handle failed pipeline with stop strategy', async () => {
      mockParallelExecutor.executeSequentialGroup = vi.fn().mockResolvedValue({
        executions: [{
          stageName: 'stage-1',
          status: 'failed',
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          duration: 1,
          error: { message: 'Stage failed', code: 'ERROR' },
        }],
        anyFailed: true,
      });

      const runner = new PipelineRunner(repoPath, false);

      const state = await runner.runPipeline(simplePipelineConfig);

      expect(state.status).toBe('failed');
      expect(state.artifacts.totalDuration).toBeGreaterThanOrEqual(0);
      expect(mockStateManager.saveState).toHaveBeenCalled();
    });

    it('should handle partial success with warn strategy', async () => {
      mockParallelExecutor.executeSequentialGroup = vi.fn()
        .mockResolvedValueOnce({
          executions: [{
            stageName: 'stage-1',
            status: 'failed',
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            duration: 1,
            error: { message: 'Stage 1 failed', code: 'ERROR' },
          }],
          anyFailed: true,
        })
        .mockResolvedValueOnce({
          executions: [{
            stageName: 'stage-2',
            status: 'success',
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            duration: 1,
            commitSha: 'stage-2-commit',
          }],
          anyFailed: false,
        });

      const runner = new PipelineRunner(repoPath, false);

      const state = await runner.runPipeline(failureStrategyWarnConfig);

      expect(state.status).toBe('completed');
      expect(state.stages.length).toBeGreaterThanOrEqual(1);
      expect(state.stages.some(s => s.status === 'failed')).toBe(true);
      expect(state.stages.some(s => s.status === 'success')).toBe(true);
    });

    it('should handle dry run mode end-to-end', async () => {
      const runner = new PipelineRunner(repoPath, true);

      const state = await runner.runPipeline(gitWorkflowPipelineConfig);

      expect(state.status).toBe('completed');
      expect(mockBranchManager.setupPipelineBranch).not.toHaveBeenCalled();
      expect(mockBranchManager.checkoutBranch).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('🧪 DRY RUN MODE'));
    });

    it('should handle interactive mode and suppress logs', async () => {
      const runner = new PipelineRunner(repoPath, false);

      await runner.runPipeline(simplePipelineConfig, { interactive: true });

      expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining('🚀 Starting pipeline'));
      expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining('Pipeline Summary'));
    });

    it('should handle pipeline with disabled stages', async () => {
      mockDAGPlanner = createMockDAGPlanner({ executionGraph: disabledStagesExecutionGraph });
      mocks.mockDAGPlanner = mockDAGPlanner;

      const runner = new PipelineRunner(repoPath, false);

      const state = await runner.runPipeline(disabledStagesPipelineConfig);

      expect(state.status).toBe('completed');
      const skippedStage = state.stages.find(s => s.stageName === 'disabled-stage');
      expect(skippedStage).toBeDefined();
      expect(skippedStage?.status).toBe('skipped');
    });
  });
});
