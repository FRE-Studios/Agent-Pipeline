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

      const { config, metadata } = await loader.loadPipeline('test-pipeline');

      expect(config.name).toBe(simplePipelineConfig.name);
      expect(config.trigger).toBe(simplePipelineConfig.trigger);
      expect(config.agents).toHaveLength(simplePipelineConfig.agents.length);

      expect(metadata.sourceType).toBe('library');
      expect(metadata.sourcePath).toBe(configPath);
      expect(metadata.loadedAt).toBeDefined();
    });

    it('should load pipeline with all properties', async () => {
      const configPath = path.join(pipelinesDir, 'parallel-test.yml');
      await fs.writeFile(configPath, YAML.stringify(parallelPipelineConfig), 'utf-8');

      const { config, metadata } = await loader.loadPipeline('parallel-test');

      expect(config.name).toBe(parallelPipelineConfig.name);
      expect(config.agents).toHaveLength(4);
      expect(config.settings?.executionMode).toBe('parallel');
      expect(metadata.sourceType).toBe('library');
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

      const { config } = await loader.loadPipeline('complex');

      expect(config.agents[1].dependsOn).toEqual(['stage-1']);
      expect(config.agents[2].dependsOn).toEqual(['stage-1', 'stage-2']);
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

      const { config } = await loader.loadPipeline('conditional');

      expect(config.agents[1].condition).toBe('{{ stages.review.outputs.issues > 0 }}');
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

      const { config } = await loader.loadPipeline('retry');

      expect(config.agents[0].retry).toBeDefined();
      expect(config.agents[0].retry?.maxAttempts).toBe(3);
      expect(config.agents[0].retry?.backoff).toBe('exponential');
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

      const { config } = await loader.loadPipeline('git-workflow');

      expect(config.git).toBeDefined();
      expect(config.git?.baseBranch).toBe('main');
      expect(config.git?.pullRequest?.autoCreate).toBe(true);
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

      const { config } = await loader.loadPipeline('with-notifications');

      expect(config.notifications).toBeDefined();
      expect(config.notifications?.enabled).toBe(true);
      expect(config.notifications?.channels?.slack?.webhookUrl).toBe('https://hooks.slack.com/test');
    });

    it('should handle pipeline with saveVerboseOutputs configuration', async () => {
      const verboseOutputsConfig = {
        name: 'with-verbose-outputs',
        trigger: 'manual',
        settings: {
          autoCommit: true,
          commitPrefix: '[pipeline]',
          failureStrategy: 'stop',
          preserveWorkingTree: false,
          saveVerboseOutputs: true,
        },
        agents: [
          { name: 'stage-1', agent: 'agent.md' },
        ],
      };

      const configPath = path.join(pipelinesDir, 'with-verbose-outputs.yml');
      await fs.writeFile(configPath, YAML.stringify(verboseOutputsConfig), 'utf-8');

      const { config } = await loader.loadPipeline('with-verbose-outputs');

      expect(config.settings?.saveVerboseOutputs).toBe(true);
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

      const { config } = await loader.loadPipeline(longName);
      expect(config).toBeDefined();
    });

    it('should handle pipeline with unicode characters', async () => {
      const testConfig = {
        name: 'unicode-test-🚀',
        trigger: 'manual',
        agents: [
          { name: 'stage-1', agent: 'agent.md' },
        ],
      };

      const configPath = path.join(pipelinesDir, 'unicode.yml');
      await fs.writeFile(configPath, YAML.stringify(testConfig), 'utf-8');

      const { config } = await loader.loadPipeline('unicode');
      expect(config.name).toBe('unicode-test-🚀');
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

      const { config } = await loader.loadPipeline('commented');
      expect(config.name).toBe('commented-pipeline');
      expect(config.agents).toHaveLength(1);
    });

    it('should handle concurrent pipeline loads', async () => {
      const configPath1 = path.join(pipelinesDir, 'concurrent1.yml');
      const configPath2 = path.join(pipelinesDir, 'concurrent2.yml');

      await fs.writeFile(configPath1, YAML.stringify({ ...simplePipelineConfig, name: 'concurrent1' }), 'utf-8');
      await fs.writeFile(configPath2, YAML.stringify({ ...parallelPipelineConfig, name: 'concurrent2' }), 'utf-8');

      const [result1, result2] = await Promise.all([
        loader.loadPipeline('concurrent1'),
        loader.loadPipeline('concurrent2'),
      ]);

      expect(result1.config.name).toBe('concurrent1');
      expect(result2.config.name).toBe('concurrent2');
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

      const { config } = await loader.loadPipeline('ordered');

      expect(config.agents[0].name).toBe('first');
      expect(config.agents[1].name).toBe('second');
      expect(config.agents[2].name).toBe('third');
    });
  });

  describe('loadPipelineFromPath', () => {
    it('should load pipeline from absolute path', async () => {
      const externalDir = path.join(tempDir, 'external');
      await fs.mkdir(externalDir, { recursive: true });

      const configPath = path.join(externalDir, 'external-pipeline.yml');
      await fs.writeFile(configPath, YAML.stringify(simplePipelineConfig), 'utf-8');

      const { config, metadata } = await loader.loadPipelineFromPath(configPath);

      expect(config.name).toBe(simplePipelineConfig.name);
      expect(config.agents).toHaveLength(simplePipelineConfig.agents.length);
      expect(metadata.sourceType).toBe('loop-pending');
      expect(metadata.sourcePath).toBe(path.resolve(configPath));
      expect(metadata.loadedAt).toBeDefined();
    });

    it('should load pipeline from relative path', async () => {
      const externalDir = path.join(tempDir, 'external');
      await fs.mkdir(externalDir, { recursive: true });

      const configPath = path.join(externalDir, 'relative-pipeline.yml');
      await fs.writeFile(configPath, YAML.stringify(simplePipelineConfig), 'utf-8');

      // Use relative path
      const relativePath = path.relative(process.cwd(), configPath);
      const { config, metadata } = await loader.loadPipelineFromPath(relativePath);

      expect(config.name).toBe(simplePipelineConfig.name);
      expect(metadata.sourceType).toBe('loop-pending');
      expect(path.isAbsolute(metadata.sourcePath)).toBe(true);
    });

    it('should load pipeline from outside .agent-pipeline directory', async () => {
      const outsideDir = path.join(tempDir, 'somewhere-else', 'pipelines');
      await fs.mkdir(outsideDir, { recursive: true });

      const configPath = path.join(outsideDir, 'outside-pipeline.yml');
      await fs.writeFile(configPath, YAML.stringify(parallelPipelineConfig), 'utf-8');

      const { config, metadata } = await loader.loadPipelineFromPath(configPath);

      expect(config.name).toBe(parallelPipelineConfig.name);
      expect(metadata.sourceType).toBe('loop-pending');
      expect(metadata.sourcePath).toContain('somewhere-else');
    });

    it('should throw error for non-existent file', async () => {
      const nonExistentPath = path.join(tempDir, 'does-not-exist.yml');

      await expect(loader.loadPipelineFromPath(nonExistentPath))
        .rejects
        .toThrow('Pipeline file not found');
    });

    it('should validate required fields from path-loaded pipeline', async () => {
      const invalidConfig = {
        // Missing required fields
        trigger: 'manual',
      };

      const configPath = path.join(tempDir, 'invalid-from-path.yml');
      await fs.writeFile(configPath, YAML.stringify(invalidConfig), 'utf-8');

      await expect(loader.loadPipelineFromPath(configPath))
        .rejects
        .toThrow('Invalid pipeline configuration: missing required fields');
    });

    it('should handle malformed YAML from path', async () => {
      const configPath = path.join(tempDir, 'malformed.yml');
      await fs.writeFile(configPath, 'invalid: yaml: content:', 'utf-8');

      await expect(loader.loadPipelineFromPath(configPath))
        .rejects
        .toThrow();
    });

    it('should return different metadata sourceType than loadPipeline', async () => {
      // Load from library
      const libraryPath = path.join(pipelinesDir, 'library-test.yml');
      await fs.writeFile(libraryPath, YAML.stringify(simplePipelineConfig), 'utf-8');
      const libraryResult = await loader.loadPipeline('library-test');

      // Load from path
      const externalPath = path.join(tempDir, 'path-test.yml');
      await fs.writeFile(externalPath, YAML.stringify(simplePipelineConfig), 'utf-8');
      const pathResult = await loader.loadPipelineFromPath(externalPath);

      expect(libraryResult.metadata.sourceType).toBe('library');
      expect(pathResult.metadata.sourceType).toBe('loop-pending');
    });

    it('should handle concurrent loads from different paths', async () => {
      const path1 = path.join(tempDir, 'concurrent-path-1.yml');
      const path2 = path.join(tempDir, 'concurrent-path-2.yml');

      await fs.writeFile(path1, YAML.stringify({ ...simplePipelineConfig, name: 'concurrent1' }), 'utf-8');
      await fs.writeFile(path2, YAML.stringify({ ...parallelPipelineConfig, name: 'concurrent2' }), 'utf-8');

      const [result1, result2] = await Promise.all([
        loader.loadPipelineFromPath(path1),
        loader.loadPipelineFromPath(path2),
      ]);

      expect(result1.config.name).toBe('concurrent1');
      expect(result2.config.name).toBe('concurrent2');
      expect(result1.metadata.sourcePath).toBe(path.resolve(path1));
      expect(result2.metadata.sourcePath).toBe(path.resolve(path2));
    });

    it('should include timestamp in metadata', async () => {
      const configPath = path.join(tempDir, 'timestamped.yml');
      await fs.writeFile(configPath, YAML.stringify(simplePipelineConfig), 'utf-8');

      const before = new Date().toISOString();
      const { metadata } = await loader.loadPipelineFromPath(configPath);
      const after = new Date().toISOString();

      expect(metadata.loadedAt).toBeDefined();
      expect(metadata.loadedAt >= before).toBe(true);
      expect(metadata.loadedAt <= after).toBe(true);
    });

    it('should handle pipeline with all features from path', async () => {
      const complexConfig = {
        name: 'complex-from-path',
        trigger: 'manual',
        git: {
          baseBranch: 'main',
          branchStrategy: 'unique-per-run',
        },
        notifications: {
          enabled: true,
          events: ['pipeline.completed'],
        },
        settings: {
          autoCommit: true,
          commitPrefix: '[loop]',
          failureStrategy: 'stop',
          preserveWorkingTree: false,
        },
        agents: [
          { name: 'stage-1', agent: 'agent1.md' },
          { name: 'stage-2', agent: 'agent2.md', dependsOn: ['stage-1'] },
        ],
      };

      const configPath = path.join(tempDir, 'complex-from-path.yml');
      await fs.writeFile(configPath, YAML.stringify(complexConfig), 'utf-8');

      const { config, metadata } = await loader.loadPipelineFromPath(configPath);

      expect(config.name).toBe('complex-from-path');
      expect(config.git).toBeDefined();
      expect(config.notifications).toBeDefined();
      expect(config.settings).toBeDefined();
      expect(config.agents).toHaveLength(2);
      expect(metadata.sourceType).toBe('loop-pending');
    });
  });

  describe('runtime configuration', () => {
    it('should set default runtime to claude-code-headless when not specified', async () => {
      const configWithoutRuntime = {
        name: 'no-runtime-test',
        trigger: 'manual',
        agents: [{ name: 'stage-1', agent: 'agent.md' }],
      };
      const configPath = path.join(pipelinesDir, 'no-runtime.yml');
      await fs.writeFile(configPath, YAML.stringify(configWithoutRuntime), 'utf-8');

      const { config } = await loader.loadPipeline('no-runtime');

      expect(config.runtime).toBeDefined();
      expect(config.runtime?.type).toBe('claude-code-headless');
    });

    it('should load pipeline with runtime configuration', async () => {
      const runtimeConfig = {
        name: 'with-runtime',
        trigger: 'manual',
        runtime: {
          type: 'claude-code-headless',
          options: {
            model: 'sonnet',
            maxTurns: 10,
          },
        },
        agents: [
          { name: 'stage-1', agent: 'agent.md' },
        ],
      };

      const configPath = path.join(pipelinesDir, 'with-runtime.yml');
      await fs.writeFile(configPath, YAML.stringify(runtimeConfig), 'utf-8');

      const { config } = await loader.loadPipeline('with-runtime');

      expect(config.runtime).toBeDefined();
      expect(config.runtime?.type).toBe('claude-code-headless');
      expect(config.runtime?.options?.model).toBe('sonnet');
      expect(config.runtime?.options?.maxTurns).toBe(10);
    });

    it('should load pipeline with stage-level runtime override', async () => {
      const stageRuntimeConfig = {
        name: 'stage-runtime',
        trigger: 'manual',
        runtime: {
          type: 'claude-code-headless',
        },
        agents: [
          {
            name: 'stage-1',
            agent: 'agent1.md',
            runtime: {
              type: 'claude-sdk',
              options: {
                model: 'haiku',
              },
            },
          },
          {
            name: 'stage-2',
            agent: 'agent2.md',
            // Uses pipeline-level runtime
          },
        ],
      };

      const configPath = path.join(pipelinesDir, 'stage-runtime.yml');
      await fs.writeFile(configPath, YAML.stringify(stageRuntimeConfig), 'utf-8');

      const { config } = await loader.loadPipeline('stage-runtime');

      expect(config.runtime?.type).toBe('claude-code-headless');
      expect(config.agents[0].runtime?.type).toBe('claude-sdk');
      expect(config.agents[0].runtime?.options?.model).toBe('haiku');
      expect(config.agents[1].runtime).toBeUndefined(); // Uses pipeline-level
    });

    it('should load runtime with minimal configuration', async () => {
      const minimalRuntimeConfig = {
        name: 'minimal-runtime',
        trigger: 'manual',
        runtime: {
          type: 'claude-sdk',
        },
        agents: [
          { name: 'stage-1', agent: 'agent.md' },
        ],
      };

      const configPath = path.join(pipelinesDir, 'minimal-runtime.yml');
      await fs.writeFile(configPath, YAML.stringify(minimalRuntimeConfig), 'utf-8');

      const { config } = await loader.loadPipeline('minimal-runtime');

      expect(config.runtime).toBeDefined();
      expect(config.runtime?.type).toBe('claude-sdk');
      expect(config.runtime?.options).toBeUndefined();
    });

    it('should load runtime with complex options', async () => {
      const complexRuntimeConfig = {
        name: 'complex-runtime',
        trigger: 'manual',
        runtime: {
          type: 'claude-code-headless',
          options: {
            model: 'opus',
            maxTurns: 20,
            maxThinkingTokens: 10000,
            permissionMode: 'acceptEdits',
            customOption: 'customValue',
          },
        },
        agents: [
          { name: 'stage-1', agent: 'agent.md' },
        ],
      };

      const configPath = path.join(pipelinesDir, 'complex-runtime.yml');
      await fs.writeFile(configPath, YAML.stringify(complexRuntimeConfig), 'utf-8');

      const { config } = await loader.loadPipeline('complex-runtime');

      expect(config.runtime?.type).toBe('claude-code-headless');
      expect(config.runtime?.options?.model).toBe('opus');
      expect(config.runtime?.options?.maxTurns).toBe(20);
      expect(config.runtime?.options?.maxThinkingTokens).toBe(10000);
      expect(config.runtime?.options?.permissionMode).toBe('acceptEdits');
      expect(config.runtime?.options?.customOption).toBe('customValue');
    });

    it('should handle mixed runtime configuration across stages', async () => {
      const mixedRuntimeConfig = {
        name: 'mixed-runtime',
        trigger: 'manual',
        runtime: {
          type: 'claude-code-headless',
          options: {
            model: 'sonnet',
          },
        },
        agents: [
          {
            name: 'quick-check',
            agent: 'quick.md',
            runtime: {
              type: 'claude-sdk',
              options: {
                model: 'haiku',
              },
            },
          },
          {
            name: 'normal-stage',
            agent: 'normal.md',
            // Uses pipeline-level runtime (claude-code-headless with sonnet)
          },
          {
            name: 'deep-analysis',
            agent: 'deep.md',
            runtime: {
              type: 'claude-sdk',
              options: {
                model: 'opus',
                maxTurns: 30,
              },
            },
          },
        ],
      };

      const configPath = path.join(pipelinesDir, 'mixed-runtime.yml');
      await fs.writeFile(configPath, YAML.stringify(mixedRuntimeConfig), 'utf-8');

      const { config } = await loader.loadPipeline('mixed-runtime');

      expect(config.runtime?.type).toBe('claude-code-headless');
      expect(config.runtime?.options?.model).toBe('sonnet');

      expect(config.agents[0].runtime?.type).toBe('claude-sdk');
      expect(config.agents[0].runtime?.options?.model).toBe('haiku');

      expect(config.agents[1].runtime).toBeUndefined();

      expect(config.agents[2].runtime?.type).toBe('claude-sdk');
      expect(config.agents[2].runtime?.options?.model).toBe('opus');
      expect(config.agents[2].runtime?.options?.maxTurns).toBe(30);
    });
  });
});
