// src/validators/pipeline-validator.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import { PipelineConfig } from '../config/schema.js';

export interface ValidationError {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export class PipelineValidator {
  private errors: ValidationError[] = [];

  async validate(config: PipelineConfig, repoPath: string): Promise<ValidationError[]> {
    this.errors = [];

    // Validate basic structure
    this.validateBasicStructure(config);

    // Validate agent files exist
    await this.validateAgentFiles(config, repoPath);

    // Validate settings
    this.validateSettings(config);

    // Validate agents configuration
    this.validateAgents(config);

    return this.errors;
  }

  private validateBasicStructure(config: PipelineConfig): void {
    if (!config.name || config.name.trim() === '') {
      this.errors.push({
        field: 'name',
        message: 'Pipeline name is required',
        severity: 'error'
      });
    }

    if (!config.trigger) {
      this.errors.push({
        field: 'trigger',
        message: 'Pipeline trigger is required (manual or post-commit)',
        severity: 'error'
      });
    } else if (!['manual', 'post-commit'].includes(config.trigger)) {
      this.errors.push({
        field: 'trigger',
        message: `Invalid trigger: ${config.trigger}. Must be 'manual' or 'post-commit'`,
        severity: 'error'
      });
    }

    if (!config.agents || config.agents.length === 0) {
      this.errors.push({
        field: 'agents',
        message: 'Pipeline must have at least one agent',
        severity: 'error'
      });
    }
  }

  private async validateAgentFiles(config: PipelineConfig, repoPath: string): Promise<void> {
    if (!config.agents) return;

    for (const agent of config.agents) {
      const agentPath = path.isAbsolute(agent.agent)
        ? agent.agent
        : path.join(repoPath, agent.agent);

      try {
        await fs.access(agentPath);
      } catch {
        this.errors.push({
          field: `agents.${agent.name}.agent`,
          message: `Agent file not found: ${agent.agent}`,
          severity: 'error'
        });
      }
    }
  }

  private validateSettings(config: PipelineConfig): void {
    if (!config.settings) return;

    if (config.settings.failureStrategy) {
      const validStrategies = ['stop', 'continue', 'warn'];
      if (!validStrategies.includes(config.settings.failureStrategy)) {
        this.errors.push({
          field: 'settings.failureStrategy',
          message: `Invalid failure strategy: ${config.settings.failureStrategy}. Must be one of: ${validStrategies.join(', ')}`,
          severity: 'error'
        });
      }
    }

    if (config.settings.commitPrefix && !config.settings.commitPrefix.includes('{{stage}}')) {
      this.errors.push({
        field: 'settings.commitPrefix',
        message: 'commitPrefix should include {{stage}} template variable',
        severity: 'warning'
      });
    }
  }

  private validateAgents(config: PipelineConfig): void {
    if (!config.agents) return;

    const agentNames = new Set<string>();

    for (const agent of config.agents) {
      // Check for duplicate agent names
      if (agentNames.has(agent.name)) {
        this.errors.push({
          field: `agents.${agent.name}`,
          message: `Duplicate agent name: ${agent.name}`,
          severity: 'error'
        });
      }
      agentNames.add(agent.name);

      // Validate agent name
      if (!agent.name || agent.name.trim() === '') {
        this.errors.push({
          field: 'agents[].name',
          message: 'Agent name is required',
          severity: 'error'
        });
      }

      // Validate agent path
      if (!agent.agent || agent.agent.trim() === '') {
        this.errors.push({
          field: `agents.${agent.name}.agent`,
          message: 'Agent path is required',
          severity: 'error'
        });
      }

      // Validate onFail strategy
      if (agent.onFail) {
        const validStrategies = ['stop', 'continue', 'warn'];
        if (!validStrategies.includes(agent.onFail)) {
          this.errors.push({
            field: `agents.${agent.name}.onFail`,
            message: `Invalid onFail strategy: ${agent.onFail}. Must be one of: ${validStrategies.join(', ')}`,
            severity: 'error'
          });
        }
      }

      // Validate timeout
      if (agent.timeout !== undefined) {
        if (typeof agent.timeout !== 'number' || agent.timeout <= 0) {
          this.errors.push({
            field: `agents.${agent.name}.timeout`,
            message: 'Timeout must be a positive number',
            severity: 'error'
          });
        } else if (agent.timeout > 600) {
          this.errors.push({
            field: `agents.${agent.name}.timeout`,
            message: 'Timeout exceeds recommended maximum of 600 seconds',
            severity: 'warning'
          });
        }
      }
    }
  }

  static async validateAndReport(
    config: PipelineConfig,
    repoPath: string
  ): Promise<boolean> {
    const validator = new PipelineValidator();
    const errors = await validator.validate(config, repoPath);

    if (errors.length === 0) {
      return true;
    }

    const hasErrors = errors.some(e => e.severity === 'error');
    const hasWarnings = errors.some(e => e.severity === 'warning');

    console.log('\n📋 Pipeline Validation Results:\n');

    for (const error of errors) {
      const icon = error.severity === 'error' ? '❌' : '⚠️';
      console.log(`${icon} ${error.field}: ${error.message}`);
    }

    if (hasErrors) {
      console.log('\n❌ Pipeline validation failed. Fix errors before running.\n');
      return false;
    }

    if (hasWarnings) {
      console.log('\n⚠️  Pipeline has warnings but can still run.\n');
    }

    return true;
  }
}
