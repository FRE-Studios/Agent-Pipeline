// src/cli/help/index.ts

import type { CommandHelp, OptionHelp, ExampleHelp } from './types.js';

// ============================================================================
// Command Help Registry
// ============================================================================

const commandRegistry: Record<string, CommandHelp> = {
  run: {
    name: 'run',
    summary: 'Execute a pipeline',
    description: 'Execute a pipeline with optional flags for dry-run, git workflow, and notifications.',
    usage: ['agent-pipeline run <pipeline> [options]'],
    options: [
      { flags: '--dry-run', description: 'Test without git commits' },
      { flags: '--no-interactive', description: 'Use simple console output (no live UI)' },
      { flags: '--verbose', description: 'Show token stats and debug info' },
      { flags: '--no-notifications', description: 'Suppress desktop/Slack alerts' },
      { flags: '--base-branch <branch>', description: 'Override PR target branch' },
      { flags: '--pr-draft', description: 'Create PR as draft' },
      { flags: '--pr-web', description: 'Open PR in browser after creation' },
      { flags: '--loop', description: 'Enable pipeline looping mode' },
      { flags: '--max-loop-iterations <n>', description: 'Set max iterations', default: '100' },
    ],
    examples: [
      { command: 'agent-pipeline run my-pipeline', description: 'Run with live UI' },
      { command: 'agent-pipeline run code-review --dry-run', description: 'Test without commits' },
      { command: 'agent-pipeline run ci-pipeline --no-interactive --verbose', description: 'CI-friendly output' },
    ],
    seeAlso: ['list', 'status', 'history'],
  },

  list: {
    name: 'list',
    summary: 'Show available pipelines',
    description: 'List all pipeline configurations found in .agent-pipeline/pipelines/',
    usage: ['agent-pipeline list'],
    options: [],
    examples: [
      { command: 'agent-pipeline list', description: 'Show all pipelines' },
    ],
    seeAlso: ['run', 'config'],
  },

  status: {
    name: 'status',
    summary: 'Show last run status',
    description: 'Display the result of the most recent pipeline run.',
    usage: ['agent-pipeline status'],
    options: [],
    examples: [
      { command: 'agent-pipeline status', description: 'Check last run result' },
    ],
    seeAlso: ['history', 'analytics'],
  },

  history: {
    name: 'history',
    summary: 'Browse run history',
    description: 'Launch interactive browser to explore past pipeline runs.',
    usage: ['agent-pipeline history'],
    options: [],
    examples: [
      { command: 'agent-pipeline history', description: 'Open interactive browser' },
    ],
    seeAlso: ['status', 'analytics'],
  },

  analytics: {
    name: 'analytics',
    summary: 'View performance metrics',
    description: 'Generate success-rate and duration metrics from stored run data.',
    usage: ['agent-pipeline analytics [options]'],
    options: [
      { flags: '-p, --pipeline <name>', description: 'Filter by pipeline name' },
      { flags: '-d, --days <n>', description: 'Filter by last N days' },
      { flags: '-l, --loops', description: 'Show loop session analytics' },
    ],
    examples: [
      { command: 'agent-pipeline analytics', description: 'All-time metrics' },
      { command: 'agent-pipeline analytics --pipeline my-pipeline', description: 'Filter by pipeline' },
      { command: 'agent-pipeline analytics --days 7 --loops', description: 'Weekly loop stats' },
    ],
    seeAlso: ['history', 'status'],
  },

  init: {
    name: 'init',
    summary: 'Initialize project',
    description: 'Scaffold .agent-pipeline/ with example pipelines and required agents.',
    usage: ['agent-pipeline init'],
    options: [],
    examples: [
      { command: 'agent-pipeline init', description: 'Create example pipelines' },
    ],
    seeAlso: ['create', 'list'],
  },

  create: {
    name: 'create',
    summary: 'Create new pipeline',
    description: 'Interactive wizard to create a new pipeline configuration.',
    usage: ['agent-pipeline create'],
    options: [],
    examples: [
      { command: 'agent-pipeline create', description: 'Launch interactive wizard' },
    ],
    seeAlso: ['init', 'clone', 'edit'],
  },

  edit: {
    name: 'edit',
    summary: 'Edit pipeline config',
    description: 'Open a pipeline configuration in your default editor.',
    usage: ['agent-pipeline edit <pipeline>'],
    options: [],
    examples: [
      { command: 'agent-pipeline edit my-pipeline', description: 'Open in editor' },
    ],
    seeAlso: ['config', 'validate'],
  },

  clone: {
    name: 'clone',
    summary: 'Duplicate a pipeline',
    description: 'Create a copy of an existing pipeline with a new name.',
    usage: ['agent-pipeline clone <source> [destination]'],
    options: [],
    examples: [
      { command: 'agent-pipeline clone my-pipeline my-pipeline-v2', description: 'Create a copy' },
      { command: 'agent-pipeline clone front-end-parallel-example custom', description: 'Clone example' },
    ],
    seeAlso: ['create', 'edit'],
  },

  delete: {
    name: 'delete',
    summary: 'Remove a pipeline',
    description: 'Delete a pipeline configuration and optionally its history.',
    usage: ['agent-pipeline delete <pipeline> [options]'],
    options: [
      { flags: '--force', description: 'Delete without confirmation' },
      { flags: '--delete-logs', description: 'Also delete run history' },
    ],
    examples: [
      { command: 'agent-pipeline delete old-pipeline', description: 'Delete with confirmation' },
      { command: 'agent-pipeline delete old-pipeline --force --delete-logs', description: 'Force delete all' },
    ],
    seeAlso: ['cleanup'],
  },

  validate: {
    name: 'validate',
    summary: 'Check pipeline syntax',
    description: 'Validate pipeline YAML syntax and dependency graph.',
    usage: ['agent-pipeline validate <pipeline>'],
    options: [],
    examples: [
      { command: 'agent-pipeline validate my-pipeline', description: 'Check for errors' },
    ],
    seeAlso: ['config', 'edit'],
  },

  config: {
    name: 'config',
    summary: 'View pipeline configuration',
    description: 'Pretty-print the effective configuration for a pipeline.',
    usage: ['agent-pipeline config <pipeline>'],
    options: [],
    examples: [
      { command: 'agent-pipeline config my-pipeline', description: 'Show config' },
    ],
    seeAlso: ['edit', 'validate'],
  },

  export: {
    name: 'export',
    summary: 'Export pipeline to file',
    description: 'Export pipeline configuration, optionally bundling agent definitions.',
    usage: ['agent-pipeline export <pipeline> [options]'],
    options: [
      { flags: '-o, --output <file>', description: 'Write to file instead of stdout' },
      { flags: '--include-agents', description: 'Include agent markdown in export' },
    ],
    examples: [
      { command: 'agent-pipeline export my-pipeline', description: 'Print to stdout' },
      { command: 'agent-pipeline export my-pipeline -o backup.yml --include-agents', description: 'Full backup' },
    ],
    seeAlso: ['import', 'config'],
  },

  import: {
    name: 'import',
    summary: 'Import pipeline from file',
    description: 'Import a pipeline from a local file or URL.',
    usage: ['agent-pipeline import <file-or-url>'],
    options: [],
    examples: [
      { command: 'agent-pipeline import ./backup.yml', description: 'Import from file' },
      { command: 'agent-pipeline import https://example.com/pipeline.yml', description: 'Import from URL' },
    ],
    seeAlso: ['export', 'create'],
  },

  agent: {
    name: 'agent',
    summary: 'Manage agents',
    description: 'List, inspect, and import agent definitions.',
    usage: [
      'agent-pipeline agent list',
      'agent-pipeline agent info <name>',
      'agent-pipeline agent pull [--all]',
    ],
    options: [
      { flags: '--all', description: 'Import all agents without selection (pull only)' },
    ],
    examples: [
      { command: 'agent-pipeline agent list', description: 'Show available agents' },
      { command: 'agent-pipeline agent info code-reviewer', description: 'Show agent details' },
      { command: 'agent-pipeline agent pull', description: 'Import from plugins' },
      { command: 'agent-pipeline agent pull --all', description: 'Import all plugin agents' },
    ],
    seeAlso: ['create', 'init'],
  },

  hooks: {
    name: 'hooks',
    summary: 'Manage git hooks',
    description: 'Install, list, and remove git hooks for pipeline automation.',
    usage: [
      'agent-pipeline hooks',
      'agent-pipeline hooks install <pipeline>',
      'agent-pipeline hooks uninstall <pipeline>',
      'agent-pipeline hooks uninstall --all',
    ],
    options: [
      { flags: '--all', description: 'Remove all agent-pipeline hooks (uninstall only)' },
    ],
    examples: [
      { command: 'agent-pipeline hooks', description: 'List installed hooks' },
      { command: 'agent-pipeline hooks install post-commit-review', description: 'Add git hook' },
      { command: 'agent-pipeline hooks uninstall --all', description: 'Remove all hooks' },
    ],
    seeAlso: ['run'],
  },

  schema: {
    name: 'schema',
    summary: 'Show config template',
    description: 'Output pipeline configuration templates and JSON schema.',
    usage: ['agent-pipeline schema [options]'],
    options: [
      { flags: '--full', description: 'Complete JSON schema (for IDE validation)' },
      { flags: '--examples', description: 'Show multiple example configurations' },
      { flags: '--field <name>', description: 'Explain a specific configuration field' },
      { flags: '-f, --format <format>', description: 'Output format: json or yaml (--full only)' },
      { flags: '-o, --output <file>', description: 'Write to file instead of stdout' },
    ],
    examples: [
      { command: 'agent-pipeline schema', description: 'Starter template' },
      { command: 'agent-pipeline schema --examples', description: 'See common patterns' },
      { command: 'agent-pipeline schema --field agents', description: 'Learn about agents config' },
      { command: 'agent-pipeline schema --full -o schema.json', description: 'Export for IDE' },
    ],
    seeAlso: ['create', 'validate'],
  },

  cleanup: {
    name: 'cleanup',
    summary: 'Remove pipeline branches',
    description: 'Delete pipeline branches and worktrees created during runs.',
    usage: ['agent-pipeline cleanup [options]'],
    options: [
      { flags: '-p, --pipeline <name>', description: 'Filter by pipeline name' },
      { flags: '--force', description: 'Delete without confirmation' },
      { flags: '--delete-logs', description: 'Also delete run history' },
    ],
    examples: [
      { command: 'agent-pipeline cleanup', description: 'Preview what will be deleted' },
      { command: 'agent-pipeline cleanup --force', description: 'Delete all branches' },
      { command: 'agent-pipeline cleanup --pipeline my-pipeline --force', description: 'Clean specific pipeline' },
    ],
    seeAlso: ['rollback', 'delete'],
  },

  rollback: {
    name: 'rollback',
    summary: 'Undo pipeline commits',
    description: 'Revert commits created by pipeline stages.',
    usage: ['agent-pipeline rollback [options]'],
    options: [
      { flags: '-r, --run-id <id>', description: 'Rollback specific run' },
      { flags: '-s, --stages <n>', description: 'Rollback last N stages' },
    ],
    examples: [
      { command: 'agent-pipeline rollback --stages 2', description: 'Undo last 2 stages' },
      { command: 'agent-pipeline rollback --run-id abc123', description: 'Rollback specific run' },
    ],
    seeAlso: ['cleanup', 'history'],
  },

  test: {
    name: 'test',
    summary: 'Test pipeline configuration',
    description: 'Validate pipeline and optionally test notification channels.',
    usage: ['agent-pipeline test <pipeline> [options]'],
    options: [
      { flags: '--notifications', description: 'Test notification delivery' },
    ],
    examples: [
      { command: 'agent-pipeline test my-pipeline --notifications', description: 'Test notifications' },
    ],
    seeAlso: ['validate', 'run'],
  },
};

