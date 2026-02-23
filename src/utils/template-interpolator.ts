// src/utils/template-interpolator.ts

import { PipelineConfig } from '../config/schema.js';

/**
 * Static template variables — same for the entire pipeline run.
 */
export interface StaticTemplateContext {
  pipelineName: string;
  runId: string;
  trigger: string;
  timestamp: string;
  baseBranch: string;
}

/**
 * Per-run variables — set after init, static once set.
 */
export interface RunTemplateContext extends StaticTemplateContext {
  branch: string;
  initialCommit: string;
}

/**
 * Per-stage variables — change for each stage.
 */
export interface StageTemplateContext extends RunTemplateContext {
  stage: string;
  stageIndex: string;
}

/**
 * Replace {{variable}} placeholders in a template string.
 * Unknown variables are left as-is.
 */
export function interpolateTemplate(
  template: string,
  context: Record<string, unknown>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const value = context[key];
    if (value === undefined || value === null) {
      return match; // Keep placeholder if no value
    }
    return String(value);
  });
}

/**
 * Build the static context available at pipeline config time.
 */
export function buildStaticContext(
  config: PipelineConfig,
  runId: string
): StaticTemplateContext {
  return {
    pipelineName: config.name,
    runId,
    trigger: config.trigger,
    timestamp: new Date().toISOString(),
    baseBranch: config.git?.baseBranch || 'main',
  };
}

/**
 * Extend static context with per-run values (set after init).
 */
export function buildRunContext(
  staticCtx: StaticTemplateContext,
  branch: string,
  initialCommit: string
): RunTemplateContext {
  return {
    ...staticCtx,
    branch,
    initialCommit,
  };
}

/**
 * Extend run context with per-stage values.
 */
export function buildStageContext(
  runCtx: RunTemplateContext,
  stageName: string,
  stageIndex: number
): StageTemplateContext {
  return {
    ...runCtx,
    stage: stageName,
    stageIndex: String(stageIndex),
  };
}
