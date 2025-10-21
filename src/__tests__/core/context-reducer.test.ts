// src/__tests__/core/context-reducer.test.ts

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContextReducer } from '../../core/context-reducer.js';
import { GitManager } from '../../core/git-manager.js';
import { PipelineState, AgentStageConfig, ContextReductionConfig } from '../../config/schema.js';
import * as fs from 'fs/promises';

// Mock dependencies
vi.mock('fs/promises');

// Hoist the mock query function
const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn()
}));

// Mock the Claude SDK globally
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: mockQuery
}));

describe('ContextReducer', () => {
  let contextReducer: ContextReducer;
  let mockGitManager: GitManager;
  const repoPath = '/mock/repo';
  const runId = 'test-run-123';

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    mockGitManager = {
      getCurrentCommit: vi.fn().mockResolvedValue('abc123'),
      getChangedFiles: vi.fn().mockResolvedValue([])
    } as any;

    contextReducer = new ContextReducer(mockGitManager, repoPath, runId);
  });

  describe('shouldReduce', () => {
    it('should return true when token count exceeds triggerThreshold', () => {
      const config: ContextReductionConfig = {
        enabled: true,
        maxTokens: 50000,
        strategy: 'agent-based',
        triggerThreshold: 45000
      };

      const result = contextReducer.shouldReduce(46000, config);
      expect(result).toBe(true);
    });

    it('should return false when token count is below triggerThreshold', () => {
      const config: ContextReductionConfig = {
        enabled: true,
        maxTokens: 50000,
        strategy: 'agent-based',
        triggerThreshold: 45000
      };

      const result = contextReducer.shouldReduce(40000, config);
      expect(result).toBe(false);
    });

    it('should use 90% of maxTokens as default threshold when triggerThreshold not specified', () => {
      const config: ContextReductionConfig = {
        enabled: true,
        maxTokens: 50000,
        strategy: 'agent-based'
      };

      // 90% of 50000 = 45000
      expect(contextReducer.shouldReduce(44999, config)).toBe(false);
      expect(contextReducer.shouldReduce(45000, config)).toBe(true);
      expect(contextReducer.shouldReduce(45001, config)).toBe(true);
    });

    it('should handle custom triggerThreshold correctly', () => {
      const config: ContextReductionConfig = {
        enabled: true,
        maxTokens: 100000,
        strategy: 'agent-based',
        triggerThreshold: 80000
      };

      expect(contextReducer.shouldReduce(79999, config)).toBe(false);
      expect(contextReducer.shouldReduce(80000, config)).toBe(true);
    });
  });

  describe('applyReduction', () => {
    let mockState: PipelineState;

    beforeEach(() => {
      mockState = {
        runId: 'test-run',
        pipelineConfig: {
          name: 'test-pipeline',
          trigger: 'manual',
          settings: {
            autoCommit: true,
            commitPrefix: '[test]',
            failureStrategy: 'stop',
            preserveWorkingTree: false,
            contextReduction: {
              enabled: true,
              maxTokens: 50000,
              strategy: 'agent-based',
              contextWindow: 3
            }
          },
          agents: []
        },
        trigger: {
          type: 'manual',
          commitSha: 'abc123',
          timestamp: '2024-01-01T00:00:00Z'
        },
        stages: [
          {
            stageName: 'stage-1',
            status: 'success',
            startTime: '2024-01-01T00:00:00Z',
            endTime: '2024-01-01T00:01:00Z',
            duration: 60
          },
          {
            stageName: 'stage-2',
            status: 'success',
            startTime: '2024-01-01T00:01:00Z',
            endTime: '2024-01-01T00:02:00Z',
            duration: 60
          },
          {
            stageName: 'stage-3',
            status: 'success',
            startTime: '2024-01-01T00:02:00Z',
            endTime: '2024-01-01T00:03:00Z',
            duration: 60
          },
          {
            stageName: 'stage-4',
            status: 'success',
            startTime: '2024-01-01T00:03:00Z',
            endTime: '2024-01-01T00:04:00Z',
            duration: 60
          },
          {
            stageName: 'stage-5',
            status: 'success',
            startTime: '2024-01-01T00:04:00Z',
            endTime: '2024-01-01T00:05:00Z',
            duration: 60
          }
        ],
        status: 'running',
        artifacts: {
          initialCommit: 'abc123',
          changedFiles: [],
          totalDuration: 0
        }
      };
    });

    it('should replace older stages with reducer summary and keep recent stages', () => {
      const reducerOutput = {
        stageName: '__context_reducer__',
        status: 'success' as const,
        startTime: '2024-01-01T00:05:00Z',
        endTime: '2024-01-01T00:05:30Z',
        duration: 30,
        extractedData: {
          summary: 'Context reduced successfully',
          critical_findings: ['Finding 1', 'Finding 2']
        }
      };

      const reducedState = contextReducer.applyReduction(mockState, reducerOutput);

      // Should have reducer stage + last 3 stages (contextWindow = 3)
      expect(reducedState.stages).toHaveLength(4);
      expect(reducedState.stages[0].stageName).toBe('__context_reducer__');
      expect(reducedState.stages[1].stageName).toBe('stage-3');
      expect(reducedState.stages[2].stageName).toBe('stage-4');
      expect(reducedState.stages[3].stageName).toBe('stage-5');
    });

    it('should return original state when reducer output status is failed', () => {
      const reducerOutput = {
        stageName: '__context_reducer__',
        status: 'failed' as const,
        startTime: '2024-01-01T00:05:00Z',
        endTime: '2024-01-01T00:05:30Z',
        duration: 30,
        error: {
          message: 'Reducer failed'
        }
      };

      const reducedState = contextReducer.applyReduction(mockState, reducerOutput);

      // State should be unchanged
      expect(reducedState).toEqual(mockState);
      expect(reducedState.stages).toHaveLength(5);
    });

    it('should handle case when there are fewer stages than contextWindow', () => {
      const smallState = {
        ...mockState,
        stages: [
          {
            stageName: 'stage-1',
            status: 'success' as const,
            startTime: '2024-01-01T00:00:00Z',
            endTime: '2024-01-01T00:01:00Z',
            duration: 60
          }
        ]
      };

      const reducerOutput = {
        stageName: '__context_reducer__',
        status: 'success' as const,
        startTime: '2024-01-01T00:01:00Z',
        endTime: '2024-01-01T00:01:30Z',
        duration: 30,
        extractedData: {
          summary: 'Context reduced'
        }
      };

      const reducedState = contextReducer.applyReduction(smallState, reducerOutput);

      // Should have reducer stage + the 1 existing stage
      expect(reducedState.stages).toHaveLength(2);
      expect(reducedState.stages[0].stageName).toBe('__context_reducer__');
      expect(reducedState.stages[1].stageName).toBe('stage-1');
    });
  });

  describe('runReduction', () => {
    let mockState: PipelineState;
    let mockUpcomingStage: AgentStageConfig;

    beforeEach(() => {
      // Setup default file read mocks (will be overridden in individual tests if needed)
      vi.mocked(fs.readFile).mockResolvedValue('# Security Auditor Agent\nScan for vulnerabilities...');

      mockState = {
        runId: 'test-run',
        pipelineConfig: {
          name: 'test-pipeline',
          trigger: 'manual',
          settings: {
            autoCommit: true,
            commitPrefix: '[test]',
            failureStrategy: 'stop',
            preserveWorkingTree: false
          },
          agents: []
        },
        trigger: {
          type: 'manual',
          commitSha: 'abc123',
          timestamp: '2024-01-01T00:00:00Z'
        },
        stages: [
          {
            stageName: 'code-review',
            status: 'success',
            startTime: '2024-01-01T00:00:00Z',
            endTime: '2024-01-01T00:01:00Z',
            duration: 60,
            extractedData: {
              issues_found: 5,
              severity: 'high'
            },
            agentOutput: 'Found 5 issues in code review'
          }
        ],
        status: 'running',
        artifacts: {
          initialCommit: 'abc123',
          changedFiles: [],
          totalDuration: 0
        }
      };

      mockUpcomingStage = {
        name: 'security-scan',
        agent: '.claude/agents/security-auditor.md'
      };
    });

    it('should handle agent file read failure gracefully', async () => {
      vi.mocked(fs.readFile).mockRejectedValueOnce(new Error('File not found'));

      const reducerAgentPath = '.claude/agents/context-reducer.md';

      // Mock the reducer agent response to succeed
      const mockAsyncIterator = (async function* () {
        yield {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                name: 'report_outputs',
                input: {
                  outputs: {
                    summary: 'Context reduced',
                    critical_findings: []
                  }
                }
              }
            ]
          }
        };
      })();

      mockQuery.mockReturnValueOnce(mockAsyncIterator as any);

      const result = await contextReducer.runReduction(mockState, mockUpcomingStage, reducerAgentPath);

      // Should still complete successfully even if agent file wasn't read
      expect(result.status).toBe('success');
    });

    it('should return failed execution when reducer agent fails', async () => {
      // Mock query to throw error
      mockQuery.mockImplementationOnce(() => {
        throw new Error('Agent execution failed');
      });

      const reducerAgentPath = '.claude/agents/context-reducer.md';
      vi.mocked(fs.readFile).mockResolvedValue('# Context Reducer\nReduce context...');

      const result = await contextReducer.runReduction(mockState, mockUpcomingStage, reducerAgentPath);

      expect(result.status).toBe('failed');
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Agent execution failed');
    });

    it('should create execution with correct metadata on success', async () => {
      const mockAsyncIterator = (async function* () {
        yield {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'text',
                text: 'Context has been reduced'
              },
              {
                type: 'tool_use',
                name: 'report_outputs',
                input: {
                  outputs: {
                    summary: 'Reduced context from 5 stages',
                    critical_findings: ['Finding 1'],
                    metrics: { 'code-review': { issues_found: 5 } }
                  }
                }
              }
            ]
          }
        };
      })();

      mockQuery.mockReturnValueOnce(mockAsyncIterator as any);

      const reducerAgentPath = '.claude/agents/context-reducer.md';
      vi.mocked(fs.readFile).mockResolvedValue('# Context Reducer\nReduce context...');

      const result = await contextReducer.runReduction(mockState, mockUpcomingStage, reducerAgentPath);

      expect(result.stageName).toBe('__context_reducer__');
      expect(result.status).toBe('success');
      expect(result.startTime).toBeDefined();
      expect(result.endTime).toBeDefined();
      expect(result.duration).toBeGreaterThan(0);
      expect(result.extractedData).toEqual({
        summary: 'Reduced context from 5 stages',
        critical_findings: ['Finding 1'],
        metrics: { 'code-review': { issues_found: 5 } }
      });
      expect(result.agentOutput).toContain('Context has been reduced');
    });
  });

  describe('integration scenarios', () => {
    it('should handle complete reduction workflow', async () => {
      const config: ContextReductionConfig = {
        enabled: true,
        maxTokens: 50000,
        strategy: 'agent-based',
        triggerThreshold: 45000,
        contextWindow: 3
      };

      const mockState: PipelineState = {
        runId: 'test-run',
        pipelineConfig: {
          name: 'test-pipeline',
          trigger: 'manual',
          settings: {
            autoCommit: true,
            commitPrefix: '[test]',
            failureStrategy: 'stop',
            preserveWorkingTree: false,
            contextReduction: config
          },
          agents: []
        },
        trigger: {
          type: 'manual',
          commitSha: 'abc123',
          timestamp: '2024-01-01T00:00:00Z'
        },
        stages: Array.from({ length: 8 }, (_, i) => ({
          stageName: `stage-${i + 1}`,
          status: 'success' as const,
          startTime: '2024-01-01T00:00:00Z',
          endTime: '2024-01-01T00:01:00Z',
          duration: 60,
          extractedData: { data: `output-${i + 1}` }
        })),
        status: 'running',
        artifacts: {
          initialCommit: 'abc123',
          changedFiles: [],
          totalDuration: 0
        }
      };

      // 1. Check if reduction needed
      const tokenCount = 46000;
      const needsReduction = contextReducer.shouldReduce(tokenCount, config);
      expect(needsReduction).toBe(true);

      // 2. Mock reducer execution
      const mockAsyncIterator = (async function* () {
        yield {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                name: 'report_outputs',
                input: {
                  outputs: {
                    summary: 'Context reduced from 8 stages',
                    stage_summaries: {
                      'stage-1': 'Summary 1',
                      'stage-2': 'Summary 2'
                    }
                  }
                }
              }
            ]
          }
        };
      })();

      mockQuery.mockReturnValueOnce(mockAsyncIterator as any);
      vi.mocked(fs.readFile).mockResolvedValue('# Context Reducer');

      const upcomingStage: AgentStageConfig = {
        name: 'next-stage',
        agent: '.claude/agents/next.md'
      };

      const reducerOutput = await contextReducer.runReduction(
        mockState,
        upcomingStage,
        '.claude/agents/context-reducer.md'
      );

      expect(reducerOutput.status).toBe('success');

      // 3. Apply reduction
      const reducedState = contextReducer.applyReduction(mockState, reducerOutput);

      // Should have reducer + last 3 stages
      expect(reducedState.stages).toHaveLength(4);
      expect(reducedState.stages[0].stageName).toBe('__context_reducer__');
      expect(reducedState.stages[1].stageName).toBe('stage-6');
      expect(reducedState.stages[2].stageName).toBe('stage-7');
      expect(reducedState.stages[3].stageName).toBe('stage-8');
    });
  });
});
