// src/validators/pipeline-validator.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import { simpleGit } from 'simple-git';
import { PipelineConfig } from '../config/schema.js';
import { checkGHCLI } from '../utils/gh-cli-checker.js';
import { ConditionEvaluator } from '../core/condition-evaluator.js';
import { DAGPlanner } from '../core/dag-planner.js';

export interface ValidationError {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export class PipelineValidator {
  private errors: ValidationError[] = [];

  async validate(config: PipelineConfig, repoPath: string): Promise<ValidationError[]> {
    this.errors = [];

    // P0: Critical validations (always run)
    this.validateClaudeApiKey();
    await this.validateGitRepository(repoPath);

    // Validate basic structure
    this.validateBasicStructure(config);

    // Validate agent files exist
    await this.validateAgentFiles(config, repoPath);

    // Validate settings
    this.validateSettings(config);

    // P0: Git user config (conditional - only if autoCommit is enabled)
    const autoCommit = config.settings?.autoCommit ?? true; // default is true
    if (autoCommit) {
      await this.validateGitUserConfig(repoPath);
    }

    // P0: GitHub CLI availability (conditional - only if PR creation enabled)
    if (config.git?.pullRequest?.autoCreate === true) {
      await this.validateGitHubCLI();
    }

    // P0: Context reduction agent path (conditional - only if agent-based strategy)
    if (config.settings?.contextReduction?.strategy === 'agent-based') {
      await this.validateContextReductionAgent(config, repoPath);
    }

    // P1: Conditional expression validation (conditional - only if agents have conditions)
    if (config.agents?.some(a => a.condition)) {
      this.validateConditionalExpressions(config);
      this.validateConditionalStageReferences(config);
    }

    // P1: Slack webhook (conditional - only if Slack notifications enabled)
    if (config.notifications?.channels?.slack?.enabled) {
      this.validateSlackWebhook(config);
    }

    // P1: Git working tree state (conditional - only if preserveWorkingTree is false)
    if (config.settings?.preserveWorkingTree === false && config.git) {
      await this.validateGitWorkingTree(repoPath);
    }

    // P2: Retry configuration sanity (conditional - only if retries configured)
    this.validateRetryConfiguration(config);

    // P2: Parallel execution limits (conditional - only if parallel stages exist)
    await this.validateParallelExecutionLimits(config);

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

  /**
   * Validate GitHub CLI availability for PR creation.
   * Checks if gh CLI is installed and authenticated when autoCreate is enabled.
   */
  private async validateGitHubCLI(): Promise<void> {
    const ghStatus = await checkGHCLI();

    if (!ghStatus.installed) {
      this.errors.push({
        field: 'git.pullRequest.autoCreate',
        message:
          'GitHub CLI (gh) is not installed. Install from https://cli.github.com/ or set autoCreate to false',
        severity: 'error'
      });
    } else if (!ghStatus.authenticated) {
      this.errors.push({
        field: 'git.pullRequest.autoCreate',
        message:
          "GitHub CLI is not authenticated. Run 'gh auth login' or set autoCreate to false",
        severity: 'error'
      });
    }
  }

  /**
   * Validate Claude API key is set in environment.
   */
  private validateClaudeApiKey(): void {
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      this.errors.push({
        field: 'environment',
        message:
          'Claude API key not set. Set environment variable: export ANTHROPIC_API_KEY=sk-ant-...',
        severity: 'error'
      });
    }
  }

  /**
   * Validate current directory is a git repository.
   */
  private async validateGitRepository(repoPath: string): Promise<void> {
    try {
      const git = simpleGit(repoPath);
      const isRepo = 'checkIsRepo';
      await git[isRepo]();
    } catch {
      this.errors.push({
        field: 'repository',
        message: 'Not a git repository. Initialize with: git init',
        severity: 'error'
      });
    }
  }

  /**
   * Validate git user configuration (user.name and user.email).
   * Only runs when autoCommit is enabled.
   */
  private async validateGitUserConfig(repoPath: string): Promise<void> {
    try {
      const git = simpleGit(repoPath);
      const name = await git.getConfig('user.name');
      const email = await git.getConfig('user.email');

      if (!name.value) {
        this.errors.push({
          field: 'git.config',
          message: 'Git user.name not configured. Run: git config user.name "Your Name"',
          severity: 'error'
        });
      }
      if (!email.value) {
        this.errors.push({
          field: 'git.config',
          message: 'Git user.email not configured. Run: git config user.email "you@example.com"',
          severity: 'error'
        });
      }
    } catch (error) {
      // If git config fails, likely not a git repo - already caught by validateGitRepository
    }
  }

  /**
   * Validate context reduction agent file exists when using agent-based strategy.
   */
  private async validateContextReductionAgent(
    config: PipelineConfig,
    repoPath: string
  ): Promise<void> {
    const agentPath = config.settings?.contextReduction?.agentPath;

    if (!agentPath) {
      this.errors.push({
        field: 'settings.contextReduction.agentPath',
        message:
          'agentPath is required when strategy is "agent-based". Specify agent file or change strategy to "summary-based"',
        severity: 'error'
      });
      return;
    }

    const fullPath = path.isAbsolute(agentPath)
      ? agentPath
      : path.join(repoPath, agentPath);

    try {
      await fs.access(fullPath);
    } catch {
      this.errors.push({
        field: 'settings.contextReduction.agentPath',
        message: `Context reduction agent not found: ${agentPath}. Create this file or change strategy to "summary-based"`,
        severity: 'error'
      });
    }
  }

