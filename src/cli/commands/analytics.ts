// src/cli/commands/analytics.ts

import { StateManager } from '../../core/state-manager.js';
import { PipelineAnalytics } from '../../analytics/pipeline-analytics.js';

export async function analyticsCommand(
  repoPath: string,
  options: {
    pipeline?: string;
    days?: number;
    loops?: boolean;
  }
): Promise<void> {
  const stateManager = new StateManager(repoPath);
  const analytics = new PipelineAnalytics(stateManager, repoPath);

  const timeRange = options.days
    ? {
        start: new Date(Date.now() - options.days * 24 * 60 * 60 * 1000),
        end: new Date()
      }
    : undefined;

  // Handle loop analytics separately
  if (options.loops) {
    await displayLoopMetrics(analytics, timeRange, options.days);
    return;
  }

  const metrics = await analytics.generateMetrics(options.pipeline, timeRange);

  if (metrics.totalRuns === 0) {
    console.log('\n📊 Pipeline Analytics\n');
    console.log('No pipeline runs found for the specified criteria.\n');
    return;
  }

  console.log('\n📊 Pipeline Analytics\n');

  if (options.pipeline) {
    console.log(`Pipeline: ${options.pipeline}`);
  }
  if (options.days) {
    console.log(`Time Range: Last ${options.days} days`);
  }
  console.log('');

  console.log(`Total Runs: ${metrics.totalRuns}`);
  console.log(`Success Rate: ${(metrics.successRate * 100).toFixed(1)}%`);
  console.log(`Average Duration: ${metrics.averageDuration.toFixed(2)}s\n`);

  if (metrics.stageMetrics.size > 0) {
    console.log('Stage Performance:');
    for (const [name, stage] of metrics.stageMetrics) {
      console.log(`  ${name}:`);
      console.log(`    Success Rate: ${(stage.successRate * 100).toFixed(1)}%`);
      console.log(`    Avg Duration: ${stage.averageDuration.toFixed(2)}s`);
      console.log(`    Failures: ${stage.failureCount}`);
      console.log(`    Total Runs: ${stage.totalRuns}`);
    }
    console.log('');
  }

  if (metrics.failureReasons.size > 0) {
    console.log('Top Failure Reasons:');
    const sortedFailures = Array.from(metrics.failureReasons.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    for (const [reason, count] of sortedFailures) {
      console.log(`  ${count}x ${reason}`);
    }
    console.log('');
  }

  if (metrics.trendsOverTime.length > 0) {
    console.log('Trends Over Time (by day):');
    const recentTrends = metrics.trendsOverTime.slice(-7); // Last 7 days
    for (const trend of recentTrends) {
      const successBar = '█'.repeat(Math.round(trend.successRate * 20));
      console.log(
        `  ${trend.date}: ${successBar} ${(trend.successRate * 100).toFixed(0)}% (${trend.totalRuns} runs)`
      );
    }
    console.log('');
  }
}

/**
 * Display loop-specific analytics
 */
async function displayLoopMetrics(
  analytics: PipelineAnalytics,
  timeRange: { start: Date; end: Date } | undefined,
  days: number | undefined
): Promise<void> {
  const metrics = await analytics.generateLoopMetrics(timeRange);

  if (metrics.totalSessions === 0) {
    console.log('\n📊 Loop Analytics\n');
    console.log('No loop sessions found for the specified criteria.\n');
    return;
  }

  console.log('\n📊 Loop Analytics\n');

  if (days) {
    console.log(`Time Range: Last ${days} days`);
  }
  console.log('');

  console.log(`Total Sessions: ${metrics.totalSessions}`);
  console.log(`Completed: ${metrics.completedSessions}`);
  console.log(`Failed: ${metrics.failedSessions}`);
  console.log(`Limit Reached: ${metrics.limitReachedSessions}`);
  console.log(`Total Iterations: ${metrics.totalIterations}`);
  console.log(`Avg Iterations/Session: ${metrics.averageIterationsPerSession.toFixed(2)}\n`);

  if (metrics.terminationReasons.size > 0) {
    console.log('Termination Reasons:');
    for (const [reason, count] of metrics.terminationReasons) {
      const percentage = ((count / metrics.totalSessions) * 100).toFixed(1);
      console.log(`  ${reason}: ${count} (${percentage}%)`);
    }
    console.log('');
  }

  if (metrics.mostCommonPipelines.size > 0) {
    console.log('Most Common Pipelines:');
    const sortedPipelines = Array.from(metrics.mostCommonPipelines.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    for (const [pipeline, count] of sortedPipelines) {
      console.log(`  ${count}x ${pipeline}`);
    }
    console.log('');
  }
}
