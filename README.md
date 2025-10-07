# Agent Pipeline

> Intelligent agent orchestration with parallel execution, conditional logic, and state management for Claude Code

An agent CI/CD pipeline for intelligent, multi-stage workflows with full visibility. Execute Claude agents in parallel with DAG dependencies, conditional logic, and retry mechanisms, all orchestrated via git hooks and a beautiful terminal interface.

## Features

**Core Functionality:**
- **Parallel Execution** - Run multiple Claude agents concurrently with DAG dependencies
- **Conditional Logic** - Execute stages based on previous results with template expressions
- **Retry Mechanisms** - Automatic retry with exponential/linear/fixed backoff
- **State Management** - Each agent's output is persisted and passed to dependent stages
- **Git Integration** - Each agent stage creates an atomic commit for easy rollback
- **YAML Configuration** - Define pipelines in simple, readable YAML files
- **Error Handling** - Configurable failure strategies (stop/warn/continue)
- **Pipeline History** - All runs are saved with full state tracking

**Phase 2 Enhancements:**
- **Git Hook Management** - Auto-install/uninstall post-commit hooks
- **Rollback System** - Revert entire pipelines or specific stages with confirmation
- **Dry-Run Mode** - Test pipelines without creating commits
- **Smart Error Reporting** - Context-aware error messages with suggestions
- **Pipeline Validation** - Pre-flight checks before running (includes DAG cycle detection)
- **Enhanced Status** - Detailed pipeline run information with commit history
- **Project Scaffolding** - Initialize new projects with examples

**Phase 3 Priority 1 - Observability:**
- **Live Terminal UI** - Beautiful interactive UI with real-time pipeline progress
- **History Browser** - Interactive TUI to browse and analyze past runs
- **Analytics & Metrics** - Pipeline performance analysis with success rates and trends
- **Output Streaming** - Real-time agent output during execution

**Phase 3 Priority 2 - Advanced Execution:**
- **Parallel Execution** - Run independent stages concurrently for faster pipelines
- **DAG Dependencies** - Define stage dependencies with automatic execution ordering
- **Conditional Stages** - Skip stages based on previous outputs using expressions
- **Retry Logic** - Automatic retry with configurable backoff strategies
- **Execution Modes** - Switch between parallel and sequential execution

## Installation

```bash
npm install
npm run build
```

## Quick Start

### Option 1: Initialize New Project (Recommended)

```bash
# Initialize with example pipeline and agents
node dist/index.js init

# Run the example pipeline
node dist/index.js run example-pipeline
```

### Option 2: Manual Setup

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

### Basic Commands

```bash
# Initialize a new project
node dist/index.js init

# List available pipelines
node dist/index.js list

# Run a specific pipeline (interactive UI by default)
node dist/index.js run <pipeline-name>

# Run in dry-run mode (no commits)
node dist/index.js run <pipeline-name> --dry-run

# Run with console output only (disable live UI)
node dist/index.js run <pipeline-name> --no-interactive

# Check status of last run
node dist/index.js status

# Browse pipeline history (interactive)
node dist/index.js history

# View analytics
node dist/index.js analytics
node dist/index.js analytics --pipeline <name> --days 30
```

### Git Hook Management

```bash
# Install post-commit hook
node dist/index.js install <pipeline-name>

# Remove post-commit hook
node dist/index.js uninstall
```

### Rollback

```bash
# Rollback entire pipeline
node dist/index.js rollback

# Rollback specific number of stages
node dist/index.js rollback --stages 2

# Rollback specific run by ID
node dist/index.js rollback --run-id <uuid>
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
  executionMode: parallel  # parallel (default) or sequential

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

  # This stage depends on code-review completing first
  - name: auto-fix
    agent: .claude/agents/fixer.md
    dependsOn:
      - code-review
    condition: "{{ stages.code-review.outputs.issues_found > 0 }}"
    retry:
      maxAttempts: 3
      backoff: exponential
      initialDelay: 1000
      maxDelay: 30000
```

### Configuration Options

#### Pipeline Settings

- **name**: Unique pipeline identifier
- **trigger**: When to run (`manual` or `post-commit`)
- **settings.autoCommit**: Auto-commit agent changes (default: true)
- **settings.commitPrefix**: Commit message prefix template
- **settings.failureStrategy**: How to handle failures (`stop`, `continue`, `warn`)
- **settings.preserveWorkingTree**: Stash/restore uncommitted changes
- **settings.executionMode**: Execution strategy (`parallel` or `sequential`, default: `parallel`)

