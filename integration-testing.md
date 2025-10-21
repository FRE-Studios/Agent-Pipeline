# Integration Testing

## Overview

Integration tests validate end-to-end workflows by testing how multiple components interact together in realistic scenarios. Unlike unit tests that mock all dependencies, integration tests use **real file system operations** and **real git operations** in isolated environments, while **mocking only the Claude Agent SDK** (to avoid API costs and ensure deterministic tests).

### Testing Approach

**What We Test (Real Operations):**
- ✅ File system I/O (.agent-pipeline/, .claude/agents/ directories)
- ✅ Git operations (commits, branches, staging, checkout) in isolated temp repos
- ✅ State persistence (JSON files in .agent-pipeline/state/runs/)
- ✅ YAML configuration loading and validation
- ✅ Component integration (PipelineRunner → StageExecutor → GitManager → StateManager)

**What We Mock:**
- 🔧 Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) - Use predefined responses
- 🔧 GitHub CLI (`gh`) - Mock PR creation output
- 🔧 Desktop notifications (`node-notifier`) - Already mocked in unit tests

### Test Environment Strategy

Each integration test runs in a completely isolated temporary git repository:

```typescript
// Each test gets:
const testEnv = await createIsolatedGitRepo();
// testEnv.repoPath - fresh git repo with initial commit
// testEnv.pipelinesDir - .agent-pipeline/pipelines/
// testEnv.agentsDir - .claude/agents/
// testEnv.stateDir - .agent-pipeline/state/runs/

// After test:
await cleanupTestRepo(testEnv);
```

This ensures:
- Tests don't interfere with each other
- No pollution of the actual codebase
- Real git operations without risk
- Easy cleanup

---

## File Organization

```
src/__tests__/integration/
├── setup/
│   ├── test-environment.ts        # Isolated git repo creation utilities
│   ├── fixtures.ts                # Minimal agent prompts & pipeline configs
│   └── helpers.ts                 # Shared test utilities
│
├── full-pipeline-execution.integration.test.ts    # Init → Create → Run → Status → History
├── git-workflow.integration.test.ts               # Branch isolation, commits, PR creation
├── pipeline-management.integration.test.ts        # Create, Clone, Export, Import, Validate
├── agent-migration.integration.test.ts            # Agent pull → List → Info → Use in pipeline
├── error-recovery.integration.test.ts             # Rollback, Cleanup, Invalid configs
└── README.md                                      # Integration test documentation
```

### Naming Conventions

**File Naming:**
- `{workflow-name}.integration.test.ts` - Describes the user workflow being tested
- Example: `full-pipeline-execution.integration.test.ts`

**Test Naming:**
- Use descriptive `describe()` blocks for workflows
- Use `it()` for specific scenarios within workflows
- Example:
  ```typescript
  describe('Full Pipeline Execution Workflow', () => {
    it('should complete init → create → run → status flow successfully', async () => {
      // Test implementation
    });
  });
  ```

---

## Implementation Steps

### Step 1: Test Environment Infrastructure

**Objective:** Create reusable utilities for setting up isolated test environments with real git repositories.

**Files to Create:**

#### `src/__tests__/integration/setup/test-environment.ts`

Create utilities to manage isolated test repositories:

```typescript
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import simpleGit from 'simple-git';

export interface TestEnvironment {
  repoPath: string;
  pipelinesDir: string;
  agentsDir: string;
  stateDir: string;
  git: SimpleGit;
}

export async function createIsolatedGitRepo(): Promise<TestEnvironment> {
  // 1. Create temp directory
  // 2. Initialize git repo with user.name and user.email
  // 3. Create initial commit
  // 4. Create .agent-pipeline/ and .claude/agents/ directories
  // 5. Return TestEnvironment object
}

export async function cleanupTestRepo(env: TestEnvironment): Promise<void> {
  // Remove temp directory recursively
}
```

**Implementation Notes:**
- Use `mkdtemp()` from `fs/promises` to create unique temp dirs
- Initialize git with `simpleGit().init()` and configure user
- Create an initial commit so there's a git history
- Create directory structure that matches real usage

**Reference:** Look at `src/__tests__/setup.ts` for temp directory patterns already used in unit tests.

