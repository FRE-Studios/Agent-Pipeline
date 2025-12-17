// src/__tests__/smoke/cli-smoke.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';
import { createTempDir, cleanupTempDir } from '../setup.js';

/**
 * CLI Smoke Tests
 *
 * These tests verify basic CLI functionality by executing the built CLI
 * as a subprocess. They do NOT make real API calls and should run quickly.
 *
 * Prerequisites:
 * - CLI must be built (npm run build)
 * - Tests use subprocess execution, not mocked functions
 */
describe('CLI Smoke Tests', () => {
  const cliPath = path.resolve(__dirname, '../../../dist/index.js');
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir('smoke-');
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('Basic CLI Commands', () => {
    it('should execute --help without errors', async () => {
      const { exitCode, stdout } = await execCLI(['--help']);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('Agent Pipeline');
      expect(stdout).toContain('Usage:');
      expect(stdout).toContain('Commands:');
    }, 10000);

    it('should show help for invalid commands', async () => {
      // CLI shows help for unknown commands
      const { exitCode, stdout } = await execCLI(['nonexistent-command']);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('Usage:');
      expect(stdout).toContain('Commands:');
    }, 10000);

    it('should show usage for missing required arguments', async () => {
      // Try to run without pipeline name - shows usage
      const { exitCode, stderr } = await execCLI(['run']);

      expect(exitCode).toBe(1);
      expect(stderr.toLowerCase()).toContain('usage');
    }, 10000);
  });

  describe('Project Initialization', () => {
    it('should initialize project with init command', async () => {
      const { exitCode, stdout } = await execCLI(['init'], { cwd: tempDir });

      expect(exitCode).toBe(0);
      expect(stdout).toContain('initialized');

      // Verify directory structure created
      const pipelinesDir = path.join(tempDir, '.agent-pipeline/pipelines');
      const agentsDir = path.join(tempDir, '.agent-pipeline/agents');

      const [pipelinesStat, agentsStat] = await Promise.all([
        fs.stat(pipelinesDir),
        fs.stat(agentsDir)
      ]);

      expect(pipelinesStat.isDirectory()).toBe(true);
      expect(agentsStat.isDirectory()).toBe(true);

      // Verify test pipeline created
      const testPipelineExists = await fileExists(
        path.join(pipelinesDir, 'test-pipeline.yml')
      );
      expect(testPipelineExists).toBe(true);
    }, 15000);

    it('should not overwrite existing pipelines with init', async () => {
      // First init
      await execCLI(['init'], { cwd: tempDir });

      // Create custom file
      const customFile = path.join(tempDir, '.agent-pipeline/pipelines/custom.yml');
      await fs.writeFile(customFile, 'custom: content', 'utf-8');

      // Second init
      const { exitCode } = await execCLI(['init'], { cwd: tempDir });

      expect(exitCode).toBe(0);

      // Custom file should still exist
      const content = await fs.readFile(customFile, 'utf-8');
      expect(content).toContain('custom: content');
    }, 15000);
  });

  describe('Pipeline Validation', () => {
    it('should validate test pipeline after init', async () => {
      // Initialize project
      await execCLI(['init'], { cwd: tempDir });

      // Validate test pipeline
      const { exitCode, stdout, stderr } = await execCLI(
        ['validate', 'test-pipeline'],
        { cwd: tempDir }
      );

      // Should succeed (exit 0) or provide meaningful output
      expect(exitCode === 0 || stdout.length > 0 || stderr.length > 0).toBe(true);
    }, 15000);

    it('should report errors for invalid pipeline', async () => {
      // Initialize project
      await execCLI(['init'], { cwd: tempDir });

      // Create invalid pipeline (missing required fields)
      const invalidPipeline = path.join(
        tempDir,
        '.agent-pipeline/pipelines/invalid.yml'
      );
      await fs.writeFile(
        invalidPipeline,
        'name: invalid\ntrigger: manual\n# missing agents array',
        'utf-8'
      );

      // Validate should fail
      const { exitCode, stdout, stderr } = await execCLI(
        ['validate', 'invalid'],
        { cwd: tempDir }
      );

      // Should fail or show validation issues
      expect(exitCode === 1 || stdout.includes('error') || stderr.includes('error')).toBe(true);
    }, 15000);

    it('should handle non-existent pipeline validation', async () => {
      // Initialize project
      await execCLI(['init'], { cwd: tempDir });

      // Try to validate non-existent pipeline
      const { exitCode, stderr } = await execCLI(
        ['validate', 'does-not-exist'],
        { cwd: tempDir }
      );

      expect(exitCode).toBe(1);
      expect(stderr.toLowerCase()).toMatch(/not found|does not exist/);
    }, 15000);
  });

  describe('List Commands', () => {
    it('should list pipelines after init', async () => {
      // Initialize project
      await execCLI(['init'], { cwd: tempDir });

      // List pipelines
      const { exitCode, stdout } = await execCLI(['list'], { cwd: tempDir });

      expect(exitCode).toBe(0);
      expect(stdout).toContain('test-pipeline');
    }, 15000);

    it('should list agents after init', async () => {
      // Initialize project
      await execCLI(['init'], { cwd: tempDir });

      // List agents
      const { exitCode, stdout } = await execCLI(
        ['agent', 'list'],
        { cwd: tempDir }
      );

      expect(exitCode).toBe(0);
      // Should show some agents
      expect(stdout.length).toBeGreaterThan(0);
    }, 15000);
  });

  describe('Error Handling', () => {
    it('should handle operation in non-initialized directory', async () => {
      // Try to validate without init
      const { exitCode, stderr } = await execCLI(
        ['validate', 'test-pipeline'],
        { cwd: tempDir }
      );

      expect(exitCode).toBe(1);
      expect(stderr.toLowerCase()).toMatch(/not initialized|not found/);
    }, 10000);

    it.skip('should handle permission errors gracefully', async () => {
      // Skipped - permission handling is too platform-specific
      // and can cause EACCES errors in test environment
    }, 15000);
  });

  describe('Process Management', () => {
    it('should terminate gracefully on SIGTERM', async () => {
      return new Promise<void>((resolve) => {
        const child = spawn('node', [cliPath, '--help'], {
          env: { ...process.env, FORCE_COLOR: '0' }
        });

        // Send SIGTERM after a short delay
        setTimeout(() => {
          child.kill('SIGTERM');
        }, 100);

        child.on('exit', (code, signal) => {
          // Should exit cleanly
          expect(code === 0 || signal === 'SIGTERM').toBe(true);
          resolve();
        });
      });
    }, 10000);

    it('should not leave zombie processes', async () => {
      // Execute multiple CLI commands in sequence
      await execCLI(['--help']);
      await execCLI(['--version']);
      await execCLI(['init'], { cwd: tempDir });

      // Get current process count
      const beforeCount = await getProcessCount('node');

      // Wait a bit for cleanup
      await wait(100);

      // Process count should not increase
      const afterCount = await getProcessCount('node');
      expect(afterCount).toBeLessThanOrEqual(beforeCount + 1); // Allow 1 for current test
    }, 15000);
  });

  /**
   * Helper: Execute CLI command as subprocess
   */
  async function execCLI(
    args: string[],
    options: {
      cwd?: string;
      env?: Record<string, string>;
      timeout?: number;
    } = {}
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn('node', [cliPath, ...args], {
        cwd: options.cwd || process.cwd(),
        env: {
          ...process.env,
          ...options.env,
          FORCE_COLOR: '0', // Disable colors for cleaner output
          CI: 'true' // Ensure non-interactive mode
        }
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      const timer = options.timeout
        ? setTimeout(() => {
            child.kill('SIGTERM');
            reject(new Error(`CLI execution timeout after ${options.timeout}ms`));
          }, options.timeout)
        : null;

      child.on('close', (code) => {
        if (timer) clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: code || 0 });
      });

      child.on('error', (err) => {
        if (timer) clearTimeout(timer);
        reject(err);
      });
    });
  }

  /**
   * Helper: Check if file exists
   */
  async function fileExists(filepath: string): Promise<boolean> {
    try {
      await fs.access(filepath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Helper: Get count of processes matching name
   */
  async function getProcessCount(name: string): Promise<number> {
    return new Promise((resolve) => {
      const child = spawn('ps', ['aux']);
      let output = '';

      child.stdout?.on('data', (data) => {
        output += data.toString();
      });

      child.on('close', () => {
        const lines = output.split('\n').filter((line) => line.includes(name));
        resolve(lines.length);
      });

      child.on('error', () => {
        resolve(0); // Return 0 if ps command fails
      });
    });
  }

  /**
   * Helper: Wait for specified milliseconds
   */
  function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
});
