import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ValidationOrchestrator } from '../../validators/validation-orchestrator.js';
import { ValidationContext, Validator, ValidationError } from '../../validators/types.js';
import { PipelineConfig } from '../../config/schema.js';

/**
 * Creates a mock validator for testing.
 */
function createMockValidator(
  name: string,
  priority: 0 | 1 | 2,
  options: {
    shouldRun?: boolean;
    errors?: ValidationError[];
    skipRemainingValidators?: boolean;
    onValidate?: (context: ValidationContext) => void;
  } = {}
): Validator {
  const {
    shouldRun = true,
    errors = [],
    skipRemainingValidators = false,
    onValidate,
  } = options;

  return {
    name,
    priority,
    shouldRun: vi.fn().mockReturnValue(shouldRun),
    validate: vi.fn().mockImplementation(async (context: ValidationContext) => {
      if (onValidate) {
        onValidate(context);
      }
      errors.forEach(error => context.errors.push(error));
      if (skipRemainingValidators) {
        context.skipRemainingValidators = true;
      }
    }),
  };
}

/**
 * Creates a base pipeline config for testing.
 */
function createBaseConfig(): PipelineConfig {
  return {
    name: 'test-pipeline',
    trigger: 'manual',
    agents: [
      {
        name: 'test-stage',
        agent: '.agent-pipeline/agents/test-agent.md',
      },
    ],
  };
}

