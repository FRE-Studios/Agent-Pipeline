# Example Pipelines

Agent Pipeline ships with ready-to-run examples under `.agent-pipeline/pipelines/`. Use them as references or templates for your own workflows.

## Test Pipeline (`test-pipeline.yml`)

- Trigger: `manual`
- Purpose: Minimal smoke test with two sequential stages.
- Stages:
  - `hello-world`: basic agent invocation.
  - `file-creator`: creates a sample file and commits it with a custom message.

Run it with:

```bash
agent-pipeline run test-pipeline
```

## Parallel Execution (`parallel-example.yml`)

Demonstrates DAG execution and retry handling:

- Three review stages (`code-review`, `security-scan`, `performance-check`) run simultaneously.
- `security-scan` includes a retry policy with exponential backoff.
- `summary-report` waits for all prior stages and can use their outputs via `inputs`.

## Conditional Execution (`conditional-example.yml`)

Highlights conditional branches and stage-level overrides:

- `auto-fix` runs only when `issues_found > 0`.
- `celebrate` triggers when no issues are detected.
- `emergency-fix` requires either a critical severity or discovered vulnerabilities.
- `update-docs` always runs after `code-review` and `security-scan`.

These examples exercise `ConditionEvaluator`, stage retries, and selective `onFail` behavior.

## Git Workflow (`git-workflow-example.yml`)

Showcases branch isolation and automated PR creation:

- Configures `git.pullRequest.autoCreate` with a custom title and body.
- Runs two stages (`code-review`, `quality-check`) with automatic commits.
- Pair with `agent-pipeline run git-workflow-example --no-pr` if you want to skip PR creation during experiments.

## Post-Merge Cleanup (`post-merge-cleanup.yml`)

Designed for `post-merge` hooks:

- Runs cleanup-related agents (`doc-sync`, `dependency-audit`, `code-consolidation`) in parallel.
- Sends local notifications on completion or failure.
- Final `summary-report` stage aggregates results and commits a summary.

Install it as a git hook:

```bash
agent-pipeline install post-merge-cleanup
```

For more inspiration, explore the agent definitions in `.claude/agents/`. They pair with these pipelines to demonstrate structured outputs and downstream dependencies.

