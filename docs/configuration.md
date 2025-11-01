# Pipeline Configuration

Agent Pipeline loads YAML pipeline definitions from `.agent-pipeline/pipelines/<name>.yml`. Each file describes the trigger, global settings, and an ordered (or DAG-planned) list of agent stages.

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
  contextReduction:
    enabled: true
    maxTokens: 50000
    strategy: summary-based
    contextWindow: 3

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
    agent: .claude/agents/code-reviewer.md
    timeout: 180
    outputs: [issues_found, severity]
    retry:
      maxAttempts: 3
      backoff: exponential

  - name: auto-fix
    agent: .claude/agents/fixer.md
    dependsOn: [code-review]
    condition: "{{ stages.code-review.outputs.issues_found > 0 }}"
    onFail: warn
    autoCommit: false
```

### Global Settings

- `autoCommit`: stage executor commits any file changes when `true`.
- `failureStrategy`: controls how the pipeline reacts to a failed stage (`stop` or `continue`). Individual stages can override via `onFail` (`stop`, `continue`, or `warn`).
- `preserveWorkingTree`: stashes uncommitted changes before the run and restores them after completion.
- `executionMode`: `parallel` (default) uses the DAG planner to execute independent groups simultaneously; `sequential` forces one stage at a time.
- `contextReduction`: enables the context optimizer backed by `ContextReducer` and `TokenEstimator`. When enabled, summaries and file references are persisted under `.agent-pipeline/outputs/<runId>/`.
- `permissionMode`: controls how agents handle file operations and permissions. Options:
  - `default`: Prompts for permission based on `.claude/settings.json` rules (interactive workflows)
  - `acceptEdits` (default): Auto-accepts file edits (Write, Edit tools) while respecting allow/deny rules (automated workflows)
  - `bypassPermissions`: Bypasses all permission checks (use with extreme caution)
  - `plan`: Read-only mode, no actual execution (dry-run scenarios)

  **Note:** When using `acceptEdits` (default), agents can create/edit files without prompts, but `.claude/settings.json` allow/deny patterns are still enforced. This is ideal for automated CI/CD pipelines where you trust the workflow but want basic safeguards.

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
- `condition`: uses `ConditionEvaluator` with pipeline state (`stages.<name>.outputs`) to skip stages dynamically.
- `retry`: per-stage retry policy using `RetryHandler` (`maxAttempts`, `backoff`, `initialDelay`, `maxDelay`).
- `inputs`: adds ad-hoc values to the agent prompt payload.
- `outputs`: keys extracted from agent responses via `report_outputs` or legacy text parsing. Extracted values feed downstream stages.
- `autoCommit` and `commitMessage`: override global commit behavior for the stage.

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

## Context Reduction Details

Long pipelines can exceed Claude's token window. When `contextReduction.enabled` is `true`:

1. `ContextReducer` keeps only the most recent `contextWindow` stages in full detail.
2. Older stages contribute a short summary plus links to on-disk artifacts.
3. `TokenEstimator.smartCount()` monitors token usage. If a run approaches `maxTokens`, the reducer tightens summaries or invokes a dedicated reducer agent when configured.
4. Stage outputs are always persisted under `.agent-pipeline/outputs/<runId>/`, so agents can fetch complete data on demand.

Enable this feature for pipelines with many stages or verbose agent output—it provides significant savings without data loss.

