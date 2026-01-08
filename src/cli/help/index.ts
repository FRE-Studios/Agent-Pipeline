// src/cli/help/index.ts

import chalk from 'chalk';
import type { CommandHelp, OptionHelp, ExampleHelp } from './types.js';

// ============================================================================
// Color Utilities
// ============================================================================

const c = {
  // Headers and titles
  title: chalk.bold.cyan,
  header: chalk.bold.white,
  // Commands and code
  cmd: chalk.green,
  arg: chalk.cyan,
  // Options and flags
  flag: chalk.yellow,
  // Descriptions and secondary text
  desc: chalk.white,
  dim: chalk.dim,
  // Special
  highlight: chalk.bold.green,
  muted: chalk.gray,
};

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
      { flags: '--no-loop', description: 'Force-disable looping (for testing)' },
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

  'loop-context': {
    name: 'loop-context',
    summary: 'Show context for loop agents',
    description: 'Display current pipeline YAML and guidance for creating the next pipeline in loop mode. Use this command within loop mode agents to understand the current state and create properly structured next pipelines.',
    usage: ['agent-pipeline loop-context'],
    options: [],
    examples: [
      { command: 'agent-pipeline loop-context', description: 'Show current pipeline and guidance' },
    ],
    seeAlso: ['run', 'analytics'],
  },
};

// ============================================================================
// Help Formatters
// ============================================================================

function formatOptions(options: OptionHelp[]): string {
  if (options.length === 0) return '';

  const lines = [c.header('Options:')];
  for (const opt of options) {
    const defaultStr = opt.default ? c.dim(` (default: ${opt.default})`) : '';
    lines.push(`  ${c.flag(opt.flags.padEnd(28))} ${c.desc(opt.description)}${defaultStr}`);
  }
  return lines.join('\n');
}

function formatExamples(examples: ExampleHelp[]): string {
  if (examples.length === 0) return '';

  const lines = [c.header('Examples:')];
  for (const ex of examples) {
    lines.push(`  ${c.cmd(ex.command)}`);
    lines.push(`      ${c.dim(ex.description)}`);
  }
  return lines.join('\n');
}

function formatCommandHelp(cmd: CommandHelp): string {
  const sections: string[] = [];

  // Description
  sections.push(c.desc(cmd.description));
  sections.push('');

  // Usage
  sections.push(c.header('Usage:'));
  for (const usage of cmd.usage) {
    sections.push(`  ${c.cmd(usage)}`);
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
    sections.push(`${c.dim('See also:')} ${cmd.seeAlso.map(s => c.cmd(s)).join(', ')}`);
  }

  return sections.join('\n');
}

// ============================================================================
// Help Sections
// ============================================================================

