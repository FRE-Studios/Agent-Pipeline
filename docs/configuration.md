# Pipeline Configuration

Agent Pipeline loads YAML pipeline definitions from `.agent-pipeline/pipelines/<name>.yml`. Each file describes the trigger, global settings, and an ordered (or DAG-planned) list of agent stages.

> **Schema Validation:** Run `agent-pipeline schema` to export the JSON Schema for IDE autocomplete and validation. See [CLI Reference](cli.md#schema) for details.

## Configuration Overview

```yaml
name: commit-review
trigger: post-commit                 # pre-commit, post-commit, pre-push, post-merge, or manual

settings:
  autoCommit: true                   # Automatically commit stage changes
  commitPrefix: "[pipeline:{{stage}}]"
  failureStrategy: continue          # stop or continue
  executionMode: parallel            # parallel (default) or sequential
  claudeAgent:                       # Optional: Claude Agent SDK settings
    model: sonnet                    # haiku, sonnet, or opus
    maxTurns: 10                     # Prevent runaway agents
    maxThinkingTokens: 5000          # Extended thinking budget

git:
  baseBranch: main
  branchStrategy: reusable           # reusable, unique-per-run, or unique-and-delete
  branchPrefix: pipeline
  mergeStrategy: pull-request        # pull-request, local-merge, or none (default: none)
  pullRequest:                       # Only used when mergeStrategy: pull-request
    title: "🤖 Pipeline: {{pipelineName}}"
    reviewers: [alice, bob]
    labels: [automated, needs-review]
    draft: false

# Note: git hooks can only be installed when git.branchStrategy is set.
# Pipeline commits include a Pipeline-Run-ID trailer and use --no-verify to avoid hook loops.
# For hook-triggered pipelines, prefer branchStrategy: unique-per-run (or unique-and-delete) and disable autoCommit for read-only checks.

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
    autoCommit: false
```

### Global Settings

- `autoCommit`: stage executor commits any file changes when `true`.
- `failureStrategy`: controls how the pipeline reacts to a failed stage (`stop` or `continue`). Individual stages can override via `onFail` (`stop`, `continue`, or `warn`).
- `executionMode`: `parallel` (default) uses the DAG planner to execute independent groups simultaneously; `sequential` forces one stage at a time.

### Worktree Isolation

When a pipeline has a `git` configuration, it automatically executes in a dedicated git worktree. This means:

- Your working directory remains completely untouched during pipeline execution
- No stashing or restoring of uncommitted changes needed
- Each pipeline run operates in isolation at `.agent-pipeline/worktrees/<pipeline-name>/` by default
- Original branch and working tree are preserved throughout

You can customize the worktree location via settings:

```yaml
settings:
  worktree:
    directory: custom-worktrees   # Custom worktree base directory (relative or absolute)
```

Worktrees are cleaned up automatically after successful runs only when `branchStrategy` is `unique-and-delete`. Use `agent-pipeline cleanup` to remove stale worktrees.

### Permission Control

- `permissionMode`: controls how agents handle file operations and permissions. Options:
  - `default`: Prompts for permission based on `.claude/settings.json` rules (interactive workflows)
  - `acceptEdits` (default): Auto-accepts file edits (Write, Edit tools) while respecting allow/deny rules (automated workflows)
  - `bypassPermissions`: Bypasses all permission checks (use with extreme caution)
  - `plan`: Read-only mode, no actual execution (dry-run scenarios)

  **Note:** When using `acceptEdits` (default), agents can create/edit files without prompts, but `.claude/settings.json` allow/deny patterns are still enforced. This is ideal for automated CI/CD pipelines where you trust the workflow but want basic safeguards.

### Runtime Configuration

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

**Using Claude SDK Runtime:**
To use the SDK runtime instead of the default headless runtime, specify it in your pipeline config:
```yaml
runtime:
  type: claude-sdk
  options:
    model: sonnet
```

- `claudeAgent`: Alternative configuration for Claude Agent SDK settings (optional). If omitted, the SDK uses its own defaults.
  - `model`: Select Claude model for cost/performance optimization (`haiku`, `sonnet`, or `opus`)
  - `maxTurns`: Maximum conversation turns (prevents runaway agents)
  - `maxThinkingTokens`: Extended thinking budget for complex reasoning tasks

  **Cost Optimization:** Use `haiku` for simple tasks (linting, formatting) to reduce costs by up to 90%. Reserve `opus` for complex reasoning (architecture, design decisions). Per-stage overrides allow mixing models within a pipeline.

  **Example:**
  ```yaml
  settings:
    claudeAgent:
      model: sonnet           # Global default
      maxTurns: 10            # Safety limit

  agents:
    - name: quick-lint
      agent: .agent-pipeline/agents/linter.md
      claudeAgent:
        model: haiku          # Override: fast, cheap
        maxTurns: 5

    - name: architecture-review
      agent: .agent-pipeline/agents/architect.md
      claudeAgent:
        model: opus           # Override: powerful reasoning
        maxThinkingTokens: 15000
  ```

### Git Workflow

Branch isolation and PR creation are handled by `BranchManager` and `PRCreator`:

- `branchStrategy`: `reusable` keeps a predictable branch name (`pipeline/<name>`), `unique-per-run` appends the run ID, and `unique-and-delete` appends the run ID and auto-cleans on success.
- `mergeStrategy`: controls how pipeline work is merged after completion:
  - `pull-request`: push branch to remote and create a GitHub PR (requires `gh` CLI)
  - `local-merge`: merge branch to `baseBranch` locally without remote interaction
  - `none` (default): no merge action; work stays on the pipeline branch
  - **Note:** `unique-and-delete` branchStrategy cannot be used with `mergeStrategy: none` (validation error)
- `pullRequest`: only used when `mergeStrategy: pull-request`. Supports `title`, `labels`, `reviewers`, `assignees`, `milestone`, and `draft` flags.
- Use `agent-pipeline run <pipeline> --pr-draft`, `--pr-web`, or `--base-branch <branch>` for on-demand overrides.

### Notifications

`NotificationManager` fan-outs events to configured notifiers:

- Supported events include `pipeline.started`, `pipeline.completed`, `pipeline.failed`, `stage.completed`, `stage.failed`, and `pr.created`.
- Local notifications are enabled by default when the section exists.
- Slack notifications require a webhook URL and optional channel overrides or failure mentions.
- Test configurations with `agent-pipeline test <pipeline> --notifications`.

### Looping

Pipeline-level looping enables continuous execution where agents can queue the next pipeline iteration:

```yaml
looping:
  enabled: true                    # Auto-enable loop mode for this pipeline
  maxIterations: 100               # Safety limit (default: 100)
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

### Stage Configuration

Each entry in `agents:` maps to a stage executed by `StageExecutor`:

- `dependsOn`: builds the DAG edges evaluated by `DAGPlanner`.
- `retry`: per-stage retry policy using `RetryHandler` (`maxAttempts`, `backoff`, `initialDelay`, `maxDelay`).
- `inputs`: adds ad-hoc key-value pairs to the agent prompt context.
- `autoCommit` and `commitMessage`: override global commit behavior for the stage.
- `timeout`: maximum execution time in seconds. Default is 900s (15 minutes) with non-blocking warnings at 5, 10, and 13 minutes. Customize for quick tasks (`timeout: 60`) or complex operations (`timeout: 600`).

## Inter-Stage Communication

Agent Pipeline uses filesystem-based handover for communication between stages:

1. Each pipeline run creates a handover directory in the repo root (default: `.agent-pipeline/runs/<pipeline>-<runId>`), or at `settings.handover.directory` if set.
2. Stages write their outputs to `stages/<stage-name>/output.md` within the handover directory.
3. The `HANDOVER.md` file contains the current pipeline state and context for the next stage.
4. The `LOG.md` file maintains an execution history.

By default, `.agent-pipeline/runs/.gitignore` ignores everything except `LOG.md` and `HANDOVER.md` so transient stage artifacts do not pollute Git.
This approach enables agents to access outputs from previous stages directly via the filesystem, providing reliable data transfer without token overhead.
