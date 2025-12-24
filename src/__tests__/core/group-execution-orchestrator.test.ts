// src/__tests__/core/group-execution-orchestrator.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GroupExecutionOrchestrator, GroupContext } from '../../core/group-execution-orchestrator.js';
import { StateManager } from '../../core/state-manager.js';
import { ParallelExecutor, ParallelExecutionResult } from '../../core/parallel-executor.js';
import { HandoverManager } from '../../core/handover-manager.js';
import { PipelineConfig, PipelineState, AgentStageConfig, StageExecution } from '../../config/schema.js';
import { ExecutionGroup } from '../../core/types/execution-graph.js';
import { runningPipelineState, successfulStageExecution, failedStageExecution } from '../fixtures/pipeline-states.js';
import { simplePipelineConfig, parallelPipelineConfig } from '../fixtures/pipeline-configs.js';

describe('GroupExecutionOrchestrator', () => {
  let orchestrator: GroupExecutionOrchestrator;
  let mockStateManager: StateManager;
  let mockParallelExecutor: ParallelExecutor;
  let mockHandoverManager: HandoverManager;
  let shouldLogSpy: ReturnType<typeof vi.fn>;
  let stateChangeCallbackSpy: ReturnType<typeof vi.fn>;
  let notifyStageResultsCallbackSpy: ReturnType<typeof vi.fn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  const createMockState = (overrides: Partial<PipelineState> = {}): PipelineState => ({
    ...runningPipelineState,
    stages: [],
    ...overrides,
  });

  const createExecutionGroup = (stages: AgentStageConfig[], level: number = 0): ExecutionGroup => ({
    level,
    stages,
  });

  const createSuccessfulResult = (stageNames: string[]): ParallelExecutionResult => ({
    executions: stageNames.map(name => ({
      ...successfulStageExecution,
      stageName: name,
    })),
    allSucceeded: true,
    anyFailed: false,
    duration: 60,
  });

  const createFailedResult = (failedStage: string, successStages: string[] = []): ParallelExecutionResult => ({
    executions: [
      ...successStages.map(name => ({
        ...successfulStageExecution,
        stageName: name,
      })),
      {
        ...failedStageExecution,
        stageName: failedStage,
      },
    ],
    allSucceeded: false,
    anyFailed: true,
    duration: 60,
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock StateManager
    mockStateManager = {
      saveState: vi.fn().mockResolvedValue(undefined),
    } as unknown as StateManager;

    // Create mock ParallelExecutor
    mockParallelExecutor = {
      executeParallelGroup: vi.fn().mockResolvedValue(createSuccessfulResult(['stage1', 'stage2'])),
      executeSequentialGroup: vi.fn().mockResolvedValue(createSuccessfulResult(['stage1'])),
      aggregateResults: vi.fn().mockReturnValue('2/2 stages succeeded'),
    } as unknown as ParallelExecutor;

    // Create mock HandoverManager
    mockHandoverManager = {
      mergeParallelOutputs: vi.fn().mockResolvedValue(undefined),
      copyStageToHandover: vi.fn().mockResolvedValue(undefined),
    } as unknown as HandoverManager;

    // Create spies for callbacks
    shouldLogSpy = vi.fn().mockReturnValue(true);
    stateChangeCallbackSpy = vi.fn();
    notifyStageResultsCallbackSpy = vi.fn().mockResolvedValue(undefined);

    // Spy on console
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Create orchestrator
    orchestrator = new GroupExecutionOrchestrator(
      mockStateManager,
      shouldLogSpy,
      stateChangeCallbackSpy,
      notifyStageResultsCallbackSpy
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('processGroup', () => {
    describe('basic execution', () => {
      it('should process a group of stages successfully', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'stage1', agent: 'agent1.md' },
          { name: 'stage2', agent: 'agent2.md' },
        ];
        const group = createExecutionGroup(stages, 0);
        const state = createMockState();
        const config: PipelineConfig = {
          ...parallelPipelineConfig,
          settings: { ...parallelPipelineConfig.settings, executionMode: 'parallel' },
        };

        const result = await orchestrator.processGroup(
          group,
          state,
          config,
          mockParallelExecutor,
          false,
          mockHandoverManager
        );

        expect(result.shouldStopPipeline).toBe(false);
        expect(mockParallelExecutor.executeParallelGroup).toHaveBeenCalled();
        expect(mockStateManager.saveState).toHaveBeenCalledWith(state);
        expect(stateChangeCallbackSpy).toHaveBeenCalled();
      });

      it('should return state unchanged when no stages to run', async () => {
        const group = createExecutionGroup([], 0);
        const state = createMockState();

        const result = await orchestrator.processGroup(
          group,
          state,
          simplePipelineConfig,
          mockParallelExecutor,
          false
        );

        expect(result.shouldStopPipeline).toBe(false);
        expect(result.state).toBe(state);
        expect(mockParallelExecutor.executeParallelGroup).not.toHaveBeenCalled();
        expect(mockParallelExecutor.executeSequentialGroup).not.toHaveBeenCalled();
      });

      it('should execute single stage sequentially', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'single-stage', agent: 'agent.md' },
        ];
        const group = createExecutionGroup(stages, 0);
        const state = createMockState();
        const config: PipelineConfig = {
          ...simplePipelineConfig,
          settings: { ...simplePipelineConfig.settings, executionMode: 'parallel' },
        };

        vi.mocked(mockParallelExecutor.executeSequentialGroup).mockResolvedValue(
          createSuccessfulResult(['single-stage'])
        );

        await orchestrator.processGroup(
          group,
          state,
          config,
          mockParallelExecutor,
          false
        );

        // Single stage should use sequential even in parallel mode
        expect(mockParallelExecutor.executeSequentialGroup).toHaveBeenCalled();
        expect(mockParallelExecutor.executeParallelGroup).not.toHaveBeenCalled();
      });

      it('should execute in sequential mode when configured', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'stage1', agent: 'agent1.md' },
          { name: 'stage2', agent: 'agent2.md' },
        ];
        const group = createExecutionGroup(stages, 0);
        const state = createMockState();
        const config: PipelineConfig = {
          ...simplePipelineConfig,
          settings: { ...simplePipelineConfig.settings, executionMode: 'sequential' },
        };

        vi.mocked(mockParallelExecutor.executeSequentialGroup).mockResolvedValue(
          createSuccessfulResult(['stage1', 'stage2'])
        );

        await orchestrator.processGroup(
          group,
          state,
          config,
          mockParallelExecutor,
          false
        );

        expect(mockParallelExecutor.executeSequentialGroup).toHaveBeenCalled();
        expect(mockParallelExecutor.executeParallelGroup).not.toHaveBeenCalled();
      });

      it('should default to parallel execution mode when not specified', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'stage1', agent: 'agent1.md' },
          { name: 'stage2', agent: 'agent2.md' },
        ];
        const group = createExecutionGroup(stages, 0);
        const state = createMockState();
        const config: PipelineConfig = {
          ...simplePipelineConfig,
          settings: { autoCommit: true }, // No executionMode specified
        };

        await orchestrator.processGroup(
          group,
          state,
          config,
          mockParallelExecutor,
          false
        );

        expect(mockParallelExecutor.executeParallelGroup).toHaveBeenCalled();
      });
    });

    describe('disabled stages', () => {
      it('should filter out disabled stages', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'enabled-stage', agent: 'agent1.md', enabled: true },
          { name: 'disabled-stage', agent: 'agent2.md', enabled: false },
        ];
        const group = createExecutionGroup(stages, 0);
        const state = createMockState();

        vi.mocked(mockParallelExecutor.executeSequentialGroup).mockResolvedValue(
          createSuccessfulResult(['enabled-stage'])
        );

        await orchestrator.processGroup(
          group,
          state,
          simplePipelineConfig,
          mockParallelExecutor,
          false
        );

        // Disabled stage should be added to state as skipped
        expect(state.stages).toContainEqual(
          expect.objectContaining({
            stageName: 'disabled-stage',
            status: 'skipped',
          })
        );

        // Only enabled stage should be executed
        const executeCall = vi.mocked(mockParallelExecutor.executeSequentialGroup).mock.calls[0];
        expect(executeCall[0]).toHaveLength(1);
        expect(executeCall[0][0].name).toBe('enabled-stage');
      });

      it('should log skipped disabled stages when logging enabled', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'disabled-stage', agent: 'agent.md', enabled: false },
        ];
        const group = createExecutionGroup(stages, 0);
        const state = createMockState();

        await orchestrator.processGroup(
          group,
          state,
          simplePipelineConfig,
          mockParallelExecutor,
          false // non-interactive mode
        );

        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('Skipping disabled stage: disabled-stage')
        );
      });

      it('should not log in interactive mode', async () => {
        shouldLogSpy.mockReturnValue(false);

        const stages: AgentStageConfig[] = [
          { name: 'disabled-stage', agent: 'agent.md', enabled: false },
        ];
        const group = createExecutionGroup(stages, 0);
        const state = createMockState();

        await orchestrator.processGroup(
          group,
          state,
          simplePipelineConfig,
          mockParallelExecutor,
          true // interactive mode
        );

        expect(consoleSpy).not.toHaveBeenCalledWith(
          expect.stringContaining('Skipping disabled stage')
        );
      });

      it('should return early when all stages are disabled', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'disabled1', agent: 'agent1.md', enabled: false },
          { name: 'disabled2', agent: 'agent2.md', enabled: false },
        ];
        const group = createExecutionGroup(stages, 0);
        const state = createMockState();

        const result = await orchestrator.processGroup(
          group,
          state,
          simplePipelineConfig,
          mockParallelExecutor,
          false
        );

        expect(result.shouldStopPipeline).toBe(false);
        expect(mockParallelExecutor.executeParallelGroup).not.toHaveBeenCalled();
        expect(mockParallelExecutor.executeSequentialGroup).not.toHaveBeenCalled();
        expect(state.stages).toHaveLength(2);
        expect(state.stages.every(s => s.status === 'skipped')).toBe(true);
      });

      it('should call stateChangeCallback for each disabled stage', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'disabled1', agent: 'agent1.md', enabled: false },
          { name: 'disabled2', agent: 'agent2.md', enabled: false },
        ];
        const group = createExecutionGroup(stages, 0);
        const state = createMockState();

        await orchestrator.processGroup(
          group,
          state,
          simplePipelineConfig,
          mockParallelExecutor,
          false
        );

        expect(stateChangeCallbackSpy).toHaveBeenCalledTimes(2);
      });
    });

    describe('handover management', () => {
      it('should merge parallel outputs for successful parallel execution', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'stage1', agent: 'agent1.md' },
          { name: 'stage2', agent: 'agent2.md' },
        ];
        const group = createExecutionGroup(stages, 0);
        const state = createMockState();
        const config: PipelineConfig = {
          ...parallelPipelineConfig,
          settings: { ...parallelPipelineConfig.settings, executionMode: 'parallel' },
        };

        await orchestrator.processGroup(
          group,
          state,
          config,
          mockParallelExecutor,
          false,
          mockHandoverManager
        );

        expect(mockHandoverManager.mergeParallelOutputs).toHaveBeenCalledWith(['stage1', 'stage2']);
      });

      it('should copy stage to handover for sequential execution', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'stage1', agent: 'agent1.md' },
        ];
        const group = createExecutionGroup(stages, 0);
        const state = createMockState();

        vi.mocked(mockParallelExecutor.executeSequentialGroup).mockResolvedValue(
          createSuccessfulResult(['stage1'])
        );

        await orchestrator.processGroup(
          group,
          state,
          simplePipelineConfig,
          mockParallelExecutor,
          false,
          mockHandoverManager
        );

        expect(mockHandoverManager.copyStageToHandover).toHaveBeenCalledWith('stage1');
      });

      it('should handle handover errors gracefully', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'stage1', agent: 'agent1.md' },
          { name: 'stage2', agent: 'agent2.md' },
        ];
        const group = createExecutionGroup(stages, 0);
        const state = createMockState();
        const config: PipelineConfig = {
          ...parallelPipelineConfig,
          settings: { ...parallelPipelineConfig.settings, executionMode: 'parallel' },
        };

        vi.mocked(mockHandoverManager.mergeParallelOutputs).mockRejectedValue(
          new Error('Handover failed')
        );

        // Should not throw
        const result = await orchestrator.processGroup(
          group,
          state,
          config,
          mockParallelExecutor,
          false,
          mockHandoverManager
        );

        expect(result.shouldStopPipeline).toBe(false);
        expect(console.warn).toHaveBeenCalledWith(
          expect.stringContaining('Failed to update HANDOVER.md')
        );
      });

      it('should not update handover when no stages completed successfully', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'failed-stage', agent: 'agent.md' },
        ];
        const group = createExecutionGroup(stages, 0);
        const state = createMockState();

        vi.mocked(mockParallelExecutor.executeSequentialGroup).mockResolvedValue({
          executions: [{ ...failedStageExecution, stageName: 'failed-stage' }],
          allSucceeded: false,
          anyFailed: true,
          duration: 60,
        });

        await orchestrator.processGroup(
          group,
          state,
          simplePipelineConfig,
          mockParallelExecutor,
          false,
          mockHandoverManager
        );

        expect(mockHandoverManager.mergeParallelOutputs).not.toHaveBeenCalled();
        expect(mockHandoverManager.copyStageToHandover).not.toHaveBeenCalled();
      });

      it('should skip handover update when handoverManager is not provided', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'stage1', agent: 'agent1.md' },
        ];
        const group = createExecutionGroup(stages, 0);
        const state = createMockState();

        vi.mocked(mockParallelExecutor.executeSequentialGroup).mockResolvedValue(
          createSuccessfulResult(['stage1'])
        );

        // No handoverManager passed
        await orchestrator.processGroup(
          group,
          state,
          simplePipelineConfig,
          mockParallelExecutor,
          false
        );

        // Should complete without errors
        expect(mockHandoverManager.copyStageToHandover).not.toHaveBeenCalled();
      });
    });

    describe('failure strategies', () => {
      it('should stop pipeline on failure with "stop" strategy (default)', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'failing-stage', agent: 'agent.md' },
        ];
        const group = createExecutionGroup(stages, 0);
        const state = createMockState();
        const config: PipelineConfig = {
          ...simplePipelineConfig,
          settings: { ...simplePipelineConfig.settings, failureStrategy: 'stop' },
        };

        vi.mocked(mockParallelExecutor.executeSequentialGroup).mockResolvedValue(
          createFailedResult('failing-stage')
        );

        const result = await orchestrator.processGroup(
          group,
          state,
          config,
          mockParallelExecutor,
          false
        );

        expect(result.shouldStopPipeline).toBe(true);
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('Pipeline stopped due to stage failure: failing-stage')
        );
      });

      it('should continue pipeline on failure with "continue" strategy', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'failing-stage', agent: 'agent.md' },
        ];
        const group = createExecutionGroup(stages, 0);
        const state = createMockState();
        const config: PipelineConfig = {
          ...simplePipelineConfig,
          settings: { ...simplePipelineConfig.settings, failureStrategy: 'continue' },
        };

        vi.mocked(mockParallelExecutor.executeSequentialGroup).mockResolvedValue(
          createFailedResult('failing-stage')
        );

        const result = await orchestrator.processGroup(
          group,
          state,
          config,
          mockParallelExecutor,
          false
        );

        expect(result.shouldStopPipeline).toBe(false);
        expect(state.status).toBe('partial');
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('Stage failing-stage failed but continuing')
        );
      });

      it('should continue pipeline on failure with "warn" strategy', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'failing-stage', agent: 'agent.md' },
        ];
        const group = createExecutionGroup(stages, 0);
        const state = createMockState();
        const config: PipelineConfig = {
          ...simplePipelineConfig,
          settings: { ...simplePipelineConfig.settings, failureStrategy: 'warn' },
        };

        vi.mocked(mockParallelExecutor.executeSequentialGroup).mockResolvedValue(
          createFailedResult('failing-stage')
        );

        const result = await orchestrator.processGroup(
          group,
          state,
          config,
          mockParallelExecutor,
          false
        );

        expect(result.shouldStopPipeline).toBe(false);
        expect(state.status).toBe('partial');
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('Stage failing-stage failed (warn mode)')
        );
      });

      it('should use stage-level onFail override', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'failing-stage', agent: 'agent.md', onFail: 'continue' },
        ];
        const group = createExecutionGroup(stages, 0);
        const state = createMockState();
        const config: PipelineConfig = {
          ...simplePipelineConfig,
          settings: { ...simplePipelineConfig.settings, failureStrategy: 'stop' },
        };

        vi.mocked(mockParallelExecutor.executeSequentialGroup).mockResolvedValue(
          createFailedResult('failing-stage')
        );

        const result = await orchestrator.processGroup(
          group,
          state,
          config,
          mockParallelExecutor,
          false
        );

        // Stage-level onFail: 'continue' should override pipeline-level 'stop'
        expect(result.shouldStopPipeline).toBe(false);
      });

      it('should stop on unrecognized failure strategy', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'failing-stage', agent: 'agent.md', onFail: 'invalid' as any },
        ];
        const group = createExecutionGroup(stages, 0);
        const state = createMockState();

        vi.mocked(mockParallelExecutor.executeSequentialGroup).mockResolvedValue(
          createFailedResult('failing-stage')
        );

        const result = await orchestrator.processGroup(
          group,
          state,
          simplePipelineConfig,
          mockParallelExecutor,
          false
        );

        expect(result.shouldStopPipeline).toBe(true);
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('unrecognized failure strategy')
        );
      });

      it('should not change status to partial if already not running', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'failing-stage', agent: 'agent.md' },
        ];
        const group = createExecutionGroup(stages, 0);
        const state = createMockState({ status: 'partial' });
        const config: PipelineConfig = {
          ...simplePipelineConfig,
          settings: { ...simplePipelineConfig.settings, failureStrategy: 'continue' },
        };

        vi.mocked(mockParallelExecutor.executeSequentialGroup).mockResolvedValue(
          createFailedResult('failing-stage')
        );

        await orchestrator.processGroup(
          group,
          state,
          config,
          mockParallelExecutor,
          false
        );

        expect(state.status).toBe('partial');
      });

      it('should handle multiple failed stages', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'failing1', agent: 'agent1.md', onFail: 'continue' },
          { name: 'failing2', agent: 'agent2.md', onFail: 'stop' },
        ];
        const group = createExecutionGroup(stages, 0);
        const state = createMockState();
        const config: PipelineConfig = {
          ...parallelPipelineConfig,
          settings: { ...parallelPipelineConfig.settings, executionMode: 'parallel' },
        };

        vi.mocked(mockParallelExecutor.executeParallelGroup).mockResolvedValue({
          executions: [
            { ...failedStageExecution, stageName: 'failing1' },
            { ...failedStageExecution, stageName: 'failing2' },
          ],
          allSucceeded: false,
          anyFailed: true,
          duration: 60,
        });

        const result = await orchestrator.processGroup(
          group,
          state,
          config,
          mockParallelExecutor,
          false
        );

        // Should stop because failing2 has onFail: 'stop'
        expect(result.shouldStopPipeline).toBe(true);
      });
    });

    describe('notifications', () => {
      it('should notify for each completed execution', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'stage1', agent: 'agent1.md' },
          { name: 'stage2', agent: 'agent2.md' },
        ];
        const group = createExecutionGroup(stages, 0);
        const state = createMockState();
        const config: PipelineConfig = {
          ...parallelPipelineConfig,
          settings: { ...parallelPipelineConfig.settings, executionMode: 'parallel' },
        };

        await orchestrator.processGroup(
          group,
          state,
          config,
          mockParallelExecutor,
          false
        );

        expect(notifyStageResultsCallbackSpy).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({ stageName: 'stage1' }),
            expect.objectContaining({ stageName: 'stage2' }),
          ]),
          state
        );
      });
    });

    describe('logging', () => {
      it('should log group start for parallel execution with multiple stages', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'stage1', agent: 'agent1.md' },
          { name: 'stage2', agent: 'agent2.md' },
        ];
        const group = createExecutionGroup(stages, 1);
        const state = createMockState();
        const config: PipelineConfig = {
          ...parallelPipelineConfig,
          settings: { ...parallelPipelineConfig.settings, executionMode: 'parallel' },
        };

        await orchestrator.processGroup(
          group,
          state,
          config,
          mockParallelExecutor,
          false
        );

        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('Running 2 stages in parallel (group 1)')
        );
      });

      it('should not log group start for single stage', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'single', agent: 'agent.md' },
        ];
        const group = createExecutionGroup(stages, 0);
        const state = createMockState();

        vi.mocked(mockParallelExecutor.executeSequentialGroup).mockResolvedValue(
          createSuccessfulResult(['single'])
        );

        await orchestrator.processGroup(
          group,
          state,
          simplePipelineConfig,
          mockParallelExecutor,
          false
        );

        expect(consoleSpy).not.toHaveBeenCalledWith(
          expect.stringContaining('Running')
        );
      });

      it('should log aggregated results for parallel execution', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'stage1', agent: 'agent1.md' },
          { name: 'stage2', agent: 'agent2.md' },
        ];
        const group = createExecutionGroup(stages, 0);
        const state = createMockState();
        const config: PipelineConfig = {
          ...parallelPipelineConfig,
          settings: { ...parallelPipelineConfig.settings, executionMode: 'parallel' },
        };

        await orchestrator.processGroup(
          group,
          state,
          config,
          mockParallelExecutor,
          false
        );

        expect(mockParallelExecutor.aggregateResults).toHaveBeenCalled();
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('2/2 stages succeeded')
        );
      });
    });

    describe('group context', () => {
      it('should pass group context to executor', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'stage1', agent: 'agent1.md' },
        ];
        const group = createExecutionGroup(stages, 0);
        const state = createMockState();
        const groupContext: GroupContext = { isFinalGroup: true };

        vi.mocked(mockParallelExecutor.executeSequentialGroup).mockResolvedValue(
          createSuccessfulResult(['stage1'])
        );

        await orchestrator.processGroup(
          group,
          state,
          simplePipelineConfig,
          mockParallelExecutor,
          false,
          undefined,
          groupContext
        );

        expect(mockParallelExecutor.executeSequentialGroup).toHaveBeenCalledWith(
          expect.any(Array),
          expect.any(Object),
          expect.any(Function),
          groupContext
        );
      });
    });

    describe('state management', () => {
      it('should save state after group execution', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'stage1', agent: 'agent1.md' },
        ];
        const group = createExecutionGroup(stages, 0);
        const state = createMockState();

        vi.mocked(mockParallelExecutor.executeSequentialGroup).mockResolvedValue(
          createSuccessfulResult(['stage1'])
        );

        await orchestrator.processGroup(
          group,
          state,
          simplePipelineConfig,
          mockParallelExecutor,
          false
        );

        expect(mockStateManager.saveState).toHaveBeenCalledWith(state);
      });

      it('should trigger state change callback after group execution', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'stage1', agent: 'agent1.md' },
        ];
        const group = createExecutionGroup(stages, 0);
        const state = createMockState();

        vi.mocked(mockParallelExecutor.executeSequentialGroup).mockResolvedValue(
          createSuccessfulResult(['stage1'])
        );

        await orchestrator.processGroup(
          group,
          state,
          simplePipelineConfig,
          mockParallelExecutor,
          false
        );

        expect(stateChangeCallbackSpy).toHaveBeenCalledWith(state);
      });
    });

    describe('tool activity tracking', () => {
      it('should update tool activity through state callback', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'stage1', agent: 'agent1.md' },
        ];
        const group = createExecutionGroup(stages, 0);
        const state = createMockState({
          stages: [{ stageName: 'stage1', status: 'running', startTime: new Date().toISOString() }],
        });

        // Capture the updateToolActivity callback
        let updateToolActivityFn: ((stageName: string, activity: string) => void) | undefined;
        vi.mocked(mockParallelExecutor.executeSequentialGroup).mockImplementation(
          async (_stages, _state, updateToolActivity) => {
            updateToolActivityFn = updateToolActivity;
            return createSuccessfulResult(['stage1']);
          }
        );

        await orchestrator.processGroup(
          group,
          state,
          simplePipelineConfig,
          mockParallelExecutor,
          false
        );

        // Simulate tool activity update
        expect(updateToolActivityFn).toBeDefined();
        updateToolActivityFn!('stage1', 'Reading file');

        expect(state.stages[0].toolActivity).toContain('Reading file');
        expect(stateChangeCallbackSpy).toHaveBeenCalled();
      });

      it('should limit tool activity to last 3 items', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'stage1', agent: 'agent1.md' },
        ];
        const group = createExecutionGroup(stages, 0);
        const state = createMockState({
          stages: [{ stageName: 'stage1', status: 'running', startTime: new Date().toISOString() }],
        });

        let updateToolActivityFn: ((stageName: string, activity: string) => void) | undefined;
        vi.mocked(mockParallelExecutor.executeSequentialGroup).mockImplementation(
          async (_stages, _state, updateToolActivity) => {
            updateToolActivityFn = updateToolActivity;
            return createSuccessfulResult(['stage1']);
          }
        );

        await orchestrator.processGroup(
          group,
          state,
          simplePipelineConfig,
          mockParallelExecutor,
          false
        );

        // Add 5 activities
        updateToolActivityFn!('stage1', 'Activity 1');
        updateToolActivityFn!('stage1', 'Activity 2');
        updateToolActivityFn!('stage1', 'Activity 3');
        updateToolActivityFn!('stage1', 'Activity 4');
        updateToolActivityFn!('stage1', 'Activity 5');

        expect(state.stages[0].toolActivity).toHaveLength(3);
        expect(state.stages[0].toolActivity).toEqual(['Activity 3', 'Activity 4', 'Activity 5']);
      });

      it('should handle tool activity for non-existent stage gracefully', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'stage1', agent: 'agent1.md' },
        ];
        const group = createExecutionGroup(stages, 0);
        const state = createMockState({ stages: [] });

        let updateToolActivityFn: ((stageName: string, activity: string) => void) | undefined;
        vi.mocked(mockParallelExecutor.executeSequentialGroup).mockImplementation(
          async (_stages, _state, updateToolActivity) => {
            updateToolActivityFn = updateToolActivity;
            return createSuccessfulResult(['stage1']);
          }
        );

        await orchestrator.processGroup(
          group,
          state,
          simplePipelineConfig,
          mockParallelExecutor,
          false
        );

        // Should not throw when stage doesn't exist
        expect(() => updateToolActivityFn!('non-existent', 'Activity')).not.toThrow();
      });
    });

    describe('edge cases', () => {
      it('should handle stages with enabled undefined (default to enabled)', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'stage-no-enabled', agent: 'agent.md' }, // enabled not specified
        ];
        const group = createExecutionGroup(stages, 0);
        const state = createMockState();

        vi.mocked(mockParallelExecutor.executeSequentialGroup).mockResolvedValue(
          createSuccessfulResult(['stage-no-enabled'])
        );

        await orchestrator.processGroup(
          group,
          state,
          simplePipelineConfig,
          mockParallelExecutor,
          false
        );

        expect(mockParallelExecutor.executeSequentialGroup).toHaveBeenCalledWith(
          expect.arrayContaining([expect.objectContaining({ name: 'stage-no-enabled' })]),
          expect.any(Object),
          expect.any(Function),
          undefined
        );
      });

      it('should handle mixed enabled/disabled stages', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'enabled1', agent: 'agent1.md', enabled: true },
          { name: 'disabled', agent: 'agent2.md', enabled: false },
          { name: 'enabled2', agent: 'agent3.md' }, // undefined = enabled
        ];
        const group = createExecutionGroup(stages, 0);
        const state = createMockState();
        const config: PipelineConfig = {
          ...parallelPipelineConfig,
          settings: { ...parallelPipelineConfig.settings, executionMode: 'parallel' },
        };

        vi.mocked(mockParallelExecutor.executeParallelGroup).mockResolvedValue(
          createSuccessfulResult(['enabled1', 'enabled2'])
        );

        await orchestrator.processGroup(
          group,
          state,
          config,
          mockParallelExecutor,
          false
        );

        // Only 2 enabled stages should be passed to executor
        const executeCall = vi.mocked(mockParallelExecutor.executeParallelGroup).mock.calls[0];
        expect(executeCall[0]).toHaveLength(2);
        expect(executeCall[0].map(s => s.name)).toEqual(['enabled1', 'enabled2']);
      });

      it('should handle empty execution result', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'stage1', agent: 'agent1.md' },
        ];
        const group = createExecutionGroup(stages, 0);
        const state = createMockState();

        vi.mocked(mockParallelExecutor.executeSequentialGroup).mockResolvedValue({
          executions: [],
          allSucceeded: true,
          anyFailed: false,
          duration: 0,
        });

        const result = await orchestrator.processGroup(
          group,
          state,
          simplePipelineConfig,
          mockParallelExecutor,
          false,
          mockHandoverManager
        );

        expect(result.shouldStopPipeline).toBe(false);
        expect(mockHandoverManager.copyStageToHandover).not.toHaveBeenCalled();
      });

      it('should handle config without settings', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'stage1', agent: 'agent1.md' },
          { name: 'stage2', agent: 'agent2.md' },
        ];
        const group = createExecutionGroup(stages, 0);
        const state = createMockState();
        const config: PipelineConfig = {
          name: 'no-settings',
          trigger: 'manual',
          agents: stages,
          // No settings property
        };

        await orchestrator.processGroup(
          group,
          state,
          config,
          mockParallelExecutor,
          false
        );

        // Should default to parallel mode
        expect(mockParallelExecutor.executeParallelGroup).toHaveBeenCalled();
      });
    });
  });
});
