// src/analytics/pipeline-analytics.ts

import { StateManager } from '../core/state-manager.js';
import { PipelineState } from '../config/schema.js';
import { PipelineMetrics, StageMetrics, TimeSeriesData } from './types.js';

export class PipelineAnalytics {
  constructor(private stateManager: StateManager) {}

  async generateMetrics(
    pipelineName?: string,
    timeRange?: { start: Date; end: Date }
  ): Promise<PipelineMetrics> {
    const runs = await this.stateManager.getAllRuns();

    // Filter by pipeline name and time range
    const filteredRuns = runs.filter((run) => {
      if (pipelineName && run.pipelineConfig.name !== pipelineName) {
        return false;
      }
      if (timeRange) {
        const runTime = new Date(run.trigger.timestamp);
        if (runTime < timeRange.start || runTime > timeRange.end) {
          return false;
        }
      }
      return true;
    });

    // Calculate metrics
    const totalRuns = filteredRuns.length;
    const successfulRuns = filteredRuns.filter((r) => r.status === 'completed').length;
    const successRate = totalRuns > 0 ? successfulRuns / totalRuns : 0;

    const totalDuration = filteredRuns.reduce(
      (sum, run) => sum + run.artifacts.totalDuration,
      0
    );
    const averageDuration = totalRuns > 0 ? totalDuration / totalRuns : 0;

    // Stage-level metrics
    const stageMetrics = this.calculateStageMetrics(filteredRuns);

    // Failure analysis
    const failureReasons = this.analyzeFailures(filteredRuns);

    // Time series data for trends
    const trendsOverTime = this.calculateTrends(filteredRuns);

    return {
      totalRuns,
      successRate,
      averageDuration,
      stageMetrics,
      failureReasons,
      trendsOverTime
    };
  }

  private calculateStageMetrics(runs: PipelineState[]): Map<string, StageMetrics> {
    const metrics = new Map<string, StageMetrics>();

    for (const run of runs) {
      for (const stage of run.stages) {
        if (!metrics.has(stage.stageName)) {
          metrics.set(stage.stageName, {
            stageName: stage.stageName,
            successRate: 0,
            averageDuration: 0,
            failureCount: 0,
            totalRuns: 0
          });
        }

        const stageMetric = metrics.get(stage.stageName)!;
        stageMetric.totalRuns++;

        if (stage.status === 'success') {
          stageMetric.successRate =
            (stageMetric.successRate * (stageMetric.totalRuns - 1) + 1) /
            stageMetric.totalRuns;
        } else if (stage.status === 'failed') {
          stageMetric.failureCount++;
        }

        if (stage.duration) {
          stageMetric.averageDuration =
            (stageMetric.averageDuration * (stageMetric.totalRuns - 1) + stage.duration) /
            stageMetric.totalRuns;
        }
      }
    }

    return metrics;
  }

  private analyzeFailures(runs: PipelineState[]): Map<string, number> {
    const failures = new Map<string, number>();

    for (const run of runs) {
      for (const stage of run.stages) {
        if (stage.status === 'failed' && stage.error) {
          const reason = stage.error.message.split('\n')[0]; // First line
          failures.set(reason, (failures.get(reason) || 0) + 1);
        }
      }
    }

    return failures;
  }

  private calculateTrends(runs: PipelineState[]): TimeSeriesData[] {
    // Group by day
    const dataByDay = new Map<string, { successes: number; failures: number }>();

    for (const run of runs) {
      const day = new Date(run.trigger.timestamp).toISOString().split('T')[0];

      if (!dataByDay.has(day)) {
        dataByDay.set(day, { successes: 0, failures: 0 });
      }

      const dayData = dataByDay.get(day)!;
      if (run.status === 'completed') {
        dayData.successes++;
      } else if (run.status === 'failed') {
        dayData.failures++;
      }
    }

    return Array.from(dataByDay.entries())
      .map(([date, data]) => ({
        date,
        successRate: data.successes / (data.successes + data.failures),
        totalRuns: data.successes + data.failures
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
}
