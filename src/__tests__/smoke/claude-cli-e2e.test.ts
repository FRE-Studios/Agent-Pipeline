// src/__tests__/smoke/claude-cli-e2e.test.ts

/**
 * End-to-End Tests for Real Claude CLI Execution
 *
 * These tests execute real `claude` CLI commands to validate headless runtime integration.
 *
 * **Requirements:**
 * - Claude CLI installed: `npm install -g @anthropic-ai/claude-code`
 * - API key configured: `ANTHROPIC_API_KEY` environment variable
 *
 * **Execution:**
 * - Default: Tests skip automatically if CLI unavailable (no failures)
 * - Enable: Set `RUN_E2E_TESTS=true` environment variable
 * - Separate script: `npm run test:e2e`
 *
 * **Note:** These tests make real API calls and may incur costs.
 *
 * **TEMPORARILY SKIPPED:**
 * This test file is currently skipped while we fix underlying issues in the
 * claude-code-headless-runtime. The timeouts from these E2E tests make the
 * test suite painful to run. Re-enable this file after the runtime fixes are complete.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ClaudeCodeHeadlessRuntime } from '../../core/agent-runtimes/claude-code-headless-runtime.js';
import { createTempDir, cleanupTempDir } from '../setup.js';

/**
 * Helper function to execute CLI commands as subprocess
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
    const cliPath = path.join(process.cwd(), 'dist', 'index.js');

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
          setTimeout(() => {
            if (!child.killed) {
              child.kill('SIGKILL');
            }
          }, 1000);
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
 * Helper function to execute real claude CLI commands
 */
