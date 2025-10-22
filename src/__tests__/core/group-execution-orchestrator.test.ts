// src/__tests__/core/group-execution-orchestrator.test.ts

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GroupExecutionOrchestrator } from '../../core/group-execution-orchestrator.js';
import { GitManager } from '../../core/git-manager.js';
import { StateManager } from '../../core/state-manager.js';
import { ParallelExecutor } from '../../core/parallel-executor.js';
import { PipelineConfig, PipelineState, AgentStageConfig } from '../../config/schema.js';
import { ExecutionGraph, ExecutionGroup } from '../../core/types/execution-graph.js';

// Mock dependencies
vi.mock('../../core/git-manager.js');
vi.mock('../../core/state-manager.js');
vi.mock('../../core/condition-evaluator.js');
vi.mock('../../core/context-reducer.js');
vi.mock('../../utils/token-estimator.js');

// Import mock helpers
import { createMockConditionEvaluator } from '../mocks/condition-evaluator.js';
import { ConditionEvaluator } from '../../core/condition-evaluator.js';
import { createMockContextReducer } from '../mocks/context-reducer.js';
import { ContextReducer } from '../../core/context-reducer.js';
import { TokenEstimator } from '../../utils/token-estimator.js';
import { StageExecutor } from '../../core/stage-executor.js';

