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
      expect(result.state.status).toBe('failed');
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
      expect(result.state.status).toBe('running');
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
});
