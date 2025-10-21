import { vi } from 'vitest';
import { ContextReducer } from '../../core/context-reducer.js';
import { PipelineState, AgentStageConfig, StageExecution, ContextReductionConfig } from '../../config/schema.js';

export interface MockContextReducerConfig {
  shouldReduceResult?: boolean;
  runReductionResult?: StageExecution;
  applyReductionResult?: PipelineState;
  shouldThrow?: boolean;
  errorMessage?: string;
}

export function createMockContextReducer(config: MockContextReducerConfig = {}): ContextReducer {
  const {
    shouldReduceResult = false,
    runReductionResult,
    applyReductionResult,
    shouldThrow = false,
    errorMessage = 'Context reduction failed',
  } = config;

  return {
    shouldReduce: vi.fn().mockImplementation((_tokenCount: number, _config: ContextReductionConfig) => {
      if (shouldThrow) {
        throw new Error(errorMessage);
      }
      return shouldReduceResult;
    }),
    runReduction: vi.fn().mockImplementation(async (
      _pipelineState: PipelineState,
      _upcomingStage: AgentStageConfig,
      _reducerAgentPath: string
    ) => {
      if (shouldThrow) {
        throw new Error(errorMessage);
      }
      return runReductionResult || {
        stageName: '__context_reducer__',
        status: 'success',
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        duration: 5.2,
        retryAttempt: 0,
        maxRetries: 0,
        agentOutput: 'Context reduced successfully',
        extractedData: {
          summary: 'Context summary',
          critical_findings: ['Finding 1'],
          metrics: {}
        }
      };
    }),
    applyReduction: vi.fn().mockImplementation((
      pipelineState: PipelineState,
      _reducerOutput: StageExecution
    ) => {
      if (shouldThrow) {
        throw new Error(errorMessage);
      }
      return applyReductionResult || pipelineState;
    }),
  } as unknown as ContextReducer;
}