describe('GroupExecutionOrchestrator', () => {
  let orchestrator: GroupExecutionOrchestrator;
  let mockGitManager: GitManager;
  let mockStateManager: StateManager;
  let mockShouldLog: ReturnType<typeof vi.fn>;
  let mockStateChangeCallback: ReturnType<typeof vi.fn>;
  let mockNotifyStageResultsCallback: ReturnType<typeof vi.fn>;
  let mockParallelExecutor: ParallelExecutor;

  const mockConfig: PipelineConfig = {
    name: 'test-pipeline',
    trigger: 'manual',
    agents: []
  };

  const mockState: PipelineState = {
    runId: 'test-run-id',
    pipelineConfig: mockConfig,
    trigger: {
      type: 'manual',
      commitSha: 'abc123',
      timestamp: new Date().toISOString()
    },
    stages: [],
    status: 'running',
    artifacts: {
      initialCommit: 'abc123',
      changedFiles: [],
      totalDuration: 0
    }
  };

  const mockStage: AgentStageConfig = {
    name: 'test-stage',
    agent: '.claude/agents/test.md'
  };

  const mockGroup: ExecutionGroup = {
    level: 0,
    stages: [mockStage]
  };

  const mockExecutionGraph: ExecutionGraph = {
    plan: {
      groups: [mockGroup],
      maxParallelism: 1
    },
    validation: {
      errors: [],
      warnings: [],
      isValid: true
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset mockState to fresh state
    mockState.stages = [];
    mockState.status = 'running';
    mockState.artifacts = {
      initialCommit: 'abc123',
      changedFiles: [],
      totalDuration: 0
    };

    mockGitManager = new GitManager('/test/repo');
    mockStateManager = new StateManager('/test/repo');
    mockShouldLog = vi.fn().mockReturnValue(true);
    mockStateChangeCallback = vi.fn();
    mockNotifyStageResultsCallback = vi.fn().mockResolvedValue(undefined);

    vi.spyOn(mockStateManager, 'saveState').mockResolvedValue();

    orchestrator = new GroupExecutionOrchestrator(
      mockGitManager,
      mockStateManager,
      '/test/repo',
      false,
      mockShouldLog,
      mockStateChangeCallback,
      mockNotifyStageResultsCallback
    );

    // Create mock parallel executor
    mockParallelExecutor = {
      executeParallelGroup: vi.fn(),
      executeSequentialGroup: vi.fn(),
      aggregateResults: vi.fn().mockReturnValue('All stages completed')
    } as any;
  });

  describe('processGroup', () => {
    it('should process a group with enabled stages', async () => {
      const mockGroupResult = {
        executions: [
          {
            stageName: 'test-stage',
            status: 'success',
            startTime: new Date().toISOString()
          }
        ],
        anyFailed: false
      };

      vi.spyOn(mockParallelExecutor, 'executeSequentialGroup').mockResolvedValue(
        mockGroupResult
      );

      const result = await orchestrator.processGroup(
        mockGroup,
        mockState,
        mockConfig,
        mockExecutionGraph,
        mockParallelExecutor,
        false
      );

      expect(result.state.stages).toHaveLength(1);
      expect(result.state.stages[0].stageName).toBe('test-stage');
      expect(result.shouldStopPipeline).toBe(false);
    });

    it('should filter out disabled stages', async () => {
      const disabledGroup: ExecutionGroup = {
        level: 0,
        stages: [
          { name: 'enabled-stage', agent: '.claude/agents/test.md' },
          { name: 'disabled-stage', agent: '.claude/agents/test.md', enabled: false }
        ]
      };

      const mockGroupResult = {
        executions: [
          {
            stageName: 'enabled-stage',
            status: 'success',
            startTime: new Date().toISOString()
          }
        ],
        anyFailed: false
      };

      vi.spyOn(mockParallelExecutor, 'executeSequentialGroup').mockResolvedValue(
        mockGroupResult
      );

      const result = await orchestrator.processGroup(
        disabledGroup,
        mockState,
        mockConfig,
        mockExecutionGraph,
        mockParallelExecutor,
        false
      );

      // Should have disabled stage marked as skipped + enabled stage executed
      expect(result.state.stages).toHaveLength(2);
      expect(result.state.stages[0].stageName).toBe('disabled-stage');
      expect(result.state.stages[0].status).toBe('skipped');
      expect(result.state.stages[1].stageName).toBe('enabled-stage');
      expect(result.state.stages[1].status).toBe('success');
    });

    it('should skip group when no stages to run', async () => {
      const emptyGroup: ExecutionGroup = {
        level: 0,
        stages: [
          { name: 'disabled-stage', agent: '.claude/agents/test.md', enabled: false }
        ]
      };

      const result = await orchestrator.processGroup(
        emptyGroup,
        mockState,
        mockConfig,
        mockExecutionGraph,
        mockParallelExecutor,
        false
      );

      // Should only have the disabled stage
      expect(result.state.stages).toHaveLength(1);
      expect(result.state.stages[0].status).toBe('skipped');
      expect(result.shouldStopPipeline).toBe(false);
    });

    it('should execute group in parallel mode when configured', async () => {
      const parallelGroup: ExecutionGroup = {
        level: 0,
        stages: [
          { name: 'stage-1', agent: '.claude/agents/test1.md' },
          { name: 'stage-2', agent: '.claude/agents/test2.md' }
        ]
      };

      const mockGroupResult = {
        executions: [
          {
            stageName: 'stage-1',
            status: 'success',
            startTime: new Date().toISOString()
          },
          {
            stageName: 'stage-2',
            status: 'success',
            startTime: new Date().toISOString()
          }
        ],
        anyFailed: false
      };

      vi.spyOn(mockParallelExecutor, 'executeParallelGroup').mockResolvedValue(
        mockGroupResult
      );

      const parallelConfig = {
        ...mockConfig,
        settings: { executionMode: 'parallel' as const }
      };

      const result = await orchestrator.processGroup(
        parallelGroup,
        mockState,
        parallelConfig,
        mockExecutionGraph,
        mockParallelExecutor,
        false
      );

      expect(mockParallelExecutor.executeParallelGroup).toHaveBeenCalled();
      expect(result.state.stages).toHaveLength(2);
    });

    it('should execute group in sequential mode when configured', async () => {
      const mockGroupResult = {
        executions: [
          {
            stageName: 'test-stage',
            status: 'success',
            startTime: new Date().toISOString()
          }
        ],
        anyFailed: false
      };

      vi.spyOn(mockParallelExecutor, 'executeSequentialGroup').mockResolvedValue(
        mockGroupResult
      );

      const sequentialConfig = {
        ...mockConfig,
        settings: { executionMode: 'sequential' as const }
      };

      await orchestrator.processGroup(
        mockGroup,
        mockState,
        sequentialConfig,
        mockExecutionGraph,
        mockParallelExecutor,
        false
      );

      expect(mockParallelExecutor.executeSequentialGroup).toHaveBeenCalled();
    });

    it('should save state after group execution', async () => {
      const mockGroupResult = {
        executions: [
          {
            stageName: 'test-stage',
            status: 'success',
            startTime: new Date().toISOString()
          }
        ],
        anyFailed: false
      };

      vi.spyOn(mockParallelExecutor, 'executeSequentialGroup').mockResolvedValue(
        mockGroupResult
      );

      await orchestrator.processGroup(
        mockGroup,
        mockState,
        mockConfig,
        mockExecutionGraph,
        mockParallelExecutor,
        false
      );

      expect(mockStateManager.saveState).toHaveBeenCalled();
    });

    it('should call state change callback', async () => {
      const mockGroupResult = {
        executions: [
          {
            stageName: 'test-stage',
            status: 'success',
            startTime: new Date().toISOString()
          }
        ],
        anyFailed: false
      };

      vi.spyOn(mockParallelExecutor, 'executeSequentialGroup').mockResolvedValue(
        mockGroupResult
      );

      await orchestrator.processGroup(
        mockGroup,
        mockState,
        mockConfig,
        mockExecutionGraph,
        mockParallelExecutor,
        false
      );

      expect(mockStateChangeCallback).toHaveBeenCalled();
    });

    it('should notify stage results', async () => {
      const mockGroupResult = {
        executions: [
          {
            stageName: 'test-stage',
            status: 'success',
            startTime: new Date().toISOString()
          }
        ],
        anyFailed: false
      };

      vi.spyOn(mockParallelExecutor, 'executeSequentialGroup').mockResolvedValue(
        mockGroupResult
      );

      await orchestrator.processGroup(
        mockGroup,
        mockState,
        mockConfig,
        mockExecutionGraph,
        mockParallelExecutor,
        false
      );

      expect(mockNotifyStageResultsCallback).toHaveBeenCalledWith(
        mockGroupResult.executions,
        expect.any(Object)
      );
    });

    it('should stop pipeline on failure with stop strategy', async () => {
      const mockGroupResult = {
        executions: [
          {
            stageName: 'test-stage',
            status: 'failed',
            startTime: new Date().toISOString()
          }
        ],
        anyFailed: true
      };

      vi.spyOn(mockParallelExecutor, 'executeSequentialGroup').mockResolvedValue(
        mockGroupResult
      );

      const stopConfig = {
        ...mockConfig,
        settings: { failureStrategy: 'stop' as const }
      };

      const result = await orchestrator.processGroup(
        mockGroup,
        mockState,
        stopConfig,
        mockExecutionGraph,
        mockParallelExecutor,
        false
      );

      expect(result.shouldStopPipeline).toBe(true);
      // Orchestrator doesn't set status - that's PipelineRunner's responsibility
      // Status remains 'running' until PipelineRunner sets it to 'failed'
      expect(result.state.status).toBe('running');
    });

    it('should continue pipeline on failure with continue strategy', async () => {
      const mockGroupResult = {
        executions: [
          {
            stageName: 'test-stage',
            status: 'failed',
            startTime: new Date().toISOString()
          }
        ],
        anyFailed: true
      };

      vi.spyOn(mockParallelExecutor, 'executeSequentialGroup').mockResolvedValue(
        mockGroupResult
      );

      const continueConfig = {
        ...mockConfig,
        settings: { failureStrategy: 'continue' as const }
      };

      const result = await orchestrator.processGroup(
        mockGroup,
        mockState,
        continueConfig,
        mockExecutionGraph,
        mockParallelExecutor,
        false
      );

      expect(result.shouldStopPipeline).toBe(false);
      expect(result.state.status).toBe('partial');
    });

    it('should mark state partial when stage uses warn strategy', async () => {
      const stageWithWarnStrategy: ExecutionGroup = {
        level: 0,
        stages: [
          {
            name: 'warn-stage',
            agent: '.claude/agents/test.md',
            onFail: 'warn'
          }
        ]
      };

      const mockGroupResult = {
        executions: [
          {
            stageName: 'warn-stage',
            status: 'failed',
            startTime: new Date().toISOString()
          }
        ],
        anyFailed: true
      };

      vi.spyOn(mockParallelExecutor, 'executeSequentialGroup').mockResolvedValue(
        mockGroupResult
      );

      const result = await orchestrator.processGroup(
        stageWithWarnStrategy,
        mockState,
        mockConfig,
        mockExecutionGraph,
        mockParallelExecutor,
        false
      );

      expect(result.shouldStopPipeline).toBe(false);
      expect(result.state.status).toBe('partial');
    });

    it('should use stage-level failure strategy over global', async () => {
      const stageWithStopStrategy: ExecutionGroup = {
        level: 0,
        stages: [
          {
            name: 'test-stage',
            agent: '.claude/agents/test.md',
            onFail: 'stop'
          }
        ]
      };

      const mockGroupResult = {
        executions: [
          {
            stageName: 'test-stage',
            status: 'failed',
            startTime: new Date().toISOString()
          }
        ],
        anyFailed: true
      };

      vi.spyOn(mockParallelExecutor, 'executeSequentialGroup').mockResolvedValue(
        mockGroupResult
      );

      const continueConfig = {
        ...mockConfig,
        settings: { failureStrategy: 'continue' as const }
      };

      const result = await orchestrator.processGroup(
        stageWithStopStrategy,
        mockState,
        continueConfig,
        mockExecutionGraph,
        mockParallelExecutor,
        false
      );

      // Stage-level 'stop' should override global 'continue'
      expect(result.shouldStopPipeline).toBe(true);
    });

    it('should suppress logs in interactive mode', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      mockShouldLog.mockReturnValue(false); // Interactive mode

      const mockGroupResult = {
        executions: [
          {
            stageName: 'test-stage',
            status: 'success',
            startTime: new Date().toISOString()
          }
        ],
        anyFailed: false
      };

      vi.spyOn(mockParallelExecutor, 'executeSequentialGroup').mockResolvedValue(
        mockGroupResult
      );

      await orchestrator.processGroup(
        mockGroup,
        mockState,
        mockConfig,
        mockExecutionGraph,
        mockParallelExecutor,
        true // interactive
      );

      // Should not log in interactive mode
      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('Conditional Execution', () => {
    it('should run stage when condition evaluates to true', async () => {
      const mockEvaluator = createMockConditionEvaluator({ evaluateResult: true });
      (orchestrator as any).conditionEvaluator = mockEvaluator;

      const conditionalGroup: ExecutionGroup = {
        level: 0,
        stages: [
          {
            name: 'conditional-stage',
            agent: '.claude/agents/test.md',
            condition: '{{ stages.review.outputs.issues > 0 }}'
          }
        ]
      };

      const mockGroupResult = {
        executions: [
          {
            stageName: 'conditional-stage',
            status: 'success',
            startTime: new Date().toISOString()
          }
        ],
        anyFailed: false
      };

      vi.spyOn(mockParallelExecutor, 'executeSequentialGroup').mockResolvedValue(
        mockGroupResult
      );

      const result = await orchestrator.processGroup(
        conditionalGroup,
        mockState,
        mockConfig,
        mockExecutionGraph,
        mockParallelExecutor,
        false
      );

      expect(mockEvaluator.evaluate).toHaveBeenCalledWith(
        '{{ stages.review.outputs.issues > 0 }}',
        expect.any(Object)
      );
      expect(result.state.stages).toHaveLength(1);
      expect(result.state.stages[0].stageName).toBe('conditional-stage');
      expect(result.state.stages[0].status).toBe('success');
    });

    it('should skip stage when condition evaluates to false', async () => {
      const mockEvaluator = createMockConditionEvaluator({ evaluateResult: false });
      (orchestrator as any).conditionEvaluator = mockEvaluator;

      const conditionalGroup: ExecutionGroup = {
        level: 0,
        stages: [
          {
            name: 'conditional-stage',
            agent: '.claude/agents/test.md',
            condition: '{{ stages.review.outputs.issues == 0 }}'
          }
        ]
      };

      const result = await orchestrator.processGroup(
        conditionalGroup,
        mockState,
        mockConfig,
        mockExecutionGraph,
        mockParallelExecutor,
        false
      );

      expect(mockEvaluator.evaluate).toHaveBeenCalledWith(
        '{{ stages.review.outputs.issues == 0 }}',
        expect.any(Object)
      );
      expect(result.state.stages).toHaveLength(1);
      expect(result.state.stages[0].stageName).toBe('conditional-stage');
      expect(result.state.stages[0].status).toBe('skipped');
      expect(result.state.stages[0].conditionEvaluated).toBe(true);
      expect(result.state.stages[0].conditionResult).toBe(false);
    });

    it('should handle multiple stages with mixed conditions', async () => {
      const mockEvaluator = createMockConditionEvaluator();
      (orchestrator as any).conditionEvaluator = mockEvaluator;

      // First call returns true, second call returns false
      vi.spyOn(mockEvaluator, 'evaluate')
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);

      const conditionalGroup: ExecutionGroup = {
        level: 0,
        stages: [
          {
            name: 'stage-1',
            agent: '.claude/agents/test1.md',
            condition: '{{ stages.review.outputs.issues > 0 }}'
          },
          {
            name: 'stage-2',
            agent: '.claude/agents/test2.md',
            condition: '{{ stages.review.outputs.issues == 0 }}'
          }
        ]
      };

      const mockGroupResult = {
        executions: [
          {
            stageName: 'stage-1',
            status: 'success',
            startTime: new Date().toISOString()
          }
        ],
        anyFailed: false
      };

      vi.spyOn(mockParallelExecutor, 'executeSequentialGroup').mockResolvedValue(
        mockGroupResult
      );

      const result = await orchestrator.processGroup(
        conditionalGroup,
        mockState,
        mockConfig,
        mockExecutionGraph,
        mockParallelExecutor,
        false
      );

      // Should have 2 stages: stage-2 skipped, stage-1 executed
      expect(result.state.stages).toHaveLength(2);
      expect(result.state.stages[0].stageName).toBe('stage-2');
      expect(result.state.stages[0].status).toBe('skipped');
      expect(result.state.stages[1].stageName).toBe('stage-1');
      expect(result.state.stages[1].status).toBe('success');
    });

    it('should log when condition is met', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const mockEvaluator = createMockConditionEvaluator({ evaluateResult: true });
      (orchestrator as any).conditionEvaluator = mockEvaluator;

      const conditionalGroup: ExecutionGroup = {
        level: 0,
        stages: [
          {
            name: 'conditional-stage',
            agent: '.claude/agents/test.md',
            condition: '{{ stages.review.outputs.issues > 0 }}'
          }
        ]
      };

      const mockGroupResult = {
        executions: [
          {
            stageName: 'conditional-stage',
            status: 'success',
            startTime: new Date().toISOString()
          }
        ],
        anyFailed: false
      };

      vi.spyOn(mockParallelExecutor, 'executeSequentialGroup').mockResolvedValue(
        mockGroupResult
      );

      await orchestrator.processGroup(
        conditionalGroup,
        mockState,
        mockConfig,
        mockExecutionGraph,
        mockParallelExecutor,
        false
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Condition met for stage "conditional-stage"')
      );

      consoleSpy.mockRestore();
    });

    it('should log when condition is not met', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const mockEvaluator = createMockConditionEvaluator({ evaluateResult: false });
      (orchestrator as any).conditionEvaluator = mockEvaluator;

      const conditionalGroup: ExecutionGroup = {
        level: 0,
        stages: [
          {
            name: 'conditional-stage',
            agent: '.claude/agents/test.md',
            condition: '{{ stages.review.outputs.issues == 0 }}'
          }
        ]
      };

      await orchestrator.processGroup(
        conditionalGroup,
        mockState,
        mockConfig,
        mockExecutionGraph,
        mockParallelExecutor,
        false
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Skipping stage "conditional-stage" (condition not met)')
      );

      consoleSpy.mockRestore();
    });

    it('should correctly update state fields when condition fails', async () => {
      const mockEvaluator = createMockConditionEvaluator({ evaluateResult: false });
      (orchestrator as any).conditionEvaluator = mockEvaluator;

      const conditionalGroup: ExecutionGroup = {
        level: 0,
        stages: [
          {
            name: 'conditional-stage',
            agent: '.claude/agents/test.md',
            condition: '{{ stages.review.outputs.issues == 0 }}'
          }
        ]
      };

      const result = await orchestrator.processGroup(
        conditionalGroup,
        mockState,
        mockConfig,
        mockExecutionGraph,
        mockParallelExecutor,
        false
      );

      const skippedStage = result.state.stages[0];
      expect(skippedStage.stageName).toBe('conditional-stage');
      expect(skippedStage.status).toBe('skipped');
      expect(skippedStage.conditionEvaluated).toBe(true);
      expect(skippedStage.conditionResult).toBe(false);
      expect(skippedStage.startTime).toBeDefined();
    });
  });

  describe('Context Reduction', () => {
    beforeEach(() => {
      // Mock StageExecutor constructor
      vi.mock('../../core/stage-executor.js');
    });

    it('should skip context reduction when disabled', async () => {
      const configWithDisabledReduction = {
        ...mockConfig,
        settings: {
          contextReduction: {
            enabled: false,
            maxTokens: 50000,
            strategy: 'agent-based' as const,
            agentPath: '.claude/agents/reducer.md'
          }
        }
      };

      const mockGroupResult = {
        executions: [
          {
            stageName: 'test-stage',
            status: 'success',
            startTime: new Date().toISOString()
          }
        ],
        anyFailed: false
      };

      vi.spyOn(mockParallelExecutor, 'executeSequentialGroup').mockResolvedValue(
        mockGroupResult
      );

      const mockContextReducer = createMockContextReducer();
      vi.spyOn(ContextReducer.prototype, 'shouldReduce');

      await orchestrator.processGroup(
        mockGroup,
        mockState,
        configWithDisabledReduction,
        mockExecutionGraph,
        mockParallelExecutor,
        false
      );

      // shouldReduce should never be called when disabled
      expect(ContextReducer.prototype.shouldReduce).not.toHaveBeenCalled();
    });

    it('should skip context reduction when strategy is not agent-based', async () => {
      const configWithSummaryStrategy = {
        ...mockConfig,
        settings: {
          contextReduction: {
            enabled: true,
            maxTokens: 50000,
            strategy: 'summary-based' as const
          }
        }
      };

      const mockGroupResult = {
        executions: [
          {
            stageName: 'test-stage',
            status: 'success',
            startTime: new Date().toISOString()
          }
        ],
        anyFailed: false
      };

      vi.spyOn(mockParallelExecutor, 'executeSequentialGroup').mockResolvedValue(
        mockGroupResult
      );

      vi.spyOn(ContextReducer.prototype, 'shouldReduce');

      await orchestrator.processGroup(
        mockGroup,
        mockState,
        configWithSummaryStrategy,
        mockExecutionGraph,
        mockParallelExecutor,
        false
      );

      // shouldReduce should never be called when strategy is not agent-based
      expect(ContextReducer.prototype.shouldReduce).not.toHaveBeenCalled();
    });

    it('should skip context reduction when agentPath is not provided', async () => {
      const configWithoutAgentPath = {
        ...mockConfig,
        settings: {
          contextReduction: {
            enabled: true,
            maxTokens: 50000,
            strategy: 'agent-based' as const
          }
        }
      };

      const mockGroupResult = {
        executions: [
          {
            stageName: 'test-stage',
            status: 'success',
            startTime: new Date().toISOString()
          }
        ],
        anyFailed: false
      };

      vi.spyOn(mockParallelExecutor, 'executeSequentialGroup').mockResolvedValue(
        mockGroupResult
      );

      vi.spyOn(ContextReducer.prototype, 'shouldReduce');

      await orchestrator.processGroup(
        mockGroup,
        mockState,
        configWithoutAgentPath,
        mockExecutionGraph,
        mockParallelExecutor,
        false
      );

      // shouldReduce should never be called when agentPath missing
      expect(ContextReducer.prototype.shouldReduce).not.toHaveBeenCalled();
    });

    it('should skip context reduction when no next stage available', async () => {
      const configWithReduction = {
        ...mockConfig,
        settings: {
          contextReduction: {
            enabled: true,
            maxTokens: 50000,
            strategy: 'agent-based' as const,
            agentPath: '.claude/agents/reducer.md'
          }
        }
      };

      // Single group graph - no next stage
      const singleGroupGraph: ExecutionGraph = {
        plan: {
          groups: [mockGroup],
          maxParallelism: 1
        },
        validation: {
          errors: [],
          warnings: [],
          isValid: true
        }
      };

      const mockGroupResult = {
        executions: [
          {
            stageName: 'test-stage',
            status: 'success',
            startTime: new Date().toISOString()
          }
        ],
        anyFailed: false
      };

      vi.spyOn(mockParallelExecutor, 'executeSequentialGroup').mockResolvedValue(
        mockGroupResult
      );

      vi.spyOn(ContextReducer.prototype, 'shouldReduce');

      await orchestrator.processGroup(
        mockGroup,
        mockState,
        configWithReduction,
        singleGroupGraph,
        mockParallelExecutor,
        false
      );

      // shouldReduce should never be called when no next stage
      expect(ContextReducer.prototype.shouldReduce).not.toHaveBeenCalled();
    });

    it('should skip context reduction when below threshold', async () => {
      const configWithReduction = {
        ...mockConfig,
        settings: {
          contextReduction: {
            enabled: true,
            maxTokens: 50000,
            strategy: 'agent-based' as const,
            agentPath: '.claude/agents/reducer.md'
          }
        }
      };

      // Multi-group graph with next stage
      const multiGroupGraph: ExecutionGraph = {
        plan: {
          groups: [
            mockGroup,
            {
              level: 1,
              stages: [{ name: 'next-stage', agent: '.claude/agents/next.md' }]
            }
          ],
          maxParallelism: 1
        },
        validation: {
          errors: [],
          warnings: [],
          isValid: true
        }
      };

      const mockGroupResult = {
        executions: [
          {
            stageName: 'test-stage',
            status: 'success',
            startTime: new Date().toISOString()
          }
        ],
        anyFailed: false
      };

      vi.spyOn(mockParallelExecutor, 'executeSequentialGroup').mockResolvedValue(
        mockGroupResult
      );

      // Mock TokenEstimator to return low token count
      const mockTokenEstimator = {
        estimateTokens: vi.fn().mockReturnValue(10000), // Below threshold
        dispose: vi.fn()
      };
      vi.spyOn(TokenEstimator.prototype, 'estimateTokens').mockReturnValue(10000);
      vi.spyOn(TokenEstimator.prototype, 'dispose').mockImplementation(() => {});

      // Mock ContextReducer.shouldReduce to return false
      const mockContextReducer = createMockContextReducer({ shouldReduceResult: false });
      vi.spyOn(ContextReducer.prototype, 'shouldReduce').mockReturnValue(false);
      vi.spyOn(ContextReducer.prototype, 'runReduction');

      await orchestrator.processGroup(
        mockGroup,
        mockState,
        configWithReduction,
        multiGroupGraph,
        mockParallelExecutor,
        false
      );

      // shouldReduce should be called but return false
      expect(ContextReducer.prototype.shouldReduce).toHaveBeenCalled();
      // runReduction should NOT be called
      expect(ContextReducer.prototype.runReduction).not.toHaveBeenCalled();
    });

    it('should run context reduction when above threshold', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const configWithReduction = {
        ...mockConfig,
        settings: {
          contextReduction: {
            enabled: true,
            maxTokens: 50000,
            strategy: 'agent-based' as const,
            agentPath: '.claude/agents/reducer.md'
          }
        }
      };

      // Multi-group graph with next stage
      const multiGroupGraph: ExecutionGraph = {
        plan: {
          groups: [
            mockGroup,
            {
              level: 1,
              stages: [{ name: 'next-stage', agent: '.claude/agents/next.md' }]
            }
          ],
          maxParallelism: 1
        },
        validation: {
          errors: [],
          warnings: [],
          isValid: true
        }
      };

      const mockGroupResult = {
        executions: [
          {
            stageName: 'test-stage',
            status: 'success',
            startTime: new Date().toISOString()
          }
        ],
        anyFailed: false
      };

      vi.spyOn(mockParallelExecutor, 'executeSequentialGroup').mockResolvedValue(
        mockGroupResult
      );

      // Mock TokenEstimator to return high token count
      vi.spyOn(TokenEstimator.prototype, 'estimateTokens').mockReturnValue(47000); // Above threshold
      vi.spyOn(TokenEstimator.prototype, 'dispose').mockImplementation(() => {});

      // Mock ContextReducer methods
      vi.spyOn(ContextReducer.prototype, 'shouldReduce').mockReturnValue(true);
      const mockReductionResult = {
        stageName: '__context_reducer__',
        status: 'success' as const,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        duration: 5.2,
        retryAttempt: 0,
        maxRetries: 0
      };
      vi.spyOn(ContextReducer.prototype, 'runReduction').mockResolvedValue(mockReductionResult);
      vi.spyOn(ContextReducer.prototype, 'applyReduction').mockImplementation((state) => state);

      await orchestrator.processGroup(
        mockGroup,
        mockState,
        configWithReduction,
        multiGroupGraph,
        mockParallelExecutor,
        false
      );

      // Should log context warning
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Context approaching limit')
      );

      // Should call runReduction
      expect(ContextReducer.prototype.runReduction).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should apply successful context reduction to state', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const configWithReduction = {
        ...mockConfig,
        settings: {
          contextReduction: {
            enabled: true,
            maxTokens: 50000,
            strategy: 'agent-based' as const,
            agentPath: '.claude/agents/reducer.md'
          }
        }
      };

      const multiGroupGraph: ExecutionGraph = {
        plan: {
          groups: [
            mockGroup,
            {
              level: 1,
              stages: [{ name: 'next-stage', agent: '.claude/agents/next.md' }]
            }
          ],
          maxParallelism: 1
        },
        validation: {
          errors: [],
          warnings: [],
          isValid: true
        }
      };

      const mockGroupResult = {
        executions: [
          {
            stageName: 'test-stage',
            status: 'success',
            startTime: new Date().toISOString()
          }
        ],
        anyFailed: false
      };

      vi.spyOn(mockParallelExecutor, 'executeSequentialGroup').mockResolvedValue(
        mockGroupResult
      );

      vi.spyOn(TokenEstimator.prototype, 'estimateTokens').mockReturnValue(47000);
      vi.spyOn(TokenEstimator.prototype, 'dispose').mockImplementation(() => {});

      vi.spyOn(ContextReducer.prototype, 'shouldReduce').mockReturnValue(true);
      const mockReductionResult = {
        stageName: '__context_reducer__',
        status: 'success' as const,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        duration: 5.2,
        retryAttempt: 0,
        maxRetries: 0
      };
      vi.spyOn(ContextReducer.prototype, 'runReduction').mockResolvedValue(mockReductionResult);

      // Track applyReduction calls
      const applyReductionSpy = vi.spyOn(ContextReducer.prototype, 'applyReduction').mockImplementation((state) => {
        return {
          ...state,
          stages: [mockReductionResult, ...state.stages]
        };
      });

      await orchestrator.processGroup(
        mockGroup,
        mockState,
        configWithReduction,
        multiGroupGraph,
        mockParallelExecutor,
        false
      );

      expect(applyReductionSpy).toHaveBeenCalled();
      expect(mockStateManager.saveState).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Context reduced successfully')
      );

      consoleSpy.mockRestore();
    });

    it('should continue pipeline when context reduction fails', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const configWithReduction = {
        ...mockConfig,
        settings: {
          contextReduction: {
            enabled: true,
            maxTokens: 50000,
            strategy: 'agent-based' as const,
            agentPath: '.claude/agents/reducer.md'
          }
        }
      };

      const multiGroupGraph: ExecutionGraph = {
        plan: {
          groups: [
            mockGroup,
            {
              level: 1,
              stages: [{ name: 'next-stage', agent: '.claude/agents/next.md' }]
            }
          ],
          maxParallelism: 1
        },
        validation: {
          errors: [],
          warnings: [],
          isValid: true
        }
      };

      const mockGroupResult = {
        executions: [
          {
            stageName: 'test-stage',
            status: 'success',
            startTime: new Date().toISOString()
          }
        ],
        anyFailed: false
      };

      vi.spyOn(mockParallelExecutor, 'executeSequentialGroup').mockResolvedValue(
        mockGroupResult
      );

      vi.spyOn(TokenEstimator.prototype, 'estimateTokens').mockReturnValue(47000);
      vi.spyOn(TokenEstimator.prototype, 'dispose').mockImplementation(() => {});

      vi.spyOn(ContextReducer.prototype, 'shouldReduce').mockReturnValue(true);

      // Mock reduction to return failed status
      const mockFailedReduction = {
        stageName: '__context_reducer__',
        status: 'failed' as const,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        retryAttempt: 0,
        maxRetries: 0
      };
      vi.spyOn(ContextReducer.prototype, 'runReduction').mockResolvedValue(mockFailedReduction);

      const result = await orchestrator.processGroup(
        mockGroup,
        mockState,
        configWithReduction,
        multiGroupGraph,
        mockParallelExecutor,
        false
      );

      // Pipeline should continue
      expect(result.shouldStopPipeline).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Context reduction failed. Continuing with full context')
      );

      consoleSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    });

    it('should handle context reduction errors gracefully', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const configWithReduction = {
        ...mockConfig,
        settings: {
          contextReduction: {
            enabled: true,
            maxTokens: 50000,
            strategy: 'agent-based' as const,
            agentPath: '.claude/agents/reducer.md'
          }
        }
      };

      const multiGroupGraph: ExecutionGraph = {
        plan: {
          groups: [
            mockGroup,
            {
              level: 1,
              stages: [{ name: 'next-stage', agent: '.claude/agents/next.md' }]
            }
          ],
          maxParallelism: 1
        },
        validation: {
          errors: [],
          warnings: [],
          isValid: true
        }
      };

      const mockGroupResult = {
        executions: [
          {
            stageName: 'test-stage',
            status: 'success',
            startTime: new Date().toISOString()
          }
        ],
        anyFailed: false
      };

      vi.spyOn(mockParallelExecutor, 'executeSequentialGroup').mockResolvedValue(
        mockGroupResult
      );

      vi.spyOn(TokenEstimator.prototype, 'estimateTokens').mockReturnValue(47000);
      vi.spyOn(TokenEstimator.prototype, 'dispose').mockImplementation(() => {});

      vi.spyOn(ContextReducer.prototype, 'shouldReduce').mockReturnValue(true);

      // Mock reduction to throw error
      vi.spyOn(ContextReducer.prototype, 'runReduction').mockRejectedValue(
        new Error('Reducer agent failed')
      );

      const result = await orchestrator.processGroup(
        mockGroup,
        mockState,
        configWithReduction,
        multiGroupGraph,
        mockParallelExecutor,
        false
      );

      // Pipeline should continue despite error
      expect(result.shouldStopPipeline).toBe(false);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Context reduction error')
      );

      consoleWarnSpy.mockRestore();
    });

    it('should correctly estimate context for next stage', async () => {
      const configWithReduction = {
        ...mockConfig,
        settings: {
          contextReduction: {
            enabled: true,
            maxTokens: 50000,
            strategy: 'agent-based' as const,
            agentPath: '.claude/agents/reducer.md'
          }
        }
      };

      const multiGroupGraph: ExecutionGraph = {
        plan: {
          groups: [
            mockGroup,
            {
              level: 1,
              stages: [{ name: 'next-stage', agent: '.claude/agents/next.md' }]
            }
          ],
          maxParallelism: 1
        },
        validation: {
          errors: [],
          warnings: [],
          isValid: true
        }
      };

      const mockGroupResult = {
        executions: [
          {
            stageName: 'test-stage',
            status: 'success',
            startTime: new Date().toISOString()
          }
        ],
        anyFailed: false
      };

      vi.spyOn(mockParallelExecutor, 'executeSequentialGroup').mockResolvedValue(
        mockGroupResult
      );

      // Spy on TokenEstimator
      const estimateSpy = vi.spyOn(TokenEstimator.prototype, 'estimateTokens').mockReturnValue(47000);
      vi.spyOn(TokenEstimator.prototype, 'dispose').mockImplementation(() => {});

      vi.spyOn(ContextReducer.prototype, 'shouldReduce').mockReturnValue(true);
      vi.spyOn(ContextReducer.prototype, 'runReduction').mockResolvedValue({
        stageName: '__context_reducer__',
        status: 'success',
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        duration: 5.2,
        retryAttempt: 0,
        maxRetries: 0
      });
      vi.spyOn(ContextReducer.prototype, 'applyReduction').mockImplementation((state) => state);

      await orchestrator.processGroup(
        mockGroup,
        mockState,
        configWithReduction,
        multiGroupGraph,
        mockParallelExecutor,
        false
      );

      // Token estimator should have been called
      expect(estimateSpy).toHaveBeenCalled();
    });
  });

  describe('Logging Methods', () => {
    it('should log disabled stage skipping with correct message', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const disabledGroup: ExecutionGroup = {
        level: 0,
        stages: [
          { name: 'disabled-stage', agent: '.claude/agents/test.md', enabled: false }
        ]
      };

      await orchestrator.processGroup(
        disabledGroup,
        mockState,
        mockConfig,
        mockExecutionGraph,
        mockParallelExecutor,
        false
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Skipping disabled stage: disabled-stage')
      );

      consoleSpy.mockRestore();
    });

    it('should log condition-based stage skipping with condition text', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const mockEvaluator = createMockConditionEvaluator({ evaluateResult: false });
      (orchestrator as any).conditionEvaluator = mockEvaluator;

      const conditionalGroup: ExecutionGroup = {
        level: 0,
        stages: [
          {
            name: 'conditional-stage',
            agent: '.claude/agents/test.md',
            condition: '{{ stages.review.outputs.issues == 0 }}'
          }
        ]
      };

      await orchestrator.processGroup(
        conditionalGroup,
        mockState,
        mockConfig,
        mockExecutionGraph,
        mockParallelExecutor,
        false
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/Skipping stage "conditional-stage" \(condition not met\)/)
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('{{ stages.review.outputs.issues == 0 }}')
      );

      consoleSpy.mockRestore();
    });

    it('should log group start for parallel execution with multiple stages', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const parallelConfig = {
        ...mockConfig,
        settings: { executionMode: 'parallel' as const }
      };

      const parallelGroup: ExecutionGroup = {
        level: 2,
        stages: [
          { name: 'stage-1', agent: '.claude/agents/test1.md' },
          { name: 'stage-2', agent: '.claude/agents/test2.md' },
          { name: 'stage-3', agent: '.claude/agents/test3.md' }
        ]
      };

      const mockGroupResult = {
        executions: [
          {
            stageName: 'stage-1',
            status: 'success',
            startTime: new Date().toISOString()
          },
          {
            stageName: 'stage-2',
            status: 'success',
            startTime: new Date().toISOString()
          },
          {
            stageName: 'stage-3',
            status: 'success',
            startTime: new Date().toISOString()
          }
        ],
        anyFailed: false
      };

      vi.spyOn(mockParallelExecutor, 'executeParallelGroup').mockResolvedValue(
        mockGroupResult
      );

      await orchestrator.processGroup(
        parallelGroup,
        mockState,
        parallelConfig,
        mockExecutionGraph,
        mockParallelExecutor,
        false
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/Running 3 stages in parallel \(group 2\)/)
      );

      consoleSpy.mockRestore();
    });

    it('should not log group start for single stage', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const singleStageGroup: ExecutionGroup = {
        level: 1,
        stages: [
          { name: 'single-stage', agent: '.claude/agents/test.md' }
        ]
      };

      const mockGroupResult = {
        executions: [
          {
            stageName: 'single-stage',
            status: 'success',
            startTime: new Date().toISOString()
          }
        ],
        anyFailed: false
      };

      vi.spyOn(mockParallelExecutor, 'executeSequentialGroup').mockResolvedValue(
        mockGroupResult
      );

      await orchestrator.processGroup(
        singleStageGroup,
        mockState,
        mockConfig,
        mockExecutionGraph,
        mockParallelExecutor,
        false
      );

      // Should not log "Running X stages in parallel" for single stage
      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringMatching(/Running .* stages in parallel/)
      );

      consoleSpy.mockRestore();
    });

    it('should log group result with aggregated results for parallel execution', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const parallelConfig = {
        ...mockConfig,
        settings: { executionMode: 'parallel' as const }
      };

      const parallelGroup: ExecutionGroup = {
        level: 1,
        stages: [
          { name: 'stage-1', agent: '.claude/agents/test1.md' },
          { name: 'stage-2', agent: '.claude/agents/test2.md' }
        ]
      };

      const mockGroupResult = {
        executions: [
          {
            stageName: 'stage-1',
            status: 'success',
            startTime: new Date().toISOString()
          },
          {
            stageName: 'stage-2',
            status: 'success',
            startTime: new Date().toISOString()
          }
        ],
        anyFailed: false
      };

      vi.spyOn(mockParallelExecutor, 'executeParallelGroup').mockResolvedValue(
        mockGroupResult
      );

      const aggregateResultsText = '2 stages completed successfully';
      vi.spyOn(mockParallelExecutor, 'aggregateResults').mockReturnValue(aggregateResultsText);

      await orchestrator.processGroup(
        parallelGroup,
        mockState,
        parallelConfig,
        mockExecutionGraph,
        mockParallelExecutor,
        false
      );

      // Should log aggregated results with emoji
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('📊 2 stages completed successfully')
      );

      consoleSpy.mockRestore();
    });

    it('should not log group result for sequential execution', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const sequentialConfig = {
        ...mockConfig,
        settings: { executionMode: 'sequential' as const }
      };

      const mockGroupResult = {
        executions: [
          {
            stageName: 'test-stage',
            status: 'success',
            startTime: new Date().toISOString()
          }
        ],
        anyFailed: false
      };

      vi.spyOn(mockParallelExecutor, 'executeSequentialGroup').mockResolvedValue(
        mockGroupResult
      );

      await orchestrator.processGroup(
        mockGroup,
        mockState,
        sequentialConfig,
        mockExecutionGraph,
        mockParallelExecutor,
        false
      );

      // Should not log aggregated results for sequential mode
      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringMatching(/📊/)
      );

      consoleSpy.mockRestore();
    });
  });
});