  /**
   * Validate conditional expression syntax for all agents with conditions.
   */
  private validateConditionalExpressions(config: PipelineConfig): void {
    if (!config.agents) return;

    const evaluator = new ConditionEvaluator();

    for (const agent of config.agents) {
      if (!agent.condition) continue;

      const result = evaluator.validateSyntax(agent.condition);
      if (!result.valid) {
        this.errors.push({
          field: `agents.${agent.name}.condition`,
          message: `Invalid condition syntax: ${result.error}. Fix syntax in pipeline config`,
          severity: 'error'
        });
      }
    }
  }

  /**
   * Validate that conditional expressions reference valid stage names.
   */
  private validateConditionalStageReferences(config: PipelineConfig): void {
    if (!config.agents) return;

    const stageNames = new Set(config.agents.map(a => a.name));

    for (const agent of config.agents) {
      if (!agent.condition) continue;

      // Extract stage references from condition (e.g., stages.review.outputs.passed)
      const stageReferences = this.extractStageReferences(agent.condition);

      for (const ref of stageReferences) {
        if (!stageNames.has(ref)) {
          const availableStages = Array.from(stageNames).join(', ');
          this.errors.push({
            field: `agents.${agent.name}.condition`,
            message: `Condition references non-existent stage "${ref}". Available stages: [${availableStages}]`,
            severity: 'error'
          });
        }
      }
    }
  }

  /**
   * Extract stage names from condition expression.
   * Matches patterns like: stages.stageName.outputs.key
   */
  private extractStageReferences(condition: string): string[] {
    const pattern = /stages\.([a-zA-Z0-9_-]+)/g;
    const matches: string[] = [];
    let match;

    while ((match = pattern.exec(condition)) !== null) {
      matches.push(match[1]);
    }

    return [...new Set(matches)]; // Remove duplicates
  }

  /**
   * Validate Slack webhook URL format.
   */
  private validateSlackWebhook(config: PipelineConfig): void {
    const webhookUrl = config.notifications?.channels?.slack?.webhookUrl;

    if (!webhookUrl) {
      this.errors.push({
        field: 'notifications.channels.slack.webhookUrl',
        message:
          'Slack webhook URL is required when Slack notifications are enabled. Get webhook: https://api.slack.com/messaging/webhooks',
        severity: 'error'
      });
      return;
    }

    if (!webhookUrl.startsWith('https://hooks.slack.com/')) {
      this.errors.push({
        field: 'notifications.channels.slack.webhookUrl',
        message:
          'Invalid Slack webhook URL. Must start with https://hooks.slack.com/. Get webhook: https://api.slack.com/messaging/webhooks',
        severity: 'error'
      });
    }
  }

  /**
   * Validate git working tree state - warn if uncommitted changes exist.
   */
  private async validateGitWorkingTree(repoPath: string): Promise<void> {
    try {
      const git = simpleGit(repoPath);
      const status = await git.status();

      if (!status.isClean()) {
        this.errors.push({
          field: 'settings.preserveWorkingTree',
          message:
            'Uncommitted changes detected. Pipeline may overwrite them. Commit changes first: git add . && git commit -m "..."',
          severity: 'warning'
        });
      }
    } catch (error) {
      // If git status fails, likely not a git repo - already caught by validateGitRepository
    }
  }

  /**
   * Validate retry configuration sanity checks.
   */
  private validateRetryConfiguration(config: PipelineConfig): void {
    // Check per-agent retry settings only (retry is per-agent, not global)
    if (config.agents) {
      for (const agent of config.agents) {
        if (agent.retry) {
          this.checkRetrySanity(`agents.${agent.name}.retry`, agent.retry);
        }
      }
    }
  }

  /**
   * Helper to check retry configuration sanity.
   */
  private checkRetrySanity(field: string, retry: any): void {
    if (retry.maxAttempts && retry.maxAttempts > 10) {
      this.errors.push({
        field,
        message: `maxAttempts (${retry.maxAttempts}) exceeds recommended limit. Consider reducing to <= 10 to avoid excessive delays`,
        severity: 'warning'
      });
    }

    if (retry.delay && retry.delay > 300) {
      this.errors.push({
        field,
        message: `Retry delay (${retry.delay}s) exceeds recommended maximum. Consider reducing to <= 300s (5 minutes)`,
        severity: 'warning'
      });
    }
  }

  /**
   * Validate parallel execution limits by analyzing the DAG.
   */
  private async validateParallelExecutionLimits(config: PipelineConfig): Promise<void> {
    if (!config.agents || config.agents.length === 0) return;

    try {
      const planner = new DAGPlanner();
      const graph = planner.buildExecutionPlan(config);

      // Use maxParallelism from the execution plan
      const maxParallel = graph.plan.maxParallelism;

      if (maxParallel > 10) {
        this.errors.push({
          field: 'agents',
          message: `Pipeline has ${maxParallel} stages running in parallel. Consider adding dependencies to limit concurrency and avoid rate limits`,
          severity: 'warning'
        });
      }
    } catch (error) {
      // DAG planning errors will be caught during execution
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