function showOverview(): void {
  const title = c.title('Agent Pipeline');
  const tagline = c.dim('Orchestrate Claude agents with parallel execution and git automation');

  console.log(`${title} - ${tagline}

${c.header('Quick Start:')}
  ${c.cmd('agent-pipeline init')}                    ${c.dim('Set up example pipelines')}
  ${c.cmd('agent-pipeline run')} ${c.arg('<pipeline>')}          ${c.dim('Execute a pipeline')}
  ${c.cmd('agent-pipeline list')}                    ${c.dim('Show available pipelines')}

${c.header('Commands:')}
  ${c.cmd('run')} ${c.arg('<pipeline>')}     ${c.dim('Execute a pipeline')}
  ${c.cmd('list')}               ${c.dim('Show available pipelines')}
  ${c.cmd('status')}             ${c.dim('Show last run status')}
  ${c.cmd('history')}            ${c.dim('Browse run history')}
  ${c.cmd('analytics')}          ${c.dim('View performance metrics')}
  ${c.cmd('init')}               ${c.dim('Initialize project')}

  ${c.cmd('create')}             ${c.dim('Create new pipeline')}
  ${c.cmd('edit')} ${c.arg('<pipeline>')}    ${c.dim('Edit pipeline config')}
  ${c.cmd('clone')} ${c.arg('<src> [dst]')}  ${c.dim('Duplicate a pipeline')}
  ${c.cmd('delete')} ${c.arg('<pipeline>')}  ${c.dim('Remove a pipeline')}
  ${c.cmd('validate')}           ${c.dim('Check pipeline syntax')}
  ${c.cmd('config')}             ${c.dim('View pipeline config')}
  ${c.cmd('export')}             ${c.dim('Export pipeline to file')}
  ${c.cmd('import')}             ${c.dim('Import from file/URL')}

  ${c.cmd('agent list')}         ${c.dim('List available agents')}
  ${c.cmd('agent info')} ${c.arg('<name>')}  ${c.dim('Show agent details')}
  ${c.cmd('agent pull')}         ${c.dim('Import plugin agents')}

  ${c.cmd('hooks')}              ${c.dim('Manage git hooks')}
  ${c.cmd('schema')}             ${c.dim('Show config template')}
  ${c.cmd('loop-context')}       ${c.dim('Show context for loop agents')}
  ${c.cmd('cleanup')}            ${c.dim('Remove pipeline branches')}
  ${c.cmd('rollback')}           ${c.dim('Undo pipeline commits')}
  ${c.cmd('test')}               ${c.dim('Test pipeline config')}

${c.dim("Run 'agent-pipeline help <command>' for detailed options.")}
${c.dim("Run 'agent-pipeline help examples' for usage examples.")}
${c.dim("Run 'agent-pipeline help quickstart' for getting started guide.")}
${c.dim("Run 'agent-pipeline help cheatsheet' for quick reference.")}`);
}

function showQuickstart(): void {
  console.log(`${c.title('Getting Started with Agent Pipeline')}

${c.header('1.')} Initialize your project:

   ${c.cmd('agent-pipeline init')}

   ${c.dim('Creates .agent-pipeline/ with example pipelines and agents.')}

${c.header('2.')} Explore the examples:

   ${c.cmd('agent-pipeline list')}
   ${c.cmd('agent-pipeline config front-end-parallel-example')}

${c.header('3.')} Run your first pipeline:

   ${c.cmd('agent-pipeline run front-end-parallel-example')}

   ${c.dim('Watch the live UI as agents execute in parallel.')}

${c.header('4.')} Check the results:

   ${c.cmd('agent-pipeline status')}
   ${c.cmd('agent-pipeline history')}

${c.header('5.')} Create your own pipeline:

   ${c.cmd('agent-pipeline create')}

   ${c.dim('Or copy an example:')}
   ${c.cmd('agent-pipeline clone front-end-parallel-example my-pipeline')}

${c.header('Next Steps:')}
  ${c.dim('-')} Run ${c.cmd("'agent-pipeline schema'")} to see configuration options
  ${c.dim('-')} Run ${c.cmd("'agent-pipeline schema --examples'")} for common patterns
  ${c.dim('-')} Read ${c.arg('docs/configuration.md')} for advanced settings
  ${c.dim('-')} Set up git hooks: ${c.cmd('agent-pipeline hooks install <pipeline>')}`);
}

