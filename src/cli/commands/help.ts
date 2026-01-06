// src/cli/commands/help.ts

export function helpCommand(): void {
  console.log(`
Agent Pipeline - Intelligent agent orchestration for Claude Code

Intelligent agent orchestration with parallel execution, conditional logic, git workflow automation, and multi-channel notifications for Claude Code

Usage:
  agent-pipeline <command> [options]

Core Commands:
  run <pipeline-name>          Run a pipeline
  list                         List available pipelines
  status                       Show last pipeline run status
  history                      Browse pipeline history (interactive)
  analytics [options]          Show pipeline analytics
  init                         Initialize agent-pipeline project

Run Options:
  --dry-run                    Test without creating commits
  --no-interactive             Disable live UI (use simple console output)
  --verbose                    Show detailed logs (token stats, cache hit rates, etc.)
  --no-notifications           Disable all notifications
  --base-branch <branch>       Override base branch for PR
  --pr-draft                   Create PR as draft
  --pr-web                     Open PR in browser for editing
  --loop                       Enable pipeline looping mode
  --max-loop-iterations <n>    Override maximum loop iterations (default: 100)

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

Git Hooks:
  hooks                        List installed git hooks
  hooks install <pipeline>     Install git hook for a pipeline
  hooks uninstall <pipeline>   Remove git hook for a pipeline
  hooks uninstall --all        Remove all agent-pipeline git hooks

Git Integration:
  rollback [options]           Rollback pipeline commits
  cleanup [options]            Clean up pipeline branches

Testing:
  test <pipeline-name> [opts]  Test pipeline configuration

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
  agent-pipeline hooks install post-commit-example
  agent-pipeline export front-end-parallel-example --include-agents --output backup.yml
  agent-pipeline import https://example.com/pipeline.yml
  agent-pipeline schema
  agent-pipeline schema --full
  agent-pipeline schema --full --format yaml
        `);
}
