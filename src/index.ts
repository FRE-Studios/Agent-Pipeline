#!/usr/bin/env node

// src/index.ts - Clean CLI router

// Check Node.js version before any imports
const nodeVersion = process.version;
const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
if (majorVersion < 18) {
  console.error(`❌ Node.js 18+ required. Current: ${nodeVersion}`);
  console.error(`   Upgrade: https://nodejs.org/`);
  console.error(`   Or with nvm: nvm install 18`);
  process.exit(1);
}

import React from 'react';
import { render } from 'ink';
import { Logger } from './utils/logger.js';

// Runtime registration
import { AgentRuntimeRegistry } from './core/agent-runtime-registry.js';
import { ClaudeSDKRuntime } from './core/agent-runtimes/claude-sdk-runtime.js';
import { ClaudeCodeHeadlessRuntime } from './core/agent-runtimes/claude-code-headless-runtime.js';

// Command imports
import { runCommand } from './cli/commands/run.js';
import { listCommand } from './cli/commands/list.js';
import { statusCommand } from './cli/commands/status.js';
import { testCommand } from './cli/commands/test.js';
import { initCommand } from './cli/commands/init.js';
import { rollbackCommand } from './cli/commands/rollback.js';
import { analyticsCommand } from './cli/commands/analytics.js';
import { cleanupCommand } from './cli/commands/cleanup.js';
import { hooksListCommand, hooksInstallCommand, hooksUninstallCommand } from './cli/commands/hooks.js';
import { HistoryBrowser } from './cli/commands/history.js';

// Pipeline commands
import { createPipelineCommand } from './cli/commands/pipeline/create.js';
import { deletePipelineCommand } from './cli/commands/pipeline/delete.js';
import { clonePipelineCommand } from './cli/commands/pipeline/clone.js';
import { editPipelineCommand } from './cli/commands/pipeline/edit.js';
import { validatePipelineCommand } from './cli/commands/pipeline/validate.js';
import { configPipelineCommand } from './cli/commands/pipeline/config.js';
import { exportPipelineCommand } from './cli/commands/pipeline/export.js';
import { importPipelineCommand } from './cli/commands/pipeline/import.js';

// Agent commands
import { listAgentsCommand } from './cli/commands/agent/list.js';
import { agentInfoCommand } from './cli/commands/agent/info.js';
import { pullAgentsCommand } from './cli/commands/agent/pull.js';

// Schema command
import { schemaCommand } from './cli/commands/schema.js';

