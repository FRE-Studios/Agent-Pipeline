import { describe, it, expect } from 'vitest';
import {
  interpolateTemplate,
  buildStaticContext,
  buildRunContext,
  buildStageContext,
} from '../../utils/template-interpolator.js';
import type { PipelineConfig } from '../../config/schema.js';

describe('interpolateTemplate', () => {
  it('should replace known variables', () => {
    const result = interpolateTemplate('Hello {{name}}!', { name: 'World' });
    expect(result).toBe('Hello World!');
  });

  it('should leave unknown variables as-is', () => {
    const result = interpolateTemplate('{{known}} and {{unknown}}', { known: 'yes' });
    expect(result).toBe('yes and {{unknown}}');
  });

  it('should handle null and undefined values by keeping placeholder', () => {
    const result = interpolateTemplate('{{a}} {{b}}', { a: null, b: undefined });
    expect(result).toBe('{{a}} {{b}}');
  });

  it('should replace multiple variables in one template', () => {
    const result = interpolateTemplate(
      '[{{prefix}}:{{stage}}] {{msg}}',
      { prefix: 'pipeline', stage: 'build', msg: 'done' }
    );
    expect(result).toBe('[pipeline:build] done');
  });

  it('should convert numeric values to string', () => {
    const result = interpolateTemplate('Index: {{idx}}', { idx: 42 });
    expect(result).toBe('Index: 42');
  });

  it('should handle empty string values', () => {
    const result = interpolateTemplate('Val: {{empty}}', { empty: '' });
    expect(result).toBe('Val: ');
  });

  it('should handle template with no variables', () => {
    const result = interpolateTemplate('no variables here', { key: 'val' });
    expect(result).toBe('no variables here');
  });

  it('should handle empty template', () => {
    const result = interpolateTemplate('', { key: 'val' });
    expect(result).toBe('');
  });

  it('should handle same variable used multiple times', () => {
    const result = interpolateTemplate('{{x}} and {{x}}', { x: 'hello' });
    expect(result).toBe('hello and hello');
  });
});

describe('buildStaticContext', () => {
  const mockConfig: PipelineConfig = {
    name: 'my-pipeline',
    trigger: 'manual',
    git: { baseBranch: 'develop' },
    agents: [],
  };

  it('should build correct static context keys', () => {
    const ctx = buildStaticContext(mockConfig, 'run-abc-123');

    expect(ctx.pipelineName).toBe('my-pipeline');
    expect(ctx.runId).toBe('run-abc-123');
    expect(ctx.trigger).toBe('manual');
    expect(ctx.baseBranch).toBe('develop');
    expect(ctx.timestamp).toBeDefined();
    // timestamp should be a valid ISO string
    expect(() => new Date(ctx.timestamp)).not.toThrow();
  });

  it('should default baseBranch to main when git config omitted', () => {
    const configNoGit: PipelineConfig = {
      name: 'simple',
      trigger: 'post-commit',
      agents: [],
    };

    const ctx = buildStaticContext(configNoGit, 'run-xyz');
    expect(ctx.baseBranch).toBe('main');
  });
});

describe('buildRunContext', () => {
  it('should extend static context with per-run fields', () => {
    const static_ = buildStaticContext(
      { name: 'p', trigger: 'manual', agents: [] },
      'run-1'
    );

    const run = buildRunContext(static_, 'pipeline/my-branch', 'abc123');

    expect(run.pipelineName).toBe('p');
    expect(run.runId).toBe('run-1');
    expect(run.branch).toBe('pipeline/my-branch');
    expect(run.initialCommit).toBe('abc123');
  });
});

describe('buildStageContext', () => {
  it('should extend run context with per-stage fields', () => {
    const static_ = buildStaticContext(
      { name: 'p', trigger: 'manual', agents: [] },
      'run-1'
    );
    const run = buildRunContext(static_, 'branch', 'commit');
    const stage = buildStageContext(run, 'code-review', 2);

    expect(stage.stage).toBe('code-review');
    expect(stage.stageIndex).toBe('2');
    // inherited fields
    expect(stage.pipelineName).toBe('p');
    expect(stage.branch).toBe('branch');
  });
});