// ============================================================================
// Help Formatters
// ============================================================================

function formatOptions(options: OptionHelp[]): string {
  if (options.length === 0) return '';

  const lines = ['Options:'];
  for (const opt of options) {
    const defaultStr = opt.default ? ` (default: ${opt.default})` : '';
    lines.push(`  ${opt.flags.padEnd(28)} ${opt.description}${defaultStr}`);
  }
  return lines.join('\n');
}

function formatExamples(examples: ExampleHelp[]): string {
  if (examples.length === 0) return '';

  const lines = ['Examples:'];
  for (const ex of examples) {
    lines.push(`  ${ex.command}`);
    lines.push(`      ${ex.description}`);
  }
  return lines.join('\n');
}

function formatCommandHelp(cmd: CommandHelp): string {
  const sections: string[] = [];

  // Description
  sections.push(cmd.description);
  sections.push('');

  // Usage
  sections.push('Usage:');
  for (const usage of cmd.usage) {
    sections.push(`  ${usage}`);
  }

  // Options
  if (cmd.options.length > 0) {
    sections.push('');
    sections.push(formatOptions(cmd.options));
  }

  // Examples
  if (cmd.examples.length > 0) {
    sections.push('');
    sections.push(formatExamples(cmd.examples));
  }

  // See also
  if (cmd.seeAlso && cmd.seeAlso.length > 0) {
    sections.push('');
    sections.push(`See also: ${cmd.seeAlso.join(', ')}`);
  }

  return sections.join('\n');
}