function showExamples(): void {
  console.log(`${c.title('Common Workflows')}

${c.header('Getting Started:')}
  ${c.cmd('agent-pipeline init')}                              ${c.dim('Create example pipelines')}
  ${c.cmd('agent-pipeline list')}                              ${c.dim("See what's available")}
  ${c.cmd('agent-pipeline run front-end-parallel-example')}    ${c.dim('Try the demo')}

${c.header('Development Workflow:')}
  ${c.cmd('agent-pipeline run code-review')}                   ${c.dim('Review recent changes')}
  ${c.cmd('agent-pipeline run code-review --dry-run')}         ${c.dim('Test without commits')}
  ${c.cmd('agent-pipeline status')}                            ${c.dim('Check last run result')}

${c.header('Git Hook Automation:')}
  ${c.cmd('agent-pipeline hooks install post-commit-review')}  ${c.dim('Auto-run on commits')}
  ${c.cmd('agent-pipeline hooks')}                             ${c.dim('List installed hooks')}
  ${c.cmd('agent-pipeline hooks uninstall --all')}             ${c.dim('Remove all hooks')}

${c.header('Pipeline Management:')}
  ${c.cmd('agent-pipeline create')}                            ${c.dim('Interactive wizard')}
  ${c.cmd('agent-pipeline clone my-pipeline my-pipeline-v2')}  ${c.dim('Duplicate for editing')}
  ${c.cmd('agent-pipeline validate my-pipeline')}              ${c.dim('Check for errors')}
  ${c.cmd('agent-pipeline export my-pipeline -o backup.yml')}  ${c.dim('Backup config')}

${c.header('Maintenance:')}
  ${c.cmd('agent-pipeline cleanup --force')}                   ${c.dim('Remove old branches')}
  ${c.cmd('agent-pipeline rollback --stages 2')}               ${c.dim('Undo last 2 stages')}
  ${c.cmd('agent-pipeline analytics --days 7')}                ${c.dim('Weekly performance')}

${c.header('CI/CD Integration:')}
  ${c.cmd('agent-pipeline run deploy --no-interactive')}       ${c.dim('Headless mode for CI')}
  ${c.cmd('agent-pipeline run tests --no-notifications')}      ${c.dim('Silent execution')}`);
}

function showCheatsheet(): void {
  console.log(`${c.title('agent-pipeline cheatsheet')}

${c.cmd('init')}                         ${c.dim('Setup project')}
${c.cmd('run')} ${c.arg('<pipeline>')}               ${c.dim('Execute pipeline')}
${c.cmd('run')} ${c.arg('<p>')} ${c.flag('--dry-run')}            ${c.dim('Test without commits')}
${c.cmd('list')}                         ${c.dim('Show pipelines')}
${c.cmd('status')}                       ${c.dim('Last run result')}
${c.cmd('history')}                      ${c.dim('Browse runs (interactive)')}
${c.cmd('analytics')}                    ${c.dim('Performance metrics')}

${c.cmd('create')}                       ${c.dim('New pipeline wizard')}
${c.cmd('edit')} ${c.arg('<pipeline>')}              ${c.dim('Open in editor')}
${c.cmd('clone')} ${c.arg('<src> [dst]')}            ${c.dim('Duplicate pipeline')}
${c.cmd('delete')} ${c.arg('<pipeline>')}            ${c.dim('Remove pipeline')}
${c.cmd('validate')} ${c.arg('<pipeline>')}          ${c.dim('Check syntax')}
${c.cmd('config')} ${c.arg('<pipeline>')}            ${c.dim('View config')}
${c.cmd('export')} ${c.arg('<pipeline>')}            ${c.dim('Export to file')}
${c.cmd('import')} ${c.arg('<file>')}                ${c.dim('Import pipeline')}

${c.cmd('agent list')}                   ${c.dim('Show agents')}
${c.cmd('agent info')} ${c.arg('<name>')}            ${c.dim('Agent details')}
${c.cmd('agent pull')}                   ${c.dim('Import from plugins')}

${c.cmd('hooks')}                        ${c.dim('List git hooks')}
${c.cmd('hooks install')} ${c.arg('<pipeline>')}     ${c.dim('Add git hook')}
${c.cmd('hooks uninstall')} ${c.flag('--all')}        ${c.dim('Remove all hooks')}

${c.cmd('schema')}                       ${c.dim('Config template')}
${c.cmd('schema')} ${c.flag('--full')}                ${c.dim('Complete JSON schema')}
${c.cmd('schema')} ${c.flag('--examples')}            ${c.dim('Example configs')}
${c.cmd('schema')} ${c.flag('--field')} ${c.arg('<name>')}        ${c.dim('Explain a field')}

${c.cmd('cleanup')} ${c.flag('--force')}              ${c.dim('Delete branches')}
${c.cmd('rollback')} ${c.flag('--stages')} ${c.arg('<n>')}        ${c.dim('Undo commits')}
${c.cmd('test')} ${c.arg('<pipeline>')}              ${c.dim('Test config')}`);
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
    console.log(c.flag(`Unknown command: ${topic}\n`));
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
