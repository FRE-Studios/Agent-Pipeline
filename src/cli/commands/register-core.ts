// src/cli/commands/register-core.ts - Core command registrations

import type { Command } from 'commander';
import React from 'react';
import { render } from 'ink';

import { runCommand } from './run.js';
import { listCommand } from './list.js';
import { statusCommand } from './status.js';
import { initCommand } from './init.js';
import { HistoryBrowser } from './history.js';
import { analyticsCommand } from './analytics.js';
import { testCommand } from './test.js';
import { rollbackCommand } from './rollback.js';
import { cleanupCommand } from './cleanup.js';
import { schemaCommand } from './schema.js';

export function registerCoreCommands(program: Command): void {
  const repoPath = process.cwd();

  program
    .command('run')
    .description('Execute a pipeline')
    .argument('<pipeline>', 'Pipeline name to run')
    .option('--dry-run', 'Test without git commits')
    .option('--quiet', 'Use simple console output (no live UI)')
    .option('--verbose', 'Show token stats and debug info')
    .option('--no-notifications', 'Suppress desktop/Slack alerts')
    .option('--base-branch <branch>', 'Override PR target branch')
    .option('--pr-draft', 'Create PR as draft')
    .option('--pr-web', 'Open PR in browser after creation')
    .option('--no-loop', 'Force-disable looping (for testing)')
    .option('--max-loop-iterations <n>', 'Set max iterations', parseInt)
    .action(async (pipeline: string, opts: {
      dryRun?: boolean;
      quiet?: boolean;
      verbose?: boolean;
      notifications?: boolean;
      baseBranch?: string;
      prDraft?: boolean;
      prWeb?: boolean;
      loop?: boolean;
      maxLoopIterations?: number;
    }) => {
      await runCommand(repoPath, pipeline, {
        dryRun: opts.dryRun,
        interactive: !opts.quiet,
        verbose: opts.verbose,
        baseBranch: opts.baseBranch,
        prDraft: opts.prDraft,
        prWeb: opts.prWeb,
        noNotifications: opts.notifications === false,
        loop: opts.loop === false ? false : undefined,
        maxLoopIterations: opts.maxLoopIterations,
      });
    });

  program
    .command('list')
    .description('Show available pipelines')
    .action(async () => {
      await listCommand(repoPath);
    });

  program
    .command('status')
    .description('Show last run status')
    .action(async () => {
      await statusCommand(repoPath);
    });

  program
    .command('init')
    .description('Initialize project with example pipelines')
    .action(async () => {
      await initCommand(repoPath);
    });

  program
    .command('history')
    .description('Browse run history (interactive)')
    .action(async () => {
      render(React.createElement(HistoryBrowser, { repoPath }));
    });

  program
    .command('analytics')
    .description('View performance metrics')
    .option('-p, --pipeline <name>', 'Filter by pipeline name')
    .option('-d, --days <n>', 'Filter by last N days', parseInt)
    .option('-l, --loops', 'Show loop session analytics')
    .action(async (opts: { pipeline?: string; days?: number; loops?: boolean }) => {
      await analyticsCommand(repoPath, opts);
    });

  program
    .command('test')
    .description('Test pipeline configuration')
    .argument('<pipeline>', 'Pipeline name to test')
    .option('--notifications', 'Test notification delivery')
    .action(async (pipeline: string, opts: { notifications?: boolean }) => {
      await testCommand(repoPath, pipeline, opts);
    });

  program
    .command('rollback')
    .description('Undo pipeline commits')
    .option('-r, --run-id <id>', 'Rollback specific run')
    .option('-s, --stages <n>', 'Rollback last N stages', parseInt)
    .action(async (opts: { runId?: string; stages?: number }) => {
      await rollbackCommand(repoPath, opts);
    });

  program
    .command('cleanup')
    .description('Remove pipeline branches and worktrees')
    .option('-p, --pipeline <name>', 'Filter by pipeline name')
    .option('--force', 'Delete without confirmation')
    .option('--delete-logs', 'Also delete run history')
    .option('-w, --worktrees', 'Clean up worktrees')
    .option('-a, --all', 'Clean up everything')
    .option('--prefix <prefix>', 'Branch prefix filter')
    .option('--delete-remote', 'Also delete remote branches')
    .action(async (opts: {
      pipeline?: string;
      force?: boolean;
      deleteLogs?: boolean;
      worktrees?: boolean;
      all?: boolean;
      prefix?: string;
      deleteRemote?: boolean;
    }) => {
      await cleanupCommand(repoPath, opts);
    });

  program
    .command('schema')
    .description('Show config template and JSON schema')
    .option('--full', 'Complete JSON schema (for IDE validation)')
    .option('--examples', 'Show multiple example configurations')
    .option('--field <name>', 'Explain a specific configuration field')
    .option('-f, --format <format>', 'Output format: json or yaml')
    .option('-o, --output <file>', 'Write to file instead of stdout')
    .action(async (opts: {
      full?: boolean;
      examples?: boolean;
      field?: string;
      format?: string;
      output?: string;
    }) => {
      await schemaCommand(repoPath, {
        format: (opts.format === 'yaml' ? 'yaml' : 'json') as 'json' | 'yaml',
        output: opts.output,
        full: opts.full,
        examples: opts.examples,
        field: opts.field,
      });
    });

  program
    .command('loop-context')
    .description('Show context for loop agents')
    .action(async () => {
      const { loopContextCommand } = await import('./loop-context.js');
      await loopContextCommand(repoPath);
    });
}