// ============================================================================
// Help Sections
// ============================================================================

function showOverview(): void {
  console.log(`Agent Pipeline - Orchestrate Claude agents with parallel execution and git automation

Quick Start:
  agent-pipeline init                    Set up example pipelines
  agent-pipeline run <pipeline>          Execute a pipeline
  agent-pipeline list                    Show available pipelines

Commands:
  run <pipeline>     Execute a pipeline
  list               Show available pipelines
  status             Show last run status
  history            Browse run history
  analytics          View performance metrics
  init               Initialize project

  create             Create new pipeline
  edit <pipeline>    Edit pipeline config
  clone <src> [dst]  Duplicate a pipeline
  delete <pipeline>  Remove a pipeline
  validate           Check pipeline syntax
  config             View pipeline config
  export             Export pipeline to file
  import             Import from file/URL

  agent list         List available agents
  agent info <name>  Show agent details
  agent pull         Import plugin agents

  hooks              Manage git hooks
  schema             Show config template
  cleanup            Remove pipeline branches
  rollback           Undo pipeline commits
  test               Test pipeline config

Run 'agent-pipeline help <command>' for detailed options.
Run 'agent-pipeline help examples' for usage examples.
Run 'agent-pipeline help quickstart' for getting started guide.
Run 'agent-pipeline help cheatsheet' for quick reference.`);
}

