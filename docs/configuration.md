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
  preserveWorkingTree: false         # Stash and restore local changes
  executionMode: parallel            # parallel (default) or sequential
  saveVerboseOutputs: true           # Save pipeline summaries to .agent-pipeline/outputs/
  claudeAgent:                       # Optional: Claude Agent SDK settings
    model: sonnet                    # haiku, sonnet, or opus
    maxTurns: 10                     # Prevent runaway agents
    maxThinkingTokens: 5000          # Extended thinking budget

git:
  baseBranch: main
  branchStrategy: reusable           # reusable or unique-per-run
  branchPrefix: pipeline
  pullRequest:
    autoCreate: true
    title: "🤖 Pipeline: {{pipelineName}}"
    reviewers: [alice, bob]
    labels: [automated, needs-review]
    draft: false

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
- `preserveWorkingTree`: stashes uncommitted changes before the run and restores them after completion.
- `executionMode`: `parallel` (default) uses the DAG planner to execute independent groups simultaneously; `sequential` forces one stage at a time.
- `saveVerboseOutputs`: when `true` (default), saves pipeline summaries and changed file lists to `.agent-pipeline/outputs/<runId>/`.
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

- `branchStrategy`: `reusable` keeps a predictable branch name (`pipeline/<name>`), while `unique-per-run` appends the run ID.
- `pullRequest.autoCreate`: when `true`, the pipeline attempts to open a PR with GitHub CLI (`gh`). Additional metadata such as `labels`, `assignees`, and `milestone` map directly to CLI flags.
- Use `agent-pipeline run <pipeline> --no-pr`, `--pr-draft`, `--pr-web`, or `--base-branch <branch>` for on-demand overrides.

### Notifications

`NotificationManager` fan-outs events to configured notifiers:

- Supported events include `pipeline.started`, `pipeline.completed`, `pipeline.failed`, `stage.completed`, `stage.failed`, and `pr.created`.
- Local notifications are enabled by default when the section exists.
- Slack notifications require a webhook URL and optional channel overrides or failure mentions.
- Test configurations with `agent-pipeline test <pipeline> --notifications`.

### Stage Configuration

Each entry in `agents:` maps to a stage executed by `StageExecutor`:

- `dependsOn`: builds the DAG edges evaluated by `DAGPlanner`.
- `retry`: per-stage retry policy using `RetryHandler` (`maxAttempts`, `backoff`, `initialDelay`, `maxDelay`).
- `inputs`: adds ad-hoc key-value pairs to the agent prompt context.
- `autoCommit` and `commitMessage`: override global commit behavior for the stage.
- `timeout`: maximum execution time in seconds. Default is 900s (15 minutes) with non-blocking warnings at 5, 10, and 13 minutes. Customize for quick tasks (`timeout: 60`) or complex operations (`timeout: 600`).

### Reporting Structured Outputs

Agents should call the `report_outputs` tool for precise data passing:

```javascript
report_outputs({
  outputs: {
    summary: "Reviewed 12 files. Found 5 issues.",
    issues_found: 5,
    severity: "high"
  }
});
```

The stage executor writes structured JSON to `.agent-pipeline/outputs/<runId>/<stage>-output.json` and the raw response to `<stage>-raw.md`, enabling later stages to read full details via the Read tool when needed.

## Inter-Stage Communication

Agent Pipeline uses filesystem-based handover for communication between stages:

1. Each pipeline run creates a handover directory at `.agent-pipeline/handover/<pipeline>-<runId>/`.
2. Stages write their outputs to `stages/<stage-name>/output.md` within the handover directory.
3. The `HANDOVER.md` file contains the current pipeline state and context for the next stage.
4. The `LOG.md` file maintains an execution history.

This approach enables agents to access outputs from previous stages directly via the filesystem, providing reliable data transfer without token overhead.

