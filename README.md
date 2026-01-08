# Agent Pipeline

> Intelligent agent orchestration with parallel execution, conditional logic, git workflow automation, and multi-channel notifications for Claude Code

Last update: 2025-10-28

Agent Pipeline delivers an agent-driven CI/CD workflow with full visibility. Execute Claude agents with DAG-planned parallelism, conditional logic, retries, and automated git hygiene. Branch isolation, GitHub PR creation, local/Slack notifications, and a live terminal UI keep humans in the loop.

## Features

- **Pipeline orchestration** – `PipelineRunner` combines DAG planning, conditional gating, and per-stage retries backed by `RetryHandler`.
- **Git workflow automation** – Worktrees isolate runs by default, while `BranchManager` and `PRCreator` manage dedicated branches and PRs.
- **State & context management** – `StateManager` persists run history while `HandoverManager` enables filesystem-based communication between stages.
- **Model flexibility** – Mix Haiku, Sonnet, and Opus models per stage for cost optimization (up to 90% savings on simple tasks).
- **Cost controls** – Set `maxTurns` and `maxThinkingTokens` to prevent runaway agents and enable deep reasoning when needed.
- **Observability** – Ink-powered live UI, interactive history browser, and analytics reports generated from stored run data.
- **Notifications** – `NotificationManager` sends desktop and Slack notifications with event filtering and fail-safe delivery.
- **Permission control** – Defaults to `acceptEdits` mode for automated workflows, respecting `.claude/settings.json` allow/deny rules.
- **YAML-first configuration** – Schema-validated pipelines with filesystem-based stage handover and customizable commit messages.

## Prerequisites

- **Node.js** (v18 or higher)
- **Git** (configured with user name and email)
- **Claude API Key** (set in environment or Claude Code settings)
- **GitHub CLI** (`gh`) – optional unless you enable automated PR creation
  - Install: `brew install gh` (macOS) or [see docs](https://cli.github.com/)
  - Authenticate: `gh auth login`

## Installation

### npm (Recommended)

```bash
npm install -g agent-pipeline
```

### From Source

```bash
git clone https://github.com/FRE-Studios/agent-pipeline.git
cd agent-pipeline
npm install
npm run build
npm link
```

## Quick Start

### 1. Initialize New Project

```bash
agent-pipeline init
```

This scaffolds two robust example pipelines (`front-end-parallel-example` and `post-commit-example`), required agent definitions, and the directory structure (`.agent-pipeline/`, `.agent-pipeline/agents/`). Agents from installed Claude Code plugins are automatically discovered.

### 2. Run Your First Pipeline

```bash
# Run the parallel design exploration (works on any project)
agent-pipeline run front-end-parallel-example

# For existing projects, try the post-commit workflow
agent-pipeline run post-commit-example
```

**What you'll see:** live terminal UI with status badges, real-time agent output streaming, atomic commits per stage, and a pipeline summary with timing and results.
Runs execute in isolated git worktrees by default, so your working directory stays untouched.

### 3. Explore Your Pipeline History

```bash
# Browse past runs interactively
agent-pipeline history

# View performance metrics and analytics
agent-pipeline analytics
agent-pipeline analytics --pipeline <name> --days 30
```

### 4. Try Advanced Features

```bash
# Install git hooks for automated post-commit reviews
agent-pipeline hooks install post-commit-example
# Requires git.branchStrategy configured in the pipeline

# Clone and customize a pipeline
agent-pipeline clone front-end-parallel-example my-custom-pipeline
```

---

### Manual Setup (Alternative)

#### 1. Create a Pipeline Configuration

```yaml
# .agent-pipeline/pipelines/my-pipeline.yml
name: my-pipeline
trigger: manual

git:
  autoCommit: true
  commitPrefix: "[pipeline:{{stage}}]"

execution:
  failureStrategy: continue

agents:
  - name: code-review
    agent: .agent-pipeline/agents/code-reviewer.md
    timeout: 120

  - name: code-reducer
    agent: .agent-pipeline/agents/code-reducer.md
```

#### 2. Create Agent Definitions

```markdown
<!-- .agent-pipeline/agents/code-reviewer.md -->
# Code Review Agent

You are a code review agent in an automated pipeline.

## Your Task
Review the code changes and provide feedback...
```

#### 3. Run the Pipeline

```bash
agent-pipeline run my-pipeline
```

## Documentation

- `docs/configuration.md` – Pipeline settings, git workflow, notifications, and context reduction details.
- `docs/examples.md` – Ready-to-run sample pipelines shipped with the CLI.
- `docs/cli.md` – Command reference for pipeline, agent, and git integration workflows.
- `docs/data-flow-map.md` – Visual data flow diagrams showing how data moves through the system.
- `docs/dev/` – Historical design notes and roadmap snapshots.

## Architecture Overview

Key components:

- `src/core/pipeline-runner.ts` – Orchestrates initialization, execution groups, and finalization.
- `src/core/group-execution-orchestrator.ts` – Applies conditional logic, executes groups (parallel or sequential), and triggers context reduction.
- `src/core/stage-executor.ts` – Runs individual agents with retries, token estimation, and git commits.
- `src/core/state-manager.ts` – Persists pipeline state under `.agent-pipeline/state/runs/`.
- `src/core/worktree-manager.ts` – Manages git worktrees for default pipeline isolation.
- `src/core/branch-manager.ts` / `src/core/git-manager.ts` – Handle branch isolation and git commands.
- `src/core/pr-creator.ts` – Integrates with GitHub CLI for PR automation.
- `src/utils/token-estimator.ts` – Provides `smartCount()` for context window monitoring.
- `src/ui/pipeline-ui.tsx` & `src/ui/history-browser.tsx` – Ink UIs for live runs and history browsing.
- `src/analytics/pipeline-analytics.ts` – Generates aggregated metrics for the `analytics` command.
- `src/notifications/notification-manager.ts` – Dispatches desktop and Slack notifications.
- `src/cli/commands/` – Command implementations (`run`, `install`, `cleanup`, `rollback`, etc.).

```
agent-pipeline/
├── .agent-pipeline/                 # Pipeline definitions and run history
├── docs/                            # User and developer documentation
├── src/
│   ├── analytics/
│   ├── cli/commands/
│   ├── config/
│   ├── core/
│   ├── notifications/
│   ├── ui/
│   ├── utils/
│   └── index.ts                     # CLI entry point
└── .agent-pipeline/agents/                  # Example agent prompts
```

## Git History Example

```
* a3f9d2c [pipeline:memory-manager] Update CLAUDE.md with findings
* 8c2e4a1 [pipeline:doc-updater] Add documentation updates
* 5b7f3d9 [pipeline:quality-check] Refactor for better readability
* 2e1c8f4 [pipeline:security-audit] Fix security issues
* 9d4a2b6 [pipeline:code-review] Apply style improvements
* 7a3b5c8 feat: add user authentication
```

Atomic commits make it easy to review changes, roll back specific stages, or bisect when issues arise.

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode
npm run dev

# Run tests
npm test
```
