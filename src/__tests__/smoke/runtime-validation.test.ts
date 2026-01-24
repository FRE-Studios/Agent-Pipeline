// src/__tests__/smoke/runtime-validation.test.ts

/**
 * Runtime Validation Tests
 *
 * These tests verify the agent runtime validation logic without making
 * actual API calls. They test:
 * - Runtime registration and discovery
 * - Capability reporting
 * - CLI availability detection (mocked)
 *
 * For actual end-to-end tests with API calls, set RUN_E2E_TESTS=true
 * and run the tests in a separate CI pipeline with proper API credentials.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { AgentRuntimeRegistry } from '../../core/agent-runtime-registry.js';
import { ClaudeCodeHeadlessRuntime } from '../../core/agent-runtimes/claude-code-headless-runtime.js';
import { ClaudeSDKRuntime } from '../../core/agent-runtimes/claude-sdk-runtime.js';

// Mock child_process.spawn for CLI validation tests
vi.mock('child_process', () => ({
  spawn: vi.fn()
}));

describe('Runtime Validation Tests', () => {
  beforeEach(() => {
    AgentRuntimeRegistry.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    AgentRuntimeRegistry.clear();
  });

  describe('AgentRuntimeRegistry', () => {
    it('should register and retrieve runtimes', () => {
      const headlessRuntime = new ClaudeCodeHeadlessRuntime();
      const sdkRuntime = new ClaudeSDKRuntime();

      AgentRuntimeRegistry.register(headlessRuntime);
      AgentRuntimeRegistry.register(sdkRuntime);

      const retrieved = AgentRuntimeRegistry.getRuntime('claude-code-headless');
      expect(retrieved).toBe(headlessRuntime);

      const sdkRetrieved = AgentRuntimeRegistry.getRuntime('claude-sdk');
      expect(sdkRetrieved).toBe(sdkRuntime);
    });

    it('should list all registered runtimes', () => {
      const headlessRuntime = new ClaudeCodeHeadlessRuntime();
      const sdkRuntime = new ClaudeSDKRuntime();

      AgentRuntimeRegistry.register(headlessRuntime);
      AgentRuntimeRegistry.register(sdkRuntime);

      const all = AgentRuntimeRegistry.getAllRuntimes();
      expect(all).toHaveLength(2);
      expect(all.map(r => r.type)).toContain('claude-code-headless');
      expect(all.map(r => r.type)).toContain('claude-sdk');
    });

    it('should throw for unregistered runtime', () => {
      expect(() => AgentRuntimeRegistry.getRuntime('non-existent')).toThrow(
        /not found/
      );
    });

    it('should clear all runtimes', () => {
      AgentRuntimeRegistry.register(new ClaudeCodeHeadlessRuntime());
      expect(AgentRuntimeRegistry.getAllRuntimes()).toHaveLength(1);

      AgentRuntimeRegistry.clear();
      expect(AgentRuntimeRegistry.getAllRuntimes()).toHaveLength(0);
    });
  });

  describe('ClaudeCodeHeadlessRuntime', () => {
    it('should have correct type and name', () => {
      const runtime = new ClaudeCodeHeadlessRuntime();

      expect(runtime.type).toBe('claude-code-headless');
      expect(runtime.name).toBe('Claude Code Headless Mode');
    });

    it('should report correct capabilities', () => {
      const runtime = new ClaudeCodeHeadlessRuntime();
      const capabilities = runtime.getCapabilities();

      expect(capabilities.supportsStreaming).toBe(true);
      expect(capabilities.supportsTokenTracking).toBe(true);
      expect(capabilities.supportsMCP).toBe(false);
      expect(capabilities.supportsContextReduction).toBe(false);
      expect(capabilities.availableModels).toContain('haiku');
      expect(capabilities.availableModels).toContain('sonnet');
      expect(capabilities.availableModels).toContain('opus');
      expect(capabilities.permissionModes).toContain('acceptEdits');
    });

    it('should validate CLI availability - success case', async () => {
      const runtime = new ClaudeCodeHeadlessRuntime();

      // Mock successful CLI execution
      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.killed = false;
      mockProcess.kill = vi.fn();

      vi.mocked(spawn).mockReturnValue(mockProcess);

      // Start validation
      const validationPromise = runtime.validate();

      // Simulate successful version output
      setTimeout(() => {
        mockProcess.stdout.emit('data', Buffer.from('claude-code v1.0.0\n'));
        mockProcess.emit('exit', 0);
      }, 10);

      const result = await validationPromise;

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate CLI availability - failure case', async () => {
      const runtime = new ClaudeCodeHeadlessRuntime();

      // Mock failed CLI execution
      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.killed = false;
      mockProcess.kill = vi.fn();

      vi.mocked(spawn).mockReturnValue(mockProcess);

      // Start validation
      const validationPromise = runtime.validate();

      // Simulate spawn error (CLI not found)
      setTimeout(() => {
        mockProcess.emit('error', new Error('spawn claude ENOENT'));
      }, 10);

      const result = await validationPromise;

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Claude CLI not found');
      expect(result.warnings).toContain('Install Claude CLI with: npm install -g @anthropic-ai/claude-code');
    });

    it('should validate CLI availability - non-zero exit', async () => {
      const runtime = new ClaudeCodeHeadlessRuntime();

      // Mock CLI with non-zero exit
      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.killed = false;
      mockProcess.kill = vi.fn();

      vi.mocked(spawn).mockReturnValue(mockProcess);

      // Start validation
      const validationPromise = runtime.validate();

      // Simulate non-zero exit
      setTimeout(() => {
        mockProcess.stderr.emit('data', Buffer.from('Error: not authenticated\n'));
        mockProcess.emit('exit', 1);
      }, 10);

      const result = await validationPromise;

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('ClaudeSDKRuntime', () => {
    it('should have correct type and name', () => {
      const runtime = new ClaudeSDKRuntime();

      expect(runtime.type).toBe('claude-sdk');
      expect(runtime.name).toBe('Claude Agent SDK');
    });

    it('should report correct capabilities', () => {
      const runtime = new ClaudeSDKRuntime();
      const capabilities = runtime.getCapabilities();

      expect(capabilities.supportsStreaming).toBe(true);
      expect(capabilities.supportsTokenTracking).toBe(true);
      expect(capabilities.supportsMCP).toBe(true);
      expect(capabilities.availableModels).toContain('haiku');
      expect(capabilities.availableModels).toContain('sonnet');
      expect(capabilities.availableModels).toContain('opus');
    });

    it('should validate successfully when API key is available', async () => {
      const runtime = new ClaudeSDKRuntime();

      // SDK runtime validates based on API key presence
      const originalEnv = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'test-key';

      try {
        const result = await runtime.validate();
        expect(result.valid).toBe(true);
      } finally {
        if (originalEnv) {
          process.env.ANTHROPIC_API_KEY = originalEnv;
        } else {
          delete process.env.ANTHROPIC_API_KEY;
        }
      }
    });
  });

  describe('Runtime Selection', () => {
    it('should support default runtime fallback', () => {
      const headlessRuntime = new ClaudeCodeHeadlessRuntime();
      const sdkRuntime = new ClaudeSDKRuntime();

      AgentRuntimeRegistry.register(headlessRuntime);
      AgentRuntimeRegistry.register(sdkRuntime);

      // Default should be claude-code-headless if available
      const defaultRuntime = AgentRuntimeRegistry.getRuntime('claude-code-headless');
      expect(defaultRuntime).toBeDefined();
      expect(defaultRuntime?.type).toBe('claude-code-headless');
    });

    it('should allow runtime override per pipeline', () => {
      const headlessRuntime = new ClaudeCodeHeadlessRuntime();
      const sdkRuntime = new ClaudeSDKRuntime();

      AgentRuntimeRegistry.register(headlessRuntime);
      AgentRuntimeRegistry.register(sdkRuntime);

      // Pipeline can specify claude-sdk
      const requested = AgentRuntimeRegistry.getRuntime('claude-sdk');
      expect(requested).toBeDefined();
      expect(requested?.type).toBe('claude-sdk');
    });
  });

  describe('Runtime Capabilities Comparison', () => {
    it('should correctly identify MCP support differences', () => {
      const headless = new ClaudeCodeHeadlessRuntime();
      const sdk = new ClaudeSDKRuntime();

      // Headless does not support MCP (uses built-in tools)
      expect(headless.getCapabilities().supportsMCP).toBe(false);

      // SDK supports MCP
      expect(sdk.getCapabilities().supportsMCP).toBe(true);
    });

    it('should correctly identify context reduction support', () => {
      const headless = new ClaudeCodeHeadlessRuntime();
      const sdk = new ClaudeSDKRuntime();

      // Headless uses --resume for session continuation, not context reduction
      expect(headless.getCapabilities().supportsContextReduction).toBe(false);

      // SDK supports context reduction
      expect(sdk.getCapabilities().supportsContextReduction).toBe(true);
    });
  });
});