#### Agent Stage Options

**Basic Configuration:**
- **name**: Stage identifier
- **agent**: Path to agent definition file
- **enabled**: Skip stage if false (default: true)
- **timeout**: Max execution time in seconds
- **onFail**: Stage-specific failure strategy (`stop`, `continue`, `warn`)
- **autoCommit**: Stage-specific auto-commit override
- **commitMessage**: Custom commit message template
- **inputs**: Key-value pairs passed to agent context
- **outputs**: Keys to extract from agent response

**Advanced Execution:**
- **dependsOn**: Array of stage names this stage depends on (runs after all complete)
- **condition**: Template expression to evaluate before running (e.g., `"{{ stages.review.outputs.issues > 0 }}"`)
- **retry**: Retry configuration object (see below)

#### Retry Configuration

```yaml
retry:
  maxAttempts: 3        # Total attempts (including first try)
  backoff: exponential  # exponential, linear, or fixed
  initialDelay: 1000    # Initial delay in ms (default: 1000)
  maxDelay: 30000       # Max delay cap in ms (default: 30000)
```

**Backoff Strategies:**
- `exponential`: Delay doubles each retry (1s → 2s → 4s → 8s)
- `linear`: Delay increases linearly (1s → 2s → 3s → 4s)
- `fixed`: Same delay every time (1s → 1s → 1s)

#### Conditional Expressions

Conditions use template syntax with access to previous stage outputs:

```yaml
# Simple comparison
condition: "{{ stages.review.outputs.issues > 0 }}"

# Equality check
condition: "{{ stages.review.outputs.severity == 'critical' }}"

# Logical operators
condition: "{{ stages.review.outputs.issues > 0 && stages.scan.outputs.vulnerabilities == 0 }}"

# Available operators: ==, !=, >, <, >=, <=, &&, ||
```

## Architecture

### Project Structure

```
agent-pipeline/
├── src/
│   ├── core/
│   │   ├── pipeline-runner.ts      # Main orchestrator with DAG execution
│   │   ├── stage-executor.ts       # Individual stage runner with retry
│   │   ├── state-manager.ts        # Pipeline state persistence
│   │   ├── git-manager.ts          # Git operations wrapper
│   │   ├── dag-planner.ts          # DAG analysis and execution planning
│   │   ├── parallel-executor.ts    # Parallel stage execution
│   │   ├── condition-evaluator.ts  # Template expression evaluation
│   │   ├── retry-handler.ts        # Retry logic with backoff
│   │   └── types/
│   │       └── execution-graph.ts  # DAG type definitions
│   ├── config/
│   │   ├── pipeline-loader.ts      # YAML parser
│   │   └── schema.ts               # TypeScript interfaces
│   ├── ui/
│   │   ├── pipeline-ui.tsx         # Live terminal UI (Ink)
│   │   ├── components/
│   │   │   ├── stage-row.tsx       # Stage display component
│   │   │   └── status-badge.tsx    # Status indicator
│   │   └── history-browser.tsx     # Interactive history browser
│   ├── analytics/
│   │   ├── pipeline-analytics.ts   # Metrics calculation
│   │   └── types.ts                # Analytics types
│   ├── utils/
│   │   ├── logger.ts               # Logging utilities
│   │   └── errors.ts               # Custom error types
│   └── index.ts                    # CLI entry point
├── .agent-pipeline/
│   ├── pipelines/                  # Pipeline YAML configs
│   │   ├── test-pipeline.yml
│   │   ├── parallel-example.yml
│   │   └── conditional-example.yml
│   └── state/runs/                 # Pipeline execution history
└── .claude/agents/                 # Agent definitions
```

### How It Works

1. **Pipeline Configuration** is loaded from YAML
2. **DAG Planner** analyzes dependencies and creates execution plan
   - Validates no circular dependencies
   - Performs topological sort
   - Groups stages by execution level
3. **Pipeline Runner** initializes state and executes each group
4. **For each execution group:**
   - Evaluate conditions for all stages
   - Execute stages in parallel (or sequentially if configured)
   - Handle retries with backoff if configured
   - Stage Executor loads agent definition and runs it
   - Changes are auto-committed (if enabled)
   - State is persisted to disk
   - Outputs are extracted for dependent stages
5. **Pipeline completes** with full history and analytics

