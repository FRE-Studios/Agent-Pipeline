import { vi } from 'vitest';
import { ConditionEvaluator } from '../../core/condition-evaluator.js';
import { PipelineState } from '../../config/schema.js';

export interface MockConditionEvaluatorConfig {
  evaluateResult?: boolean;
  shouldThrow?: boolean;
  errorMessage?: string;
}

export function createMockConditionEvaluator(config: MockConditionEvaluatorConfig = {}): ConditionEvaluator {
  const {
    evaluateResult = true,
    shouldThrow = false,
    errorMessage = 'Condition evaluation failed',
  } = config;

  return {
    evaluate: vi.fn().mockImplementation((_condition: string, _state: PipelineState) => {
      if (shouldThrow) {
        throw new Error(errorMessage);
      }
      return evaluateResult;
    }),
    validateSyntax: vi.fn().mockReturnValue({ valid: true }),
  } as unknown as ConditionEvaluator;
}
