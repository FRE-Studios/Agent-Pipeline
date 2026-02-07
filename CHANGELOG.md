# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] - 2026-02-06

### Added

- **Codex Headless runtime** – New agent runtime for OpenAI's Codex CLI with JSON streaming, tool-activity parsing, and stdin-based prompt delivery
- **Standalone loop agent** – Loop agent now runs through the normal group/executor path, gaining running state, handover updates, notifications, and a unique name suffix to avoid collisions
- **Model shorthand** – `model` can now be set directly at the agent stage level
- **Remote branch cleanup** – `cleanup` command lists and deletes remote pipeline branches via `BranchManager`
- **`init` scaffolding** – `init` now creates all template agents alongside example pipelines

### Changed

- **Loop default behavior** – Loop agent now loops by default when looping is enabled in the pipeline config
- **`--quiet` flag** – Renamed `--no-interactive` to `--quiet` for better ergonomics
- **Unified logging** – Renamed handover log to execution log for consistency across the CLI
- **Runtime options scoping** – Runtime options are only forwarded to agents whose runtime matches the pipeline-level runtime
- **Graceful finalizer** – Pipeline finalizer logs a warning instead of throwing when the base branch is already checked out, with manual merge instructions
- **Local-merge error handling** – Checked-out base branch failures no longer fall through to the generic worktree guidance message
- **Merge success message** – Now shown unconditionally when local-merge succeeds, regardless of interactive mode
- **Dependency cleanup** – Updated `@anthropic-ai/claude-agent-sdk` to ^0.2.19 and `zod` to ^4.0.0

### Fixed

- **Git autocommit** – Fixed autocommit being `true` in unexpected conditions
- **PR merge strategy** – Fixed `pull-request` mergeStrategy not applying correctly
- **Git hook trigger** – Improved reliability; better error messages when GUI-triggered commits lack execution variables
- **Loop context UI** – UI now checks `loopContext.enabled` instead of just the existence of `loopContext`
- **Codex YAML front-matter** – Prompts starting with `---` are piped via stdin to avoid Codex treating them as flags
- **`gh` CLI errors** – Errors from `gh` are now properly logged and surfaced to the user
- **Error diagnostics** – `stdout` is included in error output for easier debugging

## [0.1.1] - 2025-01-26

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
