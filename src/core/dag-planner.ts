// src/core/dag-planner.ts

import { PipelineConfig, AgentStageConfig } from '../config/schema.js';
import {
  ExecutionNode,
  ExecutionGroup,
  ExecutionPlan,
  DAGValidation,
  ExecutionGraph
} from './types/execution-graph.js';

export class DAGPlanner {
  /**
   * Build complete execution plan from pipeline config
   */
  buildExecutionPlan(config: PipelineConfig): ExecutionGraph {
    const validation = this.validateDAG(config);

    if (!validation.valid) {
      throw new Error(`Invalid pipeline DAG:\n${validation.errors.join('\n')}`);
    }

    const nodes = this.buildNodes(config);
    const adjacencyList = this.buildAdjacencyList(nodes);
    const sortedStages = this.topologicalSort(nodes, adjacencyList);
    const groups = this.groupByLevel(sortedStages, nodes);

    const plan: ExecutionPlan = {
      groups,
      totalStages: config.agents.length,
      maxParallelism: Math.max(...groups.map(g => g.stages.length)),
      isSequential: groups.every(g => g.stages.length === 1)
    };

    return {
      nodes,
      adjacencyList,
      plan,
      validation
    };
  }

  /**
   * Validate DAG for cycles and missing dependencies
   */
  validateDAG(config: PipelineConfig): DAGValidation {
    const errors: string[] = [];
    const warnings: string[] = [];

    const stageNames = new Set(config.agents.map(a => a.name));

    // Check for duplicate stage names
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const agent of config.agents) {
      if (seen.has(agent.name)) {
        duplicates.add(agent.name);
      }
      seen.add(agent.name);
    }

    if (duplicates.size > 0) {
      errors.push(`Duplicate stage names: ${Array.from(duplicates).join(', ')}`);
    }

    // Check for missing dependencies
    for (const agent of config.agents) {
      if (agent.dependsOn) {
        for (const dependency of agent.dependsOn) {
          if (!stageNames.has(dependency)) {
            errors.push(`Stage "${agent.name}" depends on unknown stage "${dependency}"`);
          }
        }
      }
    }

    // Check for cycles using DFS
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const cycleReported = new Set<string>();

    const hasCycle = (stageName: string): boolean => {
      visited.add(stageName);
      recursionStack.add(stageName);

      const stage = config.agents.find(a => a.name === stageName);
      if (stage?.dependsOn) {
        for (const dependency of stage.dependsOn) {
          if (!visited.has(dependency)) {
            if (hasCycle(dependency)) return true;
          } else if (recursionStack.has(dependency)) {
            const cycleKey = `${stageName}->${dependency}`;
            if (!cycleReported.has(cycleKey)) {
              errors.push(`Circular dependency detected involving "${stageName}" -> "${dependency}"`);
              cycleReported.add(cycleKey);
            }
            return true;
          }
        }
      }

      recursionStack.delete(stageName);
      return false;
    };

    for (const agent of config.agents) {
      if (!visited.has(agent.name)) {
        hasCycle(agent.name);
      }
    }

    // Check for self-dependencies
    for (const agent of config.agents) {
      if (agent.dependsOn?.includes(agent.name)) {
        errors.push(`Stage "${agent.name}" cannot depend on itself`);
      }
    }

