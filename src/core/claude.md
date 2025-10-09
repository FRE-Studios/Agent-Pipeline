# src/core/

Core pipeline execution engine including orchestration, git operations, and stage execution logic.

## Files

- **pipeline-runner.ts** - Main orchestrator coordinating entire pipeline execution lifecycle
- **dag-planner.ts** - DAG dependency analysis and topological sort for execution planning
- **parallel-executor.ts** - Parallel and sequential stage execution with Promise.allSettled
- **stage-executor.ts** - Individual agent stage execution with Claude SDK integration
- **condition-evaluator.ts** - Template expression parser and evaluator for conditional stages
- **retry-handler.ts** - Retry logic with exponential/linear/fixed backoff strategies
- **state-manager.ts** - Pipeline state persistence to `.agent-pipeline/state/runs/`
- **git-manager.ts** - Git operations wrapper around simple-git
- **branch-manager.ts** - Git branch workflow management and isolation
- **pr-creator.ts** - GitHub PR creation via `gh` CLI
