// src/analytics/types.ts

export interface PipelineMetrics {
  totalRuns: number;
  successRate: number;
  averageDuration: number;
  stageMetrics: Map<string, StageMetrics>;
  failureReasons: Map<string, number>;
  trendsOverTime: TimeSeriesData[];
}

export interface StageMetrics {
  stageName: string;
  successRate: number;
  averageDuration: number;
  failureCount: number;
  totalRuns: number;
}

export interface TimeSeriesData {
  date: string;
  successRate: number;
  totalRuns: number;
}
