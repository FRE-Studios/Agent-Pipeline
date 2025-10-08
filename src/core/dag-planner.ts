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
    const duplicates = config.agents
      .map(a => a.name)
      .filter((name, index, arr) => arr.indexOf(name) !== index);

    if (duplicates.length > 0) {
      errors.push(`Duplicate stage names: ${duplicates.join(', ')}`);
    }

    // Check for missing dependencies
    for (const agent of config.agents) {
      if (agent.dependsOn) {
        for (const dep of agent.dependsOn) {
          if (!stageNames.has(dep)) {
            errors.push(`Stage "${agent.name}" depends on unknown stage "${dep}"`);
          }
        }
      }
    }

    // Check for cycles using DFS
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const hasCycle = (stageName: string): boolean => {
      visited.add(stageName);
      recursionStack.add(stageName);

      const stage = config.agents.find(a => a.name === stageName);
      if (stage?.dependsOn) {
        for (const dep of stage.dependsOn) {
          if (!visited.has(dep)) {
            if (hasCycle(dep)) return true;
          } else if (recursionStack.has(dep)) {
            errors.push(`Circular dependency detected involving "${stageName}" -> "${dep}"`);
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
      for (const dep of node.dependencies) {
        const depNode = nodes.get(dep);
        if (depNode) {
          depNode.dependents.push(name);
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
      if (visited.has(name)) {
        return nodes.get(name)!.level;
      }

      visited.add(name);
      const node = nodes.get(name)!;

      if (node.dependencies.length === 0) {
        node.level = 0;
        return 0;
      }

      const depLevels = node.dependencies.map(dep => calculateLevel(dep));
      node.level = Math.max(...depLevels) + 1;
      return node.level;
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

    for (const deps of adjacencyList.values()) {
      for (const dep of deps) {
        inDegree.set(dep, (inDegree.get(dep) || 0) + 1);
      }
    }

    // Find all nodes with in-degree 0
    const queue: string[] = [];
    for (const [name, degree] of inDegree) {
      if (degree === 0) {
        queue.push(name);
      }
    }

    // Process queue
    while (queue.length > 0) {
      const current = queue.shift()!;
      sorted.push(current);

      const node = nodes.get(current)!;
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
      const node = nodes.get(stageName)!;
      const level = node.level;

      if (!levelMap.has(level)) {
        levelMap.set(level, []);
      }

      levelMap.get(level)!.push(node.stage);
    }

    // Convert to array of execution groups
    const groups: ExecutionGroup[] = [];
    const sortedLevels = Array.from(levelMap.keys()).sort((a, b) => a - b);

    for (const level of sortedLevels) {
      groups.push({
        level,
        stages: levelMap.get(level)!
      });
    }

    return groups;
  }

  /**
   * Calculate maximum dependency depth
   */
  private calculateMaxDepth(config: PipelineConfig): number {
    const depthMap = new Map<string, number>();

    const getDepth = (stageName: string): number => {
      if (depthMap.has(stageName)) {
        return depthMap.get(stageName)!;
      }

      const stage = config.agents.find(a => a.name === stageName);
      if (!stage || !stage.dependsOn || stage.dependsOn.length === 0) {
        depthMap.set(stageName, 0);
        return 0;
      }

      const depDepths = stage.dependsOn.map(dep => getDepth(dep));
      const depth = Math.max(...depDepths) + 1;
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
