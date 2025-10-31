# Agent Pipeline

> Intelligent agent orchestration with parallel execution, conditional logic, git workflow automation, and multi-channel notifications for Claude Code

Last update: 2025-10-28

Agent Pipeline delivers an agent-driven CI/CD workflow with full visibility. Execute Claude agents with DAG-planned parallelism, conditional logic, retries, and automated git hygiene. Branch isolation, GitHub PR creation, local/Slack notifications, and a live terminal UI keep humans in the loop.

## Features

- **Pipeline orchestration** – `PipelineRunner` combines DAG planning, conditional gating, and per-stage retries backed by `RetryHandler`.
- **Git workflow automation** – `BranchManager` and `PRCreator` isolate work on dedicated branches and open PRs via GitHub CLI.
- **State & context management** – `StateManager` persists run history while `ContextReducer` trims prompts using token-aware summaries and saved artifacts.
- **Observability** – Ink-powered live UI, interactive history browser, and analytics reports generated from stored run data.
- **Notifications** – `NotificationManager` sends desktop and Slack notifications with event filtering and fail-safe delivery.
- **YAML-first configuration** – Schema-validated pipelines with structured agent outputs and customizable commit messages.

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
# Initialize with example pipelines and agents
agent-pipeline init
```

This scaffolds example pipelines (`test-pipeline`, `parallel-example`, etc.), sample agent definitions, and the directory structure (`.agent-pipeline/`, `.claude/agents/`).

### 2. Run Your First Pipeline

```bash
# Run with interactive live UI (default)
agent-pipeline run example-pipeline
```

**What you'll see:** live terminal UI with status badges, real-time agent output streaming, atomic commits per stage, and a pipeline summary with timing and results.

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
# Parallel execution with DAG dependencies
agent-pipeline run parallel-example

# Conditional logic based on previous stage outputs
agent-pipeline run conditional-example

# Git workflow with branch isolation and PR creation
agent-pipeline run git-workflow-example
```

---

### Manual Setup (Alternative)

#### 1. Create a Pipeline Configuration

```yaml
# .agent-pipeline/pipelines/my-pipeline.yml
name: my-pipeline
trigger: manual

settings:
  autoCommit: true
  commitPrefix: "[pipeline:{{stage}}]"
  failureStrategy: continue
  preserveWorkingTree: false

agents:
  - name: code-review
    agent: .claude/agents/code-reviewer.md
    timeout: 120

  - name: code-reducer
    agent: .claude/agents/code-reducer.md
```

#### 2. Create Agent Definitions

```markdown
<!-- .claude/agents/code-reviewer.md -->
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
└── .claude/agents/                  # Example agent prompts
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
