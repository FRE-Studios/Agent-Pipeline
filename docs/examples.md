# Example Pipelines

Agent Pipeline ships with ready-to-run examples. Use `agent-pipeline init [example-name]` to create specific examples, or `agent-pipeline init --all` to create all examples.

## Test Pipeline (`test-pipeline.yml`)

**Created by**: `agent-pipeline init` (default)

**Purpose**: Interactive game demonstrating micro-agent collaboration and DAG-based parallelism.

**Trigger**: `manual`

**Agents** (8 micro-agents):
1. `storyteller` - Creates 5 statements (4 truths, 1 lie)
2. `logician` - Analyzes statements using logical reasoning
3. `empath` - Detects emotional patterns
4. `statistician` - Uses statistical analysis
5. `linguist` - Examines language patterns
6. `skeptic` - Questions everything systematically
7. `synthesizer` - Combines all detective reasoning
8. `judge` - Reveals truth and scores detectives

**Execution Flow**:
- Stage 1: Storyteller creates statements
- Stage 2: Five detectives analyze in parallel (DAG-based parallelism)
- Stage 3: Synthesizer combines detective insights
- Stage 4: Judge reveals winner

Run it with:

```bash
agent-pipeline run test-pipeline
```

## Post-Commit Example (`post-commit-example.yml`)

**Created by**: `agent-pipeline init post-commit` or `agent-pipeline init --all`

**Purpose**: Automated code review and quality improvements after commits.

**Trigger**: `post-commit`

**Agents** (3 micro-agents):
1. `code-review` - Reviews code for issues, style, and best practices
2. `quality-check` - Analyzes complexity, code smells, refactoring opportunities
3. `doc-updater` - Updates README, inline docs, and changelogs

**Execution Flow**:
- Sequential execution: `code-review` → `quality-check` → `doc-updater`
- Each agent builds on previous results for comprehensive analysis

**Features**:
- Sequential execution ensuring each stage builds on previous findings
- Context reduction for managing token usage across stages
- Automated commits with `[pipeline:{{stage}}]` prefix
- Demonstrates micro-agent composition pattern

## Pre-Commit Example (`pre-commit-example.yml`)

**Created by**: `agent-pipeline init pre-commit` or `agent-pipeline init --all`

**Purpose**: Fast validation checks before allowing commits (fail-fast).

**Trigger**: `pre-commit`

**Agents** (3 micro-agents):
1. `lint-check` - Runs code quality validation using quality-checker
2. `security-scan` - Scans for vulnerabilities using security-auditor
3. `validation-summary` - Generates pass/fail summary

**Features**:
- Parallel execution for speed
- Fail-fast behavior (`onFail: stop`)
- Preserves working tree (`autoCommit: false`, `preserveWorkingTree: true`)
- Summary only generated if all checks pass

## Pre-Push Example (`pre-push-example.yml`)

**Created by**: `agent-pipeline init pre-push` or `agent-pipeline init --all`

**Purpose**: Comprehensive validation before pushing to remote (with conditional approval).

**Trigger**: `pre-push`

**Agents** (4 micro-agents):
1. `security-audit` - Deep security scan using security-auditor
2. `code-quality` - Code quality analysis using quality-checker
3. `dependency-check` - Audits dependencies using dependency-auditor
4. `push-approval` - Conditional approval (only runs if no vulnerabilities)

**Features**:
- Parallel execution of 3 comprehensive checks
- Conditional logic: `push-approval` only runs if `vulnerabilities == 0`
- Fail-fast on critical issues
- Demonstrates template expressions for conditions

## Post-Merge Example (`post-merge-example.yml`)

**Created by**: `agent-pipeline init post-merge` or `agent-pipeline init --all`

**Purpose**: Automated cleanup and maintenance after merging branches (with PR creation).

**Trigger**: `post-merge`

**Agents** (4 micro-agents):
1. `doc-sync` - Updates documentation using doc-updater
2. `dependency-audit` - Checks for outdated/vulnerable dependencies
3. `code-consolidation` - Removes duplicate code using code-reducer
4. `summary-report` - Generates cleanup summary using cleanup-reporter

**Features**:
- Parallel execution of 3 cleanup tasks
- Automated PR creation with custom title and labels
- Desktop notifications on completion/failure
- Git workflow with branch isolation
- Final summary stage aggregates all cleanup results

Install it as a git hook:

```bash
agent-pipeline install post-merge-example
```

## Available Agents

All examples use focused micro-agents from `.agent-pipeline/agents/`:

**Game Agents** (test-pipeline):
- `storyteller`, `detective-logician`, `detective-empath`, `detective-statistician`, `detective-linguist`, `detective-skeptic`, `synthesizer`, `judge`

**Code Quality Agents**:
- `code-reviewer` - Reviews code for issues, style, best practices
- `quality-checker` - Analyzes complexity, code smells, refactoring
- `security-auditor` - Scans for vulnerabilities and exposed secrets
- `code-reducer` - Removes duplication and simplifies code

**Documentation Agents**:
- `doc-updater` - Maintains README, inline docs, changelogs
- `summary` - Generates pipeline summaries
- `cleanup-reporter` - Reports cleanup activities

**Infrastructure Agents**:
- `dependency-auditor` - Audits dependencies for security and updates
- `context-reducer` - Intelligently reduces context for large pipelines

