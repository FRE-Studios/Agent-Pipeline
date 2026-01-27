import { describe, it, expect, beforeEach } from 'vitest';
import { StructureValidator } from '../../validators/structure-validator.js';
import { ValidationContext, ValidationError } from '../../validators/types.js';
import { PipelineConfig } from '../../config/schema.js';

describe('StructureValidator', () => {
  let validator: StructureValidator;

  beforeEach(() => {
    validator = new StructureValidator();
  });

  describe('validator properties', () => {
    it('should have name "structure"', () => {
      expect(validator.name).toBe('structure');
    });

    it('should have priority 0 (critical)', () => {
      expect(validator.priority).toBe(0);
    });

    it('shouldRun should always return true', () => {
      const context = createContext({
        name: 'test',
        trigger: 'manual',
        agents: [],
      });
      expect(validator.shouldRun(context)).toBe(true);
    });
  });

  describe('valid pipeline', () => {
    it('should pass validation with valid name, trigger, and agents', async () => {
      const context = createContext({
        name: 'valid-pipeline',
        trigger: 'manual',
        agents: [
          {
            name: 'stage-1',
            agent: '.agent-pipeline/agents/test.md',
          },
        ],
      });

      await validator.validate(context);

      expect(context.errors).toHaveLength(0);
    });

    it('should pass validation with post-commit trigger', async () => {
      const context = createContext({
        name: 'valid-pipeline',
        trigger: 'post-commit',
        agents: [
          {
            name: 'stage-1',
            agent: '.agent-pipeline/agents/test.md',
          },
        ],
      });

      await validator.validate(context);

      expect(context.errors).toHaveLength(0);
    });

    it('should pass validation with multiple agents', async () => {
      const context = createContext({
        name: 'multi-agent-pipeline',
        trigger: 'manual',
        agents: [
          {
            name: 'stage-1',
            agent: '.agent-pipeline/agents/test1.md',
          },
          {
            name: 'stage-2',
            agent: '.agent-pipeline/agents/test2.md',
          },
          {
            name: 'stage-3',
            agent: '.agent-pipeline/agents/test3.md',
          },
        ],
      });

      await validator.validate(context);

      expect(context.errors).toHaveLength(0);
    });
  });

  describe('missing name', () => {
    it('should error when name is undefined', async () => {
      const context = createContext({
        trigger: 'manual',
        agents: [
          {
            name: 'stage-1',
            agent: '.agent-pipeline/agents/test.md',
          },
        ],
      } as unknown as PipelineConfig);

      await validator.validate(context);

      expect(context.errors).toHaveLength(1);
      expect(context.errors[0]).toEqual({
        field: 'name',
        message: 'Pipeline name is required',
        severity: 'error',
      });
    });

    it('should error when name is null', async () => {
      const context = createContext({
        name: null,
        trigger: 'manual',
        agents: [
          {
            name: 'stage-1',
            agent: '.agent-pipeline/agents/test.md',
          },
        ],
      } as unknown as PipelineConfig);

      await validator.validate(context);

      expect(context.errors.some(e => e.field === 'name' && e.severity === 'error')).toBe(true);
    });
  });

  describe('empty name', () => {
    it('should error when name is empty string', async () => {
      const context = createContext({
        name: '',
        trigger: 'manual',
        agents: [
          {
            name: 'stage-1',
            agent: '.agent-pipeline/agents/test.md',
          },
        ],
      });

      await validator.validate(context);

      expect(context.errors).toHaveLength(1);
      expect(context.errors[0]).toEqual({
        field: 'name',
        message: 'Pipeline name is required',
        severity: 'error',
      });
    });

    it('should error when name is only whitespace', async () => {
      const context = createContext({
        name: '   ',
        trigger: 'manual',
        agents: [
          {
            name: 'stage-1',
            agent: '.agent-pipeline/agents/test.md',
          },
        ],
      });

      await validator.validate(context);

      expect(context.errors).toHaveLength(1);
      expect(context.errors[0].field).toBe('name');
      expect(context.errors[0].severity).toBe('error');
    });

    it('should error when name is tab characters only', async () => {
      const context = createContext({
        name: '\t\t',
        trigger: 'manual',
        agents: [
          {
            name: 'stage-1',
            agent: '.agent-pipeline/agents/test.md',
          },
        ],
      });

      await validator.validate(context);

      expect(context.errors.some(e => e.field === 'name' && e.severity === 'error')).toBe(true);
    });
  });

  describe('missing trigger', () => {
    it('should error when trigger is undefined', async () => {
      const context = createContext({
        name: 'test-pipeline',
        agents: [
          {
            name: 'stage-1',
            agent: '.agent-pipeline/agents/test.md',
          },
        ],
      } as unknown as PipelineConfig);

      await validator.validate(context);

      expect(context.errors).toHaveLength(1);
      expect(context.errors[0]).toEqual({
        field: 'trigger',
        message: 'Pipeline trigger is required (manual or post-commit)',
        severity: 'error',
      });
    });

    it('should error when trigger is null', async () => {
      const context = createContext({
        name: 'test-pipeline',
        trigger: null,
        agents: [
          {
            name: 'stage-1',
            agent: '.agent-pipeline/agents/test.md',
          },
        ],
      } as unknown as PipelineConfig);

      await validator.validate(context);

      expect(context.errors.some(e => e.field === 'trigger' && e.severity === 'error')).toBe(true);
    });
  });

  describe('invalid trigger value', () => {
    it('should error when trigger is not manual or post-commit', async () => {
      const context = createContext({
        name: 'test-pipeline',
        trigger: 'invalid-trigger' as 'manual' | 'post-commit',
        agents: [
          {
            name: 'stage-1',
            agent: '.agent-pipeline/agents/test.md',
          },
        ],
      });

      await validator.validate(context);

      expect(context.errors).toHaveLength(1);
      expect(context.errors[0]).toEqual({
        field: 'trigger',
        message: "Invalid trigger: invalid-trigger. Must be 'manual' or 'post-commit'",
        severity: 'error',
      });
    });

    it('should error for typo in trigger value', async () => {
      const context = createContext({
        name: 'test-pipeline',
        trigger: 'manuall' as 'manual' | 'post-commit',
        agents: [
          {
            name: 'stage-1',
            agent: '.agent-pipeline/agents/test.md',
          },
        ],
      });

      await validator.validate(context);

      expect(context.errors.some(e =>
        e.field === 'trigger' &&
        e.message.includes('Invalid trigger: manuall')
      )).toBe(true);
    });

    it('should error for pre-commit trigger (not supported)', async () => {
      const context = createContext({
        name: 'test-pipeline',
        trigger: 'pre-commit' as 'manual' | 'post-commit',
        agents: [
          {
            name: 'stage-1',
            agent: '.agent-pipeline/agents/test.md',
          },
        ],
      });

      await validator.validate(context);

      expect(context.errors.some(e =>
        e.field === 'trigger' &&
        e.severity === 'error' &&
        e.message.includes('Invalid trigger')
      )).toBe(true);
    });

    it('should error for empty string trigger', async () => {
      const context = createContext({
        name: 'test-pipeline',
        trigger: '' as 'manual' | 'post-commit',
        agents: [
          {
            name: 'stage-1',
            agent: '.agent-pipeline/agents/test.md',
          },
        ],
      });

      await validator.validate(context);

      expect(context.errors.some(e => e.field === 'trigger' && e.severity === 'error')).toBe(true);
    });
  });

  describe('missing agents array', () => {
    it('should error when agents is undefined', async () => {
      const context = createContext({
        name: 'test-pipeline',
        trigger: 'manual',
      } as unknown as PipelineConfig);

      await validator.validate(context);

      expect(context.errors).toHaveLength(1);
      expect(context.errors[0]).toEqual({
        field: 'agents',
        message: 'Pipeline must have at least one agent',
        severity: 'error',
      });
    });

    it('should error when agents is null', async () => {
      const context = createContext({
        name: 'test-pipeline',
        trigger: 'manual',
        agents: null,
      } as unknown as PipelineConfig);

      await validator.validate(context);

      expect(context.errors.some(e => e.field === 'agents' && e.severity === 'error')).toBe(true);
    });
  });

  describe('empty agents array', () => {
    it('should error when agents array is empty', async () => {
      const context = createContext({
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
      });

      await validator.validate(context);

      expect(context.errors).toHaveLength(1);
      expect(context.errors[0]).toEqual({
        field: 'agents',
        message: 'Pipeline must have at least one agent',
        severity: 'error',
      });
    });
  });

  describe('multiple validation errors', () => {
    it('should collect all errors when multiple fields are invalid', async () => {
      const context = createContext({
        name: '',
        trigger: 'invalid' as 'manual' | 'post-commit',
        agents: [],
      });

      await validator.validate(context);

      expect(context.errors).toHaveLength(3);
      expect(context.errors.some(e => e.field === 'name')).toBe(true);
      expect(context.errors.some(e => e.field === 'trigger')).toBe(true);
      expect(context.errors.some(e => e.field === 'agents')).toBe(true);
    });

    it('should collect errors when name and trigger are missing', async () => {
      const context = createContext({
        agents: [
          {
            name: 'stage-1',
            agent: '.agent-pipeline/agents/test.md',
          },
        ],
      } as unknown as PipelineConfig);

      await validator.validate(context);

      expect(context.errors).toHaveLength(2);
      expect(context.errors.some(e => e.field === 'name')).toBe(true);
      expect(context.errors.some(e => e.field === 'trigger')).toBe(true);
    });

    it('should collect errors when name and agents are invalid', async () => {
      const context = createContext({
        name: '   ',
        trigger: 'manual',
        agents: [],
      });

      await validator.validate(context);

      expect(context.errors).toHaveLength(2);
      expect(context.errors.some(e => e.field === 'name')).toBe(true);
      expect(context.errors.some(e => e.field === 'agents')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should pass with name containing special characters', async () => {
      const context = createContext({
        name: 'my-pipeline_v2.0',
        trigger: 'manual',
        agents: [
          {
            name: 'stage-1',
            agent: '.agent-pipeline/agents/test.md',
          },
        ],
      });

      await validator.validate(context);

      expect(context.errors).toHaveLength(0);
    });

    it('should pass with very long name', async () => {
      const context = createContext({
        name: 'a'.repeat(200),
        trigger: 'manual',
        agents: [
          {
            name: 'stage-1',
            agent: '.agent-pipeline/agents/test.md',
          },
        ],
      });

      await validator.validate(context);

      expect(context.errors).toHaveLength(0);
    });

    it('should pass with single character name', async () => {
      const context = createContext({
        name: 'x',
        trigger: 'post-commit',
        agents: [
          {
            name: 'stage-1',
            agent: '.agent-pipeline/agents/test.md',
          },
        ],
      });

      await validator.validate(context);

      expect(context.errors).toHaveLength(0);
    });

    it('should not modify existing errors in context', async () => {
      const existingError: ValidationError = {
        field: 'other',
        message: 'pre-existing error',
        severity: 'warning',
      };
      const context = createContext({
        name: '',
        trigger: 'manual',
        agents: [
          {
            name: 'stage-1',
            agent: '.agent-pipeline/agents/test.md',
          },
        ],
      });
      context.errors.push(existingError);

      await validator.validate(context);

      expect(context.errors).toHaveLength(2);
      expect(context.errors[0]).toEqual(existingError);
      expect(context.errors[1].field).toBe('name');
    });
  });
});

/**
 * Helper function to create a validation context with sensible defaults.
 */
function createContext(config: PipelineConfig): ValidationContext {
  return {
    config,
    repoPath: '/test/repo',
    errors: [],
  };
}
