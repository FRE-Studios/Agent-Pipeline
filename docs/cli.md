# CLI Reference

All commands are routed through `src/index.ts`. Use `agent-pipeline <command> [options]` from your repository root.

## Getting Help

- `agent-pipeline` or `agent-pipeline help` – Show command overview
- `agent-pipeline help <command>` – Detailed help for a specific command
- `agent-pipeline <command> --help` – Same as above
- `agent-pipeline help quickstart` – Getting started guide
- `agent-pipeline help examples` – Common workflow examples
- `agent-pipeline help cheatsheet` – Quick reference (one-liner per command)
- `agent-pipeline --version` or `-v` – Show version

## Core Commands

- `run <pipeline>` – Execute a pipeline. Useful flags:
  - `--dry-run`: skip commits and PR creation.
  - `--no-interactive`: disable the Ink UI and log to stdout.
  - `--verbose`: show token stats, cache hit rates, and debug info.
  - `--no-notifications`: suppress notification delivery.
  - `--pr-draft`, `--pr-web`, `--base-branch <branch>`: override git workflow settings.
  - `--no-loop`: force-disable pipeline looping (useful for testing loop-enabled pipelines).
  - `--max-loop-iterations <n>`: set maximum loop iterations (default: 100).

  **Note:** Enable looping via `looping.enabled: true` in pipeline config. Use `--no-loop` to test in single-run mode.
- `list` – Show available pipeline definitions.
- `status` – Print the most recent run summary.
- `history` – Launch the interactive history browser (Ink UI).
- `analytics [--pipeline <name>] [--days <n>] [--loops]` – Generate success-rate and duration metrics from stored run state.
- `init` – Scaffold `.agent-pipeline/` with example pipelines.
  - Creates `front-end-parallel-example.yml` (parallel design exploration with 8 agents)
  - Creates `post-commit-example.yml` (sequential code review workflow for existing projects)
  - Creates `loop-example.yml` (collaborative storytelling with auto-loop enabled)
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
- `agent pull [--all]` – Fetch agents from Claude Code plugins.

## Schema

Output pipeline configuration templates and documentation.

- `schema` – Annotated starter template (default)
- `schema --full` – Complete JSON schema for IDE validation
- `schema --examples` – Multiple example configurations showing common patterns
- `schema --field <name>` – Explain a specific configuration field

Options:
- `-f, --format <json|yaml>` – Output format (for `--full` only)
- `-o, --output <file>` – Write to file instead of stdout

Available fields for `--field`:
`name`, `trigger`, `settings`, `agents`, `git`, `notifications`, `runtime`, `loop`, `condition`, `inputs`, `outputs`, `dependsOn`

**IDE Integration:** Export the schema for YAML validation and autocomplete:
```bash
agent-pipeline schema --full -o .agent-pipeline/schema.json
```
```yaml
# yaml-language-server: $schema=./.agent-pipeline/schema.json
name: my-pipeline
trigger: manual
# ... IDE will now provide autocomplete
```

## Git Hooks and Workflow

- `hooks` – List installed git hooks
- `hooks install <pipeline>` – Install a git hook matching the pipeline trigger (`pre-commit`, `post-commit`, `pre-push`, or `post-merge`). Requires `git.branchStrategy`; manual pipelines are rejected.
- `hooks uninstall <pipeline>` – Remove Agent Pipeline snippets for a pipeline across all supported hooks.
- `hooks uninstall --all` – Remove Agent Pipeline snippets from all supported hooks.
- Hooks run `npx agent-pipeline run <pipeline>` via `nohup` so your commits are non-blocking.
- Hooks skip commits that include the `Pipeline-Run-ID` trailer.
- Hook installs warn if `branchStrategy` is `reusable` or if `autoCommit` is enabled.
- Use git workflow flags during `run` to control PR creation dynamically (`--pr-draft`, `--pr-web`, `--base-branch`).

## Rollback and Cleanup

- `rollback [--run-id <id>] [--stages <n>]` – Uses `GitManager` to reset to the starting commit or roll back the last N stage commits. Prompts for confirmation before resetting HEAD.
- `cleanup [--pipeline <name>] [--force] [--delete-logs]` – Deletes pipeline branches and worktrees. Without `--force`, it shows what would be removed. When `--pipeline` is set, it uses that pipeline's `branchPrefix` and worktree directory.

## Testing

- `test <pipeline> [--notifications]` – Validate pipeline configuration and optionally test notification delivery.

For additional details on configuration, refer to `docs/configuration.md`, and check `docs/examples.md` for sample pipelines to try with these commands.
