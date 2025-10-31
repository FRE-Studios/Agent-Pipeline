# Example Pipelines

Agent Pipeline ships with ready-to-run examples. Use `agent-pipeline init [example-name]` to create specific examples, or `agent-pipeline init --all` to create all examples.

## Test Pipeline (`test-pipeline.yml`)

**Created by**: `agent-pipeline init` (default)

- Trigger: `manual`
- Purpose: Minimal starter pipeline to get you up and running quickly.
- Stages:
  - `code-review`: Reviews changes using the code-reviewer agent.
  - `summary`: Generates a summary of the review findings.

Run it with:

```bash
agent-pipeline run test-pipeline
```

## Post-Commit Example (`post-commit-example.yml`)

**Created by**: `agent-pipeline init post-commit` or `agent-pipeline init --all`

Demonstrates parallel execution and context reduction:

- Three stages run in parallel: `code-review`, `quality-check`, and then `doc-updater` after both complete.
- Includes context reduction settings for managing token usage in multi-stage pipelines.
- Stages automatically commit changes with customizable commit messages.

## Pre-Commit Example (`pre-commit-example.yml`)

**Created by**: `agent-pipeline init pre-commit` or `agent-pipeline init --all`

Fast validation checks before commits:

- Runs `lint-check` and `security-scan` in parallel with fail-fast behavior.
- Uses `preserveWorkingTree: true` to maintain uncommitted changes.
- Generates a validation summary only if all checks pass.

## Pre-Push Example (`pre-push-example.yml`)

**Created by**: `agent-pipeline init pre-push` or `agent-pipeline init --all`

Comprehensive checks before pushing:

- Parallel execution of `security-audit`, `code-quality`, and `dependency-check`.
- Conditional `push-approval` stage that only runs if no vulnerabilities are found.
- Demonstrates conditional logic with template expressions.

## Post-Merge Example (`post-merge-example.yml`)

**Created by**: `agent-pipeline init post-merge` or `agent-pipeline init --all`

Showcases git workflow automation with PR creation:

- Runs cleanup-related agents (`doc-sync`, `dependency-audit`, `code-consolidation`) in parallel.
- Configures automated PR creation with custom title and labels.
- Sends desktop notifications on completion or failure.
- Final `summary-report` stage aggregates results and commits a summary.

Install it as a git hook:

```bash
agent-pipeline install post-merge-example
```

For more inspiration, explore the agent definitions in `.claude/agents/`. They pair with these pipelines to demonstrate structured outputs and downstream dependencies.

