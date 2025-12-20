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
import { installCommand } from './cli/commands/install.js';
import { uninstallCommand } from './cli/commands/uninstall.js';
import { testCommand } from './cli/commands/test.js';
import { initCommand } from './cli/commands/init.js';
import { rollbackCommand } from './cli/commands/rollback.js';
import { analyticsCommand } from './cli/commands/analytics.js';
import { cleanupCommand } from './cli/commands/cleanup.js';
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
    switch (command) {
      case 'run': {
        if (!subCommand) {
          console.error('Usage: agent-pipeline run <pipeline-name> [options]');
          process.exit(1);
        }

        // Parse flags
        const dryRun = args.includes('--dry-run');
        const noInteractive = args.includes('--no-interactive');
        const noPr = args.includes('--no-pr');
        const prDraft = args.includes('--pr-draft');
        const prWeb = args.includes('--pr-web');
        const noNotifications = args.includes('--no-notifications');
        const loop = args.includes('--loop');

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
          noPr,
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

      case 'install': {
        if (!subCommand) {
          console.error('Usage: agent-pipeline install <pipeline-name>');
          process.exit(1);
        }
        await installCommand(repoPath, subCommand);
        break;
      }

      case 'uninstall': {
        await uninstallCommand(repoPath);
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
          }
        }

        await schemaCommand(repoPath, { format, output, full });
        break;
      }

      default: {
        console.log(`
Agent Pipeline - Intelligent agent orchestration for Claude Code

Usage:
  agent-pipeline <command> [options]

Core Commands:
  run <pipeline-name>          Run a pipeline
  list                         List available pipelines
  status                       Show last pipeline run status
  history                      Browse pipeline history (interactive)
  analytics [options]          Show pipeline analytics
  init                         Initialize agent-pipeline project

Pipeline Management:
  create                       Create a new pipeline (interactive, requires init first)
  edit <pipeline-name>         Edit pipeline configuration
  delete <pipeline-name>       Delete a pipeline
  clone <source> [dest]        Clone an existing pipeline
  validate <pipeline-name>     Validate pipeline syntax and dependencies
  config <pipeline-name>       View pipeline configuration
  export <pipeline-name>       Export pipeline to file/stdout
  import <file-or-url>         Import pipeline from file or URL

Agent Management:
  agent list                   List available agents
  agent info <agent-name>      Show detailed agent information
  agent pull [--all]           Import agents from Claude Code plugins

Schema:
  schema [options]             Output pipeline configuration template

Git Integration:
  install <pipeline-name>      Install git hook (respects pipeline trigger)
  uninstall                    Remove all agent-pipeline git hooks
  rollback [options]           Rollback pipeline commits
  cleanup [options]            Clean up pipeline branches

Testing:
  test <pipeline-name> [opts]  Test pipeline configuration

Run Options:
  --dry-run                    Test without creating commits
  --no-interactive             Disable live UI (use simple console output)
  --no-notifications           Disable all notifications
  --no-pr                      Skip PR creation even if configured
  --base-branch <branch>       Override base branch for PR
  --pr-draft                   Create PR as draft
  --pr-web                     Open PR in browser for editing
  --loop                       Enable pipeline looping mode
  --max-loop-iterations <n>    Override maximum loop iterations (default: 100)

Delete/Cleanup Options:
  --force                      Delete without confirmation
  --delete-logs                Delete associated history files

Export Options:
  --output <file>              Export to file instead of stdout
  --include-agents             Include agent definitions in export

Analytics Options:
  -p, --pipeline <name>        Filter by pipeline name
  -d, --days <n>               Filter by last N days
  -l, --loops                  Show loop session analytics instead of pipeline runs

Schema Options:
  --full                       Show complete JSON schema (all fields)
  -f, --format <format>        Output format: json (default) or yaml (--full only)
  -o, --output <file>          Write to file instead of stdout

Rollback Options:
  -r, --run-id <id>            Rollback specific run ID
  -s, --stages <n>             Rollback last N stages

Examples:
  agent-pipeline init
  agent-pipeline create
  agent-pipeline run front-end-parallel-example
  agent-pipeline run post-commit-example --dry-run
  agent-pipeline edit front-end-parallel-example
  agent-pipeline clone front-end-parallel-example my-custom-pipeline
  agent-pipeline agent list
  agent-pipeline agent pull
  agent-pipeline list
  agent-pipeline status
  agent-pipeline history
  agent-pipeline analytics --pipeline front-end-parallel-example
  agent-pipeline analytics --loops --days 7
  agent-pipeline cleanup --force --delete-logs
  agent-pipeline install post-commit-example
  agent-pipeline export front-end-parallel-example --include-agents --output backup.yml
  agent-pipeline import https://example.com/pipeline.yml
  agent-pipeline schema
  agent-pipeline schema --full
  agent-pipeline schema --full --format yaml
        `);
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