    // Warnings for potentially long dependency chains
    // Only calculate max depth if no errors found (prevents stack overflow on cycles)
    if (errors.length === 0) {
      const maxDepth = this.calculateMaxDepth(config);
      if (maxDepth > 5) {
        warnings.push(`Deep dependency chain detected (${maxDepth} levels). Consider optimizing.`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Build execution nodes from pipeline config
   */
  private buildNodes(config: PipelineConfig): Map<string, ExecutionNode> {
    const nodes = new Map<string, ExecutionNode>();

    // First pass: create nodes
    for (const stage of config.agents) {
      nodes.set(stage.name, {
        stage,
        dependencies: stage.dependsOn || [],
        dependents: [],
        level: 0
      });
    }

    // Second pass: populate dependents
    for (const [name, node] of nodes) {
      for (const dependency of node.dependencies) {
        const dependencyNode = nodes.get(dependency);
        if (dependencyNode) {
          dependencyNode.dependents.push(name);
        }
      }
    }

    // Third pass: calculate levels
    this.calculateLevels(nodes);

    return nodes;
  }

  /**
   * Calculate execution level for each node (topological level)
   */
  private calculateLevels(nodes: Map<string, ExecutionNode>): void {
    const visited = new Set<string>();

    const calculateLevel = (name: string): number => {
      const existingNode = nodes.get(name);
      if (!existingNode) {
        return 0;
      }

      if (visited.has(name)) {
        return existingNode.level;
      }

      visited.add(name);

      if (existingNode.dependencies.length === 0) {
        existingNode.level = 0;
        return 0;
      }

      const dependencyLevels = existingNode.dependencies.map(dependency => calculateLevel(dependency));
      existingNode.level = Math.max(...dependencyLevels) + 1;
      return existingNode.level;
    };

    for (const name of nodes.keys()) {
      calculateLevel(name);
    }
  }

  /**
   * Build adjacency list for topological sort
   */
  private buildAdjacencyList(nodes: Map<string, ExecutionNode>): Map<string, string[]> {
    const adjacencyList = new Map<string, string[]>();

    for (const [name, node] of nodes) {
      adjacencyList.set(name, node.dependencies);
    }

    return adjacencyList;
  }

  /**
   * Topological sort using Kahn's algorithm
   */
  private topologicalSort(
    nodes: Map<string, ExecutionNode>,
    adjacencyList: Map<string, string[]>
  ): string[] {
    const inDegree = new Map<string, number>();
    const sorted: string[] = [];

    // Calculate in-degrees
    for (const name of nodes.keys()) {
      inDegree.set(name, 0);
    }

    for (const dependencies of adjacencyList.values()) {
      for (const dependency of dependencies) {
        inDegree.set(dependency, (inDegree.get(dependency) || 0) + 1);
      }
    }

    // Find all nodes with no dependencies (in-degree 0)
    const nodesWithNoDependencies: string[] = [];
    for (const [name, degree] of inDegree) {
      if (degree === 0) {
        nodesWithNoDependencies.push(name);
      }
    }

    // Process nodes in topological order
    const queue = nodesWithNoDependencies;
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;

      sorted.push(current);

      const node = nodes.get(current);
      if (!node) continue;

      for (const dependent of node.dependents) {
        const newDegree = (inDegree.get(dependent) || 0) - 1;
        inDegree.set(dependent, newDegree);

        if (newDegree === 0) {
          queue.push(dependent);
        }
      }
    }

    return sorted;
  }

  /**
   * Group stages by execution level (parallel groups)
   */
  private groupByLevel(
    sortedStages: string[],
    nodes: Map<string, ExecutionNode>
  ): ExecutionGroup[] {
    const levelMap = new Map<number, AgentStageConfig[]>();

    for (const stageName of sortedStages) {
      const node = nodes.get(stageName);
      if (!node) continue;

      const level = node.level;

      if (!levelMap.has(level)) {
        levelMap.set(level, []);
      }

      const levelStages = levelMap.get(level);
      if (levelStages) {
        levelStages.push(node.stage);
      }
    }

    // Convert to array of execution groups
    const groups: ExecutionGroup[] = [];
    const sortedLevels = Array.from(levelMap.keys()).sort((a, b) => a - b);

    for (const level of sortedLevels) {
      const stages = levelMap.get(level);
      if (stages && stages.length > 0) {
        groups.push({
          level,
          stages
        });
      }
    }

    return groups;
  }

  /**
   * Calculate maximum dependency depth
   */
  private calculateMaxDepth(config: PipelineConfig): number {
    const depthMap = new Map<string, number>();

    const getDepth = (stageName: string): number => {
      const cachedDepth = depthMap.get(stageName);
      if (cachedDepth !== undefined) {
        return cachedDepth;
      }

      const stage = config.agents.find(a => a.name === stageName);
      if (!stage || !stage.dependsOn || stage.dependsOn.length === 0) {
        depthMap.set(stageName, 0);
        return 0;
      }

      const dependencyDepths = stage.dependsOn.map(dependency => getDepth(dependency));
      const depth = Math.max(...dependencyDepths) + 1;
      depthMap.set(stageName, depth);
      return depth;
    };

    let maxDepth = 0;
    for (const agent of config.agents) {
      maxDepth = Math.max(maxDepth, getDepth(agent.name));
    }

    return maxDepth;
  }
}
