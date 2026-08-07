# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.5] - 2026-08-06

### Removed

- **Gemini Headless runtime** (breaking) – Google deprecated the Gemini CLI. `runtime.type: gemini-headless` now fails validation with the available-runtime list. Migrate to `antigravity-headless` and remap `runtimeOptions`: `yolo`/`approvalMode`/`debug` are gone; `sandbox` is a boolean rather than a string.

### Added

- **Antigravity Headless runtime** – New agent runtime for Google's Antigravity CLI (`agy`), serving Gemini, Claude, and GPT-OSS models. Delivers the prompt as the `-p` argument, parses the `stream-json` event feed for text, token usage, and live tool activity, and adds `effort`, `agent`, `addDirs`, and `jsonSchema` options.
- **Token tracking for the Google runtime** – `agy` reports input, output, thinking, and cache-read tokens; the Gemini runtime reported none.

### Changed

- **Antigravity auth is Google sign-in** (breaking) – `GEMINI_API_KEY`/`GOOGLE_API_KEY` no longer authenticate the Google runtime. Run `agy` interactively once per machine, including on CI hosts.
- **Antigravity permission handling** – `agy`'s `--mode` sets execution posture, not permission mode, so `acceptEdits` leaves tools auto-denied. Use `bypassPermissions` or `permissions.allow` rules in `agy`'s `settings.json`. A denied tool exits 0 with empty output, which the runtime now raises as an error so stage retries engage.
- **Workspace preamble** – The runtime names the absolute working directory in the prompt; without it `agy` writes to its own scratch directory and stages commit nothing.

## [0.1.4] - 2026-03-19

### Added

- **Pipeline-wide template interpolation** – New `TemplateInterpolator` (`src/utils/template-interpolator.ts`) centralizes `{{variable}}` replacement across `git.commitPrefix`, `git.pullRequest.title`, `git.pullRequest.body`, and stage `inputs` values; previously only `{{stage}}` in `commitPrefix` was substituted. Context builds in layers: pipeline (`{{pipelineName}}`, `{{runId}}`, `{{trigger}}`, `{{timestamp}}`, `{{baseBranch}}`) → run (`{{branch}}`, `{{initialCommit}}`) → stage (`{{stage}}`, `{{stageIndex}}`). Unknown variables are left as-is at runtime.
- **Template-variable validation** – `GitValidator` warns when `commitPrefix`, `pullRequest.title`, or `pullRequest.body` reference unknown variables, naming each offending placeholder. `{{stage}}` and `{{stageIndex}}` are valid only in `commitPrefix`, since PR templates resolve outside stage scope.
- **Branch fallback for template context** – `{{branch}}` resolves to the pipeline branch, then the currently checked-out branch, then `HEAD`, instead of an empty string when a run has no isolation branch. Backed by a new `GitManager.getCurrentBranch()`.
- **Multi-runtime schema example** – `agent-pipeline schema --examples` gained an example mixing runtimes across stages.
- **Template Variables reference** – `docs/configuration.md` documents every variable, its scope, and the caveat that parallel sibling stages can share a `{{stageIndex}}`.

### Changed

- **`schema` command output** – All 10 user-facing config interfaces (`PipelineConfig`, `AgentStageConfig`, `RetryConfig`, `RuntimeConfig`, `GitConfig`, `PRConfig`, `WorktreeConfig`, `ExecutionConfig`, `HandoverConfig`, `LoopingConfig`) carry JSDoc on the interface and on each field, which now flows into the generated JSON and YAML schema templates. Types were reordered so user-facing config reads top-down and internal types sit at the bottom.
- **Schema example annotations** – The minimal template and every shipped example gained inline comments explaining each field.
- **YAML colorization** – `colorizeYaml` now dims inline comments on key-only lines (`inputs:  # ...`), list-item key-values (`- name: planner  # ...`), and plain list items; these were previously colored as string values.

## [0.1.3] - 2026-02-14

### Added

- **Gemini Headless runtime** – New agent runtime for Google's Gemini CLI with stdin-based prompt delivery and tool-activity parsing
- **Pi Agent Headless runtime** – Multi-provider coding agent runtime supporting Anthropic, OpenAI, Google, Mistral, Groq, xAI, and OpenRouter
- **Update checker** – Automatic npm update notifications with 24h cache TTL, semver-aware comparison, and stderr output to avoid stdout contamination
- **`agentInput` in state** – State JSON files now include the agent input for each stage execution
- **Commander-based CLI** – Migrated from custom argument parser to Commander with modular command registration (`register-core`, `register-pipeline`, `register-agent`, `register-hooks`)

### Changed

- **Loop executor extraction** – Refactored pipeline runner to extract loop execution logic into dedicated `loop-executor.ts`, reducing `pipeline-runner.ts` complexity
- **Loop agent outside main flow** – Loop agent now executes directly via `AgentRuntimeRegistry` after all groups complete, no longer part of the DAG execution graph
- **Runtime-agnostic error messages** – API key error suggestions now list common env vars across runtimes (Anthropic, OpenAI, Google) instead of hardcoding `ANTHROPIC_API_KEY`

### Fixed

- **Node.js DEP0190 deprecation warning** – Replaced `shell: true` spawn in `pipeline/edit.ts` with parsed command arguments
- **Gemini CLI prompt delivery** – Fixed prompt piped via stdin instead of unsupported `-p` flag
- **Update checker stability** – Notifications write to stderr, capped at 150ms non-blocking wait, timer unref'd to avoid keeping process alive

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

## [0.1.1] - 2026-01-26

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
