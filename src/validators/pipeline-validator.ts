// src/validators/pipeline-validator.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import { simpleGit } from 'simple-git';
import { PipelineConfig } from '../config/schema.js';
import { checkGHCLI } from '../utils/gh-cli-checker.js';
import { ConditionEvaluator } from '../core/condition-evaluator.js';
import { DAGPlanner } from '../core/dag-planner.js';
import { AgentRuntimeRegistry } from '../core/agent-runtime-registry.js';

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
    // Runtime-aware validation: only check API key for claude-sdk, check CLI for claude-code-headless
    this.validateRuntimeEnvironment(config);
    await this.validateGitRepository(repoPath);

    // Validate basic structure
    this.validateBasicStructure(config);

    // Validate runtime configuration
    await this.validateRuntime(config);

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

  /**
   * Validate runtime configuration at pipeline and stage levels.
   * Checks runtime type registration, availability, model selection, and permission modes.
   */
  private async validateRuntime(config: PipelineConfig): Promise<void> {
    // Validate pipeline-level runtime
    if (config.runtime) {
      await this.validateRuntimeConfig('runtime', config.runtime, config.settings?.permissionMode);
    }

    // Validate stage-level runtime overrides
    if (config.agents) {
      for (const agent of config.agents) {
        if (agent.runtime) {
          await this.validateRuntimeConfig(
            `agents.${agent.name}.runtime`,
            agent.runtime,
            config.settings?.permissionMode
          );
        }
      }
    }
  }

  /**
   * Helper to validate a specific runtime configuration.
   */
  private async validateRuntimeConfig(
    field: string,
    runtime: { type: string; options?: Record<string, unknown> },
    permissionMode?: string
  ): Promise<void> {
    // Check if runtime type is registered
    if (!AgentRuntimeRegistry.hasRuntime(runtime.type)) {
      const availableRuntimes = AgentRuntimeRegistry.getAvailableTypes().join(', ');
      this.errors.push({
        field,
        message: `Unknown runtime type: ${runtime.type}. Available runtimes: [${availableRuntimes}]`,
        severity: 'error'
      });
      return; // Skip further validation if runtime doesn't exist
    }

    // Get runtime instance
    const runtimeInstance = AgentRuntimeRegistry.getRuntime(runtime.type);
    const capabilities = runtimeInstance.getCapabilities();

    // Validate runtime availability (warnings only at load time)
    try {
      const validation = await runtimeInstance.validate();

      // Add errors as warnings (we'll fail at execution time if still unavailable)
      for (const error of validation.errors) {
        this.errors.push({
          field,
          message: `Runtime availability: ${error}`,
          severity: 'warning'
        });
      }

      // Add validation warnings
      for (const warning of validation.warnings) {
        this.errors.push({
          field,
          message: warning,
          severity: 'warning'
        });
      }
    } catch (error) {
      // Runtime validation failed unexpectedly
      this.errors.push({
        field,
        message: `Runtime validation failed: ${error instanceof Error ? error.message : String(error)}`,
        severity: 'warning'
      });
    }

    // Validate model selection
    const model = runtime.options?.model;
    if (model && typeof model === 'string') {
      if (!capabilities.availableModels.includes(model)) {
        const availableModels = capabilities.availableModels.join(', ');
        this.errors.push({
          field: `${field}.options.model`,
          message: `Model "${model}" not available for runtime "${runtime.type}". Available models: [${availableModels}]`,
          severity: 'error'
        });
      }
    }

    // Validate permission mode (if specified in runtime options or at pipeline level)
    const runtimePermissionMode = runtime.options?.permissionMode as string | undefined;
    const effectivePermissionMode = runtimePermissionMode || permissionMode;

    if (effectivePermissionMode) {
      if (!capabilities.permissionModes.includes(effectivePermissionMode)) {
        const availableModes = capabilities.permissionModes.join(', ');
        this.errors.push({
          field: `${field}.options.permissionMode`,
          message: `Permission mode "${effectivePermissionMode}" not supported by runtime "${runtime.type}". Supported modes: [${availableModes}]`,
          severity: 'error'
        });
      }
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
   * Default runtime type when not specified in pipeline config.
   * Changed from 'claude-sdk' to 'claude-code-headless' as the primary agent harness.
   */
  private static readonly DEFAULT_RUNTIME_TYPE = 'claude-code-headless';

  /**
   * Validate runtime environment based on which runtimes are used.
   * - claude-sdk: requires ANTHROPIC_API_KEY environment variable
   * - claude-code-headless: requires `claude` CLI to be installed and authenticated
   */
  private validateRuntimeEnvironment(config: PipelineConfig): void {
    // Collect all runtime types used in the pipeline
    const usedRuntimes = new Set<string>();

    // Pipeline-level runtime (or default)
    const pipelineRuntime = config.runtime?.type ?? PipelineValidator.DEFAULT_RUNTIME_TYPE;
    usedRuntimes.add(pipelineRuntime);

    // Stage-level runtime overrides
    if (config.agents) {
      for (const agent of config.agents) {
        if (agent.runtime?.type) {
          usedRuntimes.add(agent.runtime.type);
        }
      }
    }

    // Validate based on which runtimes are used
    if (usedRuntimes.has('claude-sdk')) {
      this.validateClaudeApiKey();
    }

    // Note: claude-code-headless validation happens in validateRuntime() via runtime.validate()
    // which already checks for CLI availability and shows warnings
  }

  /**
   * Validate Claude API key is set in environment.
   * Only called when claude-sdk runtime is being used.
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