describe('ValidationOrchestrator', () => {
  let orchestrator: ValidationOrchestrator;

  beforeEach(() => {
    orchestrator = new ValidationOrchestrator();
  });

  describe('constructor - registers all validators', () => {
    it('should register all built-in validators', () => {
      // Access private validators array using type assertion
      const validators = (orchestrator as unknown as { validators: Validator[] }).validators;

      // Check that all expected validators are registered
      const validatorNames = validators.map(v => v.name);
      expect(validatorNames).toContain('environment');
      expect(validatorNames).toContain('git');
      expect(validatorNames).toContain('structure');
      expect(validatorNames).toContain('runtime');
      expect(validatorNames).toContain('agents');
      expect(validatorNames).toContain('execution');
      expect(validatorNames).toContain('notifications');
      expect(validatorNames).toContain('retry');
      expect(validatorNames).toContain('dag');
    });

    it('should register exactly 9 validators', () => {
      const validators = (orchestrator as unknown as { validators: Validator[] }).validators;
      expect(validators).toHaveLength(9);
    });
  });

  describe('validators are sorted by priority', () => {
    it('should sort validators in ascending priority order (0 first, then 1, then 2)', () => {
      const validators = (orchestrator as unknown as { validators: Validator[] }).validators;

      // Check that validators are sorted by priority
      for (let i = 1; i < validators.length; i++) {
        expect(validators[i].priority).toBeGreaterThanOrEqual(validators[i - 1].priority);
      }
    });

    it('should have P0 validators first', () => {
      const validators = (orchestrator as unknown as { validators: Validator[] }).validators;

      // P0 validators should be at the start
      const p0Validators = validators.filter(v => v.priority === 0);
      expect(p0Validators.length).toBeGreaterThan(0);

      // First validators should be P0
      for (let i = 0; i < p0Validators.length; i++) {
        expect(validators[i].priority).toBe(0);
      }
    });

    it('should have P1 validators after P0 validators', () => {
      const validators = (orchestrator as unknown as { validators: Validator[] }).validators;

      const p0Count = validators.filter(v => v.priority === 0).length;
      const p1Validators = validators.filter(v => v.priority === 1);

      // P1 validators should follow P0 validators
      for (let i = 0; i < p1Validators.length; i++) {
        expect(validators[p0Count + i].priority).toBe(1);
      }
    });

    it('should have P2 validators last', () => {
      const validators = (orchestrator as unknown as { validators: Validator[] }).validators;

      const p2Validators = validators.filter(v => v.priority === 2);
      const p2StartIndex = validators.length - p2Validators.length;

      // P2 validators should be at the end
      for (let i = p2StartIndex; i < validators.length; i++) {
        expect(validators[i].priority).toBe(2);
      }
    });
  });

  describe('register', () => {
    it('should add validator and maintain sorted order', () => {
      // Create a new orchestrator and clear its validators for isolated testing
      const testOrchestrator = new ValidationOrchestrator();
      const validators = (testOrchestrator as unknown as { validators: Validator[] }).validators;

      // Clear existing validators
      validators.length = 0;

      // Register validators in reverse priority order
      const p2Validator = createMockValidator('p2-validator', 2);
      const p0Validator = createMockValidator('p0-validator', 0);
      const p1Validator = createMockValidator('p1-validator', 1);

      testOrchestrator.register(p2Validator);
      testOrchestrator.register(p0Validator);
      testOrchestrator.register(p1Validator);

      // Check they are sorted correctly
      expect(validators[0].name).toBe('p0-validator');
      expect(validators[1].name).toBe('p1-validator');
      expect(validators[2].name).toBe('p2-validator');
    });

    it('should maintain order when registering validators with same priority', () => {
      const testOrchestrator = new ValidationOrchestrator();
      const validators = (testOrchestrator as unknown as { validators: Validator[] }).validators;

      validators.length = 0;

      const first = createMockValidator('first', 0);
      const second = createMockValidator('second', 0);
      const third = createMockValidator('third', 0);

      testOrchestrator.register(first);
      testOrchestrator.register(second);
      testOrchestrator.register(third);

      // All have same priority, sort should be stable
      expect(validators.map(v => v.priority)).toEqual([0, 0, 0]);
    });
  });

  describe('validate - returns empty array when all validations pass', () => {
    it('should return empty array when all validators pass', async () => {
      const testOrchestrator = new ValidationOrchestrator();
      const validators = (testOrchestrator as unknown as { validators: Validator[] }).validators;
      validators.length = 0;

      // Register passing validators
      testOrchestrator.register(createMockValidator('validator-1', 0));
      testOrchestrator.register(createMockValidator('validator-2', 1));
      testOrchestrator.register(createMockValidator('validator-3', 2));

      const config = createBaseConfig();
      const errors = await testOrchestrator.validate(config, '/test/repo');

      expect(errors).toEqual([]);
    });

    it('should return empty array with no validators registered', async () => {
      const testOrchestrator = new ValidationOrchestrator();
      const validators = (testOrchestrator as unknown as { validators: Validator[] }).validators;
      validators.length = 0;

      const config = createBaseConfig();
      const errors = await testOrchestrator.validate(config, '/test/repo');

      expect(errors).toEqual([]);
    });
  });

  describe('validate - accumulates errors from multiple validators', () => {
    it('should collect errors from a single validator', async () => {
      const testOrchestrator = new ValidationOrchestrator();
      const validators = (testOrchestrator as unknown as { validators: Validator[] }).validators;
      validators.length = 0;

      const error: ValidationError = {
        field: 'test-field',
        message: 'Test error message',
        severity: 'error',
      };

      testOrchestrator.register(createMockValidator('validator-1', 0, { errors: [error] }));

      const config = createBaseConfig();
      const errors = await testOrchestrator.validate(config, '/test/repo');

      expect(errors).toHaveLength(1);
      expect(errors[0]).toEqual(error);
    });

    it('should collect errors from multiple validators', async () => {
      const testOrchestrator = new ValidationOrchestrator();
      const validators = (testOrchestrator as unknown as { validators: Validator[] }).validators;
      validators.length = 0;

      const error1: ValidationError = {
        field: 'field-1',
        message: 'Error 1',
        severity: 'error',
      };
      const error2: ValidationError = {
        field: 'field-2',
        message: 'Error 2',
        severity: 'warning',
      };
      const error3: ValidationError = {
        field: 'field-3',
        message: 'Error 3',
        severity: 'error',
      };

      testOrchestrator.register(createMockValidator('validator-1', 0, { errors: [error1] }));
      testOrchestrator.register(createMockValidator('validator-2', 1, { errors: [error2] }));
      testOrchestrator.register(createMockValidator('validator-3', 2, { errors: [error3] }));

      const config = createBaseConfig();
      const errors = await testOrchestrator.validate(config, '/test/repo');

      expect(errors).toHaveLength(3);
      expect(errors).toContainEqual(error1);
      expect(errors).toContainEqual(error2);
      expect(errors).toContainEqual(error3);
    });

    it('should collect multiple errors from a single validator', async () => {
      const testOrchestrator = new ValidationOrchestrator();
      const validators = (testOrchestrator as unknown as { validators: Validator[] }).validators;
      validators.length = 0;

      const errors: ValidationError[] = [
        { field: 'field-1', message: 'Error 1', severity: 'error' },
        { field: 'field-2', message: 'Error 2', severity: 'error' },
        { field: 'field-3', message: 'Error 3', severity: 'warning' },
      ];

      testOrchestrator.register(createMockValidator('validator-1', 0, { errors }));

      const config = createBaseConfig();
      const result = await testOrchestrator.validate(config, '/test/repo');

      expect(result).toHaveLength(3);
      expect(result).toEqual(errors);
    });

    it('should accumulate errors in order of validator execution', async () => {
      const testOrchestrator = new ValidationOrchestrator();
      const validators = (testOrchestrator as unknown as { validators: Validator[] }).validators;
      validators.length = 0;

      const error1: ValidationError = {
        field: 'p0-field',
        message: 'P0 error',
        severity: 'error',
      };
      const error2: ValidationError = {
        field: 'p1-field',
        message: 'P1 error',
        severity: 'error',
      };

      testOrchestrator.register(createMockValidator('p1-validator', 1, { errors: [error2] }));
      testOrchestrator.register(createMockValidator('p0-validator', 0, { errors: [error1] }));

      const config = createBaseConfig();
      const result = await testOrchestrator.validate(config, '/test/repo');

      // P0 should execute first, so its error should be first
      expect(result[0]).toEqual(error1);
      expect(result[1]).toEqual(error2);
    });
  });

  describe('validators with shouldRun returning false are skipped', () => {
    it('should skip validator when shouldRun returns false', async () => {
      const testOrchestrator = new ValidationOrchestrator();
      const validators = (testOrchestrator as unknown as { validators: Validator[] }).validators;
      validators.length = 0;

      const skippedValidator = createMockValidator('skipped', 0, {
        shouldRun: false,
        errors: [{ field: 'skipped', message: 'Should not appear', severity: 'error' }],
      });

      testOrchestrator.register(skippedValidator);

      const config = createBaseConfig();
      const errors = await testOrchestrator.validate(config, '/test/repo');

      expect(errors).toHaveLength(0);
      expect(skippedValidator.shouldRun).toHaveBeenCalled();
      expect(skippedValidator.validate).not.toHaveBeenCalled();
    });

    it('should run other validators when one is skipped', async () => {
      const testOrchestrator = new ValidationOrchestrator();
      const validators = (testOrchestrator as unknown as { validators: Validator[] }).validators;
      validators.length = 0;

      const error: ValidationError = {
        field: 'active-field',
        message: 'Active error',
        severity: 'error',
      };

      const skippedValidator = createMockValidator('skipped', 0, { shouldRun: false });
      const activeValidator = createMockValidator('active', 0, { errors: [error] });

      testOrchestrator.register(skippedValidator);
      testOrchestrator.register(activeValidator);

      const config = createBaseConfig();
      const errors = await testOrchestrator.validate(config, '/test/repo');

      expect(errors).toHaveLength(1);
      expect(errors[0]).toEqual(error);
    });

    it('should check shouldRun for each validator with current context', async () => {
      const testOrchestrator = new ValidationOrchestrator();
      const validators = (testOrchestrator as unknown as { validators: Validator[] }).validators;
      validators.length = 0;

      const shouldRunFn = vi.fn().mockReturnValue(true);
      const validator: Validator = {
        name: 'context-checker',
        priority: 0,
        shouldRun: shouldRunFn,
        validate: vi.fn(),
      };

      testOrchestrator.register(validator);

      const config = createBaseConfig();
      await testOrchestrator.validate(config, '/custom/repo/path');

      expect(shouldRunFn).toHaveBeenCalledWith(
        expect.objectContaining({
          config,
          repoPath: '/custom/repo/path',
          errors: [],
        })
      );
    });
  });

  describe('skipRemainingValidators flag stops execution', () => {
    it('should stop execution when skipRemainingValidators is set', async () => {
      const testOrchestrator = new ValidationOrchestrator();
      const validators = (testOrchestrator as unknown as { validators: Validator[] }).validators;
      validators.length = 0;

      const stoppingValidator = createMockValidator('stopper', 0, {
        skipRemainingValidators: true,
        errors: [{ field: 'stopper', message: 'Critical error', severity: 'error' }],
      });
      const skippedValidator = createMockValidator('skipped', 1);

      testOrchestrator.register(stoppingValidator);
      testOrchestrator.register(skippedValidator);

      const config = createBaseConfig();
      const errors = await testOrchestrator.validate(config, '/test/repo');

      expect(errors).toHaveLength(1);
      expect(stoppingValidator.validate).toHaveBeenCalled();
      expect(skippedValidator.shouldRun).not.toHaveBeenCalled();
      expect(skippedValidator.validate).not.toHaveBeenCalled();
    });

    it('should execute validators before the stopping one', async () => {
      const testOrchestrator = new ValidationOrchestrator();
      const validators = (testOrchestrator as unknown as { validators: Validator[] }).validators;
      validators.length = 0;

      const beforeValidator = createMockValidator('before', 0, {
        errors: [{ field: 'before', message: 'Before error', severity: 'error' }],
      });
      const stoppingValidator = createMockValidator('stopper', 1, {
        skipRemainingValidators: true,
        errors: [{ field: 'stopper', message: 'Stopping error', severity: 'error' }],
      });
      const afterValidator = createMockValidator('after', 2);

      testOrchestrator.register(beforeValidator);
      testOrchestrator.register(stoppingValidator);
      testOrchestrator.register(afterValidator);

      const config = createBaseConfig();
      const errors = await testOrchestrator.validate(config, '/test/repo');

      expect(errors).toHaveLength(2);
      expect(beforeValidator.validate).toHaveBeenCalled();
      expect(stoppingValidator.validate).toHaveBeenCalled();
      expect(afterValidator.validate).not.toHaveBeenCalled();
    });

    it('should stop at first validator that sets skipRemainingValidators', async () => {
      const testOrchestrator = new ValidationOrchestrator();
      const validators = (testOrchestrator as unknown as { validators: Validator[] }).validators;
      validators.length = 0;

      const firstStopper = createMockValidator('first-stopper', 0, {
        skipRemainingValidators: true,
      });
      const secondStopper = createMockValidator('second-stopper', 1, {
        skipRemainingValidators: true,
      });

      testOrchestrator.register(firstStopper);
      testOrchestrator.register(secondStopper);

      const config = createBaseConfig();
      await testOrchestrator.validate(config, '/test/repo');

      expect(firstStopper.validate).toHaveBeenCalled();
      expect(secondStopper.validate).not.toHaveBeenCalled();
    });
  });

  describe('validators are called in priority order', () => {
    it('should call validators in ascending priority order', async () => {
      const testOrchestrator = new ValidationOrchestrator();
      const validators = (testOrchestrator as unknown as { validators: Validator[] }).validators;
      validators.length = 0;

      const executionOrder: string[] = [];

      const p2Validator = createMockValidator('p2', 2, {
        onValidate: () => executionOrder.push('p2'),
      });
      const p0Validator = createMockValidator('p0', 0, {
        onValidate: () => executionOrder.push('p0'),
      });
      const p1Validator = createMockValidator('p1', 1, {
        onValidate: () => executionOrder.push('p1'),
      });

      // Register in mixed order
      testOrchestrator.register(p2Validator);
      testOrchestrator.register(p0Validator);
      testOrchestrator.register(p1Validator);

      const config = createBaseConfig();
      await testOrchestrator.validate(config, '/test/repo');

      expect(executionOrder).toEqual(['p0', 'p1', 'p2']);
    });

    it('should call multiple validators of same priority in registration order', async () => {
      const testOrchestrator = new ValidationOrchestrator();
      const validators = (testOrchestrator as unknown as { validators: Validator[] }).validators;
      validators.length = 0;

      const executionOrder: string[] = [];

      const first = createMockValidator('first', 0, {
        onValidate: () => executionOrder.push('first'),
      });
      const second = createMockValidator('second', 0, {
        onValidate: () => executionOrder.push('second'),
      });
      const third = createMockValidator('third', 0, {
        onValidate: () => executionOrder.push('third'),
      });

      testOrchestrator.register(first);
      testOrchestrator.register(second);
      testOrchestrator.register(third);

      const config = createBaseConfig();
      await testOrchestrator.validate(config, '/test/repo');

      // Array.sort is stable in modern JS, so order should be preserved
      expect(executionOrder).toEqual(['first', 'second', 'third']);
    });
  });

  describe('context is shared across validators', () => {
    it('should pass same context object to all validators', async () => {
      const testOrchestrator = new ValidationOrchestrator();
      const validators = (testOrchestrator as unknown as { validators: Validator[] }).validators;
      validators.length = 0;

      const capturedContexts: ValidationContext[] = [];

      const validator1 = createMockValidator('validator-1', 0, {
        onValidate: context => capturedContexts.push(context),
      });
      const validator2 = createMockValidator('validator-2', 1, {
        onValidate: context => capturedContexts.push(context),
      });

      testOrchestrator.register(validator1);
      testOrchestrator.register(validator2);

      const config = createBaseConfig();
      await testOrchestrator.validate(config, '/test/repo');

      expect(capturedContexts).toHaveLength(2);
      expect(capturedContexts[0]).toBe(capturedContexts[1]);
    });

    it('should share errors added by previous validators', async () => {
      const testOrchestrator = new ValidationOrchestrator();
      const validators = (testOrchestrator as unknown as { validators: Validator[] }).validators;
      validators.length = 0;

      let secondValidatorErrorCount = 0;

      const error: ValidationError = {
        field: 'first-field',
        message: 'First error',
        severity: 'error',
      };

      const firstValidator = createMockValidator('first', 0, { errors: [error] });
      const secondValidator = createMockValidator('second', 1, {
        onValidate: context => {
          secondValidatorErrorCount = context.errors.length;
        },
      });

      testOrchestrator.register(firstValidator);
      testOrchestrator.register(secondValidator);

      const config = createBaseConfig();
      await testOrchestrator.validate(config, '/test/repo');

      expect(secondValidatorErrorCount).toBe(1);
    });

    it('should share custom context properties added by validators', async () => {
      const testOrchestrator = new ValidationOrchestrator();
      const validators = (testOrchestrator as unknown as { validators: Validator[] }).validators;
      validators.length = 0;

      let capturedCustomProp: unknown = undefined;

      const firstValidator: Validator = {
        name: 'setter',
        priority: 0,
        shouldRun: () => true,
        validate: async (context: ValidationContext) => {
          (context as unknown as { customProp: string }).customProp = 'custom-value';
        },
      };

      const secondValidator: Validator = {
        name: 'reader',
        priority: 1,
        shouldRun: () => true,
        validate: async (context: ValidationContext) => {
          capturedCustomProp = (context as unknown as { customProp?: string }).customProp;
        },
      };

      testOrchestrator.register(firstValidator);
      testOrchestrator.register(secondValidator);

      const config = createBaseConfig();
      await testOrchestrator.validate(config, '/test/repo');

      expect(capturedCustomProp).toBe('custom-value');
    });

    it('should share config and repoPath from initial context', async () => {
      const testOrchestrator = new ValidationOrchestrator();
      const validators = (testOrchestrator as unknown as { validators: Validator[] }).validators;
      validators.length = 0;

      let capturedConfig: PipelineConfig | undefined;
      let capturedRepoPath: string | undefined;

      const validator = createMockValidator('checker', 0, {
        onValidate: context => {
          capturedConfig = context.config;
          capturedRepoPath = context.repoPath;
        },
      });

      testOrchestrator.register(validator);

      const config = createBaseConfig();
      config.name = 'unique-pipeline-name';
      await testOrchestrator.validate(config, '/unique/repo/path');

      expect(capturedConfig).toBe(config);
      expect(capturedConfig?.name).toBe('unique-pipeline-name');
      expect(capturedRepoPath).toBe('/unique/repo/path');
    });

    it('should initialize context with empty errors array', async () => {
      const testOrchestrator = new ValidationOrchestrator();
      const validators = (testOrchestrator as unknown as { validators: Validator[] }).validators;
      validators.length = 0;

      let initialErrorsLength: number | undefined;

      const validator = createMockValidator('first', 0, {
        onValidate: context => {
          initialErrorsLength = context.errors.length;
        },
      });

      testOrchestrator.register(validator);

      const config = createBaseConfig();
      await testOrchestrator.validate(config, '/test/repo');

      expect(initialErrorsLength).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle async validators correctly', async () => {
      const testOrchestrator = new ValidationOrchestrator();
      const validators = (testOrchestrator as unknown as { validators: Validator[] }).validators;
      validators.length = 0;

      const executionOrder: string[] = [];

      const slowValidator: Validator = {
        name: 'slow',
        priority: 0,
        shouldRun: () => true,
        validate: async context => {
          await new Promise(resolve => setTimeout(resolve, 10));
          executionOrder.push('slow');
          context.errors.push({ field: 'slow', message: 'Slow', severity: 'error' });
        },
      };

      const fastValidator: Validator = {
        name: 'fast',
        priority: 1,
        shouldRun: () => true,
        validate: async context => {
          executionOrder.push('fast');
          context.errors.push({ field: 'fast', message: 'Fast', severity: 'error' });
        },
      };

      testOrchestrator.register(slowValidator);
      testOrchestrator.register(fastValidator);

      const config = createBaseConfig();
      const errors = await testOrchestrator.validate(config, '/test/repo');

      // Validators should run sequentially, not in parallel
      expect(executionOrder).toEqual(['slow', 'fast']);
      expect(errors).toHaveLength(2);
    });

    it('should handle validator that throws an error', async () => {
      const testOrchestrator = new ValidationOrchestrator();
      const validators = (testOrchestrator as unknown as { validators: Validator[] }).validators;
      validators.length = 0;

      const throwingValidator: Validator = {
        name: 'thrower',
        priority: 0,
        shouldRun: () => true,
        validate: async () => {
          throw new Error('Validator error');
        },
      };

      testOrchestrator.register(throwingValidator);

      const config = createBaseConfig();

      await expect(testOrchestrator.validate(config, '/test/repo')).rejects.toThrow(
        'Validator error'
      );
    });

    it('should handle shouldRun that throws an error', async () => {
      const testOrchestrator = new ValidationOrchestrator();
      const validators = (testOrchestrator as unknown as { validators: Validator[] }).validators;
      validators.length = 0;

      const throwingValidator: Validator = {
        name: 'thrower',
        priority: 0,
        shouldRun: () => {
          throw new Error('shouldRun error');
        },
        validate: vi.fn(),
      };

      testOrchestrator.register(throwingValidator);

      const config = createBaseConfig();

      await expect(testOrchestrator.validate(config, '/test/repo')).rejects.toThrow(
        'shouldRun error'
      );
    });
  });
});
