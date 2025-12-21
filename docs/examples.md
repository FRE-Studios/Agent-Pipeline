# Example Pipelines

Agent Pipeline ships with two ready-to-run examples. Run `agent-pipeline init` to create both.

## Front-End Parallel Example (`front-end-parallel-example.yml`)

**Purpose**: Rapid design exploration demonstrating DAG-based parallelism. Six design agents interpret the same requirements through different aesthetic lenses, producing diverse prototypes in parallel.

**Trigger**: `manual`

**Agents** (8 micro-agents):
1. `product_owner` - Transforms user input into structured requirements
2. `retro_90s_webmaster` - 90s web aesthetic interpretation
3. `brutalist_purist` - Brutalist design approach
4. `luxury_editorial` - High-end editorial style
5. `indie_game_dev` - Game-inspired visual design
6. `cyberpunk_hacker` - Cyberpunk visual language
7. `swiss_modernist` - Swiss modernist design system
8. `showcase` - Collects all prototypes into a unified showcase

**Execution Flow**:
- Stage 1: Product owner creates structured requirements
- Stage 2: Six design agents run in parallel (DAG-based parallelism)
- Stage 3: Showcase collects and presents all designs

**Features**:
- True parallel execution with DAG dependencies
- Design diversity from the same requirements
- `preserveWorkingTree: true` - no git changes during exploration
- `autoCommit: false` - exploration mode

Run it with:

```bash
agent-pipeline run front-end-parallel-example
```

## Post-Commit Example (`post-commit-example.yml`)

**Purpose**: Automated code review and quality improvements for existing projects after commits.

**Trigger**: `post-commit`

**Agents** (3 micro-agents):
1. `code-reviewer` - Expert code reviewer with confidence-based filtering (only reports issues ≥80% confidence)
2. `quality-checker` - Code simplification specialist focused on clarity and maintainability
3. `doc-updater` - Maintains memory files (CLAUDE.md, README, CHANGELOG)

**Execution Flow**:
- Sequential: `code-review` → `quality-check` → `doc-updater`
- Each agent builds on previous stage results

**Features**:
- Sequential execution ensuring comprehensive analysis
- `failureStrategy: continue` - keeps going if a stage fails
- `onFail: warn` on quality-check - non-blocking improvements
- Automated commits with `[pipeline:{{stage}}]` prefix

Run it with:

```bash
# On-demand execution
agent-pipeline run post-commit-example

# Or install as git hook for automatic execution
agent-pipeline install post-commit-example
```

Note: enable `git.branchStrategy` in the pipeline config before installing the hook.
Tip: for hook-triggered pipelines, prefer `unique-per-run` and disable `autoCommit` if you only need reports.

## Available Agents

All examples use focused micro-agents from `.agent-pipeline/agents/`:

**Design Agents** (front-end-parallel-example):
- `product_owner` - Requirements transformation
- `retro_90s_webmaster`, `brutalist_purist`, `luxury_editorial`, `indie_game_dev`, `cyberpunk_hacker`, `swiss_modernist` - Design interpretations
- `showcase` - Prototype collection

**Code Quality Agents** (post-commit-example):
- `code-reviewer` - Reviews code for bugs, security, and project conventions
- `quality-checker` - Analyzes complexity, code smells, and simplification opportunities
- `doc-updater` - Maintains documentation in sync with code changes
