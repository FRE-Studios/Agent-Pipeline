# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

See @README.md for comprehensive feature documentation and usage examples. Deep dives now live under:
- `docs/configuration.md` – pipeline settings, git workflow, notifications
- `docs/examples.md` – shipped pipeline templates
- `docs/cli.md` – command reference

## Tech Stack
- **Language**: TypeScript (ES2022, ESNext modules)
- **UI Framework**: Ink (React for terminal) + React 18
- **Platforms**: Node.js v18+, cross-platform (macOS, Windows, Linux)
- **Key Dependencies**: Claude Agent SDK, simple-git, YAML parser, node-notifier

## Architecture

### Core Execution Flow

The pipeline executes in this order:

1. **Pipeline Loader** (`src/config/pipeline-loader.ts`) - Parses YAML configurations
2. **Pipeline Validator** (`src/validators/pipeline-validator.ts`) - Pre-flight checks, DAG cycle detection
3. **DAG Planner** (`src/core/dag-planner.ts`) - Analyzes dependencies, creates execution graph with topological sort
4. **Pipeline Runner** (`src/core/pipeline-runner.ts`) - Coordinates the run lifecycle via:
   - **Pipeline Initializer** (`src/core/pipeline-initializer.ts`) – prepares git state, notifications, and execution context
   - **Group Execution Orchestrator** (`src/core/group-execution-orchestrator.ts`) – evaluates conditions, executes stage groups (parallel or sequential), triggers context reduction
   - **Pipeline Finalizer** (`src/core/pipeline-finalizer.ts`) – restores branches, summarizes results, optionally creates PRs
5. **Parallel Executor** (`src/core/parallel-executor.ts`) - Runs independent stages concurrently
6. **Stage Executor** (`src/core/stage-executor.ts`) - Executes individual agent stages with retry logic
7. **Output Tool Builder** (`src/core/output-tool-builder.ts`) - Provides MCP `report_outputs` tool for structured data extraction
8. **State Manager** (`src/core/state-manager.ts`) - Persists execution state to `.agent-pipeline/state/runs/`
9. **PR Creator** (`src/core/pr-creator.ts`) - Creates GitHub PRs via `gh` CLI
10. **Notification Manager** (`src/notifications/notification-manager.ts`) - Sends desktop/Slack notifications

### Key Architectural Patterns

**DAG Execution**: Stages declare dependencies via `dependsOn` array. DAG Planner performs topological sort and groups stages by execution level. Each level runs in parallel, levels execute sequentially.

**State Management**: Each pipeline run gets a unique `runId`. State is saved after each stage group completes by `StateManager`. This enables rollback, analytics, and history browsing.

**Git Workflow**: Pipelines run on isolated branches (`pipeline/{name}` or `pipeline/{name}-{runId}`). Each stage creates an atomic commit. Original branch is restored after completion.

**Output Extraction**: Agents report structured data via MCP `report_outputs` tool or text format. Tool-based extraction preserves types (objects, arrays, numbers). Text-based falls back to regex. Single reusable MCP server created via `OutputToolBuilder` with generic `z.record(z.string(), z.unknown())` schema.

**Conditional Execution**: Condition Evaluator (`src/core/condition-evaluator.ts`) parses template expressions like `{{ stages.review.outputs.issues > 0 }}` and evaluates against pipeline state before delegation to the orchestrator.

**Retry Mechanism**: Retry Handler (`src/core/retry-handler.ts`) implements exponential/linear/fixed backoff strategies. `StageExecutor` uses it to wrap agent execution with configurable retry logic.

**UI Architecture**: Dual-mode operation - Interactive mode uses Ink/React terminal UI (`src/ui/pipeline-ui.tsx`) with real-time updates. Non-interactive mode uses simple console logging.

### Critical Files

- `src/config/schema.ts` - TypeScript interfaces for all configuration and state types
- `src/core/pipeline-runner.ts` - Entry point that wires initializer, group orchestrator, and finalizer
- `src/core/pipeline-initializer.ts` - Pre-run setup (git, notifications, parallel executor)
- `src/core/group-execution-orchestrator.ts` - Executes DAG groups, handles skips, saves state
- `src/core/pipeline-finalizer.ts` - Cleans up, restores branches, triggers PR creation/summaries
- `src/core/stage-executor.ts` - Stage execution with MCP tool integration and output extraction
- `src/core/output-tool-builder.ts` - Singleton MCP server for `report_outputs` tool
- `src/core/types/execution-graph.ts` - DAG type definitions
- `src/index.ts` - CLI entry point with command routing

## Build Commands

```bash
# Build TypeScript to dist/
npm run build

# Watch mode for development
npm run dev

# Run CLI in development (after build)
node dist/index.js <command>
# OR after npm link:
agent-pipeline <command>
```

## Test Commands

```bash
# Run all tests with Vitest
npm test -- --run

# Run tests in watch mode
npm run test -- --watch

# Run specific test file
npm test src/__tests__/core/pipeline-runner.test.ts -- --run

# Run tests with coverage
npm test -- --coverage --run
```

**IMPORTANT**: When running test commands via Bash, always include `--run` to avoid entering Vitest's interactive mode accidentally.

### Test Architecture

Tests use Vitest with extensive mocking:
- `src/__tests__/mocks/` - Mock implementations (claude-sdk, git-manager, simple-git, etc.)
- `src/__tests__/fixtures/` - Test data (pipeline configs, states, git states)
- All core modules have 100% test coverage

## Development Notes

**Module System**: Uses ESNext modules. All imports require `.js` extension (e.g., `import './foo.js'` even for `.ts` files).

**Git Manager**: Wraps `simple-git` for all git operations. Never use git directly - always use GitManager or BranchManager.

**Error Handling**: Custom error types in `src/utils/errors.ts`. Use `Logger` from `src/utils/logger.ts` for consistent logging.

**Notification System**: All notifications wrapped in try/catch - must never crash pipeline. Parallel sends to all channels (desktop + Slack).

**PR Creation**: Requires `gh` CLI installed and authenticated. Always check if PR exists before creating. Falls back gracefully if `gh` unavailable.

**State Files**: Located in `.agent-pipeline/state/runs/{runId}.json`. Each run is immutable once completed.

**Branch Strategies**:
- `reusable` - Same branch per pipeline (`pipeline/commit-review`)
- `unique-per-run` - Unique branch per run (`pipeline/commit-review-{runId}`)

**Dry Run Mode**: When enabled, skip all git commits but execute agents. Useful for testing pipelines.

## Development Flow
When planning new features or fixes, if you notice the changes will require a large refactoring, only do a detailed plan of the first phase of required changes and ask user for review before the next phases. 