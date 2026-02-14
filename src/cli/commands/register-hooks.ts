// src/cli/commands/register-hooks.ts - Hooks command registrations

import type { Command } from 'commander';

import { hooksListCommand, hooksInstallCommand, hooksUninstallCommand } from './hooks.js';

export function registerHooksCommands(program: Command): void {
  const repoPath = process.cwd();

  const hooksCmd = program
    .command('hooks')
    .description('Manage git hooks')
    .option('--pipeline <name>', 'Filter by pipeline name')
    .action(async (opts: { pipeline?: string }) => {
      await hooksListCommand(repoPath, opts);
    });

  hooksCmd
    .command('install')
    .description('Install git hook for a pipeline')
    .argument('<pipeline>', 'Pipeline name to install hook for')
    .action(async (pipeline: string) => {
      await hooksInstallCommand(repoPath, pipeline);
    });

  hooksCmd
    .command('uninstall')
    .description('Uninstall git hooks')
    .argument('[pipeline]', 'Pipeline name to uninstall hook for')
    .option('--all', 'Remove all agent-pipeline hooks')
    .action(async (pipeline: string | undefined, opts: { all?: boolean }) => {
      await hooksUninstallCommand(repoPath, {
        pipelineName: pipeline,
        removeAll: opts.all || !pipeline,
      });
    });

  hooksCmd
    .command('list')
    .description('List installed git hooks')
    .option('--pipeline <name>', 'Filter by pipeline name')
    .action(async (opts: { pipeline?: string }) => {
      await hooksListCommand(repoPath, opts);
    });
}
