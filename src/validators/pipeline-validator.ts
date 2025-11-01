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

    // Validate permission mode
    if (config.settings.permissionMode) {
      const validModes = ['default', 'acceptEdits', 'bypassPermissions', 'plan'];
      if (!validModes.includes(config.settings.permissionMode)) {
        this.errors.push({
          field: 'settings.permissionMode',
          message: `Invalid permission mode: ${config.settings.permissionMode}. Must be one of: ${validModes.join(', ')}`,
          severity: 'error'
        });
      }

      // Warn about unsafe modes
      if (config.settings.permissionMode === 'bypassPermissions') {
        this.errors.push({
          field: 'settings.permissionMode',
          message: 'bypassPermissions mode bypasses all permission checks. Use with caution in production.',
          severity: 'warning'
        });
      }
    }

    // Validate Claude Agent SDK settings
    if (config.settings.claudeAgent) {
      const ca = config.settings.claudeAgent;

      // Validate model
      if (ca.model) {
        const validModels = ['haiku', 'sonnet', 'opus'];
        if (!validModels.includes(ca.model)) {
          this.errors.push({
            field: 'settings.claudeAgent.model',
            message: `Invalid model: ${ca.model}. Must be one of: ${validModels.join(', ')}`,
            severity: 'error'
          });
        }
      }

      // Validate maxTurns
      if (ca.maxTurns !== undefined) {
        if (typeof ca.maxTurns !== 'number' || ca.maxTurns <= 0) {
          this.errors.push({
            field: 'settings.claudeAgent.maxTurns',
            message: 'maxTurns must be a positive number',
            severity: 'error'
          });
        } else if (ca.maxTurns > 100) {
          this.errors.push({
            field: 'settings.claudeAgent.maxTurns',
            message: 'maxTurns exceeds recommended maximum of 100',
            severity: 'warning'
          });
        }
      }

      // Validate maxThinkingTokens
      if (ca.maxThinkingTokens !== undefined) {
        if (typeof ca.maxThinkingTokens !== 'number' || ca.maxThinkingTokens <= 0) {
          this.errors.push({
            field: 'settings.claudeAgent.maxThinkingTokens',
            message: 'maxThinkingTokens must be a positive number',
            severity: 'error'
          });
        } else if (ca.maxThinkingTokens > 50000) {
          this.errors.push({
            field: 'settings.claudeAgent.maxThinkingTokens',
            message: 'maxThinkingTokens exceeds recommended maximum of 50000',
            severity: 'warning'
          });
        }
      }
    }

    // Validate context reduction configuration
    if (config.settings.contextReduction) {
      const cr = config.settings.contextReduction;

      // Validate strategy
      const validStrategies = ['summary-based', 'agent-based'];
      if (!validStrategies.includes(cr.strategy)) {
        this.errors.push({
          field: 'settings.contextReduction.strategy',
          message: `Invalid context reduction strategy: ${cr.strategy}. Must be one of: ${validStrategies.join(', ')}`,
          severity: 'error'
        });
      }

      // Validate maxTokens
      if (typeof cr.maxTokens !== 'number' || cr.maxTokens <= 0) {
        this.errors.push({
          field: 'settings.contextReduction.maxTokens',
          message: 'maxTokens must be a positive number',
          severity: 'error'
        });
      } else if (cr.maxTokens < 5000) {
        this.errors.push({
          field: 'settings.contextReduction.maxTokens',
          message: 'maxTokens is very low (< 5000). Consider increasing to at least 10000.',
          severity: 'warning'
        });
      }

      // Validate contextWindow
      if (cr.contextWindow !== undefined) {
        if (typeof cr.contextWindow !== 'number' || cr.contextWindow <= 0) {
          this.errors.push({
            field: 'settings.contextReduction.contextWindow',
            message: 'contextWindow must be a positive number',
            severity: 'error'
          });
        }
      }

      // Validate triggerThreshold
      if (cr.triggerThreshold !== undefined) {
        if (typeof cr.triggerThreshold !== 'number' || cr.triggerThreshold <= 0) {
          this.errors.push({
            field: 'settings.contextReduction.triggerThreshold',
            message: 'triggerThreshold must be a positive number',
            severity: 'error'
          });
        } else if (cr.triggerThreshold > cr.maxTokens) {
          this.errors.push({
            field: 'settings.contextReduction.triggerThreshold',
            message: 'triggerThreshold should be less than maxTokens',
            severity: 'error'
          });
        }
      }
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
        } else if (agent.timeout > 900) {
          this.errors.push({
            field: `agents.${agent.name}.timeout`,
            message: 'Timeout exceeds recommended maximum of 900 seconds (15 minutes)',
            severity: 'warning'
          });
        }
      }

      // Validate per-stage Claude Agent SDK settings
      if (agent.claudeAgent) {
        const ca = agent.claudeAgent;

        // Validate model
        if (ca.model) {
          const validModels = ['haiku', 'sonnet', 'opus'];
          if (!validModels.includes(ca.model)) {
            this.errors.push({
              field: `agents.${agent.name}.claudeAgent.model`,
              message: `Invalid model: ${ca.model}. Must be one of: ${validModels.join(', ')}`,
              severity: 'error'
            });
          }
        }

        // Validate maxTurns
        if (ca.maxTurns !== undefined) {
          if (typeof ca.maxTurns !== 'number' || ca.maxTurns <= 0) {
            this.errors.push({
              field: `agents.${agent.name}.claudeAgent.maxTurns`,
              message: 'maxTurns must be a positive number',
              severity: 'error'
            });
          } else if (ca.maxTurns > 100) {
            this.errors.push({
              field: `agents.${agent.name}.claudeAgent.maxTurns`,
              message: 'maxTurns exceeds recommended maximum of 100',
              severity: 'warning'
            });
          }
        }

        // Validate maxThinkingTokens
        if (ca.maxThinkingTokens !== undefined) {
          if (typeof ca.maxThinkingTokens !== 'number' || ca.maxThinkingTokens <= 0) {
            this.errors.push({
              field: `agents.${agent.name}.claudeAgent.maxThinkingTokens`,
              message: 'maxThinkingTokens must be a positive number',
              severity: 'error'
            });
          } else if (ca.maxThinkingTokens > 50000) {
            this.errors.push({
              field: `agents.${agent.name}.claudeAgent.maxThinkingTokens`,
              message: 'maxThinkingTokens exceeds recommended maximum of 50000',
              severity: 'warning'
            });
          }
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
