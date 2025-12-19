// Phase 7.3 Integration Tests - Multi-Runtime Resolution and Execution
// Comprehensive integration tests validating runtime switching, context passing, and state management

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StageExecutor } from '../../core/stage-executor.js';
import { AgentRuntimeRegistry } from '../../core/agent-runtime-registry.js';
import { createMockGitManager } from '../mocks/git-manager.js';
import {
  sdkOnlyPipelineConfig,
  headlessOnlyPipelineConfig,
  mixedRuntimePipelineConfig,
  parallelMixedPipelineConfig,
} from '../fixtures/pipeline-configs.js';
import type { AgentStageConfig, PipelineState, AgentRuntime } from '../../config/schema.js';

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

// Create mock HandoverManager factory
const createMockHandoverManager = () => ({
  initialize: vi.fn().mockResolvedValue(undefined),
  getPreviousStages: vi.fn().mockResolvedValue([]),
  buildContextMessage: vi.fn().mockReturnValue(''),
  buildContextMessageAsync: vi.fn().mockResolvedValue('## Pipeline Handover Context\n...'),
  saveAgentOutput: vi.fn().mockResolvedValue(undefined),
  appendToLog: vi.fn().mockResolvedValue(undefined),
  getHandoverDir: vi.fn().mockReturnValue('/tmp/handover'),
  createStageDirectory: vi.fn().mockResolvedValue('/tmp/handover/stages/test')
});

// Mock HandoverManager
vi.mock('../../core/handover-manager.js', () => ({
  HandoverManager: vi.fn().mockImplementation(() => createMockHandoverManager())
}));

