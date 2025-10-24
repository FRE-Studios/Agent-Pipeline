import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PipelineAnalytics } from '../../analytics/pipeline-analytics.js';
import { StateManager } from '../../core/state-manager.js';
import {
  analyticsSuccessRun1,
  analyticsSuccessRun2,
  analyticsFailedRun1,
  analyticsFailedRun2,
  analyticsMultiDayRun1,
  analyticsSameErrorRun,
  analyticsMultiStageRun,
  analyticsSkippedStageRun,
  completedPipelineState,
} from '../fixtures/pipeline-states.js';
import { simplePipelineConfig, parallelPipelineConfig } from '../fixtures/pipeline-configs.js';

describe('PipelineAnalytics', () => {
  let analytics: PipelineAnalytics;
  let mockStateManager: StateManager;

  beforeEach(() => {
    mockStateManager = {
      getAllRuns: vi.fn(),
    } as any;
    analytics = new PipelineAnalytics(mockStateManager);
  });

  describe('generateMetrics()', () => {
    describe('filtering', () => {
      it('should generate metrics for all runs when no filters provided', async () => {
        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([
          analyticsSuccessRun1,
          analyticsSuccessRun2,
          analyticsFailedRun1,
        ]);

        const metrics = await analytics.generateMetrics();

        expect(metrics.totalRuns).toBe(3);
        expect(metrics.successRate).toBe(2 / 3);
      });

      it('should filter by pipeline name correctly', async () => {
        const customConfig = { ...simplePipelineConfig, name: 'custom-pipeline' };
        const customRun = { ...analyticsSuccessRun1, pipelineConfig: customConfig };

        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([
          analyticsSuccessRun1,
          analyticsSuccessRun2,
          customRun,
        ]);

        const metrics = await analytics.generateMetrics('custom-pipeline');

        expect(metrics.totalRuns).toBe(1);
      });

      it('should filter by time range (start/end dates)', async () => {
        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([
          analyticsSuccessRun1, // 2024-01-15T10:00:00.000Z
          analyticsSuccessRun2, // 2024-01-15T14:00:00.000Z
          analyticsFailedRun1, // 2024-01-16T09:00:00.000Z
        ]);

        const metrics = await analytics.generateMetrics(undefined, {
          start: new Date('2024-01-15T00:00:00.000Z'),
          end: new Date('2024-01-15T23:59:59.999Z'),
        });

        expect(metrics.totalRuns).toBe(2);
      });

      it('should apply both pipeline name and time range filters', async () => {
        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([
          analyticsSuccessRun1, // simple-test, 2024-01-15T10:00:00.000Z
          analyticsSuccessRun2, // simple-test, 2024-01-15T14:00:00.000Z
          analyticsFailedRun1, // simple-test, 2024-01-16T09:00:00.000Z
        ]);

        const metrics = await analytics.generateMetrics('simple-test', {
          start: new Date('2024-01-15T00:00:00.000Z'),
          end: new Date('2024-01-15T23:59:59.999Z'),
        });

        expect(metrics.totalRuns).toBe(2);
      });

      it('should handle no matching runs after filtering', async () => {
        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([
          analyticsSuccessRun1,
          analyticsSuccessRun2,
        ]);

        const metrics = await analytics.generateMetrics('non-existent-pipeline');

        expect(metrics.totalRuns).toBe(0);
        expect(metrics.successRate).toBe(0);
        expect(metrics.averageDuration).toBe(0);
      });

      it('should handle time range with runs on boundary dates', async () => {
        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([
          analyticsSuccessRun1, // 2024-01-15T10:00:00.000Z
          analyticsSuccessRun2, // 2024-01-15T14:00:00.000Z
        ]);

        const metrics = await analytics.generateMetrics(undefined, {
          start: new Date('2024-01-15T10:00:00.000Z'),
          end: new Date('2024-01-15T14:00:00.000Z'),
        });

        expect(metrics.totalRuns).toBe(2);
      });
    });

    describe('calculations', () => {
      it('should calculate total runs correctly', async () => {
        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([
          analyticsSuccessRun1,
          analyticsSuccessRun2,
          analyticsFailedRun1,
          analyticsFailedRun2,
        ]);

        const metrics = await analytics.generateMetrics();

        expect(metrics.totalRuns).toBe(4);
      });

      it('should calculate 100% success rate when all runs succeed', async () => {
        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([
          analyticsSuccessRun1,
          analyticsSuccessRun2,
        ]);

        const metrics = await analytics.generateMetrics();

        expect(metrics.successRate).toBe(1);
      });

      it('should calculate 0% success rate when all runs fail', async () => {
        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([
          analyticsFailedRun1,
          analyticsFailedRun2,
        ]);

        const metrics = await analytics.generateMetrics();

        expect(metrics.successRate).toBe(0);
      });

      it('should calculate 50% success rate correctly', async () => {
        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([
          analyticsSuccessRun1,
          analyticsFailedRun1,
        ]);

        const metrics = await analytics.generateMetrics();

        expect(metrics.successRate).toBe(0.5);
      });

      it('should calculate average duration correctly', async () => {
        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([
          analyticsSuccessRun1, // totalDuration: 120000
          analyticsSuccessRun2, // totalDuration: 180000
        ]);

        const metrics = await analytics.generateMetrics();

        expect(metrics.averageDuration).toBe(150000);
      });

      it('should handle empty runs (0 total, 0 average, 0 success rate)', async () => {
        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([]);

        const metrics = await analytics.generateMetrics();

        expect(metrics.totalRuns).toBe(0);
        expect(metrics.successRate).toBe(0);
        expect(metrics.averageDuration).toBe(0);
        expect(metrics.stageMetrics.size).toBe(0);
        expect(metrics.failureReasons.size).toBe(0);
        expect(metrics.trendsOverTime.length).toBe(0);
      });

      it('should aggregate stageMetrics from calculateStageMetrics', async () => {
        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([
          analyticsSuccessRun1, // has stage-1 and stage-2
        ]);

        const metrics = await analytics.generateMetrics();

        expect(metrics.stageMetrics).toBeInstanceOf(Map);
        expect(metrics.stageMetrics.size).toBeGreaterThan(0);
      });

      it('should aggregate failureReasons from analyzeFailures', async () => {
        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([
          analyticsFailedRun1, // has failure
        ]);

        const metrics = await analytics.generateMetrics();

        expect(metrics.failureReasons).toBeInstanceOf(Map);
        expect(metrics.failureReasons.size).toBeGreaterThan(0);
      });

      it('should aggregate trendsOverTime from calculateTrends', async () => {
        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([
          analyticsSuccessRun1,
        ]);

        const metrics = await analytics.generateMetrics();

        expect(Array.isArray(metrics.trendsOverTime)).toBe(true);
        expect(metrics.trendsOverTime.length).toBeGreaterThan(0);
      });

      it('should handle partial status in success rate calculation', async () => {
        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([
          analyticsSuccessRun1, // completed
          analyticsMultiStageRun, // partial (not counted as success)
        ]);

        const metrics = await analytics.generateMetrics();

        expect(metrics.totalRuns).toBe(2);
        expect(metrics.successRate).toBe(0.5); // Only completed counts as success
      });
    });
  });

  describe('calculateStageMetrics()', () => {
    describe('basic functionality', () => {
      it('should create metrics for single stage in single run', async () => {
        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([
          completedPipelineState,
        ]);

        const metrics = await analytics.generateMetrics();
        const stageMetrics = metrics.stageMetrics;

        expect(stageMetrics.size).toBeGreaterThan(0);
        expect(stageMetrics.get('stage-1')).toBeDefined();
      });

      it('should aggregate metrics across multiple runs for same stage', async () => {
        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([
          analyticsSuccessRun1, // has stage-1
          analyticsSuccessRun2, // has stage-1
        ]);

        const metrics = await analytics.generateMetrics();
        const stage1Metrics = metrics.stageMetrics.get('stage-1');

        expect(stage1Metrics).toBeDefined();
        expect(stage1Metrics!.totalRuns).toBe(2);
      });

      it('should handle multiple different stages', async () => {
        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([
          analyticsMultiStageRun, // has review, security, quality
        ]);

        const metrics = await analytics.generateMetrics();

        expect(metrics.stageMetrics.size).toBe(3);
        expect(metrics.stageMetrics.has('review')).toBe(true);
        expect(metrics.stageMetrics.has('security')).toBe(true);
        expect(metrics.stageMetrics.has('quality')).toBe(true);
      });

      it('should return empty Map for empty runs array', async () => {
        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([]);

        const metrics = await analytics.generateMetrics();

        expect(metrics.stageMetrics.size).toBe(0);
      });
    });

    describe('success rate calculations', () => {
      it('should calculate 100% success rate when all stages succeed', async () => {
        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([
          analyticsSuccessRun1, // both stages succeed
        ]);

        const metrics = await analytics.generateMetrics();
        const stage1Metrics = metrics.stageMetrics.get('stage-1');

        expect(stage1Metrics!.successRate).toBe(1);
      });

      it('should calculate 0% success rate when all stages fail', async () => {
        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([
          analyticsFailedRun2, // stage-1 fails
        ]);

        const metrics = await analytics.generateMetrics();
        const stage1Metrics = metrics.stageMetrics.get('stage-1');

        expect(stage1Metrics!.successRate).toBe(0);
      });

      it('should calculate correct success rate for mixed success/failure (incremental calculation)', async () => {
        // Create custom runs to test incremental success rate calculation
        const successRun = {
          ...analyticsSuccessRun1,
          stages: [
            {
              stageName: 'test-stage',
              status: 'success' as const,
              startTime: '2024-01-15T10:00:00.000Z',
              endTime: '2024-01-15T10:01:00.000Z',
              duration: 60000,
              commitSha: 'abc',
            },
          ],
        };
        const failedRun = {
          ...analyticsFailedRun2,
          stages: [
            {
              stageName: 'test-stage',
              status: 'failed' as const,
              startTime: '2024-01-16T10:00:00.000Z',
              endTime: '2024-01-16T10:01:00.000Z',
              duration: 60000,
              error: {
                message: 'Test error',
                code: 'TEST_ERROR',
                suggestion: 'Fix it',
              },
            },
          ],
        };

        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([
          successRun, // test-stage success
          failedRun, // test-stage failed
        ]);

        const metrics = await analytics.generateMetrics();
        const testStageMetrics = metrics.stageMetrics.get('test-stage');

        expect(testStageMetrics!.successRate).toBe(0.5);
        expect(testStageMetrics!.totalRuns).toBe(2);
      });

      it('should not count skipped status as success or failure', async () => {
        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([
          analyticsSkippedStageRun, // stage-1 success, stage-2 skipped
        ]);

        const metrics = await analytics.generateMetrics();
        const stage1Metrics = metrics.stageMetrics.get('stage-1');
        const stage2Metrics = metrics.stageMetrics.get('stage-2');

        expect(stage1Metrics!.successRate).toBe(1);
        expect(stage2Metrics!.successRate).toBe(0); // No successful runs
      });

      it('should treat skipped runs as non-successful when computing success rate', async () => {
        const successfulRun = {
          ...analyticsSuccessRun1,
          stages: [
            {
              stageName: 'stage-skip-check',
              status: 'success' as const,
              startTime: '2024-01-20T10:00:00.000Z',
              endTime: '2024-01-20T10:01:00.000Z',
              duration: 60000,
              commitSha: 'skip-check-success',
            },
          ],
        };
        const skippedRun = {
          ...analyticsSuccessRun1,
          runId: 'analytics-skipped-success-rate',
          trigger: {
            ...analyticsSuccessRun1.trigger,
            timestamp: '2024-01-21T10:00:00.000Z',
          },
          stages: [
            {
              stageName: 'stage-skip-check',
              status: 'skipped' as const,
              startTime: '2024-01-21T10:00:00.000Z',
              conditionEvaluated: true,
              conditionResult: false,
            },
          ],
          status: 'completed' as const,
          artifacts: {
            ...analyticsSuccessRun1.artifacts,
            finalCommit: undefined,
            changedFiles: ['skip-check.ts'],
            totalDuration: 0,
          },
        };

        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([successfulRun, skippedRun]);

        const metrics = await analytics.generateMetrics();
        const stageMetrics = metrics.stageMetrics.get('stage-skip-check');

        expect(stageMetrics!.totalRuns).toBe(2);
        expect(stageMetrics!.successRate).toBe(0.5);
      });
    });

    describe('duration calculations', () => {
      it('should calculate average duration correctly (running average)', async () => {
        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([
          analyticsSuccessRun1, // stage-1: 60000ms
          analyticsSuccessRun2, // stage-1: 90000ms
        ]);

        const metrics = await analytics.generateMetrics();
        const stage1Metrics = metrics.stageMetrics.get('stage-1');

        expect(stage1Metrics!.averageDuration).toBe(75000);
      });

      it('should handle stages without duration field', async () => {
        const runWithoutDuration = {
          ...analyticsSuccessRun1,
          stages: [
            {
              stageName: 'stage-no-duration',
              status: 'success' as const,
              startTime: '2024-01-15T10:00:00.000Z',
              endTime: '2024-01-15T10:01:00.000Z',
              commitSha: 'abc123',
            },
          ],
        };

        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([runWithoutDuration]);

        const metrics = await analytics.generateMetrics();
        const stageMetrics = metrics.stageMetrics.get('stage-no-duration');

        expect(stageMetrics!.averageDuration).toBe(0);
      });

      it('should calculate duration across multiple runs', async () => {
        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([
          analyticsMultiStageRun, // review: 120000ms
        ]);

        const metrics = await analytics.generateMetrics();
        const reviewMetrics = metrics.stageMetrics.get('review');

        expect(reviewMetrics!.averageDuration).toBe(120000);
      });

      it('should ignore skipped runs when averaging duration', async () => {
        const skippedRun = {
          ...analyticsSuccessRun1,
          runId: 'analytics-duration-skip',
          stages: [
            {
              stageName: 'stage-duration-skip',
              status: 'skipped' as const,
              startTime: '2024-01-20T12:00:00.000Z',
              conditionEvaluated: true,
              conditionResult: false,
            },
          ],
        };
        const completedRun = {
          ...analyticsSuccessRun1,
          runId: 'analytics-duration-complete',
          stages: [
            {
              stageName: 'stage-duration-skip',
              status: 'success' as const,
              startTime: '2024-01-21T12:00:00.000Z',
              endTime: '2024-01-21T12:02:00.000Z',
              duration: 120000,
              commitSha: 'duration-success',
            },
          ],
        };

        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([skippedRun, completedRun]);

        const metrics = await analytics.generateMetrics();
        const stageMetrics = metrics.stageMetrics.get('stage-duration-skip');

        expect(stageMetrics!.averageDuration).toBe(120000);
        expect(stageMetrics!.totalRuns).toBe(2);
      });
    });

    describe('failure tracking', () => {
      it('should increment failure count for failed stages', async () => {
        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([
          analyticsFailedRun1, // stage-2 failed
          analyticsFailedRun2, // stage-1 failed
        ]);

        const metrics = await analytics.generateMetrics();
        const stage1Metrics = metrics.stageMetrics.get('stage-1');
        const stage2Metrics = metrics.stageMetrics.get('stage-2');

        expect(stage1Metrics!.failureCount).toBe(1);
        expect(stage2Metrics!.failureCount).toBe(1);
      });

      it('should track total runs per stage correctly', async () => {
        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([
          analyticsSuccessRun1, // has stage-1, stage-2
          analyticsSuccessRun2, // has stage-1, stage-2
          analyticsFailedRun1, // has stage-1, stage-2
        ]);

        const metrics = await analytics.generateMetrics();
        const stage1Metrics = metrics.stageMetrics.get('stage-1');
        const stage2Metrics = metrics.stageMetrics.get('stage-2');

        expect(stage1Metrics!.totalRuns).toBe(3);
        expect(stage2Metrics!.totalRuns).toBe(3);
      });
    });
  });

  describe('analyzeFailures()', () => {
    describe('basic functionality', () => {
      it('should return empty Map when no failures', async () => {
        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([
          analyticsSuccessRun1,
          analyticsSuccessRun2,
        ]);

        const metrics = await analytics.generateMetrics();

        expect(metrics.failureReasons.size).toBe(0);
      });

      it('should extract error message from single failed stage', async () => {
        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([
          analyticsFailedRun1, // Error: "Connection timeout\nRetry failed after 3 attempts"
        ]);

        const metrics = await analytics.generateMetrics();

        expect(metrics.failureReasons.has('Connection timeout')).toBe(true);
        expect(metrics.failureReasons.get('Connection timeout')).toBe(1);
      });

      it('should count multiple failures with same error message', async () => {
        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([
          analyticsFailedRun1, // Error: "Connection timeout\n..."
          analyticsSameErrorRun, // Error: "Connection timeout\n..."
        ]);

        const metrics = await analytics.generateMetrics();

        expect(metrics.failureReasons.get('Connection timeout')).toBe(2);
      });

      it('should group different error messages separately', async () => {
        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([
          analyticsFailedRun1, // Error: "Connection timeout"
          analyticsFailedRun2, // Error: "Invalid configuration"
        ]);

        const metrics = await analytics.generateMetrics();

        expect(metrics.failureReasons.size).toBe(2);
        expect(metrics.failureReasons.has('Connection timeout')).toBe(true);
        expect(metrics.failureReasons.has('Invalid configuration')).toBe(true);
      });
    });

    describe('message extraction', () => {
      it('should extract only first line of multi-line error messages', async () => {
        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([
          analyticsFailedRun1, // "Connection timeout\nRetry failed after 3 attempts"
        ]);

        const metrics = await analytics.generateMetrics();

        expect(metrics.failureReasons.has('Connection timeout')).toBe(true);
        expect(metrics.failureReasons.has('Retry failed after 3 attempts')).toBe(false);
      });

      it('should handle error messages with newlines correctly', async () => {
        const multilineErrorRun = {
          ...analyticsFailedRun1,
          stages: [
            {
              stageName: 'stage-1',
              status: 'failed' as const,
              startTime: '2024-01-15T10:00:00.000Z',
              endTime: '2024-01-15T10:01:00.000Z',
              duration: 60000,
              error: {
                message: 'First line\nSecond line\nThird line',
                code: 'TEST_ERROR',
                suggestion: 'Fix it',
              },
            },
          ],
        };

        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([multilineErrorRun]);

        const metrics = await analytics.generateMetrics();

        expect(metrics.failureReasons.has('First line')).toBe(true);
      });
    });

    describe('edge cases', () => {
      it('should skip stages without error field', async () => {
        const noErrorRun = {
          ...analyticsFailedRun1,
          stages: [
            {
              stageName: 'stage-1',
              status: 'failed' as const,
              startTime: '2024-01-15T10:00:00.000Z',
              endTime: '2024-01-15T10:01:00.000Z',
              duration: 60000,
              // No error field
            },
          ],
        };

        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([noErrorRun]);

        const metrics = await analytics.generateMetrics();

        expect(metrics.failureReasons.size).toBe(0);
      });

      it('should skip non-failed stages', async () => {
        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([
          analyticsSuccessRun1, // All stages successful
        ]);

        const metrics = await analytics.generateMetrics();

        expect(metrics.failureReasons.size).toBe(0);
      });

      it('should handle multiple error types in same run', async () => {
        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([
          analyticsMultiStageRun, // has security failure
        ]);

        const metrics = await analytics.generateMetrics();

        expect(metrics.failureReasons.has('Security vulnerability detected')).toBe(true);
      });
    });
  });

  describe('calculateTrends()', () => {
    describe('grouping by day', () => {
      it('should group runs by day (ISO date format)', async () => {
        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([
          analyticsSuccessRun1, // 2024-01-15
        ]);

        const metrics = await analytics.generateMetrics();
        const trends = metrics.trendsOverTime;

        expect(trends[0].date).toBe('2024-01-15');
      });

      it('should aggregate multiple runs on same day', async () => {
        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([
          analyticsSuccessRun1, // 2024-01-15T10:00:00.000Z
          analyticsSuccessRun2, // 2024-01-15T14:00:00.000Z
        ]);

        const metrics = await analytics.generateMetrics();
        const trends = metrics.trendsOverTime;

        expect(trends.length).toBe(1);
        expect(trends[0].date).toBe('2024-01-15');
        expect(trends[0].totalRuns).toBe(2);
      });

      it('should handle runs across multiple days', async () => {
        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([
          analyticsSuccessRun1, // 2024-01-15
          analyticsFailedRun1, // 2024-01-16
          analyticsMultiDayRun1, // 2024-01-17
        ]);

        const metrics = await analytics.generateMetrics();
        const trends = metrics.trendsOverTime;

        expect(trends.length).toBe(3);
        expect(trends[0].date).toBe('2024-01-15');
        expect(trends[1].date).toBe('2024-01-16');
        expect(trends[2].date).toBe('2024-01-17');
      });

      it('should return empty array for no runs', async () => {
        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([]);

        const metrics = await analytics.generateMetrics();

        expect(metrics.trendsOverTime.length).toBe(0);
      });
    });

    describe('success rate calculation', () => {
      it('should calculate success rate per day correctly', async () => {
        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([
          analyticsSuccessRun1, // 2024-01-15, completed
          analyticsSuccessRun2, // 2024-01-15, completed
          analyticsFailedRun1, // 2024-01-16, failed
        ]);

        const metrics = await analytics.generateMetrics();
        const trends = metrics.trendsOverTime;

        expect(trends[0].successRate).toBe(1); // 2/2 = 100%
        expect(trends[1].successRate).toBe(0); // 0/1 = 0%
      });

      it('should handle days with only successes (100%)', async () => {
        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([
          analyticsSuccessRun1,
          analyticsSuccessRun2,
        ]);

        const metrics = await analytics.generateMetrics();
        const trends = metrics.trendsOverTime;

        expect(trends[0].successRate).toBe(1);
      });

      it('should handle days with only failures (0%)', async () => {
        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([
          analyticsFailedRun1, // 2024-01-16
          analyticsFailedRun2, // 2024-01-16 (same day)
        ]);

        const metrics = await analytics.generateMetrics();
        const trends = metrics.trendsOverTime;

        // Both runs are on the same day, so only one trend entry
        expect(trends.length).toBe(1);
        expect(trends[0].successRate).toBe(0);
        expect(trends[0].date).toBe('2024-01-16');
        expect(trends[0].totalRuns).toBe(2);
      });

      it('should calculate correct rate for mixed success/failure', async () => {
        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([
          analyticsSuccessRun1, // 2024-01-15, completed
          { ...analyticsFailedRun1, trigger: { ...analyticsFailedRun1.trigger, timestamp: '2024-01-15T16:00:00.000Z' } }, // 2024-01-15, failed
        ]);

        const metrics = await analytics.generateMetrics();
        const trends = metrics.trendsOverTime;

        expect(trends[0].successRate).toBe(0.5);
        expect(trends[0].totalRuns).toBe(2);
      });
    });

    describe('sorting & formatting', () => {
      it('should sort trends by date (ascending)', async () => {
        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([
          analyticsMultiDayRun1, // 2024-01-17
          analyticsFailedRun1, // 2024-01-16
          analyticsSuccessRun1, // 2024-01-15
        ]);

        const metrics = await analytics.generateMetrics();
        const trends = metrics.trendsOverTime;

        expect(trends[0].date).toBe('2024-01-15');
        expect(trends[1].date).toBe('2024-01-16');
        expect(trends[2].date).toBe('2024-01-17');
      });

      it('should format dates as YYYY-MM-DD', async () => {
        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([
          analyticsSuccessRun1,
        ]);

        const metrics = await analytics.generateMetrics();
        const trends = metrics.trendsOverTime;

        expect(trends[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      });

      it('should include totalRuns per day', async () => {
        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([
          analyticsSuccessRun1, // 2024-01-15
          analyticsSuccessRun2, // 2024-01-15
        ]);

        const metrics = await analytics.generateMetrics();
        const trends = metrics.trendsOverTime;

        expect(trends[0].totalRuns).toBe(2);
      });
    });

    describe('edge cases', () => {
      it('should not count partial status in trends (only completed/failed)', async () => {
        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([
          analyticsSuccessRun1, // 2024-01-15, completed
          { ...analyticsMultiStageRun, trigger: { ...analyticsMultiStageRun.trigger, timestamp: '2024-01-15T16:00:00.000Z' } }, // 2024-01-15, partial
        ]);

        const metrics = await analytics.generateMetrics();
        const trends = metrics.trendsOverTime;

        // Partial status is not counted in trends, only completed and failed
        expect(trends[0].totalRuns).toBe(1); // Only the completed run
        expect(trends[0].successRate).toBe(1); // 1 success out of 1 counted run
      });

      it('should handle runs with same timestamp', async () => {
        const sameTimestampRun = {
          ...analyticsSuccessRun1,
          runId: 'duplicate-timestamp',
        };

        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([
          analyticsSuccessRun1,
          sameTimestampRun,
        ]);

        const metrics = await analytics.generateMetrics();
        const trends = metrics.trendsOverTime;

        expect(trends.length).toBe(1);
        expect(trends[0].totalRuns).toBe(2);
      });

      it('should coerce success rate to 0 when a day has only partial runs', async () => {
        const partialRun = {
          ...analyticsMultiStageRun,
          runId: 'analytics-partial-only',
          trigger: {
            ...analyticsMultiStageRun.trigger,
            timestamp: '2024-01-22T12:00:00.000Z',
          },
          status: 'partial' as const,
          stages: analyticsMultiStageRun.stages.map((stage) => ({
            ...stage,
            status: stage.stageName === 'security' ? 'failed' : 'success',
          })),
        };
        const followedByAnotherPartial = {
          ...partialRun,
          runId: 'analytics-partial-2',
          trigger: {
            ...partialRun.trigger,
            timestamp: '2024-01-22T15:00:00.000Z',
          },
        };

        vi.mocked(mockStateManager.getAllRuns).mockResolvedValue([
          partialRun,
          followedByAnotherPartial,
        ]);

        const metrics = await analytics.generateMetrics();
        const trends = metrics.trendsOverTime;

        expect(trends.length).toBe(1);
        expect(trends[0].totalRuns).toBe(0);
        expect(trends[0].successRate).toBe(0);
      });
    });
  });
});
