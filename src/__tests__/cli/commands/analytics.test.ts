import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { analyticsCommand } from '../../../cli/commands/analytics.js';
import { StateManager } from '../../../core/state-manager.js';
import { PipelineAnalytics } from '../../../analytics/pipeline-analytics.js';
import { createTempDir, cleanupTempDir } from '../../setup.js';

// Mock dependencies
vi.mock('../../../core/state-manager.js');
vi.mock('../../../analytics/pipeline-analytics.js');

describe('analyticsCommand', () => {
  let tempDir: string;
  let mockStateManager: any;
  let mockAnalytics: any;

  beforeEach(async () => {
    tempDir = await createTempDir('analytics-test-');

    // Setup StateManager mock
    mockStateManager = {};
    vi.mocked(StateManager).mockImplementation(() => mockStateManager);

    // Setup PipelineAnalytics mock
    mockAnalytics = {
      generateMetrics: vi.fn(),
    };
    vi.mocked(PipelineAnalytics).mockImplementation(() => mockAnalytics);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
    vi.clearAllMocks();
  });

  describe('Metrics Generation', () => {
    it('should generate metrics without filters', async () => {
      mockAnalytics.generateMetrics.mockResolvedValue({
        totalRuns: 10,
        successRate: 0.8,
        averageDuration: 120.5,
        stageMetrics: new Map(),
        failureReasons: new Map(),
        trendsOverTime: [],
      });

      await analyticsCommand(tempDir, {});

      expect(mockAnalytics.generateMetrics).toHaveBeenCalledWith(undefined, undefined);
    });

    it('should generate metrics with pipeline filter', async () => {
      mockAnalytics.generateMetrics.mockResolvedValue({
        totalRuns: 5,
        successRate: 0.9,
        averageDuration: 100,
        stageMetrics: new Map(),
        failureReasons: new Map(),
        trendsOverTime: [],
      });

      await analyticsCommand(tempDir, { pipeline: 'test-pipeline' });

      expect(mockAnalytics.generateMetrics).toHaveBeenCalledWith('test-pipeline', undefined);
    });

    it('should generate metrics with days filter', async () => {
      mockAnalytics.generateMetrics.mockResolvedValue({
        totalRuns: 8,
        successRate: 0.75,
        averageDuration: 90.3,
        stageMetrics: new Map(),
        failureReasons: new Map(),
        trendsOverTime: [],
      });

      const startTime = Date.now();
      await analyticsCommand(tempDir, { days: 7 });

      expect(mockAnalytics.generateMetrics).toHaveBeenCalled();
      const timeRange = mockAnalytics.generateMetrics.mock.calls[0][1];
      expect(timeRange).toBeDefined();
      expect(timeRange.end).toBeInstanceOf(Date);
      // Should be approximately 7 days ago (allow 1 second tolerance)
      const daysDiff = (timeRange.end.getTime() - timeRange.start.getTime()) / (1000 * 60 * 60 * 24);
      expect(daysDiff).toBeCloseTo(7, 0);
    });

    it('should generate metrics with both filters', async () => {
      mockAnalytics.generateMetrics.mockResolvedValue({
        totalRuns: 3,
        successRate: 1.0,
        averageDuration: 85.2,
        stageMetrics: new Map(),
        failureReasons: new Map(),
        trendsOverTime: [],
      });

      await analyticsCommand(tempDir, { pipeline: 'test-pipeline', days: 30 });

      expect(mockAnalytics.generateMetrics).toHaveBeenCalled();
      const [pipeline, timeRange] = mockAnalytics.generateMetrics.mock.calls[0];
      expect(pipeline).toBe('test-pipeline');
      expect(timeRange).toBeDefined();
      expect(timeRange.start).toBeInstanceOf(Date);
      expect(timeRange.end).toBeInstanceOf(Date);
    });

    it('should calculate timeRange correctly from days', async () => {
      mockAnalytics.generateMetrics.mockResolvedValue({
        totalRuns: 0,
        successRate: 0,
        averageDuration: 0,
        stageMetrics: new Map(),
        failureReasons: new Map(),
        trendsOverTime: [],
      });

      const beforeCall = Date.now();
      await analyticsCommand(tempDir, { days: 14 });
      const afterCall = Date.now();

      const timeRange = mockAnalytics.generateMetrics.mock.calls[0][1];
      expect(timeRange.start.getTime()).toBeGreaterThanOrEqual(beforeCall - 14 * 24 * 60 * 60 * 1000);
      expect(timeRange.start.getTime()).toBeLessThanOrEqual(afterCall - 14 * 24 * 60 * 60 * 1000);
    });

    it('should handle no runs found', async () => {
      mockAnalytics.generateMetrics.mockResolvedValue({
        totalRuns: 0,
        successRate: 0,
        averageDuration: 0,
        stageMetrics: new Map(),
        failureReasons: new Map(),
        trendsOverTime: [],
      });

      await analyticsCommand(tempDir, {});

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('📊 Pipeline Analytics'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No pipeline runs found'));
    });
  });

  describe('Console Output - Header', () => {
    it('should display title', async () => {
      mockAnalytics.generateMetrics.mockResolvedValue({
        totalRuns: 5,
        successRate: 0.8,
        averageDuration: 100,
        stageMetrics: new Map(),
        failureReasons: new Map(),
        trendsOverTime: [],
      });

      await analyticsCommand(tempDir, {});

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('📊 Pipeline Analytics'));
    });

    it('should display pipeline name when filtered', async () => {
      mockAnalytics.generateMetrics.mockResolvedValue({
        totalRuns: 5,
        successRate: 0.8,
        averageDuration: 100,
        stageMetrics: new Map(),
        failureReasons: new Map(),
        trendsOverTime: [],
      });

      await analyticsCommand(tempDir, { pipeline: 'my-pipeline' });

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Pipeline: my-pipeline'));
    });

    it('should display time range when filtered', async () => {
      mockAnalytics.generateMetrics.mockResolvedValue({
        totalRuns: 5,
        successRate: 0.8,
        averageDuration: 100,
        stageMetrics: new Map(),
        failureReasons: new Map(),
        trendsOverTime: [],
      });

      await analyticsCommand(tempDir, { days: 7 });

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Time Range: Last 7 days'));
    });

    it('should display both filters when present', async () => {
      mockAnalytics.generateMetrics.mockResolvedValue({
        totalRuns: 5,
        successRate: 0.8,
        averageDuration: 100,
        stageMetrics: new Map(),
        failureReasons: new Map(),
        trendsOverTime: [],
      });

      await analyticsCommand(tempDir, { pipeline: 'my-pipeline', days: 30 });

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Pipeline: my-pipeline'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Time Range: Last 30 days'));
    });

    it('should handle no runs message correctly', async () => {
      mockAnalytics.generateMetrics.mockResolvedValue({
        totalRuns: 0,
        successRate: 0,
        averageDuration: 0,
        stageMetrics: new Map(),
        failureReasons: new Map(),
        trendsOverTime: [],
      });

      await analyticsCommand(tempDir, { pipeline: 'nonexistent' });

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No pipeline runs found for the specified criteria.'));
    });
  });

  describe('Console Output - Metrics', () => {
    it('should display total runs', async () => {
      mockAnalytics.generateMetrics.mockResolvedValue({
        totalRuns: 42,
        successRate: 0.8,
        averageDuration: 100,
        stageMetrics: new Map(),
        failureReasons: new Map(),
        trendsOverTime: [],
      });

      await analyticsCommand(tempDir, {});

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Total Runs: 42'));
    });

    it('should display success rate with percentage', async () => {
      mockAnalytics.generateMetrics.mockResolvedValue({
        totalRuns: 10,
        successRate: 0.856,
        averageDuration: 100,
        stageMetrics: new Map(),
        failureReasons: new Map(),
        trendsOverTime: [],
      });

      await analyticsCommand(tempDir, {});

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Success Rate: 85.6%'));
    });

    it('should display average duration', async () => {
      mockAnalytics.generateMetrics.mockResolvedValue({
        totalRuns: 10,
        successRate: 0.8,
        averageDuration: 123.456,
        stageMetrics: new Map(),
        failureReasons: new Map(),
        trendsOverTime: [],
      });

      await analyticsCommand(tempDir, {});

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Average Duration: 123.46s'));
    });

    it('should format numbers correctly', async () => {
      mockAnalytics.generateMetrics.mockResolvedValue({
        totalRuns: 1000,
        successRate: 0.333333,
        averageDuration: 99.999,
        stageMetrics: new Map(),
        failureReasons: new Map(),
        trendsOverTime: [],
      });

      await analyticsCommand(tempDir, {});

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Total Runs: 1000'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Success Rate: 33.3%'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Average Duration: 100.00s'));
    });
  });

  describe('Console Output - Stage Metrics', () => {
    it('should display stage metrics when present', async () => {
      const stageMetrics = new Map([
        [
          'build',
          {
            successRate: 0.95,
            averageDuration: 45.5,
            failureCount: 2,
            totalRuns: 20,
          },
        ],
      ]);

      mockAnalytics.generateMetrics.mockResolvedValue({
        totalRuns: 20,
        successRate: 0.9,
        averageDuration: 100,
        stageMetrics,
        failureReasons: new Map(),
        trendsOverTime: [],
      });

      await analyticsCommand(tempDir, {});

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Stage Performance:'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('build:'));
    });

    it('should skip stage metrics when empty', async () => {
      mockAnalytics.generateMetrics.mockResolvedValue({
        totalRuns: 10,
        successRate: 0.8,
        averageDuration: 100,
        stageMetrics: new Map(),
        failureReasons: new Map(),
        trendsOverTime: [],
      });

      await analyticsCommand(tempDir, {});

      expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('Stage Performance:'));
    });

    it('should format stage success rate', async () => {
      const stageMetrics = new Map([
        [
          'test',
          {
            successRate: 0.875,
            averageDuration: 30,
            failureCount: 3,
            totalRuns: 24,
          },
        ],
      ]);

      mockAnalytics.generateMetrics.mockResolvedValue({
        totalRuns: 24,
        successRate: 0.8,
        averageDuration: 100,
        stageMetrics,
        failureReasons: new Map(),
        trendsOverTime: [],
      });

      await analyticsCommand(tempDir, {});

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Success Rate: 87.5%'));
    });

    it('should format stage duration', async () => {
      const stageMetrics = new Map([
        [
          'deploy',
          {
            successRate: 1.0,
            averageDuration: 78.92,
            failureCount: 0,
            totalRuns: 10,
          },
        ],
      ]);

      mockAnalytics.generateMetrics.mockResolvedValue({
        totalRuns: 10,
        successRate: 1.0,
        averageDuration: 100,
        stageMetrics,
        failureReasons: new Map(),
        trendsOverTime: [],
      });

      await analyticsCommand(tempDir, {});

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Avg Duration: 78.92s'));
    });

    it('should display failure count', async () => {
      const stageMetrics = new Map([
        [
          'lint',
          {
            successRate: 0.8,
            averageDuration: 15,
            failureCount: 5,
            totalRuns: 25,
          },
        ],
      ]);

      mockAnalytics.generateMetrics.mockResolvedValue({
        totalRuns: 25,
        successRate: 0.8,
        averageDuration: 100,
        stageMetrics,
        failureReasons: new Map(),
        trendsOverTime: [],
      });

      await analyticsCommand(tempDir, {});

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Failures: 5'));
    });

    it('should display total runs per stage', async () => {
      const stageMetrics = new Map([
        [
          'build',
          {
            successRate: 0.9,
            averageDuration: 50,
            failureCount: 3,
            totalRuns: 30,
          },
        ],
      ]);

      mockAnalytics.generateMetrics.mockResolvedValue({
        totalRuns: 30,
        successRate: 0.9,
        averageDuration: 100,
        stageMetrics,
        failureReasons: new Map(),
        trendsOverTime: [],
      });

      await analyticsCommand(tempDir, {});

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Total Runs: 30'));
    });

    it('should display multiple stages', async () => {
      const stageMetrics = new Map([
        ['stage1', { successRate: 0.9, averageDuration: 30, failureCount: 1, totalRuns: 10 }],
        ['stage2', { successRate: 0.8, averageDuration: 40, failureCount: 2, totalRuns: 10 }],
        ['stage3', { successRate: 1.0, averageDuration: 20, failureCount: 0, totalRuns: 10 }],
      ]);

      mockAnalytics.generateMetrics.mockResolvedValue({
        totalRuns: 10,
        successRate: 0.9,
        averageDuration: 100,
        stageMetrics,
        failureReasons: new Map(),
        trendsOverTime: [],
      });

      await analyticsCommand(tempDir, {});

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('stage1:'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('stage2:'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('stage3:'));
    });
  });

  describe('Console Output - Failure Reasons', () => {
    it('should display failure reasons when present', async () => {
      const failureReasons = new Map([['Syntax error', 5]]);

      mockAnalytics.generateMetrics.mockResolvedValue({
        totalRuns: 10,
        successRate: 0.5,
        averageDuration: 100,
        stageMetrics: new Map(),
        failureReasons,
        trendsOverTime: [],
      });

      await analyticsCommand(tempDir, {});

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Top Failure Reasons:'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('5x Syntax error'));
    });

    it('should skip failure reasons when empty', async () => {
      mockAnalytics.generateMetrics.mockResolvedValue({
        totalRuns: 10,
        successRate: 1.0,
        averageDuration: 100,
        stageMetrics: new Map(),
        failureReasons: new Map(),
        trendsOverTime: [],
      });

      await analyticsCommand(tempDir, {});

      expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('Top Failure Reasons:'));
    });

    it('should sort by count descending', async () => {
      const failureReasons = new Map([
        ['Error A', 2],
        ['Error B', 10],
        ['Error C', 5],
      ]);

      mockAnalytics.generateMetrics.mockResolvedValue({
        totalRuns: 17,
        successRate: 0,
        averageDuration: 100,
        stageMetrics: new Map(),
        failureReasons,
        trendsOverTime: [],
      });

      await analyticsCommand(tempDir, {});

      const logs = vi.mocked(console.log).mock.calls.map((call) => call[0]);
      const failureReasonLogs = logs.filter((log) => log && log.includes('x Error'));

      expect(failureReasonLogs[0]).toContain('10x Error B');
      expect(failureReasonLogs[1]).toContain('5x Error C');
      expect(failureReasonLogs[2]).toContain('2x Error A');
    });

    it('should limit to top 5 failures', async () => {
      const failureReasons = new Map([
        ['Error 1', 100],
        ['Error 2', 90],
        ['Error 3', 80],
        ['Error 4', 70],
        ['Error 5', 60],
        ['Error 6', 50],
        ['Error 7', 40],
      ]);

      mockAnalytics.generateMetrics.mockResolvedValue({
        totalRuns: 100,
        successRate: 0,
        averageDuration: 100,
        stageMetrics: new Map(),
        failureReasons,
        trendsOverTime: [],
      });

      await analyticsCommand(tempDir, {});

      const logs = vi.mocked(console.log).mock.calls.map((call) => call[0]);
      const failureReasonLogs = logs.filter((log) => log && log.includes('x Error'));

      expect(failureReasonLogs).toHaveLength(5);
      expect(failureReasonLogs[0]).toContain('100x Error 1');
      expect(failureReasonLogs[4]).toContain('60x Error 5');
    });

    it('should format count and reason correctly', async () => {
      const failureReasons = new Map([['Timeout exceeded', 15]]);

      mockAnalytics.generateMetrics.mockResolvedValue({
        totalRuns: 20,
        successRate: 0.25,
        averageDuration: 100,
        stageMetrics: new Map(),
        failureReasons,
        trendsOverTime: [],
      });

      await analyticsCommand(tempDir, {});

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('15x Timeout exceeded'));
    });

    it('should handle single failure', async () => {
      const failureReasons = new Map([['Network error', 1]]);

      mockAnalytics.generateMetrics.mockResolvedValue({
        totalRuns: 10,
        successRate: 0.9,
        averageDuration: 100,
        stageMetrics: new Map(),
        failureReasons,
        trendsOverTime: [],
      });

      await analyticsCommand(tempDir, {});

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('1x Network error'));
    });
  });

  describe('Console Output - Trends', () => {
    it('should display trends when present', async () => {
      const trendsOverTime = [
        { date: '2024-01-01', successRate: 0.8, totalRuns: 10 },
      ];

      mockAnalytics.generateMetrics.mockResolvedValue({
        totalRuns: 10,
        successRate: 0.8,
        averageDuration: 100,
        stageMetrics: new Map(),
        failureReasons: new Map(),
        trendsOverTime,
      });

      await analyticsCommand(tempDir, {});

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Trends Over Time (by day):'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('2024-01-01'));
    });

    it('should skip trends when empty', async () => {
      mockAnalytics.generateMetrics.mockResolvedValue({
        totalRuns: 10,
        successRate: 0.8,
        averageDuration: 100,
        stageMetrics: new Map(),
        failureReasons: new Map(),
        trendsOverTime: [],
      });

      await analyticsCommand(tempDir, {});

      expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('Trends Over Time'));
    });

    it('should limit to last 7 days', async () => {
      const trendsOverTime = Array.from({ length: 30 }, (_, i) => ({
        date: `2024-01-${String(i + 1).padStart(2, '0')}`,
        successRate: 0.8,
        totalRuns: 5,
      }));

      mockAnalytics.generateMetrics.mockResolvedValue({
        totalRuns: 150,
        successRate: 0.8,
        averageDuration: 100,
        stageMetrics: new Map(),
        failureReasons: new Map(),
        trendsOverTime,
      });

      await analyticsCommand(tempDir, {});

      const logs = vi.mocked(console.log).mock.calls.map((call) => call[0]);
      const trendLogs = logs.filter((log) => log && log.includes('2024-01-'));

      expect(trendLogs).toHaveLength(7);
      expect(trendLogs[0]).toContain('2024-01-24');
      expect(trendLogs[6]).toContain('2024-01-30');
    });

    it('should generate success bar visualization', async () => {
      const trendsOverTime = [
        { date: '2024-01-01', successRate: 0.5, totalRuns: 10 },
      ];

      mockAnalytics.generateMetrics.mockResolvedValue({
        totalRuns: 10,
        successRate: 0.5,
        averageDuration: 100,
        stageMetrics: new Map(),
        failureReasons: new Map(),
        trendsOverTime,
      });

      await analyticsCommand(tempDir, {});

      const logs = vi.mocked(console.log).mock.calls.map((call) => call[0]);
      const trendLog = logs.find((log) => log && log.includes('2024-01-01'));

      expect(trendLog).toContain('█');
      expect(trendLog).toMatch(/2024-01-01:.*50%.*\(10 runs\)/);
    });

    it('should display date percentage and runs', async () => {
      const trendsOverTime = [
        { date: '2024-01-15', successRate: 0.75, totalRuns: 20 },
      ];

      mockAnalytics.generateMetrics.mockResolvedValue({
        totalRuns: 20,
        successRate: 0.75,
        averageDuration: 100,
        stageMetrics: new Map(),
        failureReasons: new Map(),
        trendsOverTime,
      });

      await analyticsCommand(tempDir, {});

      expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/2024-01-15:.*75%.*\(20 runs\)/));
    });

    it('should handle 100% success rate', async () => {
      const trendsOverTime = [
        { date: '2024-01-01', successRate: 1.0, totalRuns: 10 },
      ];

      mockAnalytics.generateMetrics.mockResolvedValue({
        totalRuns: 10,
        successRate: 1.0,
        averageDuration: 100,
        stageMetrics: new Map(),
        failureReasons: new Map(),
        trendsOverTime,
      });

      await analyticsCommand(tempDir, {});

      const logs = vi.mocked(console.log).mock.calls.map((call) => call[0]);
      const trendLog = logs.find((log) => log && log.includes('2024-01-01'));

      expect(trendLog).toContain('100%');
      expect(trendLog).toContain('█'.repeat(20));
    });

    it('should handle 0% success rate', async () => {
      const trendsOverTime = [
        { date: '2024-01-01', successRate: 0, totalRuns: 10 },
      ];

      mockAnalytics.generateMetrics.mockResolvedValue({
        totalRuns: 10,
        successRate: 0,
        averageDuration: 100,
        stageMetrics: new Map(),
        failureReasons: new Map(),
        trendsOverTime,
      });

      await analyticsCommand(tempDir, {});

      const logs = vi.mocked(console.log).mock.calls.map((call) => call[0]);
      const trendLog = logs.find((log) => log && log.includes('2024-01-01'));

      expect(trendLog).toContain('0%');
      expect(trendLog).not.toContain('█');
    });

    it('should handle partial success rates', async () => {
      const trendsOverTime = [
        { date: '2024-01-01', successRate: 0.25, totalRuns: 8 },
      ];

      mockAnalytics.generateMetrics.mockResolvedValue({
        totalRuns: 8,
        successRate: 0.25,
        averageDuration: 100,
        stageMetrics: new Map(),
        failureReasons: new Map(),
        trendsOverTime,
      });

      await analyticsCommand(tempDir, {});

      const logs = vi.mocked(console.log).mock.calls.map((call) => call[0]);
      const trendLog = logs.find((log) => log && log.includes('2024-01-01'));

      expect(trendLog).toContain('25%');
      // 0.25 * 20 = 5 blocks
      expect(trendLog).toContain('█'.repeat(5));
    });
  });
});