**Execution Flow Example:**
```
Group 0 (parallel):  [code-review] [security-scan] [performance-check]
                            ↓            ↓                  ↓
Group 1 (sequential): [summary-report] ← waits for all above
```

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

### Parallel Execution Pipeline

Run multiple review stages in parallel for faster execution:

```yaml
name: parallel-example
trigger: manual

settings:
  executionMode: parallel

agents:
  # These three stages run in parallel
  - name: code-review
    agent: .claude/agents/code-reviewer.md
    outputs: [issues_found, severity]

  - name: security-scan
    agent: .claude/agents/security-auditor.md
    outputs: [vulnerabilities]
    retry:
      maxAttempts: 3
      backoff: exponential

  - name: performance-check
    agent: .claude/agents/quality-checker.md
    outputs: [performance_score]

  # This stage waits for all three to complete
  - name: summary-report
    agent: .claude/agents/summary.md
    dependsOn:
      - code-review
      - security-scan
      - performance-check
```

### Conditional Execution Pipeline

Execute stages based on previous results:

```yaml
name: conditional-example
trigger: manual

agents:
  - name: code-review
    agent: .claude/agents/code-reviewer.md
    outputs: [issues_found, severity]

  # Run auto-fixer only if issues were found
  - name: auto-fix
    agent: .claude/agents/fixer.md
    dependsOn: [code-review]
    condition: "{{ stages.code-review.outputs.issues_found > 0 }}"
    retry:
      maxAttempts: 2
      backoff: fixed

  # Celebrate if no issues found
  - name: celebrate
    agent: .claude/agents/celebration.md
    dependsOn: [code-review]
    condition: "{{ stages.code-review.outputs.issues_found == 0 }}"

  # Run security in parallel with above
  - name: security-scan
    agent: .claude/agents/security-auditor.md
    outputs: [vulnerabilities]

  # Only run if critical severity OR vulnerabilities found
  - name: emergency-fix
    agent: .claude/agents/emergency.md
    dependsOn: [code-review, security-scan]
    condition: "{{ stages.code-review.outputs.severity == 'critical' || stages.security-scan.outputs.vulnerabilities > 0 }}"
    onFail: stop
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

## Development Status

### Phase 1: Core Pipeline Runner ✅ COMPLETE

- ✅ YAML pipeline configuration
- ✅ Sequential agent execution with Claude Agent SDK
- ✅ Git integration with atomic commits
- ✅ State management between stages
- ✅ Terminal UI with real-time updates
- ✅ Error handling (block/warn/continue)
- ✅ Example pipelines and agents

### Phase 2: Hardening ✅ COMPLETE

**Priority 1 - Critical Features:**
- ✅ Git hook installer/uninstaller
- ✅ Rollback command with confirmation
- ✅ Dry-run mode
- ✅ Enhanced error reporting with suggestions

**Priority 2 - Developer Experience:**
- ✅ Pipeline validation before running
- ✅ Improved status command with detailed output
- ✅ Init command to scaffold new projects

### Phase 3: Advanced Features (In Progress)

**Priority 1: Observability ✅ COMPLETE**
- ✅ Live terminal UI with Ink (interactive mode by default)
- ✅ Real-time output streaming during execution
- ✅ History browser with interactive navigation
- ✅ Analytics & metrics (pipeline and stage-level)
- ✅ Failure analysis and trend visualization

**Priority 2: Advanced Execution ✅ COMPLETE**
- ✅ Parallel stage execution with Promise.allSettled
- ✅ DAG dependency analysis with cycle detection
- ✅ Topological sort for execution ordering
- ✅ Conditional stage execution with template expressions
- ✅ Retry mechanisms with exponential/linear/fixed backoff
- ✅ Execution plan visualization in console output
- ✅ Support for both parallel and sequential modes

**Priority 3: Integrations (Planned)**
- Slack/Discord notifications
- HTML report generation
- GitHub Actions integration
- Webhook support

## Contributing

Phase 3 Priority 2 (Advanced Execution) is now complete! The pipeline now supports parallel execution, DAG dependencies, conditional logic, and retry mechanisms. Contributions are welcome, especially for Priority 3 (Integrations) features.

## License

MIT

## Built With

- [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) - Agent execution
- [simple-git](https://www.npmjs.com/package/simple-git) - Git operations
- [yaml](https://www.npmjs.com/package/yaml) - YAML parsing
- TypeScript 