// Help system
import { showHelp, showCommandHelp } from './cli/help/index.js';
import * as fs from 'fs/promises';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const subCommand = args[1];

  const repoPath = process.cwd();

  // Register Claude SDK runtime on startup
  try {
    const sdkRuntime = new ClaudeSDKRuntime();
    AgentRuntimeRegistry.register(sdkRuntime);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    Logger.error(`Failed to register Claude SDK runtime: ${message}`);
    if (process.env.DEBUG) {
      console.error(err);
    }
    // Continue execution - runtime registration failure shouldn't block CLI commands
  }

  // Register Claude Code Headless runtime on startup
  try {
    const headlessRuntime = new ClaudeCodeHeadlessRuntime();
    AgentRuntimeRegistry.register(headlessRuntime);

    // Validate runtime availability (warn if CLI not installed, but don't block)
    const validation = await headlessRuntime.validate();
    if (!validation.valid && process.env.DEBUG) {
      Logger.warn('Claude Code Headless runtime registered but CLI not available');
      validation.warnings.forEach((warning) => Logger.warn(`  ${warning}`));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    Logger.error(`Failed to register Claude Code Headless runtime: ${message}`);
    if (process.env.DEBUG) {
      console.error(err);
    }
    // Continue execution - runtime registration failure shouldn't block CLI commands
  }

  try {
    // Handle --version flag
    if (command === '-v' || command === '--version') {
      const pkgPath = new URL('../package.json', import.meta.url);
      const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
      console.log(`agent-pipeline v${pkg.version}`);
      return;
    }

    // Handle help command with subcommands
    if (command === 'help') {
      showHelp(args.slice(1));
      return;
    }

    // Check for --help flag on any command
    if (args.includes('--help') || args.includes('-h')) {
      if (command && showCommandHelp(command)) {
        return;
      }
      showHelp();
      return;
    }

    switch (command) {
      case 'run': {
        if (!subCommand) {
          console.error('Usage: agent-pipeline run <pipeline-name> [options]');
          process.exit(1);
        }

        // Parse flags
        const dryRun = args.includes('--dry-run');
        const noInteractive = args.includes('--no-interactive');
        const verbose = args.includes('--verbose');
        const prDraft = args.includes('--pr-draft');
        const prWeb = args.includes('--pr-web');
        const noNotifications = args.includes('--no-notifications');
        const loopFlag = args.includes('--loop');
        const noLoopFlag = args.includes('--no-loop');

        // Determine loop option: undefined (use pipeline config), true (force on), false (force off)
        let loop: boolean | undefined;
        if (noLoopFlag) {
          loop = false;
        } else if (loopFlag) {
          loop = true;
        }
        // else loop remains undefined - use pipeline's looping.enabled config

        let baseBranch: string | undefined;
        const baseBranchIndex = args.indexOf('--base-branch');
        if (baseBranchIndex !== -1 && args[baseBranchIndex + 1]) {
          baseBranch = args[baseBranchIndex + 1];
        }

        let maxLoopIterations: number | undefined;
        const maxLoopIndex = args.indexOf('--max-loop-iterations');
        if (maxLoopIndex !== -1 && args[maxLoopIndex + 1]) {
          maxLoopIterations = parseInt(args[maxLoopIndex + 1], 10);
        }

        await runCommand(repoPath, subCommand, {
          dryRun,
          interactive: !noInteractive,
          verbose,
          baseBranch,
          prDraft,
          prWeb,
          noNotifications,
          loop,
          maxLoopIterations
        });
        break;
      }

      case 'list': {
        await listCommand(repoPath);
        break;
      }

      case 'status': {
        await statusCommand(repoPath);
        break;
      }

      case 'rollback': {
        const options: { runId?: string; stages?: number } = {};
        for (let i = 1; i < args.length; i++) {
          if (args[i] === '--run-id' || args[i] === '-r') {
            options.runId = args[++i];
          } else if (args[i] === '--stages' || args[i] === '-s') {
            options.stages = parseInt(args[++i], 10);
          }
        }
        await rollbackCommand(repoPath, options);
        break;
      }

      case 'init': {
        await initCommand(repoPath);
        break;
      }

      case 'history': {
        render(React.createElement(HistoryBrowser, { repoPath }));
        break;
      }

      case 'analytics': {
        const options: { pipeline?: string; days?: number; loops?: boolean } = {};
        for (let i = 1; i < args.length; i++) {
          if (args[i] === '--pipeline' || args[i] === '-p') {
            options.pipeline = args[++i];
          } else if (args[i] === '--days' || args[i] === '-d') {
            options.days = parseInt(args[++i], 10);
          } else if (args[i] === '--loops' || args[i] === '-l') {
            options.loops = true;
          }
        }
        await analyticsCommand(repoPath, options);
        break;
      }

      case 'cleanup': {
        const options: { pipeline?: string; force?: boolean; deleteLogs?: boolean } = {};
        for (let i = 1; i < args.length; i++) {
          if (args[i] === '--pipeline' || args[i] === '-p') {
            options.pipeline = args[++i];
          } else if (args[i] === '--force' || args[i] === '-f') {
            options.force = true;
          } else if (args[i] === '--delete-logs') {
            options.deleteLogs = true;
          }
        }
        await cleanupCommand(repoPath, options);
        break;
      }

      case 'test': {
        if (!subCommand) {
          console.error('Usage: agent-pipeline test <pipeline-name> --notifications');
          process.exit(1);
        }
        const testNotifications = args.includes('--notifications');
        await testCommand(repoPath, subCommand, { notifications: testNotifications });
        break;
      }

      case 'hooks': {
        const hooksSubCommand = subCommand;
        const hooksArg = args[2];

        switch (hooksSubCommand) {
          case 'install': {
            if (!hooksArg) {
              console.error('Usage: agent-pipeline hooks install <pipeline-name>');
              process.exit(1);
            }
            await hooksInstallCommand(repoPath, hooksArg);
            break;
          }

          case 'uninstall': {
            const removeAll = args.includes('--all');
            const pipelineName = hooksArg && !hooksArg.startsWith('--') ? hooksArg : undefined;

            if (removeAll && pipelineName) {
              console.error('Usage: agent-pipeline hooks uninstall <pipeline-name> OR agent-pipeline hooks uninstall --all');
              process.exit(1);
            }

            await hooksUninstallCommand(repoPath, {
              pipelineName,
              removeAll: removeAll || !pipelineName
            });
            break;
          }

          default: {
            // Default to list (handles both 'hooks' and 'hooks list')
            const listOptions: { pipeline?: string } = {};
            const pipelineIndex = args.indexOf('--pipeline');
            if (pipelineIndex !== -1 && args[pipelineIndex + 1]) {
              listOptions.pipeline = args[pipelineIndex + 1];
            }
            await hooksListCommand(repoPath, listOptions);
          }
        }
        break;
      }

      // Pipeline management commands
      case 'create': {
        await createPipelineCommand(repoPath);
        break;
      }

      case 'delete': {
        if (!subCommand) {
          console.error('Usage: agent-pipeline delete <pipeline-name> [--force] [--delete-logs]');
          process.exit(1);
        }
        const force = args.includes('--force');
        const deleteLogs = args.includes('--delete-logs');
        await deletePipelineCommand(repoPath, subCommand, { force, deleteLogs });
        break;
      }

      case 'clone': {
        if (!subCommand) {
          console.error('Usage: agent-pipeline clone <source-pipeline> [destination-name]');
          process.exit(1);
        }
        const destName = args[2];
        await clonePipelineCommand(repoPath, subCommand, destName);
        break;
      }

      case 'edit': {
        if (!subCommand) {
          console.error('Usage: agent-pipeline edit <pipeline-name>');
          process.exit(1);
        }
        await editPipelineCommand(repoPath, subCommand);
        break;
      }

      case 'validate': {
        if (!subCommand) {
          console.error('Usage: agent-pipeline validate <pipeline-name>');
          process.exit(1);
        }
        await validatePipelineCommand(repoPath, subCommand);
        break;
      }

      case 'config': {
        if (!subCommand) {
          console.error('Usage: agent-pipeline config <pipeline-name>');
          process.exit(1);
        }
        await configPipelineCommand(repoPath, subCommand);
        break;
      }

      case 'export': {
        if (!subCommand) {
          console.error('Usage: agent-pipeline export <pipeline-name> [--output <file>] [--include-agents]');
          process.exit(1);
        }
        let output: string | undefined;
        const outputIndex = args.indexOf('--output');
        if (outputIndex !== -1 && args[outputIndex + 1]) {
          output = args[outputIndex + 1];
        }
        const includeAgents = args.includes('--include-agents');
        await exportPipelineCommand(repoPath, subCommand, { output, includeAgents });
        break;
      }

      case 'import': {
        if (!subCommand) {
          console.error('Usage: agent-pipeline import <file-or-url>');
          process.exit(1);
        }
        await importPipelineCommand(repoPath, subCommand);
        break;
      }

      // Agent management commands
      case 'agent': {
        const agentSubCommand = subCommand;
        const agentArg = args[2];

        switch (agentSubCommand) {
          case 'list': {
            await listAgentsCommand(repoPath);
            break;
          }

          case 'info': {
            if (!agentArg) {
              console.error('Usage: agent-pipeline agent info <agent-name>');
              process.exit(1);
            }
            await agentInfoCommand(repoPath, agentArg);
            break;
          }

          case 'pull': {
            const source = agentArg;
            const all = args.includes('--all');
            await pullAgentsCommand(repoPath, { source, all });
            break;
          }

          default: {
            console.log(`
Agent Management Commands:

Usage:
  agent-pipeline agent list                    List available agents
  agent-pipeline agent info <agent-name>       Show detailed agent information
  agent-pipeline agent pull [--all]            Import agents from Claude Code plugins

Options:
  --all    Import all available agents without interactive selection

Examples:
  agent-pipeline agent list
  agent-pipeline agent info code-reviewer
  agent-pipeline agent pull
  agent-pipeline agent pull --all
            `);
          }
        }
        break;
      }

      case 'schema': {
        let format: 'json' | 'yaml' = 'json';
        let output: string | undefined;
        let full = false;
        let examples = false;
        let field: string | undefined;

        for (let i = 1; i < args.length; i++) {
          if (args[i] === '--format' || args[i] === '-f') {
            const fmt = args[++i];
            if (fmt === 'json' || fmt === 'yaml') {
              format = fmt;
            }
          } else if (args[i] === '--output' || args[i] === '-o') {
            output = args[++i];
          } else if (args[i] === '--full') {
            full = true;
          } else if (args[i] === '--examples') {
            examples = true;
          } else if (args[i] === '--field') {
            field = args[++i];
          }
        }

        await schemaCommand(repoPath, { format, output, full, examples, field });
        break;
      }

      default: {
        showHelp();
      }
    }
  } catch (error) {
    Logger.error((error as Error).message);
    if (process.env.DEBUG) {
      console.error(error);
    }
    process.exit(1);
  }
}

main();
