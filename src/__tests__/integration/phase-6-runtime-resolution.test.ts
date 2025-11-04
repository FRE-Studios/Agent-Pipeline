// Phase 6 Integration Smoke Test - Runtime Resolution
// This is a minimal integration test to verify Phase 6 runtime resolution works end-to-end
// Comprehensive integration testing deferred to Phase 7

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StageExecutor } from '../../core/stage-executor.js';
import { AgentRuntimeRegistry } from '../../core/agent-runtime-registry.js';
import { createMockGitManager } from '../mocks/git-manager.js';
import type { AgentStageConfig, PipelineState } from '../../config/schema.js';

// Mock fs to prevent file reading errors
vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('Mock agent system prompt')
}));

// Mock OutputStorageManager
vi.mock('../../core/output-storage-manager.js', () => ({
  OutputStorageManager: vi.fn(() => ({
    saveStageOutputs: vi.fn().mockResolvedValue({ structured: 'path/to/output.json', raw: 'path/to/raw.md' }),
    compressFileList: vi.fn((files: string[]) => `Changed ${files.length} files`)
  }))
}));

// Mock TokenEstimator
vi.mock('../../utils/token-estimator.js', () => ({
  TokenEstimator: vi.fn(() => ({
    smartCount: vi.fn().mockResolvedValue({ tokens: 10000, method: 'estimated' }),
    estimateTokens: vi.fn().mockReturnValue(10000),
    dispose: vi.fn()
  }))
}));

describe('Phase 6 Integration - Runtime Resolution', () => {
  beforeEach(async () => {
    // Register mock runtimes for testing
    const mockRuntime = {
      type: 'test-runtime',
      name: 'Test Runtime',
      execute: vi.fn().mockResolvedValue({
        textOutput: 'Integration test output',
        extractedData: { test: 'success' },
        tokenUsage: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150
        },
        numTurns: 1
      }),
      getCapabilities: vi.fn().mockReturnValue({
        supportsStreaming: true,
        supportsTokenTracking: true,
        supportsMCP: true,
        supportsContextReduction: true,
        availableModels: ['haiku', 'sonnet', 'opus'],
        permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan']
      }),
      validate: vi.fn().mockResolvedValue({ valid: true, errors: [], warnings: [] })
    };

    const sdkRuntime = { ...mockRuntime, type: 'claude-sdk', name: 'Claude SDK Runtime' };
    const headlessRuntime = { ...mockRuntime, type: 'claude-code-headless', name: 'Claude Code Headless Runtime' };

    AgentRuntimeRegistry.register(sdkRuntime);
    AgentRuntimeRegistry.register(headlessRuntime);
  });

  afterEach(() => {
    AgentRuntimeRegistry.clear();
    vi.clearAllMocks();
  });

  it('should execute stage with runtime resolution (Phase 6 smoke test)', async () => {
    const mockGitManager = createMockGitManager({ hasChanges: false });
    const executor = new StageExecutor(
      mockGitManager,
      false, // dryRun
      'integration-test-run',
      '/test/repo'
    );

    const stageConfig: AgentStageConfig = {
      name: 'integration-test-stage',
      agent: '.claude/agents/test.md',
      timeout: 60,
      runtime: {
        type: 'claude-sdk',
        options: { model: 'haiku' }
      }
    };

    const pipelineState: PipelineState = {
      runId: 'integration-test-run',
      pipelineConfig: {
        name: 'integration-test-pipeline',
        trigger: 'manual',
        agents: [stageConfig]
      },
      trigger: {
        type: 'manual',
        commitSha: 'test-commit',
        timestamp: new Date().toISOString()
      },
      stages: [],
      status: 'running',
      artifacts: {
        initialCommit: 'test-commit',
        changedFiles: [],
        totalDuration: 0
      }
    };

    // Execute stage - this tests the full runtime resolution flow
    const result = await executor.executeStage(stageConfig, pipelineState);

    // Verify successful execution
    expect(result.status).toBe('success');
    expect(result.stageName).toBe('integration-test-stage');
    expect(result.extractedData).toEqual({ test: 'success' });
  });

  it('should use global default runtime when no config specified (Phase 6 smoke test)', async () => {
    const mockGitManager = createMockGitManager({ hasChanges: false });
    const executor = new StageExecutor(
      mockGitManager,
      false,
      'integration-test-run-2',
      '/test/repo'
    );

    const stageConfig: AgentStageConfig = {
      name: 'default-runtime-stage',
      agent: '.claude/agents/test.md',
      timeout: 60
      // No runtime specified
    };

    const pipelineState: PipelineState = {
      runId: 'integration-test-run-2',
      pipelineConfig: {
        name: 'default-runtime-pipeline',
        trigger: 'manual',
        agents: [stageConfig]
        // No runtime specified
      },
      trigger: {
        type: 'manual',
        commitSha: 'test-commit-2',
        timestamp: new Date().toISOString()
      },
      stages: [],
      status: 'running',
      artifacts: {
        initialCommit: 'test-commit-2',
        changedFiles: [],
        totalDuration: 0
      }
    };

    // Execute stage - should use global default (claude-code-headless)
    const result = await executor.executeStage(stageConfig, pipelineState);

    // Verify successful execution with default runtime
    expect(result.status).toBe('success');
    expect(result.stageName).toBe('default-runtime-stage');
  });
});
