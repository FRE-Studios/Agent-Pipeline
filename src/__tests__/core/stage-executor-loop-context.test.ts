// src/__tests__/core/stage-executor-loop-context.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StageExecutor } from '../../core/stage-executor.js';
import { GitManager } from '../../core/git-manager.js';
import { HandoverManager } from '../../core/handover-manager.js';
import { AgentStageConfig, PipelineState, LoopContext } from '../../config/schema.js';

// Mock dependencies
vi.mock('../../core/git-manager.js');
vi.mock('../../core/handover-manager.js');
vi.mock('../../utils/token-estimator.js', () => ({
  TokenEstimator: vi.fn(() => ({
    estimateTokens: vi.fn(() => 1000),
    smartCount: vi.fn(() => Promise.resolve({ tokens: 1000, method: 'fast' })),
    dispose: vi.fn()
  }))
}));

describe('StageExecutor - Loop Context Injection', () => {
  let mockGitManager: GitManager;
  let mockHandoverManager: HandoverManager;
  let mockPipelineState: PipelineState;
  let mockStageConfig: AgentStageConfig;

  beforeEach(() => {
    mockGitManager = new GitManager('/test/repo');
    mockHandoverManager = new HandoverManager('/test/repo', 'test-pipeline', 'test-run-123');

    // Setup mock methods
    vi.mocked(mockHandoverManager.getPreviousStages).mockResolvedValue([]);
    vi.mocked(mockHandoverManager.buildContextMessage).mockReturnValue('## Pipeline Handover Context\n\n**Handover Directory:** `/test/repo/test-pipeline-test-run`');
    vi.mocked(mockHandoverManager.buildContextMessageAsync).mockResolvedValue('## Pipeline Handover Context\n\n**Handover Directory:** `/test/repo/test-pipeline-test-run`');

    mockPipelineState = {
      runId: 'test-run-123',
      pipelineConfig: {
        name: 'test-pipeline',
        trigger: 'manual',
        settings: {
          autoCommit: true,
          commitPrefix: '[pipeline]',
          failureStrategy: 'stop',
          preserveWorkingTree: false
        },
        agents: []
      },
      trigger: {
        type: 'manual',
        commitSha: 'abc123',
        timestamp: '2025-01-01T00:00:00Z'
      },
      stages: [],
      status: 'running',
      artifacts: {
        initialCommit: 'abc123',
        changedFiles: ['file1.ts', 'file2.ts'],
        totalDuration: 0
      }
    };

    mockStageConfig = {
      name: 'test-stage',
      agent: '/test/agent.md'
    };
  });

  describe('buildAgentContext with loopContext', () => {
    it('should include loop instructions when loopContext.enabled is true', async () => {
      const loopContext: LoopContext = {
        enabled: true,
        directories: {
          pending: '/repo/.agent-pipeline/next/pending',
          running: '/repo/.agent-pipeline/next/running',
          finished: '/repo/.agent-pipeline/next/finished',
          failed: '/repo/.agent-pipeline/next/failed'
        },
        currentIteration: 3,
        maxIterations: 100
      };

      const executor = new StageExecutor(
        mockGitManager,
        false,
        mockHandoverManager,
        undefined,  // No default runtime
        loopContext
      );

      // Access private method via type assertion for testing
      const context = await (executor as any).buildAgentContext(mockStageConfig, mockPipelineState);

      expect(context).toContain('Pipeline Looping');
      expect(context).toContain('LOOP MODE');
      expect(context).toContain('/repo/.agent-pipeline/next/pending');
      expect(context).toContain('Iteration: 3/100');
      expect(context).toContain('To queue the next pipeline:');
      expect(context).toContain('Write a valid pipeline YAML file to');
    });

    it('should NOT include loop section when loopContext is undefined', async () => {
      const executor = new StageExecutor(
        mockGitManager,
        false,
        mockHandoverManager,
        undefined,  // No default runtime
        undefined  // No loop context
      );

      const context = await (executor as any).buildAgentContext(mockStageConfig, mockPipelineState);

      expect(context).not.toContain('Pipeline Looping');
      expect(context).not.toContain('LOOP MODE');
      expect(context).not.toContain('To queue the next pipeline:');
    });

    it('should NOT include loop section when loopContext.enabled is false', async () => {
      const loopContext: LoopContext = {
        enabled: false,
        directories: {
          pending: '/repo/.agent-pipeline/next/pending',
          running: '/repo/.agent-pipeline/next/running',
          finished: '/repo/.agent-pipeline/next/finished',
          failed: '/repo/.agent-pipeline/next/failed'
        }
      };

      const executor = new StageExecutor(
        mockGitManager,
        false,
        mockHandoverManager,
        undefined,  // No default runtime
        loopContext
      );

      const context = await (executor as any).buildAgentContext(mockStageConfig, mockPipelineState);

      expect(context).not.toContain('Pipeline Looping');
      expect(context).not.toContain('LOOP MODE');
    });

    it('should include correct directory paths in loop instructions', async () => {
      const customDirs = {
        pending: '/custom/path/pending',
        running: '/custom/path/running',
        finished: '/custom/path/finished',
        failed: '/custom/path/failed'
      };

      const loopContext: LoopContext = {
        enabled: true,
        directories: customDirs,
        currentIteration: 1,
        maxIterations: 50
      };

      const executor = new StageExecutor(
        mockGitManager,
        false,
        mockHandoverManager,
        undefined,  // No default runtime
        loopContext
      );

      const context = await (executor as any).buildAgentContext(mockStageConfig, mockPipelineState);

      expect(context).toContain('/custom/path/pending');
      expect(context).toContain('Iteration: 1/50');
    });

    it('should handle missing optional iteration fields gracefully', async () => {
      const loopContext: LoopContext = {
        enabled: true,
        directories: {
          pending: '/repo/.agent-pipeline/next/pending',
          running: '/repo/.agent-pipeline/next/running',
          finished: '/repo/.agent-pipeline/next/finished',
          failed: '/repo/.agent-pipeline/next/failed'
        }
        // No currentIteration or maxIterations
      };

      const executor = new StageExecutor(
        mockGitManager,
        false,
        mockHandoverManager,
        undefined,  // No default runtime
        loopContext
      );

      const context = await (executor as any).buildAgentContext(mockStageConfig, mockPipelineState);

      expect(context).toContain('Pipeline Looping');
      expect(context).toContain('LOOP MODE');
      // Should handle undefined gracefully
      expect(context).toContain('Iteration: undefined/undefined');
    });

    it('should include loop section before inputs section', async () => {
      const loopContext: LoopContext = {
        enabled: true,
        directories: {
          pending: '/repo/.agent-pipeline/next/pending',
          running: '/repo/.agent-pipeline/next/running',
          finished: '/repo/.agent-pipeline/next/finished',
          failed: '/repo/.agent-pipeline/next/failed'
        },
        currentIteration: 2,
        maxIterations: 10
      };

      const executor = new StageExecutor(
        mockGitManager,
        false,
        mockHandoverManager,
        undefined,  // No default runtime
        loopContext
      );

      const context = await (executor as any).buildAgentContext(mockStageConfig, mockPipelineState);

      // Verify loop section is included
      expect(context).toContain('Pipeline Looping');
      expect(context).toContain('2/10');
    });

    it('should include all standard context sections alongside loop context', async () => {
      const loopContext: LoopContext = {
        enabled: true,
        directories: {
          pending: '/repo/.agent-pipeline/next/pending',
          running: '/repo/.agent-pipeline/next/running',
          finished: '/repo/.agent-pipeline/next/finished',
          failed: '/repo/.agent-pipeline/next/failed'
        },
        currentIteration: 5,
        maxIterations: 20
      };

      const executor = new StageExecutor(
        mockGitManager,
        false,
        mockHandoverManager,
        undefined,  // No default runtime
        loopContext
      );

      const context = await (executor as any).buildAgentContext(mockStageConfig, mockPipelineState);

      // Verify all sections are present
      expect(context).toContain('Pipeline Context');
      expect(context).toContain('test-run-123');
      expect(context).toContain('test-stage');
      expect(context).toContain('abc123');
      expect(context).toContain('Pipeline Looping');
    });
  });

  describe('buildLoopContextSectionAsync helper', () => {
    it('should return empty string when loopContext is undefined', async () => {
      const executor = new StageExecutor(
        mockGitManager,
        false,
        mockHandoverManager,
        undefined
      );

      const result = await (executor as any).buildLoopContextSectionAsync();
      expect(result).toBe('');
    });

    it('should return empty string when loopContext.enabled is false', async () => {
      const loopContext: LoopContext = {
        enabled: false,
        directories: {
          pending: '/test/pending',
          running: '/test/running',
          finished: '/test/finished',
          failed: '/test/failed'
        }
      };

      const executor = new StageExecutor(
        mockGitManager,
        false,
        mockHandoverManager,
        undefined,  // No default runtime
        loopContext
      );

      const result = await (executor as any).buildLoopContextSectionAsync();
      expect(result).toBe('');
    });

    it('should return formatted loop instructions when enabled', async () => {
      const loopContext: LoopContext = {
        enabled: true,
        directories: {
          pending: '/test/pending',
          running: '/test/running',
          finished: '/test/finished',
          failed: '/test/failed'
        },
        currentIteration: 7,
        maxIterations: 25
      };

      const executor = new StageExecutor(
        mockGitManager,
        false,
        mockHandoverManager,
        undefined,  // No default runtime
        loopContext
      );

      const result = await (executor as any).buildLoopContextSectionAsync();

      expect(result).toContain('## Pipeline Looping');
      expect(result).toContain('LOOP MODE');
      expect(result).toContain('/test/pending');
      expect(result).toContain('7/25');
      expect(result).not.toContain('\n\n\n'); // No excessive newlines
    });
  });
});
