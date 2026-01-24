// src/__tests__/smoke/cli-integration.test.ts

/**
 * CLI Integration Tests
 *
 * These tests verify CLI command integration without spawning subprocesses.
 * They test the actual command functions with real file system operations
 * in temp directories, providing faster and more reliable testing than
 * subprocess-based smoke tests.
 *
 * For subprocess-based testing, see the individual command unit tests
 * in src/__tests__/cli/commands/
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { simpleGit } from 'simple-git';
import { createTempDir, cleanupTempDir } from '../setup.js';
import { initCommand } from '../../cli/commands/init.js';
import { validatePipelineCommand } from '../../cli/commands/pipeline/validate.js';
import { listCommand } from '../../cli/commands/list.js';
import { listAgentsCommand } from '../../cli/commands/agent/list.js';
import { AgentRuntimeRegistry } from '../../core/agent-runtime-registry.js';
import { ClaudeCodeHeadlessRuntime } from '../../core/agent-runtimes/claude-code-headless-runtime.js';
import { PipelineLoader } from '../../config/pipeline-loader.js';
import { PipelineValidator } from '../../validators/pipeline-validator.js';

describe('CLI Integration Tests', () => {
  let tempDir: string;
  let processExitSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tempDir = await createTempDir('cli-integration-');

    // Initialize git repo (required for pipeline validation)
    const git = simpleGit(tempDir);
    await git.init();
    await git.addConfig('user.name', 'Test User');
    await git.addConfig('user.email', 'test@example.com');

    // Register runtimes
    AgentRuntimeRegistry.clear();
    AgentRuntimeRegistry.register(new ClaudeCodeHeadlessRuntime());

    // Spy on process.exit to prevent actual exit
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
      throw new Error(`process.exit(${code})`);
    });

    // Spy on console for assertions
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    AgentRuntimeRegistry.clear();
    await cleanupTempDir(tempDir);
    processExitSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    vi.clearAllMocks();
  });

  describe('init -> list -> validate workflow', () => {
    it('should complete full initialization workflow', async () => {
      // Step 1: Initialize project
      await initCommand(tempDir);

      // Verify directories created
      const pipelinesDir = path.join(tempDir, '.agent-pipeline', 'pipelines');
      const agentsDir = path.join(tempDir, '.agent-pipeline', 'agents');

      expect(await fs.stat(pipelinesDir).then(() => true, () => false)).toBe(true);
      expect(await fs.stat(agentsDir).then(() => true, () => false)).toBe(true);

      // Verify pipelines created
      const pipelineFiles = await fs.readdir(pipelinesDir);
      const ymlFiles = pipelineFiles.filter(f => f.endsWith('.yml'));
      expect(ymlFiles).toContain('front-end-parallel-example.yml');
      expect(ymlFiles).toContain('post-commit-example.yml');
      expect(ymlFiles).toContain('loop-example.yml');

      // Verify agents created
      const agentFiles = await fs.readdir(agentsDir);
      const mdFiles = agentFiles.filter(f => f.endsWith('.md'));
      expect(mdFiles.length).toBeGreaterThan(0);
    });

    it('should list pipelines after init', async () => {
      await initCommand(tempDir);

      // List command writes to console
      await listCommand(tempDir);

      expect(consoleLogSpy).toHaveBeenCalled();
      const calls = consoleLogSpy.mock.calls.flat().join(' ');
      expect(calls).toContain('front-end-parallel-example');
    });

    it('should list agents after init', async () => {
      await initCommand(tempDir);

      await listAgentsCommand(tempDir);

      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('should validate initialized pipelines successfully', async () => {
      await initCommand(tempDir);

      // Load and validate pipeline directly (avoid process.exit in command)
      const loader = new PipelineLoader(tempDir);
      const { config } = await loader.loadPipeline('front-end-parallel-example');
      const errors = await new PipelineValidator().validate(config, tempDir);

      const actualErrors = errors.filter(e => e.severity === 'error');
      expect(actualErrors).toHaveLength(0);
    });
  });

  describe('Error Handling', () => {
    it('should fail validation for non-existent pipeline', async () => {
      await initCommand(tempDir);

      await expect(
        validatePipelineCommand(tempDir, 'non-existent-pipeline')
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('not found')
      );
    });

    it('should handle validation in non-initialized directory', async () => {
      const loader = new PipelineLoader(tempDir);

      await expect(
        loader.loadPipeline('test-pipeline')
      ).rejects.toThrow();
    });

    it('should report validation errors for invalid pipeline', async () => {
      await initCommand(tempDir);

      // Create invalid pipeline (missing agents)
      const invalidPipeline = path.join(
        tempDir,
        '.agent-pipeline/pipelines/invalid.yml'
      );
      await fs.writeFile(
        invalidPipeline,
        'name: invalid\ntrigger: manual\n',
        'utf-8'
      );

      // PipelineLoader throws for missing required fields
      const loader = new PipelineLoader(tempDir);
      await expect(loader.loadPipeline('invalid')).rejects.toThrow(
        /missing required fields/
      );
    });
  });

  describe('Pipeline Configuration Integrity', () => {
    it('should create pipelines with valid DAG dependencies', async () => {
      await initCommand(tempDir);

      const loader = new PipelineLoader(tempDir);
      const { config } = await loader.loadPipeline('front-end-parallel-example');

      // Verify DAG structure
      const agentNames = config.agents.map(a => a.name);

      for (const agent of config.agents) {
        if (agent.dependsOn) {
          for (const dep of agent.dependsOn) {
            expect(agentNames).toContain(dep);
          }
        }
      }
    });

    it('should create pipelines with correct trigger types', async () => {
      await initCommand(tempDir);

      const loader = new PipelineLoader(tempDir);

      const { config: frontend } = await loader.loadPipeline('front-end-parallel-example');
      expect(frontend.trigger).toBe('manual');

      const { config: postCommit } = await loader.loadPipeline('post-commit-example');
      expect(postCommit.trigger).toBe('post-commit');

      const { config: loopExample } = await loader.loadPipeline('loop-example');
      expect(loopExample.trigger).toBe('manual');
    });

    it('should reference agent files that exist', async () => {
      await initCommand(tempDir);

      const loader = new PipelineLoader(tempDir);
      const { config } = await loader.loadPipeline('front-end-parallel-example');

      for (const agent of config.agents) {
        const agentPath = path.join(tempDir, agent.agent);
        const exists = await fs.stat(agentPath).then(() => true, () => false);
        expect(exists).toBe(true);
      }
    });
  });

  describe('Idempotency', () => {
    it('should be safe to run init multiple times', async () => {
      // First init
      await initCommand(tempDir);

      const pipelinesDir = path.join(tempDir, '.agent-pipeline', 'pipelines');
      const filesBefore = await fs.readdir(pipelinesDir);

      // Second init
      await initCommand(tempDir);

      const filesAfter = await fs.readdir(pipelinesDir);

      // Same files should exist
      expect(filesAfter.sort()).toEqual(filesBefore.sort());
    });

    it('should not overwrite custom files on re-init', async () => {
      await initCommand(tempDir);

      // Create custom pipeline
      const customPath = path.join(tempDir, '.agent-pipeline/pipelines/custom.yml');
      await fs.writeFile(customPath, 'name: custom\ntrigger: manual\nagents: []', 'utf-8');

      // Re-init
      await initCommand(tempDir);

      // Custom file should still exist
      const content = await fs.readFile(customPath, 'utf-8');
      expect(content).toContain('name: custom');
    });
  });

  describe('Gitignore Management', () => {
    it('should add agent-pipeline entries to .gitignore', async () => {
      await initCommand(tempDir);

      const gitignorePath = path.join(tempDir, '.gitignore');
      const content = await fs.readFile(gitignorePath, 'utf-8');

      expect(content).toContain('.agent-pipeline/state/');
      expect(content).toContain('.agent-pipeline/runs/');
      expect(content).toContain('.agent-pipeline/worktrees/');
    });

    it('should not duplicate entries on re-init', async () => {
      await initCommand(tempDir);
      await initCommand(tempDir);

      const gitignorePath = path.join(tempDir, '.gitignore');
      const content = await fs.readFile(gitignorePath, 'utf-8');

      const matches = content.match(/\.agent-pipeline\/state\//g);
      expect(matches).toHaveLength(1);
    });
  });
});
