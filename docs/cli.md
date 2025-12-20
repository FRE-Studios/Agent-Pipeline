# CLI Reference

All commands are routed through `src/index.ts`. Use `agent-pipeline <command> [options]` from your repository root.

## Core Commands

- `run <pipeline>` – Execute a pipeline. Useful flags:
  - `--dry-run`: skip commits and PR creation.
  - `--no-interactive`: disable the Ink UI and log to stdout.
  - `--no-notifications`: suppress notification delivery.
  - `--no-pr`, `--pr-draft`, `--pr-web`, `--base-branch <branch>`: override git workflow settings.
- `list` – Show available pipeline definitions.
- `status` – Print the most recent run summary.
- `history` – Launch the interactive history browser (Ink UI).
- `analytics [--pipeline <name>] [--days <n>]` – Generate success-rate and duration metrics from stored run state.
- `init` – Scaffold `.agent-pipeline/` with both example pipelines.
  - Creates `front-end-parallel-example.yml` (parallel design exploration with 8 agents)
  - Creates `post-commit-example.yml` (sequential code review workflow for existing projects)
  - Automatically creates only the fallback agents required by the pipelines.

## Pipeline Management

- `create` – Interactive pipeline generator. Requires an interactive terminal and existing agents.
  - **Prerequisites**: Run `agent-pipeline init` first, or ensure `.agent-pipeline/agents/` contains agent `.md` files.
  - **Flow**: Prompts for pipeline name, trigger type, execution mode, auto-commit preference, and agent selection.
  - **Name rules**: Must start with a letter, contain only letters/numbers/hyphens/underscores, max 50 chars.
- `edit <pipeline>` – Open a pipeline in your configured editor.
- `clone <source> [destination]` – Duplicate an existing pipeline file.
- `delete <pipeline> [--force] [--delete-logs]` – Remove a pipeline and optionally its history.
- `validate <pipeline>` – Schema and dependency validation (via `DAGPlanner`).
- `config <pipeline>` – Pretty-print the effective configuration.
- `export <pipeline> [--output <file>] [--include-agents]` – Export configuration (optionally bundling agent prompts).
- `import <file-or-url>` – Import pipeline definitions from disk or HTTP(S).

## Agent Management

Commands under the `agent` namespace interact with `.agent-pipeline/agents/`:

- `agent list` – List available agent prompts.
- `agent info <name>` – Display prompt metadata and usage.
- `agent pull [source]` – Fetch agents from a Claude Code plugin directory.

## Schema

- `schema [--format <json|yaml>] [--output <file>]` – Output JSON Schema for pipeline configuration files.
  - Default format is JSON. Use `--format yaml` for YAML output.
  - Without `--output`, prints to stdout.

**IDE Integration:** Use the schema for YAML validation and autocomplete:
```yaml
# yaml-language-server: $schema=./path/to/pipeline-config.schema.json
name: my-pipeline
trigger: manual
# ... IDE will now provide autocomplete
```

## Git Hooks and Workflow

- `install <pipeline>` – Install a git hook matching the pipeline trigger (`pre-commit`, `post-commit`, `pre-push`, or `post-merge`). Manual pipelines are rejected.
- `uninstall` – Remove Agent Pipeline snippets from all supported hooks.
- Hooks run `npx agent-pipeline run <pipeline>` via `nohup` so your commits are non-blocking.
- Use git workflow flags during `run` to control PR creation dynamically (`--no-pr`, `--pr-draft`, `--pr-web`, `--base-branch`).

## Rollback and Cleanup

- `rollback [--run-id <id>] [--stages <n>]` – Uses `GitManager` to reset to the starting commit or roll back the last N stage commits. Prompts for confirmation before resetting HEAD.
- `cleanup [--pipeline <name>] [--force] [--delete-logs]` – Deletes branches created via `BranchManager`. Without `--force`, it prints the branches that would be removed.

## Notifications

- `test <pipeline> --notifications` – Invokes `NotificationManager.test()` to validate configured channels (local and Slack). Add additional flags as needed if you want to skip notification testing.

For additional details on configuration, refer to `docs/configuration.md`, and check `docs/examples.md` for sample pipelines to try with these commands.

