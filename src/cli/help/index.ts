// src/cli/help/index.ts - Help topic content (quickstart, examples, cheatsheet)

import chalk from 'chalk';

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
// Help Topics
// ============================================================================

export function showQuickstart(): void {
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

export function showExamples(): void {
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
  ${c.cmd('agent-pipeline run deploy --quiet')}                ${c.dim('Headless mode for CI')}
  ${c.cmd('agent-pipeline run tests --no-notifications')}      ${c.dim('Silent execution')}`);
}

export function showCheatsheet(): void {
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