---

#### `src/__tests__/integration/setup/fixtures.ts`

Create minimal, focused test data:

```typescript
export const MINIMAL_AGENT_PROMPT = `
# Test Agent

You are a test agent used in integration tests.
Output: test_output_value
`;

export const MINIMAL_PIPELINE_CONFIG = {
  name: 'test-pipeline',
  trigger: 'manual',
  settings: {
    autoCommit: true,
    commitPrefix: '[pipeline:{{stage}}]',
    failureStrategy: 'stop',
  },
  agents: [
    {
      name: 'test-stage',
      agent: '.claude/agents/test-agent.md',
      timeout: 30,
      outputs: ['test_output'],
    },
  ],
};

export const GIT_WORKFLOW_PIPELINE_CONFIG = {
  // Pipeline config with git.pullRequest.autoCreate: true
};

export const PARALLEL_PIPELINE_CONFIG = {
  // Pipeline with multiple stages, some with dependsOn
};

// Helper to generate pipeline YAML string
export function generatePipelineYAML(config: any): string {
  return YAML.stringify(config);
}
```

**Implementation Notes:**
- Keep agents simple (1-2 lines of prompt)
- Configs should be minimal but valid
- Include fixtures for different scenarios (git workflow, parallel execution, etc.)

**Reference:** See `src/__tests__/fixtures/pipeline-configs.ts` for config structure patterns.

---

#### `src/__tests__/integration/setup/helpers.ts`

Create shared utilities for integration tests:

```typescript
export async function writeAgentFile(
  agentsDir: string,
  name: string,
  content: string
): Promise<void> {
  // Write agent markdown file to .claude/agents/{name}.md
}

export async function writePipelineFile(
  pipelinesDir: string,
  name: string,
  config: any
): Promise<void> {
  // Write pipeline YAML to .agent-pipeline/pipelines/{name}.yml
}

export async function getLatestCommit(git: SimpleGit): Promise<string> {
  // Return latest commit SHA
}

export async function getCommitsBetween(
  git: SimpleGit,
  from: string,
  to: string
): Promise<CommitSummary[]> {
  // Get commits in range
}

export async function readStateFile(
  stateDir: string,
  runId: string
): Promise<PipelineState> {
  // Parse and return state JSON
}
```

**Implementation Notes:**
- These helpers reduce duplication across test files
- Use real file I/O (`fs/promises`)
- Use real git operations (`simpleGit`)

---

### Step 2: Full Pipeline Execution Workflow Test

**Objective:** Test the most critical user workflow end-to-end: initializing a project, creating a pipeline, running it, and checking status.

**File to Create:** `src/__tests__/integration/full-pipeline-execution.integration.test.ts`

**Workflow to Test:**
```
init → list → create → validate → run → status → history
```

**Test Scenarios:**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createIsolatedGitRepo, cleanupTestRepo, TestEnvironment } from './setup/test-environment.js';
import { MINIMAL_PIPELINE_CONFIG, MINIMAL_AGENT_PROMPT } from './setup/fixtures.js';
import { writeAgentFile, writePipelineFile, readStateFile } from './setup/helpers.js';
import { PipelineRunner } from '../../core/pipeline-runner.js';
import { PipelineLoader } from '../../config/pipeline-loader.js';
import { StateManager } from '../../core/state-manager.js';
import { vi } from 'vitest';

// Mock Claude SDK
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  AgentSDK: vi.fn(() => ({
    query: vi.fn(async () => ({
      output: 'Test agent completed successfully\ntest_output: 42',
      toolCalls: [],
    })),
  })),
}));

