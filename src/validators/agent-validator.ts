// src/validators/agent-validator.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import { Validator, ValidationContext } from './types.js';

/**
 * Validates agent configurations: file existence, names, paths, timeouts, onFail strategies.
 */
export class AgentValidator implements Validator {
  readonly name = 'agents';
  readonly priority = 0 as const;

  shouldRun(context: ValidationContext): boolean {
    return !!context.config.agents?.length;
  }

  async validate(context: ValidationContext): Promise<void> {
    const { config, repoPath, errors } = context;
    if (!config.agents) return;

    // Validate agent files exist
    await this.validateAgentFiles(config.agents, repoPath, errors);

    // Validate agent configurations
    this.validateAgentConfigs(config.agents, errors);
  }

  private async validateAgentFiles(
    agents: Array<{ name: string; agent: string }>,
    repoPath: string,
    errors: ValidationContext['errors']
  ): Promise<void> {
    for (const agent of agents) {
      const agentPath = path.isAbsolute(agent.agent)
        ? agent.agent
        : path.join(repoPath, agent.agent);

      try {
        await fs.access(agentPath);
      } catch {
        errors.push({
          field: `agents.${agent.name}.agent`,
          message: `Agent file not found: ${agent.agent}`,
          severity: 'error',
        });
      }
    }
  }

  private validateAgentConfigs(
    agents: Array<{
      name: string;
      agent: string;
      onFail?: string;
      timeout?: number;
    }>,
    errors: ValidationContext['errors']
  ): void {
    const agentNames = new Set<string>();

    for (const agent of agents) {
      // Check for duplicate agent names
      if (agentNames.has(agent.name)) {
        errors.push({
          field: `agents.${agent.name}`,
          message: `Duplicate agent name: ${agent.name}`,
          severity: 'error',
        });
      }
      agentNames.add(agent.name);

      // Validate agent name
      if (!agent.name || agent.name.trim() === '') {
        errors.push({
          field: 'agents[].name',
          message: 'Agent name is required',
          severity: 'error',
        });
      }

      // Validate agent path
      if (!agent.agent || agent.agent.trim() === '') {
        errors.push({
          field: `agents.${agent.name}.agent`,
          message: 'Agent path is required',
          severity: 'error',
        });
      }

      // Validate onFail strategy
      if (agent.onFail) {
        const validStrategies = ['stop', 'continue', 'warn'];
        if (!validStrategies.includes(agent.onFail)) {
          errors.push({
            field: `agents.${agent.name}.onFail`,
            message: `Invalid onFail strategy: ${agent.onFail}. Must be one of: ${validStrategies.join(', ')}`,
            severity: 'error',
          });
        }
      }

      // Validate timeout
      if (agent.timeout !== undefined) {
        if (typeof agent.timeout !== 'number' || agent.timeout <= 0) {
          errors.push({
            field: `agents.${agent.name}.timeout`,
            message: 'Timeout must be a positive number',
            severity: 'error',
          });
        } else if (agent.timeout > 900) {
          errors.push({
            field: `agents.${agent.name}.timeout`,
            message: 'Timeout exceeds recommended maximum of 900 seconds (15 minutes)',
            severity: 'warning',
          });
        }
      }
    }
  }
}
