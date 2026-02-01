# Agent Pipeline

> Intelligent multi-runtime agent orchestration with DAG-planned parallelism, conditional logic, automated git hygiene, and multi-channel notifications. Supports Claude Code, Codex, and any OpenAI-compatible API.

<p align="center">
  <video src="https://github.com/user-attachments/assets/eef9bda8-6184-45db-af6e-77307695f02e" width="720" autoplay loop muted playsinline></video>
  <em>Running the front-end-parallel-example pipeline (9x speed)</em>
  <br>
  <strong><a href="https://fre-studios.github.io/Agent-Pipeline/examples/front-end-exploration/index.html">See what the agents built →</a></strong>
</p>

## Key Use Cases 

- Offload common agentic tasks that consume time and context from the main agent loop.
- Quickly explore new and divergent design concepts.

## Agent Pipeline Ergonomics

- Everything is a file in the filesystem
- Agents are just `.md` files located in the `.agent-pipeline/agents/` directory.
- Agents use the `handover.md` file for handoff to the next agent via `.agent-pipeline/instructions/handover.md`.
- When looping is enabled, a dedicated loop agent runs after all stages to decide whether to queue the next iteration using `.agent-pipeline/instructions/loop.md`.

```yaml
name: my-pipeline 
trigger: manual

agents:
  - name: first-agent
    agent: .agent-pipeline/agents/first-agent.md

  - name: second-agent
    agent: .agent-pipeline/agents/second-agent.md
    dependsOn: 
      - first-agent
```

Capable models (Claude Opus/Sonnet, GPT-5.2, DeepSeek V3.2, etc.) can understand directions very well: you can tell any agent (in their respective `.md` file) to "pass X data to next agent" or "create new pipeline for next plan phase if plan status is not complete" and the agent and pipeline will perform as you expect.

> **Note:** Looping must be enabled in the pipeline YAML for loops to run.

## Quick Start

```bash
npm install -g agent-pipeline
```

Then `cd` into an empty or existing project directory and run:

```bash
agent-pipeline init
```

Finally, run a pipeline:

```bash
# For new/empty projects
agent-pipeline run front-end-parallel-example

# For existing projects with code changes
agent-pipeline run post-commit-example
```

## Prerequisites

- **Node.js** (v18 or higher)
- **Git** (configured with user name and email)
- **At least one agent runtime:**
  - **Claude Code** (`claude` CLI) – default runtime with full tool suite
  - **Codex** (`codex` CLI) – OpenAI's Codex with filesystem tools
  - **OpenAI-compatible API key** – for any Chat Completions endpoint (OpenAI, DeepSeek, Together, Groq, Ollama, etc.)
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

## Usage Guide

### 1. Initialize New Project

```bash
agent-pipeline init
```

This scaffolds three example pipelines (`front-end-parallel-example`, `post-commit-example`, and `loop-example`), required agent definitions, and the directory structure (`.agent-pipeline/`, `.agent-pipeline/agents/`). Agents from installed Claude Code plugins are automatically discovered, with support for additional runtime agent discovery coming soon.

### 2. Run Your First Pipeline

```bash
# Run the parallel design exploration (works on any project)
agent-pipeline run front-end-parallel-example

# For existing projects, try the post-commit workflow
agent-pipeline run post-commit-example

# Try the looping Socratic exploration (demonstrates iterative agents)
agent-pipeline run loop-example
```

**What you'll see:** live terminal UI with status badges, real-time agent output streaming, atomic commits per stage, and a pipeline summary with timing and results.
Pipelines with git configured execute in isolated git worktrees by default, so your working directory stays untouched.

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

agents:
  - name: code-review
    agent: .agent-pipeline/agents/code-reviewer.md

  - name: security-review
    agent: .agent-pipeline/agents/security-reviewer.md

  - name: memory-updater
    agent: .agent-pipeline/agents/memory-updater.md
    dependsOn: 
      - code-review
      - security-review
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

## Features

- **Pipeline orchestration** – `PipelineRunner` combines DAG planning, conditional gating, and per-stage retries backed by `RetryHandler`.
- **Git workflow automation** – Worktrees isolate runs by default, while `BranchManager` and `PRCreator` manage dedicated branches and PRs.
- **State & context management** – `StateManager` persists run history while `HandoverManager` enables filesystem-based communication between stages.
- **Runtime flexibility** – Pluggable agent runtimes (Claude Code Headless, Claude SDK, Codex Headless, OpenAI-compatible) registered via `AgentRuntimeRegistry`.
- **Model flexibility** – Mix models across runtimes and providers per stage for cost optimization (up to 90% savings on simple tasks).
- **Cost controls** – Set `maxTurns` and `maxThinkingTokens` to prevent runaway agents and enable deep reasoning when needed.
- **Observability** – Ink-powered live UI, interactive history browser, and analytics reports generated from stored run data.
- **Notifications** – `NotificationManager` sends desktop and Slack notifications with event filtering and fail-safe delivery.
- **Permission control** – Defaults to `acceptEdits` mode for automated workflows, respecting `.claude/settings.json` allow/deny rules.
- **YAML-first configuration** – Schema-validated pipelines with filesystem-based stage handover and customizable commit messages.

## Architecture Overview

Key components:

- `src/core/pipeline-runner.ts` – Orchestrates initialization, execution groups, and finalization.
- `src/core/group-execution-orchestrator.ts` – Applies conditional logic, executes groups (parallel or sequential), and triggers context reduction.
- `src/core/stage-executor.ts` – Runs individual agents with retries, token estimation, and git commits.
- `src/core/state-manager.ts` – Persists pipeline state under `.agent-pipeline/state/runs/`.
- `src/core/worktree-manager.ts` – Manages git worktrees for default pipeline isolation.
- `src/core/branch-manager.ts` / `src/core/git-manager.ts` – Handle branch isolation and git commands.
- `src/core/handover-manager.ts` – Manages filesystem-based stage communication via handover files.
- `src/core/pr-creator.ts` – Integrates with GitHub CLI for PR automation.
- `src/core/agent-runtime-registry.ts` – Registry for pluggable agent runtimes (Claude Code Headless, Claude SDK, Codex Headless, OpenAI-compatible).
- `src/utils/token-estimator.ts` – Provides `smartCount()` for context window monitoring.
- `src/ui/pipeline-ui.tsx` & `src/cli/commands/history.tsx` – Ink UIs for live runs and history browsing.
- `src/analytics/pipeline-analytics.ts` – Generates aggregated metrics for the `analytics` command.
- `src/notifications/notification-manager.ts` – Dispatches desktop and Slack notifications.
- `src/validators/` – Modular validation for pipeline structure, DAG, agents, and notifications.
- `src/cli/commands/` – Command implementations (`run`, `cleanup`, `hooks`, `agent`, etc.).

```
agent-pipeline/
├── .agent-pipeline/
│   ├── agents/                      # Agent prompt definitions (.md files)
│   ├── pipelines/                   # Pipeline configurations (.yml files)
│   └── state/runs/                  # Persisted run history
├── docs/                            # User and developer documentation
└── src/
    ├── analytics/                   # Metrics and reporting
    ├── cli/commands/                # Command implementations
    ├── config/                      # Schema and loader
    ├── core/                        # Execution engine
    ├── notifications/               # Desktop and Slack notifiers
    ├── ui/                          # Ink terminal components
    ├── utils/                       # Logging, errors, helpers
    ├── validators/                  # Pipeline validation modules
    └── index.ts                     # CLI entry point
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