describe('Full Pipeline Execution Workflow', () => {
  let env: TestEnvironment;

  beforeEach(async () => {
    env = await createIsolatedGitRepo();
  });

  afterEach(async () => {
    await cleanupTestRepo(env);
  });

  it('should complete init → create → run → status flow successfully', async () => {
    // 1. INIT: Write agent and pipeline files (simulates `agent-pipeline init`)
    await writeAgentFile(env.agentsDir, 'test-agent', MINIMAL_AGENT_PROMPT);
    await writePipelineFile(env.pipelinesDir, 'test-pipeline', MINIMAL_PIPELINE_CONFIG);

    // 2. CREATE: Verify pipeline file exists
    const loader = new PipelineLoader(env.pipelinesDir);
    const pipelines = await loader.listPipelines();
    expect(pipelines).toContain('test-pipeline');

    // 3. RUN: Execute pipeline
    const config = await loader.loadPipeline('test-pipeline');
    const runner = new PipelineRunner(env.repoPath);
    const result = await runner.runPipeline(config);

    // 4. VERIFY: Check results
    expect(result.status).toBe('completed');
    expect(result.stages).toHaveLength(1);
    expect(result.stages[0].status).toBe('success');

    // 5. VERIFY: Check git commits were created
    const commits = await env.git.log();
    const pipelineCommits = commits.all.filter(c =>
      c.message.includes('[pipeline:test-stage]')
    );
    expect(pipelineCommits).toHaveLength(1);

    // 6. STATUS: Verify state was persisted
    const stateManager = new StateManager(env.stateDir);
    const savedState = await stateManager.loadState(result.runId);
    expect(savedState).toBeDefined();
    expect(savedState.status).toBe('completed');

    // 7. HISTORY: Verify we can retrieve all runs
    const allRuns = await stateManager.getAllRuns();
    expect(allRuns).toHaveLength(1);
    expect(allRuns[0].runId).toBe(result.runId);
  });

  it('should handle pipeline with multiple stages and extract outputs', async () => {
    // Test multi-stage pipeline with output extraction
    // Verify outputs are passed to dependent stages
  });

  it('should respect dry-run mode and not create commits', async () => {
    // Test --dry-run flag
    // Verify no commits created but pipeline executes
  });
});
```

**Key Validations:**
- ✅ Pipeline files created in correct directories
- ✅ Pipeline runs successfully with mocked agent
- ✅ Git commits created with correct metadata
- ✅ State persisted to `.agent-pipeline/state/runs/{runId}.json`
- ✅ State can be loaded and contains expected data
- ✅ Dry-run mode works correctly

**Reference Files:**
- `src/__tests__/core/pipeline-runner.test.ts` - Unit test patterns for PipelineRunner
- `src/__tests__/cli/commands/run.test.ts` - Run command test patterns

---

### Step 3: Git Workflow Integration Test

**Objective:** Test branch isolation, atomic commits, and PR creation workflow.

**File to Create:** `src/__tests__/integration/git-workflow.integration.test.ts`

**Workflow to Test:**
```
create pipeline with git config → run → verify branch isolation → verify commits → verify PR metadata
```

**Test Scenarios:**

```typescript
describe('Git Workflow Integration', () => {
  let env: TestEnvironment;

  beforeEach(async () => {
    env = await createIsolatedGitRepo();
  });

  afterEach(async () => {
    await cleanupTestRepo(env);
  });

  it('should execute pipeline on isolated branch and create commits', async () => {
    // 1. Create pipeline with git.branchStrategy: 'reusable'
    const config = {
      ...MINIMAL_PIPELINE_CONFIG,
      git: {
        baseBranch: 'main',
        branchStrategy: 'reusable',
        branchPrefix: 'pipeline',
      },
    };

    await writePipelineFile(env.pipelinesDir, 'git-workflow', config);
    await writeAgentFile(env.agentsDir, 'test-agent', MINIMAL_AGENT_PROMPT);

    // 2. Get original branch
    const originalBranch = (await env.git.branch()).current;

    // 3. Run pipeline
    const loader = new PipelineLoader(env.pipelinesDir);
    const pipelineConfig = await loader.loadPipeline('git-workflow');
    const runner = new PipelineRunner(env.repoPath);
    const result = await runner.runPipeline(pipelineConfig);

    // 4. VERIFY: Pipeline branch was created
    const branches = await env.git.branch();
    expect(branches.all).toContain('pipeline/git-workflow');

    // 5. VERIFY: Commits were made on pipeline branch
    const commits = await env.git.log(['pipeline/git-workflow']);
    expect(commits.all.length).toBeGreaterThan(0);

    // 6. VERIFY: Original branch was restored
    const currentBranch = (await env.git.branch()).current;
    expect(currentBranch).toBe(originalBranch);

    // 7. VERIFY: Commit has metadata trailers
    const lastCommit = commits.latest;
    expect(lastCommit.message).toContain('[pipeline:test-stage]');
    expect(lastCommit.body).toContain('Pipeline:');
    expect(lastCommit.body).toContain('Stage:');
  });

  it('should create unique branch per run when strategy is unique-per-run', async () => {
    // Test unique branch naming
    // Run pipeline twice, verify 2 different branches created
  });

  it('should reuse branch when strategy is reusable', async () => {
    // Run pipeline twice
    // Verify same branch is reused
  });

  it('should handle PR creation with gh CLI', async () => {
    // Mock gh CLI output
    // Verify PR metadata is saved to state
    // Test reviewers, labels, draft mode
  });

  it('should rollback commits successfully', async () => {
    // Run pipeline
    // Execute rollback
    // Verify commits are reverted
    // Verify working tree is clean
  });
});
```

**Key Validations:**
- ✅ Pipeline branch created with correct naming
- ✅ Commits made on pipeline branch, not original
- ✅ Original branch restored after pipeline
- ✅ Commit messages include metadata trailers
- ✅ Branch strategies work correctly (reusable vs unique)
- ✅ Rollback reverts commits safely

**Reference Files:**
- `src/__tests__/core/branch-manager.test.ts` - Branch management patterns
- `src/__tests__/core/git-manager.test.ts` - Git operation patterns
- `src/__tests__/cli/commands/rollback.test.ts` - Rollback test patterns

---

### Step 4: Pipeline Management (CRUD) Test

**Objective:** Test pipeline configuration management: create, clone, export, import, validate, delete.

**File to Create:** `src/__tests__/integration/pipeline-management.integration.test.ts`

**Workflow to Test:**
```
create → clone → export → import → validate → delete
```

**Test Scenarios:**

```typescript
describe('Pipeline Management Integration', () => {
  let env: TestEnvironment;

  beforeEach(async () => {
    env = await createIsolatedGitRepo();
  });

  afterEach(async () => {
    await cleanupTestRepo(env);
  });

  it('should create, clone, export, and import pipelines', async () => {
    // 1. CREATE: Write initial pipeline
    await writePipelineFile(env.pipelinesDir, 'original', MINIMAL_PIPELINE_CONFIG);

    // 2. CLONE: Clone to new pipeline
    const loader = new PipelineLoader(env.pipelinesDir);
    const original = await loader.loadPipeline('original');
    const cloned = { ...original, name: 'cloned-pipeline' };
    await writePipelineFile(env.pipelinesDir, 'cloned-pipeline', cloned);

    // 3. VERIFY: Both pipelines exist
    const pipelines = await loader.listPipelines();
    expect(pipelines).toContain('original');
    expect(pipelines).toContain('cloned-pipeline');

    // 4. EXPORT: Export pipeline to file
    const exportPath = join(env.repoPath, 'exported-pipeline.yml');
    await writeFile(exportPath, YAML.stringify(original));

    // 5. IMPORT: Import from file
    const imported = YAML.parse(await readFile(exportPath, 'utf-8'));
    expect(imported.name).toBe('original');

    // 6. DELETE: Remove pipeline
    await rm(join(env.pipelinesDir, 'cloned-pipeline.yml'));
    const afterDelete = await loader.listPipelines();
    expect(afterDelete).not.toContain('cloned-pipeline');
  });

  it('should validate pipeline and catch errors', async () => {
    // Create invalid pipeline (missing required fields)
    // Run validator
    // Verify validation errors are returned
  });

  it('should detect circular dependencies in DAG', async () => {
    // Create pipeline with circular dependsOn
    // Run validator
    // Verify cycle detection works
  });

  it('should export pipeline with agents included', async () => {
    // Create pipeline and agent
    // Export with --include-agents flag
    // Verify exported bundle contains both
  });
});
```

**Key Validations:**
- ✅ Pipelines can be created and listed
- ✅ Cloning creates valid copy with new name
- ✅ Export produces valid YAML
- ✅ Import loads YAML correctly
- ✅ Validation catches errors (missing fields, invalid values)
- ✅ DAG cycle detection works
- ✅ Delete removes pipeline file

**Reference Files:**
- `src/__tests__/config/pipeline-loader.test.ts` - Loader test patterns
- `src/__tests__/validators/pipeline-validator.test.ts` - Validation patterns
- `src/__tests__/cli/commands/pipeline/` - Pipeline command tests

---

### Step 5: Agent Migration Workflow Test

**Objective:** Test agent discovery, import from plugins, listing, and usage in pipelines.

**File to Create:** `src/__tests__/integration/agent-migration.integration.test.ts`

**Workflow to Test:**
```
agent pull → agent list → agent info → create pipeline with imported agent → run
```

**Test Scenarios:**

```typescript
describe('Agent Migration Workflow Integration', () => {
  let env: TestEnvironment;

  beforeEach(async () => {
    env = await createIsolatedGitRepo();
  });

  afterEach(async () => {
    await cleanupTestRepo(env);
  });

  it('should discover and list agents in .claude/agents/', async () => {
    // 1. Write multiple agent files
    await writeAgentFile(env.agentsDir, 'code-reviewer', '# Code Reviewer\n\nReview code...');
    await writeAgentFile(env.agentsDir, 'security-auditor', '# Security Auditor\n\nAudit security...');

    // 2. List agents (simulate `agent list` command)
    const agents = await readdir(env.agentsDir);
    expect(agents).toContain('code-reviewer.md');
    expect(agents).toContain('security-auditor.md');

    // 3. Read agent info (simulate `agent info` command)
    const reviewerContent = await readFile(join(env.agentsDir, 'code-reviewer.md'), 'utf-8');
    expect(reviewerContent).toContain('Code Reviewer');
  });

  it('should import agents from Claude Code plugins', async () => {
    // Mock Claude Code plugin directory structure
    // Simulate `agent pull` command
    // Verify agents are copied to .claude/agents/
    // Verify agent metadata is preserved
  });

  it('should use imported agent in pipeline execution', async () => {
    // 1. Import/create agent
    await writeAgentFile(env.agentsDir, 'imported-agent', MINIMAL_AGENT_PROMPT);

    // 2. Create pipeline that uses this agent
    const config = {
      ...MINIMAL_PIPELINE_CONFIG,
      agents: [
        {
          name: 'use-imported-agent',
          agent: '.claude/agents/imported-agent.md',
          timeout: 30,
        },
      ],
    };
    await writePipelineFile(env.pipelinesDir, 'with-imported-agent', config);

    // 3. Run pipeline
    const loader = new PipelineLoader(env.pipelinesDir);
    const pipelineConfig = await loader.loadPipeline('with-imported-agent');
    const runner = new PipelineRunner(env.repoPath);
    const result = await runner.runPipeline(pipelineConfig);

    // 4. VERIFY: Pipeline used imported agent successfully
    expect(result.status).toBe('completed');
    expect(result.stages[0].stageName).toBe('use-imported-agent');
  });

  it('should handle missing agent files gracefully', async () => {
    // Create pipeline referencing non-existent agent
    // Run pipeline
    // Verify error is reported correctly
  });
});
```

**Key Validations:**
- ✅ Agents are discovered in .claude/agents/
- ✅ Agent list command shows all agents
- ✅ Agent info command reads agent content
- ✅ Agent pull imports from plugins correctly
- ✅ Imported agents can be used in pipelines
- ✅ Missing agent files produce clear errors

**Reference Files:**
- `src/__tests__/cli/commands/agent/list.test.ts` - Agent listing patterns
- `src/__tests__/cli/commands/agent/info.test.ts` - Agent info patterns
- `src/__tests__/cli/commands/agent/pull.test.ts` - Agent import patterns
- `src/cli/utils/agent-importer.ts` - Agent import implementation

---

### Step 6: Error Recovery & Rollback Test

**Objective:** Test error handling, rollback functionality, and cleanup workflows.

**File to Create:** `src/__tests__/integration/error-recovery.integration.test.ts`

**Workflow to Test:**
```
run → rollback → cleanup → validate error scenarios
```

**Test Scenarios:**

```typescript
describe('Error Recovery Integration', () => {
  let env: TestEnvironment;

  beforeEach(async () => {
    env = await createIsolatedGitRepo();
  });

  afterEach(async () => {
    await cleanupTestRepo(env);
  });

  it('should rollback pipeline commits successfully', async () => {
    // 1. Run pipeline successfully
    // 2. Count commits
    // 3. Execute rollback
    // 4. Verify commits reverted
    // 5. Verify working tree clean
  });

  it('should handle pipeline failure and preserve state', async () => {
    // Mock agent to fail
    // Run pipeline
    // Verify state shows failure
    // Verify partial commits exist
    // Verify can recover from failure
  });

  it('should cleanup old pipeline branches', async () => {
    // Run pipeline multiple times with unique-per-run strategy
    // Execute cleanup command
    // Verify old branches deleted
    // Verify recent branches preserved
  });

  it('should handle invalid pipeline configuration gracefully', async () => {
    // Create invalid config (syntax error, missing fields, circular deps)
    // Run validation
    // Verify clear error messages
    // Verify pipeline doesn't run
  });

  it('should handle retry logic on agent failure', async () => {
    // Create pipeline with retry config
    // Mock agent to fail first 2 attempts, succeed on 3rd
    // Run pipeline
    // Verify retry attempts occurred
    // Verify eventual success
  });

  it('should handle conditional stage skipping', async () => {
    // Create pipeline with conditional stages
    // Mock outputs that trigger condition
    // Run pipeline
    // Verify stages skipped/executed correctly
  });
});
```

**Key Validations:**
- ✅ Rollback reverts commits safely
- ✅ Failed pipelines preserve state for debugging
- ✅ Cleanup removes old branches and logs
- ✅ Invalid configs produce clear error messages
- ✅ Retry logic executes with correct backoff
- ✅ Conditional stages evaluate correctly

**Reference Files:**
- `src/__tests__/cli/commands/rollback.test.ts` - Rollback patterns
- `src/__tests__/cli/commands/cleanup.test.ts` - Cleanup patterns
- `src/__tests__/core/retry-handler.test.ts` - Retry patterns
- `src/__tests__/core/condition-evaluator.test.ts` - Condition patterns

---

### Step 7: Run Full Test Suite

**Verification Commands:**

```bash
# Run only integration tests
npm test src/__tests__/integration/ -- --run

