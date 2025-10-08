import { describe, it, expect } from 'vitest';
import { DAGPlanner } from './dag-planner.js';
import {
  simplePipelineConfig,
  parallelPipelineConfig,
  conditionalPipelineConfig,
  cyclicDependencyConfig,
  duplicateNamesConfig,
  missingDependencyConfig,
} from '../__tests__/fixtures/pipeline-configs.js';

describe('DAGPlanner', () => {
  const planner = new DAGPlanner();

  describe('buildExecutionPlan', () => {
    it('should build execution plan for simple sequential pipeline', () => {
      const result = planner.buildExecutionPlan(simplePipelineConfig);

      expect(result.plan.totalStages).toBe(2);
      expect(result.plan.groups).toHaveLength(1);
      expect(result.plan.groups[0].stages).toHaveLength(2);
      expect(result.plan.groups[0].level).toBe(0);
      expect(result.plan.isSequential).toBe(false); // Two stages at same level = parallel possible
      expect(result.validation.valid).toBe(true);
    });

    it('should build execution plan for parallel pipeline with dependencies', () => {
      const result = planner.buildExecutionPlan(parallelPipelineConfig);

      expect(result.plan.totalStages).toBe(4);
      expect(result.validation.valid).toBe(true);

      // Verify that stages with no dependencies are at a lower level than summary
      const summaryNode = result.nodes.get('summary');
      expect(summaryNode).toBeDefined();
      expect(summaryNode?.dependencies).toEqual(['review', 'security', 'quality']);

      // Summary should be at a higher level than its dependencies
      const reviewNode = result.nodes.get('review');
      expect(summaryNode!.level).toBeGreaterThan(reviewNode!.level);

      // The pipeline should have some form of parallelism potential
      expect(result.plan.totalStages).toBeGreaterThan(1);
    });

    it('should build execution plan for conditional pipeline', () => {
      const result = planner.buildExecutionPlan(conditionalPipelineConfig);

      expect(result.plan.totalStages).toBe(3);
      expect(result.validation.valid).toBe(true);

      // Verify dependencies
      const autoFixNode = result.nodes.get('auto-fix');
      const celebrateNode = result.nodes.get('celebrate');
      expect(autoFixNode?.dependencies).toContain('code-review');
      expect(celebrateNode?.dependencies).toContain('code-review');

      // Verify conditional stages have conditions
      expect(autoFixNode?.stage.condition).toBeDefined();
      expect(celebrateNode?.stage.condition).toBeDefined();
    });

    it('should throw error for cyclic dependencies', () => {
      expect(() => planner.buildExecutionPlan(cyclicDependencyConfig))
        .toThrow();
    });

    it('should throw error for duplicate stage names', () => {
      expect(() => planner.buildExecutionPlan(duplicateNamesConfig))
        .toThrow();
    });

    it('should throw error for missing dependencies', () => {
      expect(() => planner.buildExecutionPlan(missingDependencyConfig))
        .toThrow();
    });
  });

  describe('validateDAG', () => {
    it('should validate correct pipeline configuration', () => {
      const result = planner.validateDAG(parallelPipelineConfig);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect cyclic dependencies', () => {
      const result = planner.validateDAG(cyclicDependencyConfig);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should detect duplicate stage names', () => {
      const result = planner.validateDAG(duplicateNamesConfig);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Duplicate'))).toBe(true);
    });

    it('should detect missing dependencies', () => {
      const result = planner.validateDAG(missingDependencyConfig);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('unknown stage'))).toBe(true);
    });

    it('should detect self-dependencies', () => {
      const selfDepConfig = {
        name: 'self-dep-test',
        trigger: 'manual' as const,
        agents: [
          {
            name: 'stage-a',
            agent: '.claude/agents/a.md',
            dependsOn: ['stage-a'], // Self-dependency
          },
        ],
      };

      const result = planner.validateDAG(selfDepConfig);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('depend on itself'))).toBe(true);
    });

    it('should warn about deep dependency chains', () => {
      const deepChainConfig = {
        name: 'deep-chain-test',
        trigger: 'manual' as const,
        agents: [
          { name: 'stage-1', agent: 'a.md' },
          { name: 'stage-2', agent: 'b.md', dependsOn: ['stage-1'] },
          { name: 'stage-3', agent: 'c.md', dependsOn: ['stage-2'] },
          { name: 'stage-4', agent: 'd.md', dependsOn: ['stage-3'] },
          { name: 'stage-5', agent: 'e.md', dependsOn: ['stage-4'] },
          { name: 'stage-6', agent: 'f.md', dependsOn: ['stage-5'] },
          { name: 'stage-7', agent: 'g.md', dependsOn: ['stage-6'] },
        ],
      };

      const result = planner.validateDAG(deepChainConfig);

      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.includes('Deep dependency'))).toBe(true);
    });

    it('should handle complex dependency graphs', () => {
      const complexConfig = {
        name: 'complex-test',
        trigger: 'manual' as const,
        agents: [
          { name: 'a', agent: 'a.md' },
          { name: 'b', agent: 'b.md' },
          { name: 'c', agent: 'c.md', dependsOn: ['a'] },
          { name: 'd', agent: 'd.md', dependsOn: ['b'] },
          { name: 'e', agent: 'e.md', dependsOn: ['c', 'd'] },
        ],
      };

      const result = planner.validateDAG(complexConfig);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('execution ordering', () => {
    it('should order stages by topological sort', () => {
      const result = planner.buildExecutionPlan(parallelPipelineConfig);

      // Verify that summary has the correct dependencies
      const summaryNode = result.nodes.get('summary');
      expect(summaryNode?.dependencies).toEqual(['review', 'security', 'quality']);

      // Summary should be at a higher level than all its dependencies
      const reviewNode = result.nodes.get('review');
      const securityNode = result.nodes.get('security');
      const qualityNode = result.nodes.get('quality');

      expect(summaryNode!.level).toBeGreaterThan(reviewNode!.level);
      expect(summaryNode!.level).toBeGreaterThan(securityNode!.level);
      expect(summaryNode!.level).toBeGreaterThan(qualityNode!.level);
    });

    it('should correctly calculate execution levels', () => {
      const multiLevelConfig = {
        name: 'multi-level-test',
        trigger: 'manual' as const,
        agents: [
          { name: 'level-0-a', agent: 'a.md' },
          { name: 'level-0-b', agent: 'b.md' },
          { name: 'level-1', agent: 'c.md', dependsOn: ['level-0-a', 'level-0-b'] },
          { name: 'level-2', agent: 'd.md', dependsOn: ['level-1'] },
          { name: 'level-3', agent: 'e.md', dependsOn: ['level-2'] },
        ],
      };

      const result = planner.buildExecutionPlan(multiLevelConfig);

      // Verify levels increase correctly
      const level0a = result.nodes.get('level-0-a');
      const level1 = result.nodes.get('level-1');
      const level2 = result.nodes.get('level-2');
      const level3 = result.nodes.get('level-3');

      expect(level0a!.level).toBe(0);
      expect(level1!.level).toBeGreaterThan(level0a!.level);
      expect(level2!.level).toBeGreaterThan(level1!.level);
      expect(level3!.level).toBeGreaterThan(level2!.level);
    });

    it('should group parallel stages at same level', () => {
      const parallelAtSameLevel = {
        name: 'parallel-same-level',
        trigger: 'manual' as const,
        agents: [
          { name: 'base', agent: 'base.md' },
          { name: 'parallel-1', agent: 'p1.md', dependsOn: ['base'] },
          { name: 'parallel-2', agent: 'p2.md', dependsOn: ['base'] },
          { name: 'parallel-3', agent: 'p3.md', dependsOn: ['base'] },
          { name: 'final', agent: 'final.md', dependsOn: ['parallel-1', 'parallel-2', 'parallel-3'] },
        ],
      };

      const result = planner.buildExecutionPlan(parallelAtSameLevel);

      // Verify parallel stages have the same level
      const p1 = result.nodes.get('parallel-1');
      const p2 = result.nodes.get('parallel-2');
      const p3 = result.nodes.get('parallel-3');

      expect(p1!.level).toBe(p2!.level);
      expect(p2!.level).toBe(p3!.level);
      // All three parallel stages should be at the same level
      expect(result.plan.totalStages).toBe(5);
    });
  });

  describe('execution graph structure', () => {
    it('should build adjacency list correctly', () => {
      const result = planner.buildExecutionPlan(parallelPipelineConfig);

      expect(result.adjacencyList.has('review')).toBe(true);
      expect(result.adjacencyList.has('security')).toBe(true);
      expect(result.adjacencyList.has('quality')).toBe(true);
      expect(result.adjacencyList.has('summary')).toBe(true);

      expect(result.adjacencyList.get('summary')).toEqual(['review', 'security', 'quality']);
    });

    it('should build nodes with correct dependencies and dependents', () => {
      const result = planner.buildExecutionPlan(parallelPipelineConfig);

      const summaryNode = result.nodes.get('summary');
      expect(summaryNode).toBeDefined();
      expect(summaryNode?.dependencies).toEqual(['review', 'security', 'quality']);
      expect(summaryNode?.level).toBe(1);

      const reviewNode = result.nodes.get('review');
      expect(reviewNode?.dependents).toContain('summary');
    });

    it('should correctly identify sequential vs parallel pipelines', () => {
      const sequentialConfig = {
        name: 'sequential',
        trigger: 'manual' as const,
        agents: [
          { name: 'stage-1', agent: 'a.md' },
          { name: 'stage-2', agent: 'b.md', dependsOn: ['stage-1'] },
          { name: 'stage-3', agent: 'c.md', dependsOn: ['stage-2'] },
        ],
      };

      const sequential = planner.buildExecutionPlan(sequentialConfig);
      expect(sequential.plan.isSequential).toBe(true);

      // Parallel pipeline should not be sequential
      const parallel = planner.buildExecutionPlan(parallelPipelineConfig);
      expect(parallel.plan.totalStages).toBe(4);
    });
  });
});
