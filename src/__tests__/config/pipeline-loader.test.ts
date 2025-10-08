import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PipelineLoader } from '../../config/pipeline-loader.js';
import { createTempDir, cleanupTempDir } from '../setup.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as YAML from 'yaml';
import { simplePipelineConfig, parallelPipelineConfig } from '../fixtures/pipeline-configs.js';

describe('PipelineLoader', () => {
  let tempDir: string;
  let loader: PipelineLoader;
  let pipelinesDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir('pipeline-loader-test-');
    loader = new PipelineLoader(tempDir);

    pipelinesDir = path.join(tempDir, '.agent-pipeline', 'pipelines');
    await fs.mkdir(pipelinesDir, { recursive: true });
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('loadPipeline', () => {
    it('should load a valid pipeline configuration', async () => {
      const configPath = path.join(pipelinesDir, 'test-pipeline.yml');
      await fs.writeFile(configPath, YAML.stringify(simplePipelineConfig), 'utf-8');

      const loaded = await loader.loadPipeline('test-pipeline');

      expect(loaded.name).toBe(simplePipelineConfig.name);
      expect(loaded.trigger).toBe(simplePipelineConfig.trigger);
      expect(loaded.agents).toHaveLength(simplePipelineConfig.agents.length);
    });

    it('should load pipeline with all properties', async () => {
      const configPath = path.join(pipelinesDir, 'parallel-test.yml');
      await fs.writeFile(configPath, YAML.stringify(parallelPipelineConfig), 'utf-8');

      const loaded = await loader.loadPipeline('parallel-test');

      expect(loaded.name).toBe(parallelPipelineConfig.name);
      expect(loaded.agents).toHaveLength(4);
      expect(loaded.settings?.executionMode).toBe('parallel');
    });

    it('should throw error for non-existent pipeline', async () => {
      await expect(loader.loadPipeline('non-existent'))
        .rejects
        .toThrow('Pipeline not found: non-existent');
    });

    it('should throw error for invalid YAML', async () => {
      const configPath = path.join(pipelinesDir, 'invalid.yml');
      await fs.writeFile(configPath, 'invalid: yaml: content:', 'utf-8');

      await expect(loader.loadPipeline('invalid'))
        .rejects
        .toThrow();
    });

    it('should throw error for missing required fields', async () => {
      const invalidConfig = {
        // Missing name and agents
        trigger: 'manual',
      };

      const configPath = path.join(pipelinesDir, 'missing-fields.yml');
      await fs.writeFile(configPath, YAML.stringify(invalidConfig), 'utf-8');

      await expect(loader.loadPipeline('missing-fields'))
        .rejects
        .toThrow('Invalid pipeline configuration: missing required fields');
    });

    it('should throw error for empty agents array', async () => {
      const invalidConfig = {
        name: 'empty-agents',
        trigger: 'manual',
        agents: [],
      };

      const configPath = path.join(pipelinesDir, 'empty-agents.yml');
      await fs.writeFile(configPath, YAML.stringify(invalidConfig), 'utf-8');

      await expect(loader.loadPipeline('empty-agents'))
        .rejects
        .toThrow('Invalid pipeline configuration: missing required fields');
    });

    it('should handle pipeline with complex dependencies', async () => {
      const complexConfig = {
        name: 'complex',
        trigger: 'manual',
        agents: [
          { name: 'stage-1', agent: 'agent1.md' },
          { name: 'stage-2', agent: 'agent2.md', dependsOn: ['stage-1'] },
          { name: 'stage-3', agent: 'agent3.md', dependsOn: ['stage-1', 'stage-2'] },
        ],
      };

      const configPath = path.join(pipelinesDir, 'complex.yml');
      await fs.writeFile(configPath, YAML.stringify(complexConfig), 'utf-8');

      const loaded = await loader.loadPipeline('complex');

      expect(loaded.agents[1].dependsOn).toEqual(['stage-1']);
      expect(loaded.agents[2].dependsOn).toEqual(['stage-1', 'stage-2']);
    });

    it('should handle pipeline with conditional stages', async () => {
      const conditionalConfig = {
        name: 'conditional',
        trigger: 'manual',
        agents: [
          { name: 'review', agent: 'review.md', outputs: ['issues'] },
          {
            name: 'fix',
            agent: 'fix.md',
            dependsOn: ['review'],
            condition: '{{ stages.review.outputs.issues > 0 }}',
          },
        ],
      };

      const configPath = path.join(pipelinesDir, 'conditional.yml');
      await fs.writeFile(configPath, YAML.stringify(conditionalConfig), 'utf-8');

      const loaded = await loader.loadPipeline('conditional');

      expect(loaded.agents[1].condition).toBe('{{ stages.review.outputs.issues > 0 }}');
    });

    it('should handle pipeline with retry configuration', async () => {
      const retryConfig = {
        name: 'retry',
        trigger: 'manual',
        agents: [
          {
            name: 'flaky-stage',
            agent: 'flaky.md',
            retry: {
              maxAttempts: 3,
              backoff: 'exponential',
              initialDelay: 1000,
              maxDelay: 30000,
            },
          },
        ],
      };

      const configPath = path.join(pipelinesDir, 'retry.yml');
      await fs.writeFile(configPath, YAML.stringify(retryConfig), 'utf-8');

      const loaded = await loader.loadPipeline('retry');

      expect(loaded.agents[0].retry).toBeDefined();
      expect(loaded.agents[0].retry?.maxAttempts).toBe(3);
      expect(loaded.agents[0].retry?.backoff).toBe('exponential');
    });

    it('should handle pipeline with git configuration', async () => {
      const gitConfig = {
        name: 'git-workflow',
        trigger: 'manual',
        git: {
          baseBranch: 'main',
          branchStrategy: 'reusable',
          pullRequest: {
            autoCreate: true,
            title: 'Test PR',
            reviewers: ['user1'],
          },
        },
        agents: [
          { name: 'stage-1', agent: 'agent.md' },
        ],
      };

      const configPath = path.join(pipelinesDir, 'git-workflow.yml');
      await fs.writeFile(configPath, YAML.stringify(gitConfig), 'utf-8');

      const loaded = await loader.loadPipeline('git-workflow');

      expect(loaded.git).toBeDefined();
      expect(loaded.git?.baseBranch).toBe('main');
      expect(loaded.git?.pullRequest?.autoCreate).toBe(true);
    });

    it('should handle pipeline with notifications', async () => {
      const notificationConfig = {
        name: 'with-notifications',
        trigger: 'manual',
        notifications: {
          enabled: true,
          events: ['pipeline.started', 'pipeline.completed'],
          channels: {
            local: {
              enabled: true,
              sound: true,
            },
            slack: {
              enabled: true,
              webhookUrl: 'https://hooks.slack.com/test',
            },
          },
        },
        agents: [
          { name: 'stage-1', agent: 'agent.md' },
        ],
      };

      const configPath = path.join(pipelinesDir, 'with-notifications.yml');
      await fs.writeFile(configPath, YAML.stringify(notificationConfig), 'utf-8');

      const loaded = await loader.loadPipeline('with-notifications');

      expect(loaded.notifications).toBeDefined();
      expect(loaded.notifications?.enabled).toBe(true);
      expect(loaded.notifications?.channels?.slack?.webhookUrl).toBe('https://hooks.slack.com/test');
    });
  });

  describe('listPipelines', () => {
    it('should list all pipeline files', async () => {
      // Create multiple pipeline files
      await fs.writeFile(
        path.join(pipelinesDir, 'pipeline1.yml'),
        YAML.stringify(simplePipelineConfig),
        'utf-8'
      );
      await fs.writeFile(
        path.join(pipelinesDir, 'pipeline2.yml'),
        YAML.stringify(parallelPipelineConfig),
        'utf-8'
      );
      await fs.writeFile(
        path.join(pipelinesDir, 'pipeline3.yaml'),
        YAML.stringify(simplePipelineConfig),
        'utf-8'
      );

      const pipelines = await loader.listPipelines();

      expect(pipelines).toHaveLength(3);
      expect(pipelines).toContain('pipeline1');
      expect(pipelines).toContain('pipeline2');
      expect(pipelines).toContain('pipeline3');
    });

    it('should return empty array if directory does not exist', async () => {
      const emptyLoader = new PipelineLoader('/non/existent/path');
      const pipelines = await emptyLoader.listPipelines();

      expect(pipelines).toEqual([]);
    });

    it('should return empty array if no pipeline files exist', async () => {
      const pipelines = await loader.listPipelines();

      expect(pipelines).toEqual([]);
    });

    it('should filter out non-YAML files', async () => {
      await fs.writeFile(path.join(pipelinesDir, 'pipeline1.yml'), YAML.stringify(simplePipelineConfig), 'utf-8');
      await fs.writeFile(path.join(pipelinesDir, 'readme.txt'), 'Not a pipeline', 'utf-8');
      await fs.writeFile(path.join(pipelinesDir, 'config.json'), '{}', 'utf-8');

      const pipelines = await loader.listPipelines();

      expect(pipelines).toHaveLength(1);
      expect(pipelines).toContain('pipeline1');
    });

    it('should handle both .yml and .yaml extensions', async () => {
      await fs.writeFile(path.join(pipelinesDir, 'test1.yml'), YAML.stringify(simplePipelineConfig), 'utf-8');
      await fs.writeFile(path.join(pipelinesDir, 'test2.yaml'), YAML.stringify(simplePipelineConfig), 'utf-8');

      const pipelines = await loader.listPipelines();

      expect(pipelines).toHaveLength(2);
      expect(pipelines).toContain('test1');
      expect(pipelines).toContain('test2');
    });

    it('should handle files with hyphens in names', async () => {
      await fs.writeFile(
        path.join(pipelinesDir, 'my-complex-pipeline.yml'),
        YAML.stringify(simplePipelineConfig),
        'utf-8'
      );

      const pipelines = await loader.listPipelines();

      expect(pipelines).toContain('my-complex-pipeline');
    });

    it('should handle subdirectories gracefully', async () => {
      await fs.writeFile(path.join(pipelinesDir, 'pipeline1.yml'), YAML.stringify(simplePipelineConfig), 'utf-8');

      const subDir = path.join(pipelinesDir, 'archived');
      await fs.mkdir(subDir);

      const pipelines = await loader.listPipelines();

      // Should not crash, just ignore subdirectories
      expect(pipelines).toContain('pipeline1');
    });
  });

  describe('edge cases', () => {
    it('should handle very long pipeline names', async () => {
      const longName = 'very-long-pipeline-name-' + 'x'.repeat(100);
      const configPath = path.join(pipelinesDir, `${longName}.yml`);
      await fs.writeFile(configPath, YAML.stringify(simplePipelineConfig), 'utf-8');

      const loaded = await loader.loadPipeline(longName);
      expect(loaded).toBeDefined();
    });

    it('should handle pipeline with unicode characters', async () => {
      const config = {
        name: 'unicode-test-🚀',
        trigger: 'manual',
        agents: [
          { name: 'stage-1', agent: 'agent.md' },
        ],
      };

      const configPath = path.join(pipelinesDir, 'unicode.yml');
      await fs.writeFile(configPath, YAML.stringify(config), 'utf-8');

      const loaded = await loader.loadPipeline('unicode');
      expect(loaded.name).toBe('unicode-test-🚀');
    });

    it('should handle empty YAML file', async () => {
      const configPath = path.join(pipelinesDir, 'empty.yml');
      await fs.writeFile(configPath, '', 'utf-8');

      await expect(loader.loadPipeline('empty'))
        .rejects
        .toThrow();
    });

    it('should handle YAML with comments', async () => {
      const yamlWithComments = `
# This is a test pipeline
name: commented-pipeline
trigger: manual  # Manual trigger

# Agent configurations
agents:
  - name: stage-1
    agent: agent.md  # Test agent
      `;

      const configPath = path.join(pipelinesDir, 'commented.yml');
      await fs.writeFile(configPath, yamlWithComments, 'utf-8');

      const loaded = await loader.loadPipeline('commented');
      expect(loaded.name).toBe('commented-pipeline');
      expect(loaded.agents).toHaveLength(1);
    });

    it('should handle concurrent pipeline loads', async () => {
      const configPath1 = path.join(pipelinesDir, 'concurrent1.yml');
      const configPath2 = path.join(pipelinesDir, 'concurrent2.yml');

      await fs.writeFile(configPath1, YAML.stringify({ ...simplePipelineConfig, name: 'concurrent1' }), 'utf-8');
      await fs.writeFile(configPath2, YAML.stringify({ ...parallelPipelineConfig, name: 'concurrent2' }), 'utf-8');

      const [loaded1, loaded2] = await Promise.all([
        loader.loadPipeline('concurrent1'),
        loader.loadPipeline('concurrent2'),
      ]);

      expect(loaded1.name).toBe('concurrent1');
      expect(loaded2.name).toBe('concurrent2');
    });

    it('should preserve agent order from YAML', async () => {
      const orderedConfig = {
        name: 'ordered',
        trigger: 'manual',
        agents: [
          { name: 'first', agent: 'a.md' },
          { name: 'second', agent: 'b.md' },
          { name: 'third', agent: 'c.md' },
        ],
      };

      const configPath = path.join(pipelinesDir, 'ordered.yml');
      await fs.writeFile(configPath, YAML.stringify(orderedConfig), 'utf-8');

      const loaded = await loader.loadPipeline('ordered');

      expect(loaded.agents[0].name).toBe('first');
      expect(loaded.agents[1].name).toBe('second');
      expect(loaded.agents[2].name).toBe('third');
    });
  });
});
