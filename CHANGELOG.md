# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-01-26

### Added

- Initial public release
- DAG-based pipeline orchestration with parallel execution
- Git workflow automation (worktrees, atomic commits, PR creation)
- Two agent runtimes: Claude SDK and Claude Code Headless
- Multi-channel notifications (desktop, Slack)
- Interactive terminal UI with Ink/React
- Pipeline history browser and analytics
- Conditional stage execution with `runIf`/`skipIf`
- Retry handling with configurable backoff strategies
- Filesystem-based stage handover via `handover.md`
- Loop support for iterative agent workflows
- Example pipelines: `front-end-parallel-example`, `post-commit-example`, `loop-example`
- CLI commands: `run`, `init`, `list`, `history`, `analytics`, `hooks`, `cleanup`, `rollback`
- Pipeline management: `create`, `clone`, `delete`, `edit`, `validate`, `export`, `import`
- Agent management: `agent list`, `agent info`, `agent pull`
