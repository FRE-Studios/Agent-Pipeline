import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DAGValidator } from '../../validators/dag-validator.js';
import { ValidationContext } from '../../validators/types.js';
import { PipelineConfig } from '../../config/schema.js';
import { DAGPlanner } from '../../core/dag-planner.js';

vi.mock('../../core/dag-planner.js');

describe('DAGValidator', () => {
  let validator: DAGValidator;
  let baseConfig: PipelineConfig;
  let mockValidateDAG: ReturnType<typeof vi.fn>;
  let mockBuildExecutionPlan: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    validator = new DAGValidator();
    baseConfig = {
      name: 'test-pipeline',
      trigger: 'manual',
      agents: [],
    };
    vi.clearAllMocks();

    // Setup default mock implementations
    mockValidateDAG = vi.fn().mockReturnValue({
      valid: true,
      errors: [],
      warnings: [],
    });

    mockBuildExecutionPlan = vi.fn().mockReturnValue({
      nodes: new Map(),
      adjacencyList: new Map(),
      plan: {
        groups: [],
        totalStages: 0,
        maxParallelism: 0,
        isSequential: true,
      },
      validation: {
        valid: true,
        errors: [],
        warnings: [],
      },
    });

    vi.mocked(DAGPlanner).mockImplementation(() => ({
      validateDAG: mockValidateDAG,
      buildExecutionPlan: mockBuildExecutionPlan,
    }) as unknown as DAGPlanner);
  });

  function createContext(config: PipelineConfig): ValidationContext {
    return {
      config,
      repoPath: '/test/repo',
      errors: [],
    };
  }

  describe('validator properties', () => {
    it('should have name "dag"', () => {
      expect(validator.name).toBe('dag');
    });

    it('should have priority 2', () => {
      expect(validator.priority).toBe(2);
    });
  });

  describe('shouldRun', () => {
    it('should return false when no agents exist', () => {
      const config: PipelineConfig = {
        ...baseConfig,
        agents: [],
      };
      const context = createContext(config);

      const result = validator.shouldRun(context);

      expect(result).toBe(false);
    });

    it('should return false when agents is undefined', () => {
      const config: PipelineConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
      } as PipelineConfig;
      const context = createContext(config);

      const result = validator.shouldRun(context);

      expect(result).toBe(false);
    });

    it('should return true when agents exist', () => {
      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'stage-1',
            agent: '.agent-pipeline/agents/test.md',
          },
        ],
      };
      const context = createContext(config);

      const result = validator.shouldRun(context);

      expect(result).toBe(true);
    });
  });

  describe('validate - valid DAG', () => {
    it('should pass validation for a valid DAG', async () => {
      mockValidateDAG.mockReturnValue({
        valid: true,
        errors: [],
        warnings: [],
      });

      mockBuildExecutionPlan.mockReturnValue({
        nodes: new Map(),
        adjacencyList: new Map(),
        plan: {
          groups: [{ level: 0, stages: [] }],
          totalStages: 2,
          maxParallelism: 2,
          isSequential: false,
        },
        validation: {
          valid: true,
          errors: [],
          warnings: [],
        },
      });

      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'stage-1',
            agent: '.agent-pipeline/agents/test1.md',
          },
          {
            name: 'stage-2',
            agent: '.agent-pipeline/agents/test2.md',
            dependsOn: ['stage-1'],
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(0);
      expect(mockValidateDAG).toHaveBeenCalledWith(config);
    });
  });

  describe('validate - DAG with cycle', () => {
    it('should error when DAG has a cycle', async () => {
      mockValidateDAG.mockReturnValue({
        valid: false,
        errors: ['Circular dependency detected involving "stage-1" -> "stage-2"'],
        warnings: [],
      });

      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'stage-1',
            agent: '.agent-pipeline/agents/test1.md',
            dependsOn: ['stage-2'],
          },
          {
            name: 'stage-2',
            agent: '.agent-pipeline/agents/test2.md',
            dependsOn: ['stage-1'],
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(1);
      expect(context.errors[0]).toEqual({
        field: 'agents.dependsOn',
        message: 'Circular dependency detected involving "stage-1" -> "stage-2"',
        severity: 'error',
      });
    });

    it('should error when DAG has self-dependency', async () => {
      mockValidateDAG.mockReturnValue({
        valid: false,
        errors: ['Stage "stage-1" cannot depend on itself'],
        warnings: [],
      });

      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'stage-1',
            agent: '.agent-pipeline/agents/test1.md',
            dependsOn: ['stage-1'],
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(1);
      expect(context.errors[0]).toEqual({
        field: 'agents.dependsOn',
        message: 'Stage "stage-1" cannot depend on itself',
        severity: 'error',
      });
    });
  });

  describe('validate - DAG with missing dependency', () => {
    it('should error when DAG has missing dependency', async () => {
      mockValidateDAG.mockReturnValue({
        valid: false,
        errors: ['Stage "stage-1" depends on unknown stage "missing-stage"'],
        warnings: [],
      });

      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'stage-1',
            agent: '.agent-pipeline/agents/test1.md',
            dependsOn: ['missing-stage'],
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(1);
      expect(context.errors[0]).toEqual({
        field: 'agents.dependsOn',
        message: 'Stage "stage-1" depends on unknown stage "missing-stage"',
        severity: 'error',
      });
    });

    it('should report multiple missing dependencies', async () => {
      mockValidateDAG.mockReturnValue({
        valid: false,
        errors: [
          'Stage "stage-1" depends on unknown stage "missing-1"',
          'Stage "stage-1" depends on unknown stage "missing-2"',
        ],
        warnings: [],
      });

      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'stage-1',
            agent: '.agent-pipeline/agents/test1.md',
            dependsOn: ['missing-1', 'missing-2'],
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(2);
      expect(context.errors[0].severity).toBe('error');
      expect(context.errors[1].severity).toBe('error');
    });
  });

  describe('validate - DAG warnings', () => {
    it('should pass through DAG validation warnings', async () => {
      mockValidateDAG.mockReturnValue({
        valid: true,
        errors: [],
        warnings: ['Deep dependency chain detected (6 levels). Consider optimizing.'],
      });

      mockBuildExecutionPlan.mockReturnValue({
        nodes: new Map(),
        adjacencyList: new Map(),
        plan: {
          groups: [],
          totalStages: 6,
          maxParallelism: 1,
          isSequential: true,
        },
        validation: {
          valid: true,
          errors: [],
          warnings: [],
        },
      });

      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          { name: 'stage-1', agent: '.agent-pipeline/agents/test.md' },
          { name: 'stage-2', agent: '.agent-pipeline/agents/test.md', dependsOn: ['stage-1'] },
          { name: 'stage-3', agent: '.agent-pipeline/agents/test.md', dependsOn: ['stage-2'] },
          { name: 'stage-4', agent: '.agent-pipeline/agents/test.md', dependsOn: ['stage-3'] },
          { name: 'stage-5', agent: '.agent-pipeline/agents/test.md', dependsOn: ['stage-4'] },
          { name: 'stage-6', agent: '.agent-pipeline/agents/test.md', dependsOn: ['stage-5'] },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(1);
      expect(context.errors[0]).toEqual({
        field: 'agents.dependsOn',
        message: 'Deep dependency chain detected (6 levels). Consider optimizing.',
        severity: 'warning',
      });
    });

    it('should include both errors and warnings from DAG validation', async () => {
      mockValidateDAG.mockReturnValue({
        valid: false,
        errors: ['Stage "stage-1" depends on unknown stage "missing"'],
        warnings: ['Deep dependency chain detected (6 levels). Consider optimizing.'],
      });

      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'stage-1',
            agent: '.agent-pipeline/agents/test.md',
            dependsOn: ['missing'],
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(2);
      expect(context.errors.some(e => e.severity === 'error')).toBe(true);
      expect(context.errors.some(e => e.severity === 'warning')).toBe(true);
    });
  });

  describe('validate - parallel limits', () => {
    it('should warn when more than 10 parallel stages', async () => {
      mockValidateDAG.mockReturnValue({
        valid: true,
        errors: [],
        warnings: [],
      });

      mockBuildExecutionPlan.mockReturnValue({
        nodes: new Map(),
        adjacencyList: new Map(),
        plan: {
          groups: [{ level: 0, stages: [] }],
          totalStages: 11,
          maxParallelism: 11,
          isSequential: false,
        },
        validation: {
          valid: true,
          errors: [],
          warnings: [],
        },
      });

      const agents = Array.from({ length: 11 }, (_, i) => ({
        name: `stage-${i + 1}`,
        agent: '.agent-pipeline/agents/test.md',
      }));

      const config: PipelineConfig = {
        ...baseConfig,
        agents,
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(1);
      expect(context.errors[0]).toEqual({
        field: 'agents',
        message: 'Pipeline has 11 stages running in parallel. Consider adding dependencies to limit concurrency and avoid rate limits',
        severity: 'warning',
      });
    });

    it('should not warn when exactly 10 parallel stages', async () => {
      mockValidateDAG.mockReturnValue({
        valid: true,
        errors: [],
        warnings: [],
      });

      mockBuildExecutionPlan.mockReturnValue({
        nodes: new Map(),
        adjacencyList: new Map(),
        plan: {
          groups: [{ level: 0, stages: [] }],
          totalStages: 10,
          maxParallelism: 10,
          isSequential: false,
        },
        validation: {
          valid: true,
          errors: [],
          warnings: [],
        },
      });

      const agents = Array.from({ length: 10 }, (_, i) => ({
        name: `stage-${i + 1}`,
        agent: '.agent-pipeline/agents/test.md',
      }));

      const config: PipelineConfig = {
        ...baseConfig,
        agents,
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(0);
    });

    it('should not warn when fewer than 10 parallel stages', async () => {
      mockValidateDAG.mockReturnValue({
        valid: true,
        errors: [],
        warnings: [],
      });

      mockBuildExecutionPlan.mockReturnValue({
        nodes: new Map(),
        adjacencyList: new Map(),
        plan: {
          groups: [{ level: 0, stages: [] }],
          totalStages: 5,
          maxParallelism: 5,
          isSequential: false,
        },
        validation: {
          valid: true,
          errors: [],
          warnings: [],
        },
      });

      const agents = Array.from({ length: 5 }, (_, i) => ({
        name: `stage-${i + 1}`,
        agent: '.agent-pipeline/agents/test.md',
      }));

      const config: PipelineConfig = {
        ...baseConfig,
        agents,
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(0);
    });

    it('should not check parallel limits when DAG is invalid', async () => {
      mockValidateDAG.mockReturnValue({
        valid: false,
        errors: ['Circular dependency detected involving "stage-1" -> "stage-2"'],
        warnings: [],
      });

      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'stage-1',
            agent: '.agent-pipeline/agents/test1.md',
            dependsOn: ['stage-2'],
          },
          {
            name: 'stage-2',
            agent: '.agent-pipeline/agents/test2.md',
            dependsOn: ['stage-1'],
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      // Should only have the cycle error, no parallel limit check
      expect(context.errors).toHaveLength(1);
      expect(context.errors[0].message).toContain('Circular dependency');
      expect(mockBuildExecutionPlan).not.toHaveBeenCalled();
    });

    it('should handle buildExecutionPlan throwing error gracefully', async () => {
      mockValidateDAG.mockReturnValue({
        valid: true,
        errors: [],
        warnings: [],
      });

      mockBuildExecutionPlan.mockImplementation(() => {
        throw new Error('Failed to build execution plan');
      });

      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'stage-1',
            agent: '.agent-pipeline/agents/test.md',
          },
        ],
      };
      const context = createContext(config);

      // Should not throw, just skip parallel limit check
      await validator.validate(context);

      expect(context.errors).toHaveLength(0);
    });
  });

  describe('validate - early return', () => {
    it('should return early when agents is undefined', async () => {
      const config: PipelineConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
      } as PipelineConfig;
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(0);
      expect(mockValidateDAG).not.toHaveBeenCalled();
    });

    it('should return early when agents array is empty', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        agents: [],
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(0);
      expect(mockValidateDAG).not.toHaveBeenCalled();
    });
  });

  describe('validate - multiple errors', () => {
    it('should collect all DAG errors', async () => {
      mockValidateDAG.mockReturnValue({
        valid: false,
        errors: [
          'Duplicate stage names: stage-1',
          'Stage "stage-2" depends on unknown stage "missing"',
          'Circular dependency detected involving "stage-3" -> "stage-4"',
        ],
        warnings: [],
      });

      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          { name: 'stage-1', agent: '.agent-pipeline/agents/test.md' },
          { name: 'stage-1', agent: '.agent-pipeline/agents/test.md' },
          { name: 'stage-2', agent: '.agent-pipeline/agents/test.md', dependsOn: ['missing'] },
          { name: 'stage-3', agent: '.agent-pipeline/agents/test.md', dependsOn: ['stage-4'] },
          { name: 'stage-4', agent: '.agent-pipeline/agents/test.md', dependsOn: ['stage-3'] },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(3);
      expect(context.errors.every(e => e.severity === 'error')).toBe(true);
      expect(context.errors.every(e => e.field === 'agents.dependsOn')).toBe(true);
    });
  });

  describe('validate - edge cases', () => {
    it('should not modify existing errors in context', async () => {
      mockValidateDAG.mockReturnValue({
        valid: false,
        errors: ['Circular dependency detected'],
        warnings: [],
      });

      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'stage-1',
            agent: '.agent-pipeline/agents/test.md',
          },
        ],
      };
      const context = createContext(config);
      context.errors.push({
        field: 'other',
        message: 'pre-existing error',
        severity: 'warning',
      });

      await validator.validate(context);

      expect(context.errors).toHaveLength(2);
      expect(context.errors[0]).toEqual({
        field: 'other',
        message: 'pre-existing error',
        severity: 'warning',
      });
      expect(context.errors[1].message).toBe('Circular dependency detected');
    });
  });
});