function showQuickstart(): void {
  console.log(`Getting Started with Agent Pipeline

1. Initialize your project:

   agent-pipeline init

   Creates .agent-pipeline/ with example pipelines and agents.

2. Explore the examples:

   agent-pipeline list
   agent-pipeline config front-end-parallel-example

3. Run your first pipeline:

   agent-pipeline run front-end-parallel-example

   Watch the live UI as agents execute in parallel.

4. Check the results:

   agent-pipeline status
   agent-pipeline history

5. Create your own pipeline:

   agent-pipeline create

   Or copy an example:
   agent-pipeline clone front-end-parallel-example my-pipeline

Next Steps:
  - Run 'agent-pipeline schema' to see configuration options
  - Run 'agent-pipeline schema --examples' for common patterns
  - Read docs/configuration.md for advanced settings
  - Set up git hooks: agent-pipeline hooks install <pipeline>`);
}

function showExamples(): void {
  console.log(`Common Workflows

Getting Started:
  agent-pipeline init                              Create example pipelines
  agent-pipeline list                              See what's available
  agent-pipeline run front-end-parallel-example    Try the demo

Development Workflow:
  agent-pipeline run code-review                   Review recent changes
  agent-pipeline run code-review --dry-run         Test without commits
  agent-pipeline status                            Check last run result

Git Hook Automation:
  agent-pipeline hooks install post-commit-review  Auto-run on commits
  agent-pipeline hooks                             List installed hooks
  agent-pipeline hooks uninstall --all             Remove all hooks

Pipeline Management:
  agent-pipeline create                            Interactive wizard
  agent-pipeline clone my-pipeline my-pipeline-v2  Duplicate for editing
  agent-pipeline validate my-pipeline              Check for errors
  agent-pipeline export my-pipeline -o backup.yml  Backup config

Maintenance:
  agent-pipeline cleanup --force                   Remove old branches
  agent-pipeline rollback --stages 2               Undo last 2 stages
  agent-pipeline analytics --days 7                Weekly performance

CI/CD Integration:
  agent-pipeline run deploy --no-interactive       Headless mode for CI
  agent-pipeline run tests --no-notifications      Silent execution`);
}

function showCheatsheet(): void {
  console.log(`agent-pipeline cheatsheet

init                         Setup project
run <pipeline>               Execute pipeline
run <p> --dry-run            Test without commits
list                         Show pipelines
status                       Last run result
history                      Browse runs (interactive)
analytics                    Performance metrics

create                       New pipeline wizard
edit <pipeline>              Open in editor
clone <src> [dst]            Duplicate pipeline
delete <pipeline>            Remove pipeline
validate <pipeline>          Check syntax
config <pipeline>            View config
export <pipeline>            Export to file
import <file>                Import pipeline

agent list                   Show agents
agent info <name>            Agent details
agent pull                   Import from plugins

hooks                        List git hooks
hooks install <pipeline>     Add git hook
hooks uninstall --all        Remove all hooks

schema                       Config template
schema --full                Complete JSON schema
schema --examples            Example configs
schema --field <name>        Explain a field

cleanup --force              Delete branches
rollback --stages <n>        Undo commits
test <pipeline>              Test config`);
}

// ============================================================================
// Main Router
// ============================================================================

export function showHelp(args: string[] = []): void {
  const topic = args[0];

  // Special sections
  if (topic === 'quickstart') {
    showQuickstart();
    return;
  }

  if (topic === 'examples') {
    showExamples();
    return;
  }

  if (topic === 'cheatsheet' || args.includes('--quick')) {
    showCheatsheet();
    return;
  }

  // Command-specific help
  if (topic && commandRegistry[topic]) {
    console.log(formatCommandHelp(commandRegistry[topic]));
    return;
  }

  // Unknown topic
  if (topic && !['--help', '-h'].includes(topic)) {
    console.log(`Unknown command: ${topic}\n`);
  }

  // Default: show overview
  showOverview();
}

export function showCommandHelp(commandName: string): boolean {
  const cmd = commandRegistry[commandName];
  if (cmd) {
    console.log(formatCommandHelp(cmd));
    return true;
  }
  return false;
}

export { commandRegistry };