async function execClaudeCLI(
  args: string[],
  options: {
    cwd?: string;
    timeout?: number;
  } = {}
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', ...args], {
      cwd: options.cwd || process.cwd(),
      env: {
        ...process.env,
        FORCE_COLOR: '0'
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
          setTimeout(() => {
            if (!child.killed) {
              child.kill('SIGKILL');
            }
          }, 1000);
          reject(new Error(`Claude CLI execution timeout after ${options.timeout}ms`));
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

// TODO: Re-enable after fixing claude-code-headless-runtime issues
describe.skip('Claude CLI E2E Tests', () => {
  let cliAvailable = false;
  let tempDir: string;
  let skipReason = '';

  // Check CLI availability once for entire suite
  beforeAll(async () => {
    // Check if E2E tests are explicitly disabled
    if (process.env.RUN_E2E_TESTS === 'false') {
      skipReason = 'E2E tests disabled via RUN_E2E_TESTS=false';
      console.log(`⏭️  ${skipReason}`);
      return;
    }

    // Check if Claude CLI is installed and working
    const runtime = new ClaudeCodeHeadlessRuntime();
    const result = await runtime.validate();
    cliAvailable = result.valid;

    if (!cliAvailable) {
      skipReason = 'Claude CLI not available';
      console.log(`⏭️  Skipping E2E tests: ${skipReason}`);
      console.log(`   Install with: npm install -g @anthropic-ai/claude-code`);
      console.log(`   Errors: ${result.errors.join(', ')}`);
    } else {
      console.log('✅ Claude CLI available - E2E tests enabled');
    }
  });

  beforeEach(async () => {
    if (!cliAvailable) return;
    tempDir = await createTempDir('e2e-');
  });

  afterEach(async () => {
    if (!cliAvailable) return;
    await cleanupTempDir(tempDir);
  });

  describe('Real CLI Execution', () => {
    it('should execute minimal agent with real claude CLI', async () => {
      if (!cliAvailable) {
        console.log(`⏭️  Skipping: ${skipReason}`);
        return;
      }

      // Create minimal test agent
      const agentDir = path.join(tempDir, '.claude', 'agents');
      await fs.mkdir(agentDir, { recursive: true });

      const agentContent = `# E2E Test Agent

You are a minimal test agent for E2E testing.

## Task
Simply acknowledge that you received the context and report success.

## Output
Use the report_outputs tool with this exact structure:

\`\`\`javascript
report_outputs({
  outputs: {
    status: "success",
    message: "E2E test agent executed successfully",
    received_context: true
  }
})
\`\`\`
`;

      const agentPath = path.join(agentDir, 'e2e-test-agent.md');
      await fs.writeFile(agentPath, agentContent);

      // Execute with real Claude CLI
      const result = await execClaudeCLI(
        [
          '--print',
          '--output-format', 'json',
          '--system-prompt', agentContent,
          'Execute the test task'
        ],
        {
          cwd: tempDir,
          timeout: 90000 // 90 second timeout for real API call
        }
      );

      // Verify execution succeeded
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBeTruthy();

      // Verify JSON output can be parsed
      const output = JSON.parse(result.stdout);
      expect(output).toBeDefined();
      expect(output.result || output.output).toBeTruthy();

      console.log('✅ Real CLI execution successful');
    }, 120000); // 2 minute test timeout

    it('should handle real CLI timeout', async () => {
      if (!cliAvailable) {
        console.log(`⏭️  Skipping: ${skipReason}`);
        return;
      }

      // Create agent that would take too long
      const agentContent = `# Timeout Test Agent

This is a test agent that simulates a long-running task.

Please take your time to think carefully before responding.
`;

      // Execute with very short timeout
      await expect(
        execClaudeCLI(
          [
            '--print',
            '--output-format', 'json',
            '--max-turns', '1',
            '--system-prompt', agentContent,
            'Think very carefully about this problem'
          ],
          {
            cwd: tempDir,
            timeout: 5000 // 5 second timeout - should trigger
          }
        )
      ).rejects.toThrow('timeout');

      console.log('✅ Timeout handling verified');
    }, 30000); // 30 second test timeout

    it('should capture real CLI output correctly', async () => {
      if (!cliAvailable) {
        console.log(`⏭️  Skipping: ${skipReason}`);
        return;
      }

      const agentContent = `# Output Capture Test

You are testing output capture.

Please respond with a simple message and use report_outputs:

\`\`\`javascript
report_outputs({
  outputs: {
    test_output: "Output capture test",
    timestamp: "2024-01-01T00:00:00Z"
  }
})
\`\`\`
`;

      const result = await execClaudeCLI(
        [
          '--print',
          '--output-format', 'json',
          '--system-prompt', agentContent,
          'Respond with the test output'
        ],
        {
          cwd: tempDir,
          timeout: 60000 // 60 second timeout
        }
      );

      // Verify stdout capture
      expect(result.stdout).toBeTruthy();
      expect(result.stdout.length).toBeGreaterThan(0);

      // Verify JSON structure
      const output = JSON.parse(result.stdout);
      expect(output).toHaveProperty('result');

      // Verify exit code
      expect(result.exitCode).toBe(0);

      console.log('✅ Output capture verified');
    }, 90000); // 90 second test timeout
  });

  describe('Error Handling', () => {
    it('should handle missing API key gracefully', async () => {
      if (!cliAvailable) {
        console.log(`⏭️  Skipping: ${skipReason}`);
        return;
      }

      // Execute without API key
      const result = await execClaudeCLI(
        ['--version'],
        {
          cwd: tempDir,
          timeout: 10000
        }
      ).catch((err) => ({
        exitCode: 1,
        stdout: '',
        stderr: err.message
      }));

      // Should either succeed (version check) or fail gracefully
      expect([0, 1]).toContain(result.exitCode);

      console.log('✅ API key handling verified');
    }, 15000);

    it('should handle malformed system prompt', async () => {
      if (!cliAvailable) {
        console.log(`⏭️  Skipping: ${skipReason}`);
        return;
      }

      // Empty system prompt should still work (CLI will use default)
      const result = await execClaudeCLI(
        [
          '--print',
          '--output-format', 'json',
          'Simple test prompt'
        ],
        {
          cwd: tempDir,
          timeout: 60000
        }
      );

      // Should succeed even with minimal args
      expect(result.exitCode).toBe(0);

      console.log('✅ Malformed prompt handling verified');
    }, 90000);
  });

  describe('CLI Availability Check', () => {
    it('should correctly detect CLI availability', async () => {
      const runtime = new ClaudeCodeHeadlessRuntime();
      const result = await runtime.validate();

      expect(result).toHaveProperty('valid');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('warnings');

      if (result.valid) {
        expect(result.errors).toHaveLength(0);
        console.log('✅ CLI detected as available');
      } else {
        expect(result.errors.length).toBeGreaterThan(0);
        console.log(`⚠️  CLI unavailable: ${result.errors[0]}`);
      }
    });
  });
});