describe('Runtime Resolution Integration Tests - Phase 7.3', () => {
  let mockSdkRuntime: AgentRuntime;
  let mockHeadlessRuntime: AgentRuntime;
  let mockHandoverManager: ReturnType<typeof createMockHandoverManager>;

  beforeEach(() => {
    // Create fresh mock HandoverManager for each test
    mockHandoverManager = createMockHandoverManager();
    // Clear registry before each test
    AgentRuntimeRegistry.clear();

    // Create SDK mock runtime
    mockSdkRuntime = {
      type: 'claude-sdk',
      name: 'Claude SDK Runtime',
      execute: vi.fn().mockResolvedValue({
        textOutput: 'SDK runtime output',
        tokenUsage: {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 20,  // Correct field name for cache reads
          thinkingTokens: 10,
          totalTokens: 170
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

    // Create Headless mock runtime
    mockHeadlessRuntime = {
      type: 'claude-code-headless',
      name: 'Claude Code Headless Runtime',
      execute: vi.fn().mockResolvedValue({
        textOutput: 'Headless runtime output',
        tokenUsage: {
          inputTokens: 120,
          outputTokens: 60,
          totalTokens: 180
        },
        numTurns: 1
      }),
      getCapabilities: vi.fn().mockReturnValue({
        supportsStreaming: false,
        supportsTokenTracking: true,
        supportsMCP: false,
        supportsContextReduction: true,
        availableModels: ['haiku', 'sonnet', 'opus'],
        permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan']
      }),
      validate: vi.fn().mockResolvedValue({ valid: true, errors: [], warnings: [] })
    };

    // Register both runtimes
    AgentRuntimeRegistry.register(mockSdkRuntime);
    AgentRuntimeRegistry.register(mockHeadlessRuntime);
  });

  afterEach(() => {
    AgentRuntimeRegistry.clear();
    vi.clearAllMocks();
  });

  // ============================================================================
  // Category 1: Single Runtime Pipelines
  // ============================================================================

  describe('Single Runtime Pipelines', () => {
    it('should execute SDK-only pipeline with context passing and state persistence', async () => {
      const mockGitManager = createMockGitManager({ hasChanges: false });
      const executor = new StageExecutor(
        mockGitManager,
        false,
        mockHandoverManager
      );

      const pipelineState: PipelineState = {
        runId: 'sdk-test-run',
        pipelineConfig: sdkOnlyPipelineConfig,
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

      // Execute Stage 1
      const stage1Config = sdkOnlyPipelineConfig.agents[0];
      const result1 = await executor.executeStage(stage1Config, pipelineState);

      expect(result1.status).toBe('success');
      expect(result1.stageName).toBe('sdk-stage-1');
      // Token usage in StageExecution uses different field names
      expect(result1.tokenUsage?.actual_input).toBe(100);
      expect(result1.tokenUsage?.cache_read).toBe(20);

      // Verify SDK runtime was used
      expect(mockSdkRuntime.execute).toHaveBeenCalledTimes(1);
      expect(mockHeadlessRuntime.execute).not.toHaveBeenCalled();

      // Add result to state for next stage
      pipelineState.stages.push(result1);

      // Execute Stage 2 (depends on Stage 1)
      const stage2Config = sdkOnlyPipelineConfig.agents[1];
      const result2 = await executor.executeStage(stage2Config, pipelineState);

      expect(result2.status).toBe('success');
      expect(result2.stageName).toBe('sdk-stage-2');

      // Verify SDK runtime was used again
      expect(mockSdkRuntime.execute).toHaveBeenCalledTimes(2);

      // Add result to state for next stage
      pipelineState.stages.push(result2);

      // Execute Stage 3 (depends on Stage 2)
      const stage3Config = sdkOnlyPipelineConfig.agents[2];
      const result3 = await executor.executeStage(stage3Config, pipelineState);

      expect(result3.status).toBe('success');
      expect(result3.stageName).toBe('sdk-stage-3');

      // Verify SDK runtime was used for all stages
      expect(mockSdkRuntime.execute).toHaveBeenCalledTimes(3);
      expect(mockHeadlessRuntime.execute).not.toHaveBeenCalled();
    });

    it('should execute Headless-only pipeline with context passing and state persistence', async () => {
      const mockGitManager = createMockGitManager({ hasChanges: false });
      const executor = new StageExecutor(
        mockGitManager,
        false,
        mockHandoverManager
      );

      const pipelineState: PipelineState = {
        runId: 'headless-test-run',
        pipelineConfig: headlessOnlyPipelineConfig,
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

      // Execute Stage 1
      const stage1Config = headlessOnlyPipelineConfig.agents[0];
      const result1 = await executor.executeStage(stage1Config, pipelineState);

      expect(result1.status).toBe('success');
      expect(result1.stageName).toBe('headless-stage-1');
      expect(result1.tokenUsage?.actual_input).toBe(120);

      // Verify Headless runtime was used
      expect(mockHeadlessRuntime.execute).toHaveBeenCalledTimes(1);
      expect(mockSdkRuntime.execute).not.toHaveBeenCalled();

      // Add result to state for next stage
      pipelineState.stages.push(result1);

      // Execute Stage 2
      const stage2Config = headlessOnlyPipelineConfig.agents[1];
      const result2 = await executor.executeStage(stage2Config, pipelineState);

      expect(result2.status).toBe('success');
      expect(result2.stageName).toBe('headless-stage-2');

      // Add result to state for next stage
      pipelineState.stages.push(result2);

      // Execute Stage 3
      const stage3Config = headlessOnlyPipelineConfig.agents[2];
      const result3 = await executor.executeStage(stage3Config, pipelineState);

      expect(result3.status).toBe('success');
      expect(result3.stageName).toBe('headless-stage-3');

      // Verify Headless runtime was used for all stages
      expect(mockHeadlessRuntime.execute).toHaveBeenCalledTimes(3);
      expect(mockSdkRuntime.execute).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Category 2: Mixed Runtime Pipelines
  // ============================================================================

  describe('Mixed Runtime Pipelines', () => {
    it('should switch between SDK and Headless runtimes across stages', async () => {
      const mockGitManager = createMockGitManager({ hasChanges: false });
      const executor = new StageExecutor(
        mockGitManager,
        false,
        mockHandoverManager
      );

      const pipelineState: PipelineState = {
        runId: 'mixed-test-run',
        pipelineConfig: mixedRuntimePipelineConfig,
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

      // Stage 1: SDK runtime (override)
      const stage1Config = mixedRuntimePipelineConfig.agents[0];
      const result1 = await executor.executeStage(stage1Config, pipelineState);

      expect(result1.status).toBe('success');
      expect(result1.stageName).toBe('mixed-stage-1');
      expect(mockSdkRuntime.execute).toHaveBeenCalledTimes(1);
      expect(mockHeadlessRuntime.execute).not.toHaveBeenCalled();

      pipelineState.stages.push(result1);

      // Stage 2: Headless runtime (global default)
      const stage2Config = mixedRuntimePipelineConfig.agents[1];
      const result2 = await executor.executeStage(stage2Config, pipelineState);

      expect(result2.status).toBe('success');
      expect(result2.stageName).toBe('mixed-stage-2');
      expect(mockSdkRuntime.execute).toHaveBeenCalledTimes(1); // Still 1 from stage 1
      expect(mockHeadlessRuntime.execute).toHaveBeenCalledTimes(1); // Now called

      pipelineState.stages.push(result2);

      // Stage 3: SDK runtime (override back)
      const stage3Config = mixedRuntimePipelineConfig.agents[2];
      const result3 = await executor.executeStage(stage3Config, pipelineState);

      expect(result3.status).toBe('success');
      expect(result3.stageName).toBe('mixed-stage-3');
      expect(mockSdkRuntime.execute).toHaveBeenCalledTimes(2); // Called again
      expect(mockHeadlessRuntime.execute).toHaveBeenCalledTimes(1); // Still 1

      // Verify runtime switching pattern: SDK → Headless → SDK
      expect(mockSdkRuntime.execute).toHaveBeenCalledTimes(2);
      expect(mockHeadlessRuntime.execute).toHaveBeenCalledTimes(1);
    });

    it('should handle parallel execution with mixed runtimes', async () => {
      const mockGitManager = createMockGitManager({ hasChanges: false });
      const executor = new StageExecutor(
        mockGitManager,
        false,
        mockHandoverManager
      );

      const pipelineState: PipelineState = {
        runId: 'parallel-mixed-run',
        pipelineConfig: parallelMixedPipelineConfig,
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

      // Stage 1: Initial (SDK)
      const stage1Config = parallelMixedPipelineConfig.agents[0];
      const result1 = await executor.executeStage(stage1Config, pipelineState);
      expect(result1.status).toBe('success');
      expect(mockSdkRuntime.execute).toHaveBeenCalledTimes(1);
      pipelineState.stages.push(result1);

      // Stages 2a and 2b run in parallel (one SDK, one Headless)
      const stage2aConfig = parallelMixedPipelineConfig.agents[1]; // SDK
      const stage2bConfig = parallelMixedPipelineConfig.agents[2]; // Headless

      const result2a = await executor.executeStage(stage2aConfig, pipelineState);
      const result2b = await executor.executeStage(stage2bConfig, pipelineState);

      expect(result2a.status).toBe('success');
      expect(result2b.status).toBe('success');
      expect(mockSdkRuntime.execute).toHaveBeenCalledTimes(2); // Stage 1 + 2a
      expect(mockHeadlessRuntime.execute).toHaveBeenCalledTimes(1); // Stage 2b

      pipelineState.stages.push(result2a, result2b);

      // Stage 3: Final (Headless, depends on both 2a and 2b)
      const stage3Config = parallelMixedPipelineConfig.agents[3];
      const result3 = await executor.executeStage(stage3Config, pipelineState);

      expect(result3.status).toBe('success');
      expect(mockHeadlessRuntime.execute).toHaveBeenCalledTimes(2); // Stage 2b + 3

      // Final counts
      expect(mockSdkRuntime.execute).toHaveBeenCalledTimes(2); // Stages 1, 2a
      expect(mockHeadlessRuntime.execute).toHaveBeenCalledTimes(2); // Stages 2b, 3
    });
  });

  // ============================================================================
  // Category 3: Runtime Resolution Logic
  // ============================================================================

  describe('Runtime Resolution Logic', () => {
    it('should use stage-level runtime override over global default', async () => {
      const mockGitManager = createMockGitManager({ hasChanges: false });
      const executor = new StageExecutor(
        mockGitManager,
        false,
        mockHandoverManager
      );

      const stageConfig: AgentStageConfig = {
        name: 'override-stage',
        agent: '.agent-pipeline/agents/test.md',
        timeout: 60,
        runtime: {
          type: 'claude-sdk',
          options: { model: 'haiku' }
        }
      };

      const pipelineState: PipelineState = {
        runId: 'override-test-run',
        pipelineConfig: {
          name: 'override-test',
          trigger: 'manual',
          runtime: {
            type: 'claude-code-headless' // Global default
          },
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

      const result = await executor.executeStage(stageConfig, pipelineState);

      expect(result.status).toBe('success');
      // Stage override (SDK) should be used, not global default (Headless)
      expect(mockSdkRuntime.execute).toHaveBeenCalledTimes(1);
      expect(mockHeadlessRuntime.execute).not.toHaveBeenCalled();
    });

    it('should use global default runtime when no stage-level override', async () => {
      const mockGitManager = createMockGitManager({ hasChanges: false });
      const executor = new StageExecutor(
        mockGitManager,
        false,
        mockHandoverManager
      );

      const stageConfig: AgentStageConfig = {
        name: 'default-stage',
        agent: '.agent-pipeline/agents/test.md',
        timeout: 60
        // No runtime specified
      };

      const pipelineState: PipelineState = {
        runId: 'default-test-run',
        pipelineConfig: {
          name: 'default-test',
          trigger: 'manual',
          runtime: {
            type: 'claude-code-headless' // Global default
          },
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

      const result = await executor.executeStage(stageConfig, pipelineState);

      expect(result.status).toBe('success');
      // Global default (Headless) should be used
      expect(mockHeadlessRuntime.execute).toHaveBeenCalledTimes(1);
      expect(mockSdkRuntime.execute).not.toHaveBeenCalled();
    });

    it('should fallback to system default (claude-code-headless) when no runtime specified', async () => {
      const mockGitManager = createMockGitManager({ hasChanges: false });
      const executor = new StageExecutor(
        mockGitManager,
        false,
        mockHandoverManager
      );

      const stageConfig: AgentStageConfig = {
        name: 'fallback-stage',
        agent: '.agent-pipeline/agents/test.md',
        timeout: 60
        // No runtime specified
      };

      const pipelineState: PipelineState = {
        runId: 'fallback-test-run',
        pipelineConfig: {
          name: 'fallback-test',
          trigger: 'manual',
          // No runtime specified at pipeline level
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

      const result = await executor.executeStage(stageConfig, pipelineState);

      expect(result.status).toBe('success');
      // System default (claude-code-headless) should be used
      expect(mockHeadlessRuntime.execute).toHaveBeenCalledTimes(1);
      expect(mockSdkRuntime.execute).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Category 4: Context Reduction (Integration level)
  // ============================================================================

  describe('Context Reduction Integration', () => {
    it('should work with Headless runtime for context reduction', async () => {
      const mockGitManager = createMockGitManager({ hasChanges: false });
      const executor = new StageExecutor(
        mockGitManager,
        false,
        mockHandoverManager
      );

      const stageConfig: AgentStageConfig = {
        name: 'context-reduction-stage',
        agent: '.agent-pipeline/agents/test.md',
        timeout: 60,
        runtime: {
          type: 'claude-code-headless'
        }
      };

      const pipelineState: PipelineState = {
        runId: 'context-reduction-run',
        pipelineConfig: {
          name: 'context-reduction-test',
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

      const result = await executor.executeStage(stageConfig, pipelineState);

      expect(result.status).toBe('success');
      expect(mockHeadlessRuntime.execute).toHaveBeenCalled();

      // Verify runtime has context reduction capability
      const capabilities = mockHeadlessRuntime.getCapabilities();
      expect(capabilities.supportsContextReduction).toBe(true);
    });

    it('should work with SDK runtime for context reduction fallback', async () => {
      const mockGitManager = createMockGitManager({ hasChanges: false });
      const executor = new StageExecutor(
        mockGitManager,
        false,
        mockHandoverManager
      );

      const stageConfig: AgentStageConfig = {
        name: 'context-sdk-stage',
        agent: '.agent-pipeline/agents/test.md',
        timeout: 60,
        runtime: {
          type: 'claude-sdk'
        }
      };

      const pipelineState: PipelineState = {
        runId: 'context-sdk-run',
        pipelineConfig: {
          name: 'context-sdk-test',
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

      const result = await executor.executeStage(stageConfig, pipelineState);

      expect(result.status).toBe('success');
      expect(mockSdkRuntime.execute).toHaveBeenCalled();

      // Verify SDK runtime also supports context reduction
      const capabilities = mockSdkRuntime.getCapabilities();
      expect(capabilities.supportsContextReduction).toBe(true);
    });
  });

  // ============================================================================
  // Category 5: Error Handling
  // ============================================================================

  describe('Error Handling', () => {
    it('should handle runtime execution failure and capture in state', async () => {
      // Mock SDK runtime to fail
      const failingSdkRuntime = {
        ...mockSdkRuntime,
        execute: vi.fn().mockRejectedValue(new Error('Runtime execution failed'))
      };

      AgentRuntimeRegistry.clear();
      AgentRuntimeRegistry.register(failingSdkRuntime);
      AgentRuntimeRegistry.register(mockHeadlessRuntime);

      const mockGitManager = createMockGitManager({ hasChanges: false });
      const executor = new StageExecutor(
        mockGitManager,
        false,
        mockHandoverManager
      );

      const stageConfig: AgentStageConfig = {
        name: 'failing-stage',
        agent: '.agent-pipeline/agents/test.md',
        timeout: 60,
        runtime: {
          type: 'claude-sdk'
        }
      };

      const pipelineState: PipelineState = {
        runId: 'failure-test-run',
        pipelineConfig: {
          name: 'failure-test',
          trigger: 'manual',
          settings: {
            failureStrategy: 'stop'
          },
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

      const result = await executor.executeStage(stageConfig, pipelineState);

      expect(result.status).toBe('failed');
      expect(result.error).toBeDefined();
      expect(result.error?.message).toBe('Runtime execution failed');
    });

    it('should enforce timeout for SDK runtime', async () => {
      // Mock SDK runtime to timeout
      const slowSdkRuntime = {
        ...mockSdkRuntime,
        execute: vi.fn().mockImplementation(() =>
          new Promise((resolve) => setTimeout(() => resolve({
            textOutput: 'Late response',
            tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            numTurns: 1
          }), 100000)) // 100 seconds
        )
      };

      AgentRuntimeRegistry.clear();
      AgentRuntimeRegistry.register(slowSdkRuntime);
      AgentRuntimeRegistry.register(mockHeadlessRuntime);

      const mockGitManager = createMockGitManager({ hasChanges: false });
      const executor = new StageExecutor(
        mockGitManager,
        false,
        mockHandoverManager
      );

      const stageConfig: AgentStageConfig = {
        name: 'timeout-stage',
        agent: '.agent-pipeline/agents/test.md',
        timeout: 1, // 1 second timeout
        runtime: {
          type: 'claude-sdk'
        }
      };

      const pipelineState: PipelineState = {
        runId: 'timeout-test-run',
        pipelineConfig: {
          name: 'timeout-test',
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

      // This should timeout
      const result = await executor.executeStage(stageConfig, pipelineState);

      expect(result.status).toBe('failed');
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Agent timeout');
    }, 10000); // 10 second test timeout

    it('should enforce timeout for Headless runtime', async () => {
      // Mock Headless runtime to timeout
      const slowHeadlessRuntime = {
        ...mockHeadlessRuntime,
        execute: vi.fn().mockImplementation(() =>
          new Promise((resolve) => setTimeout(() => resolve({
            textOutput: 'Late response',
            tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            numTurns: 1
          }), 100000)) // 100 seconds
        )
      };

      AgentRuntimeRegistry.clear();
      AgentRuntimeRegistry.register(mockSdkRuntime);
      AgentRuntimeRegistry.register(slowHeadlessRuntime);

      const mockGitManager = createMockGitManager({ hasChanges: false });
      const executor = new StageExecutor(
        mockGitManager,
        false,
        mockHandoverManager
      );

      const stageConfig: AgentStageConfig = {
        name: 'timeout-headless-stage',
        agent: '.agent-pipeline/agents/test.md',
        timeout: 1, // 1 second timeout
        runtime: {
          type: 'claude-code-headless'
        }
      };

      const pipelineState: PipelineState = {
        runId: 'timeout-headless-run',
        pipelineConfig: {
          name: 'timeout-headless-test',
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

      // This should timeout
      const result = await executor.executeStage(stageConfig, pipelineState);

      expect(result.status).toBe('failed');
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Agent timeout');
    }, 10000); // 10 second test timeout

    it('should pass permission mode to runtime.execute() correctly', async () => {
      const mockGitManager = createMockGitManager({ hasChanges: false });
      const executor = new StageExecutor(
        mockGitManager,
        false,
        mockHandoverManager
      );

      const stageConfig: AgentStageConfig = {
        name: 'permission-stage',
        agent: '.agent-pipeline/agents/test.md',
        timeout: 60,
        runtime: {
          type: 'claude-sdk'
        }
      };

      const pipelineState: PipelineState = {
        runId: 'permission-test-run',
        pipelineConfig: {
          name: 'permission-test',
          trigger: 'manual',
          settings: {
            permissionMode: 'acceptEdits' // Test acceptEdits mode
          },
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

      const result = await executor.executeStage(stageConfig, pipelineState);

      expect(result.status).toBe('success');
      expect(mockSdkRuntime.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            permissionMode: 'acceptEdits'
          })
        })
      );
    });
  });
});
