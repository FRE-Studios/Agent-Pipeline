# Example Pipelines

Agent Pipeline ships with three ready-to-run examples. Run `agent-pipeline init` to create them all. These examples are configured with sensible defaults to minimize token usage (uncomment additional agents to unlock full capabilities).

## Front-End Parallel Example (`front-end-parallel-example.yml`)

**Purpose**: Rapid design exploration demonstrating DAG-based parallelism. Design agents interpret the same requirements through different aesthetic lenses, producing diverse prototypes in parallel.

**Trigger**: `manual`

**Default Agents** (5 active):
1. `product_owner` - Transforms user input into structured requirements
2. `brutalist_purist` - Brutalist design approach
3. `indie_game_dev` - Game-inspired visual design
4. `cyberpunk_hacker` - Cyberpunk visual language
5. `showcase` - Collects all prototypes into a unified showcase

**Additional Agents** (commented out - uncomment to enable):
- `retro_90s_webmaster` - 90s web aesthetic interpretation
- `luxury_editorial` - High-end editorial style
- `swiss_modernist` - Swiss modernist design system

**Execution Flow**:
- Stage 1: Product owner creates structured requirements
- Stage 2: Design agents run in parallel (DAG-based parallelism)
- Stage 3: Showcase collects and presents all designs

**Features**:
- True parallel execution with DAG dependencies
- Design diversity from the same requirements
- Worktree isolation (your working directory stays untouched)
- `autoCommit: false` (exploration mode)

Run it with:

```bash
agent-pipeline run front-end-parallel-example
```

## Post-Commit Example (`post-commit-example.yml`)

**Purpose**: Automated code review and quality improvements for existing projects after commits.

**Trigger**: `post-commit`

**Default Agent** (1 active):
- `doc-updater` - Maintains memory files (CLAUDE.md, README, CHANGELOG)

**Full Flow** (commented out - uncomment for comprehensive review):
1. `code-reviewer` - Expert code reviewer with confidence-based filtering
2. `quality-checker` - Code simplification specialist
3. `doc-updater` - Documentation maintainer

When the full flow is enabled, agents run sequentially: `code-review` → `quality-check` → `doc-updater`

**Features**:
- `failureStrategy: continue` (keeps going if a stage fails)
- `onFail: warn` on quality-check (non-blocking improvements)
- Automated commits with `[pipeline:{{stage}}]` prefix

Run it with:

```bash
# On-demand execution
agent-pipeline run post-commit-example

# Or install as git hook for automatic execution
agent-pipeline hooks install post-commit-example
```

Note: enable `git.branchStrategy` in the pipeline config before installing the hook.
Tip: for hook-triggered pipelines, prefer `unique-per-run` (or `unique-and-delete`) and disable `autoCommit` if you only need reports.

## Loop Example (`loop-example.yml`)

**Purpose**: Demonstrates pipeline looping with a Socratic philosophical exploration agent that iteratively deepens inquiry.

**Trigger**: `manual`

**Default Agent** (1 active):
- `socratic-explorer` - Reads a question, answers thoughtfully, poses a deeper follow-up question

**Execution Flow**:
- The `socratic-explorer` agent reads `question.md` (creates it if missing with an opening question)
- Answers the current question in 2-3 sentences
- Poses a deeper follow-up question
- A dedicated loop agent then runs to decide whether to queue the next iteration
- Loop repeats up to `maxIterations` (default: 5)

**Features**:
- `looping.enabled: true` - automatic iteration
- `looping.maxIterations: 5` - safety limit on iterations
- Filesystem-based handover via `question.md`
- Each iteration builds on previous answers

Run it with:

```bash
agent-pipeline run loop-example
```

## Available Agents

All examples use focused micro-agents from `.agent-pipeline/agents/`:

**Design Agents** (front-end-parallel-example):
- `product_owner` - Requirements transformation
- `brutalist_purist`, `indie_game_dev`, `cyberpunk_hacker` - Active design agents
- `retro_90s_webmaster`, `luxury_editorial`, `swiss_modernist` - Additional design agents (commented out)
- `showcase` - Prototype collection

**Code Quality Agents** (post-commit-example):
- `doc-updater` - Maintains documentation in sync with code changes (active by default)
- `code-reviewer` - Reviews code for bugs, security, and project conventions (commented out)
- `quality-checker` - Analyzes complexity, code smells, and simplification opportunities (commented out)

**Loop Agents** (loop-example):
- `socratic-explorer` - Philosophical inquiry agent that deepens questions iteratively
