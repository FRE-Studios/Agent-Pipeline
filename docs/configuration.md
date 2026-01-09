# Pipeline Configuration

Agent Pipeline loads YAML pipeline definitions from `.agent-pipeline/pipelines/<name>.yml`. Each file describes the trigger, global settings, and an ordered (or DAG-planned) list of agent stages.

> **Schema Validation:** Run `agent-pipeline schema` to export the JSON Schema for IDE autocomplete and validation. See [CLI Reference](cli.md#schema) for details.

## Configuration Overview

```yaml
name: commit-review
trigger: post-commit                 # pre-commit, post-commit, pre-push, post-merge, or manual

# Agent stages
agents:
  - name: code-review
    agent: .agent-pipeline/agents/code-reviewer.md
    timeout: 180
    retry:
      maxAttempts: 3
      backoff: exponential

  - name: auto-fix
    agent: .agent-pipeline/agents/fixer.md
    dependsOn: [code-review]
    onFail: warn

# Notifications (optional)
notifications:
  enabled: true
  events:
    - pipeline.completed
    - pipeline.failed
    - pr.created
  channels:
    local:
      enabled: true
      sound: true
    slack:
      enabled: true
      webhookUrl: ${SLACK_WEBHOOK_URL}

# Git settings (optional)
git:
  autoCommit: true                   # Automatically commit stage changes (default: true)
  commitPrefix: "[pipeline:{{stage}}]"
  baseBranch: main
  branchStrategy: reusable           # reusable, unique-per-run, or unique-and-delete
  branchPrefix: pipeline
  mergeStrategy: pull-request        # pull-request, local-merge, or none (default: none)
  pullRequest:                       # Only used when mergeStrategy: pull-request
    title: "Pipeline: {{pipelineName}}"
    reviewers: [alice, bob]
    labels: [automated, needs-review]
    draft: false
  worktree:                          # Optional worktree settings
    directory: .agent-pipeline/worktrees

# Execution settings - runtime behavior
execution:
  mode: parallel                     # parallel (default) or sequential
  failureStrategy: stop              # stop or continue (default: stop)
  permissionMode: acceptEdits        # default, acceptEdits, bypassPermissions, or plan

# Handover settings - inter-stage communication
handover:
  directory: .agent-pipeline/runs/{{pipeline}}-{{runId}}  # Default pattern
  instructions: .agent-pipeline/instructions/handover.md

# Looping settings - inter-pipeline communication
looping:
  enabled: true                    # Auto-enable loop mode for this pipeline
  maxIterations: 100 

# Runtime configuration - agent execution backend
runtime:
  type: claude-code-headless         # claude-code-headless (default) or claude-sdk
  options:
    model: sonnet                    # haiku, sonnet, or opus

```

## Git Settings

All git-related settings are unified under the `git:` section:

- `autoCommit`: Stage executor commits any file changes when `true` (default: `true`).
- `commitPrefix`: Template for commit messages, supports `{{stage}}` placeholder.
- `baseBranch`: Branch to PR into (default: `main`).
- `branchStrategy`: `reusable` keeps a predictable branch name (`pipeline/<name>`), `unique-per-run` appends the run ID, and `unique-and-delete` appends the run ID and auto-cleans on success.
- `mergeStrategy`: Controls how pipeline work is merged after completion:
  - `pull-request`: Push branch to remote and create a GitHub PR (requires `gh` CLI)
  - `local-merge`: Merge branch to `baseBranch` locally without remote interaction
  - `none` (default): No merge action; work stays on the pipeline branch
  - **Note:** `unique-and-delete` branchStrategy cannot be used with `mergeStrategy: none` (validation error)
- `pullRequest`: Only used when `mergeStrategy: pull-request`. Supports `title`, `labels`, `reviewers`, `assignees`, `milestone`, and `draft` flags.

### Worktree Isolation

When a pipeline has a `git` configuration, it automatically executes in a dedicated git worktree. This means:

- Your working directory remains completely untouched during pipeline execution
- No stashing or restoring of uncommitted changes needed
- Each pipeline run operates in isolation at `.agent-pipeline/worktrees/<pipeline-name>/` by default
- Original branch and working tree are preserved throughout

Customize the worktree location via git settings:

```yaml
git:
  worktree:
    directory: custom-worktrees   # Custom worktree base directory (relative or absolute)
```

Worktrees are cleaned up automatically after successful runs only when `branchStrategy` is `unique-and-delete`. Use `agent-pipeline cleanup` to remove stale worktrees.

## Execution Settings

Runtime behavior is controlled under the `execution:` section:

- `mode`: `parallel` (default) uses the DAG planner to execute independent groups simultaneously; `sequential` forces one stage at a time.
- `failureStrategy`: Controls how the pipeline reacts to a failed stage (`stop` or `continue`). Individual stages can override via `onFail` (`stop`, `continue`, or `warn`).
- `permissionMode`: Controls how agents handle file operations and permissions:
  - `default`: Prompts for permission based on `.claude/settings.json` rules (interactive workflows)
  - `acceptEdits` (default): Auto-accepts file edits (Write, Edit tools) while respecting allow/deny rules (automated workflows)
  - `bypassPermissions`: Bypasses all permission checks (use with extreme caution)
  - `plan`: Read-only mode, no actual execution (dry-run scenarios)

**Note:** When using `acceptEdits` (default), agents can create/edit files without prompts, but `.claude/settings.json` allow/deny patterns are still enforced. This is ideal for automated CI/CD pipelines where you trust the workflow but want basic safeguards.

## Handover Settings

Inter-stage communication settings are under the `handover:` section:

- `directory`: Handover directory path (default: `.agent-pipeline/runs/<pipeline>-<runId>/`)
- `instructions`: Path to handover instructions template (default: `.agent-pipeline/instructions/handover.md`)

## Runtime Configuration

Agent Pipeline supports multiple agent execution backends via the `runtime` field. The default is `claude-code-headless` (Claude Code CLI), which provides the full Claude Code tool suite (Bash, Read, Write, etc.) and local execution. Alternatively, use `claude-sdk` (Claude Agent SDK) for library-based execution with MCP tools.

**Pipeline-level runtime** (applies to all stages unless overridden):
```yaml
runtime:
  type: claude-code-headless    # Default if omitted
  options:
    model: sonnet               # Optional model selection
```

**Stage-level runtime override:**
```yaml
agents:
  - name: quick-check
    agent: .agent-pipeline/agents/quick.md
    runtime:
      type: claude-sdk          # Override for this stage
      options:
        model: haiku
```

**Available Runtimes:**
- `claude-code-headless` (default): Full Claude Code tool suite, local execution, session continuation support
- `claude-sdk`: Library-based execution, MCP tools, used internally for context reduction

**Cost Optimization:** Use `haiku` for simple tasks (linting, formatting) to reduce costs by up to 90%. Reserve `opus` for complex reasoning (architecture, design decisions). Per-stage overrides allow mixing models within a pipeline.

**Example:**
```yaml
runtime:
  type: claude-sdk
  options:
    model: sonnet           # Global default
    maxTurns: 10            # Safety limit

agents:
  - name: quick-lint
    agent: .agent-pipeline/agents/linter.md
    runtime:
      type: claude-sdk
      options:
        model: haiku        # Override: fast, cheap
        maxTurns: 5

  - name: architecture-review
    agent: .agent-pipeline/agents/architect.md
    runtime:
      type: claude-sdk
      options:
        model: opus         # Override: powerful reasoning
        maxThinkingTokens: 15000
```

## Notifications

`NotificationManager` fan-outs events to configured notifiers:

- Supported events include `pipeline.started`, `pipeline.completed`, `pipeline.failed`, `stage.completed`, `stage.failed`, and `pr.created`.
- Local notifications are enabled by default when the section exists.
- Slack notifications require a webhook URL and optional channel overrides or failure mentions.
- Test configurations with `agent-pipeline test <pipeline> --notifications`.

## Looping

Pipeline-level looping enables continuous execution where agents can queue the next pipeline iteration:

```yaml
looping:
  enabled: true                    # Auto-enable loop mode for this pipeline
  maxIterations: 100               # Safety limit (default: 100)
  instructions: .agent-pipeline/instructions/loop.md  # Loop instructions template
  directories:                     # Optional: custom directory paths (relative to repo)
    pending: next/pending          # Where agents drop new pipeline YAMLs
    running: next/running          # Currently executing pipeline
    finished: next/finished        # Successfully completed pipelines
    failed: next/failed            # Failed pipeline files
```

**Behavior:**
- When `looping.enabled: true`, the pipeline automatically runs in loop mode
- Directories are created automatically when looping is enabled
- Use `--no-loop` CLI flag to force-disable looping for a single run (useful for testing)

**Agent Instructions:**
Agents in the final stage group receive loop instructions automatically, directing them to create new pipeline YAML files in the pending directory when continuation is needed.

## Stage Configuration

Each entry in `agents:` maps to a stage executed by `StageExecutor`:

- `dependsOn`: Builds the DAG edges evaluated by `DAGPlanner`.
- `retry`: Per-stage retry policy using `RetryHandler` (`maxAttempts`, `backoff`, `initialDelay`, `maxDelay`).
- `inputs`: Adds ad-hoc key-value pairs to the agent prompt context.
- `onFail`: Stage-level failure handling override (`stop`, `continue`, or `warn`).
- `timeout`: Maximum execution time in seconds. Default is 900s (15 minutes) with non-blocking warnings at 5, 10, and 13 minutes. Customize for quick tasks (`timeout: 60`) or complex operations (`timeout: 600`).
- `runtime`: Stage-level runtime override (see Runtime Configuration above).
- `enabled`: Set to `false` to skip this stage.

**Note:** Git settings (`autoCommit`, `commitPrefix`) are pipeline-level only. All stages in a pipeline share the same git configuration.

## Inter-Stage Communication

Agent Pipeline uses filesystem-based handover for communication between stages:

1. Each pipeline run creates a handover directory in the repo root (default: `.agent-pipeline/runs/<pipeline>-<runId>`), or at `handover.directory` if set.
2. Stages write their outputs to `stages/<stage-name>/output.md` within the handover directory.
3. The `HANDOVER.md` file contains the current pipeline state and context for the next stage.
4. The `LOG.md` file maintains an execution history.

By default, `.agent-pipeline/runs/.gitignore` ignores everything except `LOG.md` and `HANDOVER.md` so transient stage artifacts do not pollute Git.
This approach enables agents to access outputs from previous stages directly via the filesystem, providing reliable data transfer without token overhead.
