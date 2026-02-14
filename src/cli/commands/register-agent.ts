// src/cli/commands/register-agent.ts - Agent management command registrations

import type { Command } from 'commander';

import { listAgentsCommand } from './agent/list.js';
import { agentInfoCommand } from './agent/info.js';
import { pullAgentsCommand } from './agent/pull.js';

export function registerAgentCommands(program: Command): void {
  const repoPath = process.cwd();

  const agentCmd = program
    .command('agent')
    .description('Manage agents');

  agentCmd
    .command('list')
    .description('List available agents')
    .action(async () => {
      await listAgentsCommand(repoPath);
    });

  agentCmd
    .command('info')
    .description('Show detailed agent information')
    .argument('<name>', 'Agent name')
    .action(async (name: string) => {
      await agentInfoCommand(repoPath, name);
    });

  agentCmd
    .command('pull')
    .description('Import agents from Claude Code plugins')
    .argument('[source]', 'Source to pull from')
    .option('--all', 'Import all available agents without interactive selection')
    .action(async (source: string | undefined, opts: { all?: boolean }) => {
      await pullAgentsCommand(repoPath, { source, all: opts.all });
    });
}
