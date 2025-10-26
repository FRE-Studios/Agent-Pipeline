// src/__tests__/analytics/loop-analytics.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PipelineAnalytics } from '../../analytics/pipeline-analytics.js';
import { StateManager } from '../../core/state-manager.js';
import { LoopSession } from '../../core/loop-state-manager.js';

describe('Loop Analytics', () => {
  let analytics: PipelineAnalytics;
  let mockStateManager: StateManager;

  beforeEach(() => {
    mockStateManager = {
      getAllRuns: vi.fn(),
    } as any;
    analytics = new PipelineAnalytics(mockStateManager, '/test/repo');
  });

  const createLoopSession = (overrides: Partial<LoopSession> = {}): LoopSession => ({
    sessionId: 'session-123',
    startTime: '2024-01-15T10:00:00.000Z',
    endTime: '2024-01-15T11:00:00.000Z',
    status: 'completed',
    maxIterations: 100,
    totalIterations: 3,
    iterations: [
      {
        iterationNumber: 1,
        pipelineName: 'pipeline-a',
        runId: 'run-1',
        status: 'completed',
        duration: 1000,
        triggeredNext: true
      },
      {
        iterationNumber: 2,
        pipelineName: 'pipeline-b',
        runId: 'run-2',
        status: 'completed',
        duration: 1500,
        triggeredNext: true
      },
      {
        iterationNumber: 3,
        pipelineName: 'pipeline-c',
        runId: 'run-3',
        status: 'completed',
        duration: 2000,
        triggeredNext: false
      }
    ],
    ...overrides
  });

  describe('generateLoopMetrics()', () => {
    it('should return zero metrics when no loop sessions exist', async () => {
      const loopStateManager = (analytics as any).loopStateManager;
      vi.spyOn(loopStateManager, 'getAllSessions').mockResolvedValue([]);

      const metrics = await analytics.generateLoopMetrics();

      expect(metrics.totalSessions).toBe(0);
      expect(metrics.completedSessions).toBe(0);
      expect(metrics.failedSessions).toBe(0);
      expect(metrics.limitReachedSessions).toBe(0);
      expect(metrics.totalIterations).toBe(0);
      expect(metrics.averageIterationsPerSession).toBe(0);
      expect(metrics.mostCommonPipelines.size).toBe(0);
      expect(metrics.terminationReasons.size).toBe(0);
    });

    it('should calculate metrics for completed sessions', async () => {
      const sessions = [
        createLoopSession({
          sessionId: 'session-1',
          status: 'completed',
          totalIterations: 3
        }),
        createLoopSession({
          sessionId: 'session-2',
          status: 'completed',
          totalIterations: 5
        })
      ];

      const loopStateManager = (analytics as any).loopStateManager;
      vi.spyOn(loopStateManager, 'getAllSessions').mockResolvedValue(sessions);

      const metrics = await analytics.generateLoopMetrics();

      expect(metrics.totalSessions).toBe(2);
      expect(metrics.completedSessions).toBe(2);
      expect(metrics.failedSessions).toBe(0);
      expect(metrics.limitReachedSessions).toBe(0);
      expect(metrics.totalIterations).toBe(8);
      expect(metrics.averageIterationsPerSession).toBe(4);
    });

    it('should calculate metrics for mixed session statuses', async () => {
      const sessions = [
        createLoopSession({ sessionId: 'session-1', status: 'completed', totalIterations: 3 }),
        createLoopSession({ sessionId: 'session-2', status: 'failed', totalIterations: 2 }),
        createLoopSession({ sessionId: 'session-3', status: 'limit-reached', totalIterations: 100 })
      ];

      const loopStateManager = (analytics as any).loopStateManager;
      vi.spyOn(loopStateManager, 'getAllSessions').mockResolvedValue(sessions);

      const metrics = await analytics.generateLoopMetrics();

      expect(metrics.totalSessions).toBe(3);
      expect(metrics.completedSessions).toBe(1);
      expect(metrics.failedSessions).toBe(1);
      expect(metrics.limitReachedSessions).toBe(1);
      expect(metrics.totalIterations).toBe(105);
      expect(metrics.averageIterationsPerSession).toBeCloseTo(35, 1);
    });

    it('should count most common pipelines correctly', async () => {
      const session1 = createLoopSession({
        sessionId: 'session-1',
        iterations: [
          {
            iterationNumber: 1,
            pipelineName: 'pipeline-a',
            runId: 'run-1',
            status: 'completed',
            duration: 1000,
            triggeredNext: true
          },
          {
            iterationNumber: 2,
            pipelineName: 'pipeline-a',
            runId: 'run-2',
            status: 'completed',
            duration: 1000,
            triggeredNext: false
          }
        ],
        totalIterations: 2
      });

      const session2 = createLoopSession({
        sessionId: 'session-2',
        iterations: [
          {
            iterationNumber: 1,
            pipelineName: 'pipeline-a',
            runId: 'run-3',
            status: 'completed',
            duration: 1000,
            triggeredNext: true
          },
          {
            iterationNumber: 2,
            pipelineName: 'pipeline-b',
            runId: 'run-4',
            status: 'completed',
            duration: 1000,
            triggeredNext: false
          }
        ],
        totalIterations: 2
      });

      const loopStateManager = (analytics as any).loopStateManager;
      vi.spyOn(loopStateManager, 'getAllSessions').mockResolvedValue([session1, session2]);

      const metrics = await analytics.generateLoopMetrics();

      expect(metrics.mostCommonPipelines.get('pipeline-a')).toBe(3);
      expect(metrics.mostCommonPipelines.get('pipeline-b')).toBe(1);
    });

    it('should count termination reasons correctly', async () => {
      const sessions = [
        createLoopSession({ status: 'completed' }),
        createLoopSession({ status: 'completed' }),
        createLoopSession({ status: 'failed' }),
        createLoopSession({ status: 'limit-reached' })
      ];

      const loopStateManager = (analytics as any).loopStateManager;
      vi.spyOn(loopStateManager, 'getAllSessions').mockResolvedValue(sessions);

      const metrics = await analytics.generateLoopMetrics();

      expect(metrics.terminationReasons.get('completed')).toBe(2);
      expect(metrics.terminationReasons.get('failed')).toBe(1);
      expect(metrics.terminationReasons.get('limit-reached')).toBe(1);
    });

    it('should filter sessions by time range', async () => {
      const sessions = [
        createLoopSession({
          sessionId: 'session-1',
          startTime: '2024-01-15T10:00:00.000Z',
          totalIterations: 3
        }),
        createLoopSession({
          sessionId: 'session-2',
          startTime: '2024-01-16T10:00:00.000Z',
          totalIterations: 5
        }),
        createLoopSession({
          sessionId: 'session-3',
          startTime: '2024-01-17T10:00:00.000Z',
          totalIterations: 2
        })
      ];

      const loopStateManager = (analytics as any).loopStateManager;
      vi.spyOn(loopStateManager, 'getAllSessions').mockResolvedValue(sessions);

      const metrics = await analytics.generateLoopMetrics({
        start: new Date('2024-01-15T00:00:00.000Z'),
        end: new Date('2024-01-16T23:59:59.999Z')
      });

      expect(metrics.totalSessions).toBe(2);
      expect(metrics.totalIterations).toBe(8);
    });

    it('should handle sessions with no iterations', async () => {
      const session = createLoopSession({
        iterations: [],
        totalIterations: 0
      });

      const loopStateManager = (analytics as any).loopStateManager;
      vi.spyOn(loopStateManager, 'getAllSessions').mockResolvedValue([session]);

      const metrics = await analytics.generateLoopMetrics();

      expect(metrics.totalSessions).toBe(1);
      expect(metrics.totalIterations).toBe(0);
      expect(metrics.mostCommonPipelines.size).toBe(0);
    });
  });
});