# Run with verbose output
npm test src/__tests__/integration/ -- --run --reporter=verbose

# Run specific integration test file
npm test src/__tests__/integration/full-pipeline-execution.integration.test.ts -- --run

# Run all tests (unit + integration)
npm test -- --run

# Check coverage (optional)
npm test -- --coverage --run
```

**Expected Results:**
- ✅ All integration tests pass
- ✅ All existing unit tests still pass
- ✅ No test isolation issues (temp dirs cleaned up)
- ✅ Tests complete in reasonable time (< 30 seconds total for integration suite)
- ✅ No git state pollution in actual repository

---

## Context for Developers

### Existing Test Patterns to Follow

**1. Mock Setup Pattern** (from unit tests)
```typescript
// Mock external dependencies at top of file
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  AgentSDK: vi.fn(() => ({
    query: vi.fn(async () => ({ output: 'mocked response' })),
  })),
}));
```

**2. Fixture Usage Pattern**
```typescript
// Import shared fixtures
import { MINIMAL_PIPELINE_CONFIG } from './setup/fixtures.js';

// Use in tests
const config = { ...MINIMAL_PIPELINE_CONFIG, name: 'custom-name' };
```

**3. Test Lifecycle Pattern**
```typescript
describe('Test Suite', () => {
  let env: TestEnvironment;

  beforeEach(async () => {
    env = await createIsolatedGitRepo();
  });

  afterEach(async () => {
    await cleanupTestRepo(env);
  });

  it('test case', async () => {
    // Use env.repoPath, env.git, etc.
  });
});
```

### File References

**Core Implementation Files:**
- `src/core/pipeline-runner.ts` - Main orchestrator (start here to understand execution flow)
- `src/core/stage-executor.ts` - Individual stage execution
- `src/core/git-manager.ts` - Git operations wrapper
- `src/core/branch-manager.ts` - Branch workflow management
- `src/core/state-manager.ts` - State persistence
- `src/config/pipeline-loader.ts` - YAML loading
- `src/validators/pipeline-validator.ts` - Validation logic

**Existing Test Files to Reference:**
- `src/__tests__/setup.ts` - Test setup utilities (temp dirs, mocks)
- `src/__tests__/fixtures/` - All fixture files
- `src/__tests__/mocks/` - Mock implementations
- `src/__tests__/core/pipeline-runner.test.ts` - Comprehensive unit test example
- `src/__tests__/cli/commands/run.test.ts` - CLI command test example

**Configuration Schema:**
- `src/config/schema.ts` - TypeScript interfaces for all configs and state

---

## Best Practices

### Integration Testing Principles

1. **Test Real Interactions** - Don't mock components being tested (file system, git, state manager)
2. **Isolate Each Test** - Use fresh temp repos per test
3. **Mock External Services** - Mock Claude SDK, gh CLI, notifications
4. **Test User Workflows** - Focus on realistic end-to-end scenarios
5. **Verify Side Effects** - Check files created, commits made, state saved
6. **Clean Up Resources** - Always remove temp directories in afterEach
7. **Use Descriptive Names** - Test names should describe the workflow

### Common Pitfalls to Avoid

❌ **Don't:** Run tests in actual repository
✅ **Do:** Use isolated temp repositories

❌ **Don't:** Mock components you're trying to test
✅ **Do:** Only mock external services (Claude SDK, gh CLI)

❌ **Don't:** Share state between tests
✅ **Do:** Create fresh environment in beforeEach

❌ **Don't:** Leave temp files behind
✅ **Do:** Clean up in afterEach

❌ **Don't:** Test implementation details
✅ **Do:** Test observable behavior and outputs

### Performance Considerations

- Each integration test should complete in < 5 seconds
- Use minimal pipeline configs (1-2 stages)
- Keep agent prompts short
- Avoid unnecessary file I/O
- Run tests in parallel where possible (Vitest default)

---

## Manual Testing Checklist (Done by user - not Agent)

After implementing integration tests, manually verify:

- [ ] `npm test src/__tests__/integration/ -- --run` passes
- [ ] All tests clean up temp directories (check `/tmp` or `os.tmpdir()`)
- [ ] Tests don't interfere with actual `.agent-pipeline/` directory
- [ ] Tests run quickly (< 30 seconds total)
- [ ] No git pollution in actual repository
- [ ] Can run individual test files successfully
- [ ] Coverage report includes integration tests

---

## Next Steps After Integration Testing

1. **Update README.md** - Document integration test approach
2. **Add CI/CD Integration** - Run integration tests in GitHub Actions
3. **Performance Benchmarking** - Track integration test execution time
4. **Snapshot Testing** - Consider snapshots for complex YAML outputs
5. **E2E Tests with Real API** - Create optional smoke tests with real Claude API calls (behind flag)






### Step 2: Manual testing checklist (Done by user - not Agent)
**Test each command manually:**
- [ ] `agent-pipeline create` - Interactive flow works
- [ ] `agent-pipeline edit <pipeline>` - Opens in editor
- [ ] `agent-pipeline delete <pipeline>` - Confirmation works
- [ ] `agent-pipeline clone <source> <dest>` - Auto-naming works
- [ ] `agent-pipeline validate <pipeline>` - Shows errors
- [ ] `agent-pipeline config <pipeline>` - Displays YAML
- [ ] `agent-pipeline export <pipeline> --include-agents` - Exports with agents
- [ ] `agent-pipeline import <file>` - Imports successfully
- [ ] `agent-pipeline agent list` - Shows table
- [ ] `agent-pipeline agent info <name>` - Shows details
- [ ] `agent-pipeline agent pull` - Imports from plugins
- [ ] `agent-pipeline history` - Press 'o' to open logs
- [ ] `agent-pipeline cleanup --force --delete-logs` - Deletes branches and logs

---

## Next Steps After Testing

1. Update README.md with all new commands and examples
2. Add CONTRIBUTING.md with development guidelines
3. Create CHANGELOG.md for version tracking
4. Prepare for npm publication