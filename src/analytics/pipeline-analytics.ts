// src/analytics/pipeline-analytics.ts

import { StateManager } from '../core/state-manager.js';
import { PipelineState } from '../config/schema.js';
import { PipelineMetrics, StageMetrics, TimeSeriesData, LoopMetrics } from './types.js';
import { LoopStateManager } from '../core/loop-state-manager.js';

export class PipelineAnalytics {
  private loopStateManager: LoopStateManager;

  constructor(
    private stateManager: StateManager,
    repoPath: string
  ) {
    this.loopStateManager = new LoopStateManager(repoPath);
  }

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
    type StageAggregate = {
      stageName: string;
      totalRuns: number;
      successCount: number;
      failureCount: number;
      durationTotal: number;
      durationSamples: number;
    };

    const aggregates = new Map<string, StageAggregate>();

    for (const run of runs) {
      for (const stage of run.stages) {
        const aggregate = aggregates.get(stage.stageName) ?? {
          stageName: stage.stageName,
          totalRuns: 0,
          successCount: 0,
          failureCount: 0,
          durationTotal: 0,
          durationSamples: 0
        };

        aggregate.totalRuns++;

        if (stage.status === 'success') {
          aggregate.successCount++;
        } else if (stage.status === 'failed') {
          aggregate.failureCount++;
        }

        if (typeof stage.duration === 'number') {
          aggregate.durationTotal += stage.duration;
          aggregate.durationSamples++;
        }

        aggregates.set(stage.stageName, aggregate);
      }
    }

    const metrics = new Map<string, StageMetrics>();

    for (const aggregate of aggregates.values()) {
      const { stageName, totalRuns, successCount, failureCount, durationTotal, durationSamples } =
        aggregate;

      metrics.set(stageName, {
        stageName,
        totalRuns,
        failureCount,
        successRate: totalRuns > 0 ? successCount / totalRuns : 0,
        averageDuration: durationSamples > 0 ? durationTotal / durationSamples : 0
      });
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
      .map(([date, data]) => {
        const totalRuns = data.successes + data.failures;
        return {
          date,
          successRate: totalRuns > 0 ? data.successes / totalRuns : 0,
          totalRuns
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Generate metrics for loop sessions
   */
  async generateLoopMetrics(
    timeRange?: { start: Date; end: Date }
  ): Promise<LoopMetrics> {
    const allSessions = await this.loopStateManager.getAllSessions();

    // Filter by time range
    const filteredSessions = timeRange
      ? allSessions.filter((session) => {
          const sessionTime = new Date(session.startTime);
          return sessionTime >= timeRange.start && sessionTime <= timeRange.end;
        })
      : allSessions;

    // Calculate session counts by status
    const totalSessions = filteredSessions.length;
    const completedSessions = filteredSessions.filter(s => s.status === 'completed').length;
    const failedSessions = filteredSessions.filter(s => s.status === 'failed').length;
    const limitReachedSessions = filteredSessions.filter(s => s.status === 'limit-reached').length;

    // Calculate iteration statistics
    const totalIterations = filteredSessions.reduce((sum, s) => sum + s.totalIterations, 0);
    const averageIterationsPerSession = totalSessions > 0
      ? totalIterations / totalSessions
      : 0;

    // Find most common pipelines
    const pipelineCounts = new Map<string, number>();
    for (const session of filteredSessions) {
      for (const iteration of session.iterations) {
        pipelineCounts.set(
          iteration.pipelineName,
          (pipelineCounts.get(iteration.pipelineName) || 0) + 1
        );
      }
    }

    // Calculate termination reasons
    const terminationReasons = new Map<string, number>();
    for (const session of filteredSessions) {
      terminationReasons.set(
        session.status,
        (terminationReasons.get(session.status) || 0) + 1
      );
    }

    return {
      totalSessions,
      completedSessions,
      failedSessions,
      limitReachedSessions,
      averageIterationsPerSession,
      totalIterations,
      mostCommonPipelines: pipelineCounts,
      terminationReasons
    };
  }
}
