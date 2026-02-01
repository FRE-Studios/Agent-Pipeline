// src/__tests__/core/stage-executor-worktree.test.ts
// Tests for StageExecutor worktree GitManager initialization and context injection
// These tests require module-level mocking of GitManager to avoid slow simpleGit operations

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StageExecutor } from '../../core/stage-executor.js';
import { GitManager } from '../../core/git-manager.js';
import { HandoverManager } from '../../core/handover-manager.js';
import { AgentStageConfig, PipelineState } from '../../config/schema.js';

// Mock GitManager at module level to intercept constructor calls
vi.mock('../../core/git-manager.js');

// Mock HandoverManager
vi.mock('../../core/handover-manager.js');

// Mock fs/promises for reading agent files
vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('Mock agent system prompt'),
}));

// Mock TokenEstimator
vi.mock('../../utils/token-estimator.js', () => ({
  TokenEstimator: vi.fn(() => ({
    smartCount: vi.fn().mockResolvedValue({ tokens: 10000, method: 'estimated' }),
    estimateTokens: vi.fn().mockReturnValue(10000),
    dispose: vi.fn(),
  })),
}));

describe('StageExecutor - Worktree GitManager Initialization', () => {
  let mockGitManager: GitManager;
  let mockHandoverManager: HandoverManager;
  let mockRuntime: ReturnType<typeof createMockRuntime>;

  const mockStageConfig: AgentStageConfig = {
    name: 'test-stage',
    agent: '.agent-pipeline/agents/test-agent.md',
    timeout: 120,
  };

  const mockPipelineState: PipelineState = {
    runId: 'test-run-123',
    pipelineConfig: {
      name: 'test-pipeline',
      trigger: 'manual',
      git: {
        autoCommit: true,
        commitPrefix: '[pipeline:{{stage}}]',
      },
      execution: {
        failureStrategy: 'stop',
      },
      agents: [],
    },
    trigger: {
      type: 'manual',
      commitSha: 'initial-commit-sha',
      timestamp: '2024-01-01T00:00:00.000Z',
    },
    stages: [],
    status: 'running',
    artifacts: {
      initialCommit: 'initial-commit-sha',
      changedFiles: ['file1.ts'],
      totalDuration: 0,
    },
  };

  function createMockRuntime() {
    return {
      type: 'mock-runtime',
      name: 'Mock Runtime',
      execute: vi.fn().mockResolvedValue({
        textOutput: 'Mock agent response',
        tokenUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        numTurns: 1,
      }),
      getCapabilities: vi.fn().mockReturnValue({
        supportsStreaming: true,
        supportsTokenTracking: true,
        supportsMCP: true,
        supportsContextReduction: true,
        availableModels: ['haiku', 'sonnet', 'opus'],
        permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
      }),
      validate: vi.fn().mockResolvedValue({ valid: true, errors: [], warnings: [] }),
    };
  }

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset fs.readFile mock
    const fs = await import('fs/promises');
    vi.mocked(fs.readFile).mockResolvedValue('Mock agent system prompt');

    // Create mock GitManager instance
    mockGitManager = new GitManager('/mock/repo');
    vi.mocked(mockGitManager.hasUncommittedChanges).mockResolvedValue(false);
    vi.mocked(mockGitManager.createPipelineCommit).mockResolvedValue('');
    vi.mocked(mockGitManager.getCommitMessage).mockResolvedValue('');

    // Create mock HandoverManager
    mockHandoverManager = new HandoverManager('/mock/repo', 'test-pipeline', 'test-run-123');
    vi.mocked(mockHandoverManager.initialize).mockResolvedValue(undefined);
    vi.mocked(mockHandoverManager.createStageDirectory).mockResolvedValue('/tmp/handover/stages/test-stage');
    vi.mocked(mockHandoverManager.saveAgentOutput).mockResolvedValue(undefined);
    vi.mocked(mockHandoverManager.appendToLog).mockResolvedValue(undefined);
    vi.mocked(mockHandoverManager.getPreviousStages).mockResolvedValue([]);
    vi.mocked(mockHandoverManager.buildContextMessageAsync).mockResolvedValue('## Pipeline Handover Context\n...');

    mockRuntime = createMockRuntime();

    // Register mock runtime
    const { AgentRuntimeRegistry } = await import('../../core/agent-runtime-registry.js');
    AgentRuntimeRegistry.register({ ...mockRuntime, type: 'claude-code-headless', name: 'Claude Code Headless Runtime' });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    const { AgentRuntimeRegistry } = await import('../../core/agent-runtime-registry.js');
    AgentRuntimeRegistry.clear();
  });

  describe('GitManager initialization (lines 44-46)', () => {
    it('should create worktreeGitManager when executionRepoPath differs from repoPath', async () => {
      const mainRepoPath = '/main/repo';
      const worktreePath = '/main/repo/.agent-pipeline/worktrees/run-123';

      // GitManager constructor is mocked - we can verify it's called with worktree path
      const GitManagerConstructor = vi.mocked(GitManager);

      const executor = new StageExecutor(
        mockGitManager,
        false,
        mockHandoverManager,
        mockRuntime,
        mainRepoPath,
        worktreePath,  // Different from mainRepoPath
        { interactive: false, verbose: false }
      );

      // Verify GitManager constructor was called with worktree path
      // (First call is for mockGitManager in setup, second is for worktreeGitManager)
      const constructorCalls = GitManagerConstructor.mock.calls;
      const worktreeCall = constructorCalls.find(call => call[0] === worktreePath);
      expect(worktreeCall).toBeDefined();

      // Execute stage and verify context includes worktree info
      await executor.executeStage(mockStageConfig, mockPipelineState);

      const executeCall = mockRuntime.execute.mock.calls[0];
      const userPrompt = executeCall[0].userPrompt;

      expect(userPrompt).toContain('Worktree isolation');
      expect(userPrompt).toContain(worktreePath);
      expect(userPrompt).toContain(mainRepoPath);
    });

    it('should NOT create worktreeGitManager when executionRepoPath equals repoPath', async () => {
      const samePath = '/same/repo/path';

      const GitManagerConstructor = vi.mocked(GitManager);
      const initialCallCount = GitManagerConstructor.mock.calls.length;

      const executor = new StageExecutor(
        mockGitManager,
        false,
        mockHandoverManager,
        mockRuntime,
        samePath,
        samePath,  // Same as repoPath
        { interactive: false, verbose: false }
      );

      // No additional GitManager should be created for worktree
      expect(GitManagerConstructor.mock.calls.length).toBe(initialCallCount);

      await executor.executeStage(mockStageConfig, mockPipelineState);

      const executeCall = mockRuntime.execute.mock.calls[0];
      const userPrompt = executeCall[0].userPrompt;

      expect(userPrompt).not.toContain('Worktree isolation');
      expect(userPrompt).not.toContain('Main Repository');
    });

    it('should NOT create worktreeGitManager when executionRepoPath is undefined', async () => {
      const GitManagerConstructor = vi.mocked(GitManager);
      const initialCallCount = GitManagerConstructor.mock.calls.length;

      const executor = new StageExecutor(
        mockGitManager,
        false,
        mockHandoverManager,
        mockRuntime,
        '/main/repo',
        undefined,  // No executionRepoPath
        { interactive: false, verbose: false }
      );

      // No additional GitManager should be created
      expect(GitManagerConstructor.mock.calls.length).toBe(initialCallCount);

      await executor.executeStage(mockStageConfig, mockPipelineState);

      const executeCall = mockRuntime.execute.mock.calls[0];
      const userPrompt = executeCall[0].userPrompt;

      expect(userPrompt).not.toContain('Worktree isolation');
    });
  });

  describe('Worktree context injection (lines 432-437)', () => {
    it('should include all worktree-specific context when in worktree mode', async () => {
      const mainRepoPath = '/users/dev/my-project';
      const worktreePath = '/users/dev/my-project/.agent-pipeline/worktrees/pipeline-run-abc';

      const executor = new StageExecutor(
        mockGitManager,
        false,
        mockHandoverManager,
        mockRuntime,
        mainRepoPath,
        worktreePath,
        { interactive: false, verbose: false }
      );

      await executor.executeStage(mockStageConfig, mockPipelineState);

      const executeCall = mockRuntime.execute.mock.calls[0];
      const userPrompt = executeCall[0].userPrompt;

      // Verify all worktree-specific context is included
      expect(userPrompt).toContain('## Execution Environment');
      expect(userPrompt).toContain(`**Working Directory:** \`${worktreePath}\``);
      expect(userPrompt).toContain(`**Main Repository:** \`${mainRepoPath}\``);
      expect(userPrompt).toContain('**Execution Mode:** Worktree isolation');
      expect(userPrompt).toContain('git worktree');
      expect(userPrompt).toContain('Handover files');
    });

    it('should pass worktree cwd to runtime options', async () => {
      const mainRepoPath = '/main/repo';
      const worktreePath = '/main/repo/.agent-pipeline/worktrees/run-xyz';

      const executor = new StageExecutor(
        mockGitManager,
        false,
        mockHandoverManager,
        mockRuntime,
        mainRepoPath,
        worktreePath,
        { interactive: false, verbose: false }
      );

      await executor.executeStage(mockStageConfig, mockPipelineState);

      const executeCall = mockRuntime.execute.mock.calls[0];
      const request = executeCall[0];

      // Runtime should receive cwd in runtimeOptions
      expect(request.options.runtimeOptions).toEqual({ cwd: worktreePath });
    });

    it('should create separate GitManager for worktree operations', async () => {
      const mainRepoPath = '/main/repo';
      const worktreePath = '/main/repo/.agent-pipeline/worktrees/run-123';

      // Track GitManager constructor calls
      const GitManagerConstructor = vi.mocked(GitManager);
      const constructorCallsBefore = GitManagerConstructor.mock.calls.length;

      const executor = new StageExecutor(
        mockGitManager,
        false,
        mockHandoverManager,
        mockRuntime,
        mainRepoPath,
        worktreePath,
        { interactive: false, verbose: false }
      );

      // Verify GitManager was instantiated for the worktree path
      const constructorCallsAfter = GitManagerConstructor.mock.calls.length;
      expect(constructorCallsAfter).toBeGreaterThan(constructorCallsBefore);

      // Find the constructor call with worktree path
      const worktreeConstructorCall = GitManagerConstructor.mock.calls.find(
        call => call[0] === worktreePath
      );
      expect(worktreeConstructorCall).toBeDefined();

      // The executor should function correctly with worktree setup
      await executor.executeStage(mockStageConfig, mockPipelineState);

      const executeCall = mockRuntime.execute.mock.calls[0];
      const request = executeCall[0];

      // Verify worktree cwd is passed to runtime
      expect(request.options.runtimeOptions).toEqual({ cwd: worktreePath });
    });
  });
});
