# Agent Pipeline

> Sequential agent execution with state management for Claude Code

An agent CI/CD pipeline for intelligent, multi-stage workflows with full visibility. Execute Claude agents sequentially, with each agent's output becoming the next agent's input, all orchestrated via git hooks and a terminal interface.

## Features

- **Sequential Execution** - Run multiple Claude agents in a defined order
- **State Management** - Each agent's output is persisted and passed to the next stage
- **Git Integration** - Each agent stage creates an atomic commit for easy rollback
- **YAML Configuration** - Define pipelines in simple, readable YAML files
- **Error Handling** - Configurable failure strategies (stop/warn/continue)
- **Pipeline History** - All runs are saved with full state tracking

## Installation

```bash
npm install
npm run build
```

## Quick Start

### 1. Create a Pipeline Configuration

Create a YAML file in `.agent-pipeline/pipelines/`:

```yaml
# .agent-pipeline/pipelines/my-pipeline.yml
name: my-pipeline
trigger: manual

settings:
  autoCommit: true
  commitPrefix: "[pipeline:{{stage}}]"
  failureStrategy: continue

agents:
  - name: code-review
    agent: .claude/agents/code-reviewer.md
    timeout: 120

  - name: doc-updater
    agent: .claude/agents/doc-manager.md
```

### 2. Create Agent Definitions

Create agent prompts in `.claude/agents/`:

```markdown
<!-- .claude/agents/code-reviewer.md -->
# Code Review Agent

You are a code review agent in an automated pipeline.

## Your Task
Review the code changes and provide feedback...
```

### 3. Run the Pipeline

```bash
node dist/index.js run my-pipeline
```

## CLI Commands

```bash
# List available pipelines
node dist/index.js list

# Run a specific pipeline
node dist/index.js run <pipeline-name>

# Check status of last run
node dist/index.js status
```

## Pipeline Configuration

### Full Configuration Example

```yaml
name: commit-review
trigger: post-commit  # or 'manual'

settings:
  autoCommit: true
  commitPrefix: "[pipeline:{{stage}}]"
  failureStrategy: continue  # stop, continue, or warn
  preserveWorkingTree: false

agents:
  - name: code-review
    agent: .claude/agents/code-reviewer.md
    enabled: true
    timeout: 120  # seconds
    onFail: stop  # Override global failure strategy
    autoCommit: true  # Override global autoCommit
    commitMessage: "Custom commit message"

    # Pass custom inputs to the agent
    inputs:
      focus_areas: "security, performance"

    # Extract specific outputs to pass to next agents
    outputs:
      - issues_found
      - severity_level
```

### Configuration Options

#### Pipeline Settings

- **name**: Unique pipeline identifier
- **trigger**: When to run (`manual` or `post-commit`)
- **settings.autoCommit**: Auto-commit agent changes (default: true)
- **settings.commitPrefix**: Commit message prefix template
- **settings.failureStrategy**: How to handle failures (`stop`, `continue`, `warn`)
- **settings.preserveWorkingTree**: Stash/restore uncommitted changes

#### Agent Stage Options

- **name**: Stage identifier
- **agent**: Path to agent definition file
- **enabled**: Skip stage if false
- **timeout**: Max execution time in seconds
- **onFail**: Stage-specific failure strategy
- **autoCommit**: Stage-specific auto-commit override
- **commitMessage**: Custom commit message template
- **inputs**: Key-value pairs passed to agent context
- **outputs**: Keys to extract from agent response

## Architecture

### Project Structure

```
agent-pipeline/
├── src/
│   ├── core/
│   │   ├── pipeline-runner.ts      # Main orchestrator
│   │   ├── stage-executor.ts       # Individual stage runner
│   │   ├── state-manager.ts        # Pipeline state persistence
│   │   └── git-manager.ts          # Git operations wrapper
│   ├── config/
│   │   ├── pipeline-loader.ts      # YAML parser
│   │   └── schema.ts               # TypeScript interfaces
│   ├── utils/
│   │   ├── logger.ts               # Logging utilities
│   │   └── errors.ts               # Custom error types
│   └── index.ts                    # CLI entry point
├── .agent-pipeline/
│   ├── pipelines/                  # Pipeline YAML configs
│   └── state/runs/                 # Pipeline execution history
└── .claude/agents/                 # Agent definitions
```

### How It Works

1. **Pipeline Configuration** is loaded from YAML
2. **Pipeline Runner** initializes state and git manager
3. **For each agent stage:**
   - Stage Executor loads agent definition
   - Agent runs with pipeline context
   - Changes are auto-committed (if enabled)
   - State is persisted to disk
   - Outputs are extracted for next stage
4. **Pipeline completes** with full history

### Git History Example

After running a pipeline, your git history looks like:

```
* a3f9d2c [pipeline:memory-manager] Update CLAUDE.md with findings
* 8c2e4a1 [pipeline:doc-updater] Add documentation updates
* 5b7f3d9 [pipeline:quality-check] Refactor for better readability
* 2e1c8f4 [pipeline:security-audit] Fix security issues
* 9d4a2b6 [pipeline:code-review] Apply style improvements
* 7a3b5c8 feat: add user authentication
```

Each stage creates an atomic commit, making it easy to:
- Review changes stage-by-stage
- Rollback to specific stages
- Bisect to find which stage introduced an issue

## Example Pipelines

### Test Pipeline

A simple 2-stage pipeline for testing:

```yaml
name: test-pipeline
trigger: manual

agents:
  - name: hello-world
    agent: .claude/agents/hello-world.md

  - name: file-creator
    agent: .claude/agents/file-creator.md
```

### Commit Review Pipeline

A comprehensive code review pipeline:

```yaml
name: commit-review
trigger: post-commit

agents:
  - name: code-review
    agent: .claude/agents/code-reviewer.md
    outputs: [issues_found, severity_level]

  - name: security-audit
    agent: .claude/agents/security-auditor.md
    onFail: warn

  - name: quality-check
    agent: .claude/agents/quality-checker.md

  - name: doc-updater
    agent: .claude/agents/doc-manager.md

  - name: memory-manager
    agent: .claude/agents/memory-updater.md
```

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

## Phase 1 Status

*** Completed:**
- YAML pipeline configuration
- Sequential agent execution with Claude Agent SDK
- Git hook integration capability
- State management between stages
- Terminal UI with real-time updates
- Error handling (block/warn/continue)
- Example pipelines and agents

*** Future Phases:**
- Git hook auto-installation
- Parallel agent execution
- Pipeline templates library
- Web dashboard for history
- Slack/Discord notifications
- Pipeline DAG visualization
- Conditional branching

## Contributing

This is a Phase 1 MVP implementation. Contributions are welcome!

## License

MIT

## Built With

- [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) - Agent execution
- [simple-git](https://www.npmjs.com/package/simple-git) - Git operations
- [yaml](https://www.npmjs.com/package/yaml) - YAML parsing
- TypeScript 
