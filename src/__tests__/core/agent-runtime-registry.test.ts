// src/__tests__/core/agent-runtime-registry.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { AgentRuntimeRegistry } from '../../core/agent-runtime-registry.js';
import type {
  AgentRuntime,
  AgentExecutionRequest,
  AgentExecutionResult,
  AgentRuntimeCapabilities,
  ValidationResult
} from '../../core/types/agent-runtime.js';

// Mock runtime implementation for testing
class MockRuntime implements AgentRuntime {
  constructor(
    public readonly type: string,
    public readonly name: string
  ) {}

  async execute(_request: AgentExecutionRequest): Promise<AgentExecutionResult> {
    return {
      textOutput: 'Mock output',
      totalTokens: 100
    };
  }

  getCapabilities(): AgentRuntimeCapabilities {
    return {
      supportsStreaming: true,
      supportsTokenTracking: true,
      supportsMCP: true,
      supportsContextReduction: true,
      availableModels: ['haiku', 'sonnet', 'opus'],
      permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan']
    };
  }

  async validate(): Promise<ValidationResult> {
    return { valid: true, errors: [], warnings: [] };
  }
}

describe('AgentRuntimeRegistry', () => {
  beforeEach(() => {
    // Clear registry before each test
    AgentRuntimeRegistry.clear();
  });

  describe('register', () => {
    it('should register a runtime successfully', () => {
      const runtime = new MockRuntime('test-runtime', 'Test Runtime');

      AgentRuntimeRegistry.register(runtime);

      expect(AgentRuntimeRegistry.hasRuntime('test-runtime')).toBe(true);
    });

    it('should throw error when registering duplicate runtime type', () => {
      const runtime1 = new MockRuntime('test-runtime', 'Test Runtime 1');
      const runtime2 = new MockRuntime('test-runtime', 'Test Runtime 2');

      AgentRuntimeRegistry.register(runtime1);

      expect(() => {
        AgentRuntimeRegistry.register(runtime2);
      }).toThrow(/already registered/i);
    });

    it('should allow registering multiple different runtime types', () => {
      const runtime1 = new MockRuntime('runtime-1', 'Runtime 1');
      const runtime2 = new MockRuntime('runtime-2', 'Runtime 2');
      const runtime3 = new MockRuntime('runtime-3', 'Runtime 3');

      AgentRuntimeRegistry.register(runtime1);
      AgentRuntimeRegistry.register(runtime2);
      AgentRuntimeRegistry.register(runtime3);

      expect(AgentRuntimeRegistry.getAvailableTypes()).toEqual([
        'runtime-1',
        'runtime-2',
        'runtime-3'
      ]);
    });
  });

  describe('getRuntime', () => {
    it('should retrieve a registered runtime by type', () => {
      const runtime = new MockRuntime('test-runtime', 'Test Runtime');
      AgentRuntimeRegistry.register(runtime);

      const retrieved = AgentRuntimeRegistry.getRuntime('test-runtime');

      expect(retrieved).toBe(runtime);
      expect(retrieved.type).toBe('test-runtime');
      expect(retrieved.name).toBe('Test Runtime');
    });

    it('should throw error when runtime not found', () => {
      expect(() => {
        AgentRuntimeRegistry.getRuntime('non-existent');
      }).toThrow(/not found/i);
    });

    it('should include available runtimes in error message when runtime not found', () => {
      const runtime1 = new MockRuntime('runtime-1', 'Runtime 1');
      const runtime2 = new MockRuntime('runtime-2', 'Runtime 2');

      AgentRuntimeRegistry.register(runtime1);
      AgentRuntimeRegistry.register(runtime2);

      expect(() => {
        AgentRuntimeRegistry.getRuntime('non-existent');
      }).toThrow(/Available runtimes: runtime-1, runtime-2/);
    });

    it('should show "none" in error message when no runtimes registered', () => {
      expect(() => {
        AgentRuntimeRegistry.getRuntime('any-runtime');
      }).toThrow(/Available runtimes: none/);
    });
  });

  describe('getAllRuntimes', () => {
    it('should return empty array when no runtimes registered', () => {
      const runtimes = AgentRuntimeRegistry.getAllRuntimes();

      expect(runtimes).toEqual([]);
    });

    it('should return all registered runtimes', () => {
      const runtime1 = new MockRuntime('runtime-1', 'Runtime 1');
      const runtime2 = new MockRuntime('runtime-2', 'Runtime 2');
      const runtime3 = new MockRuntime('runtime-3', 'Runtime 3');

      AgentRuntimeRegistry.register(runtime1);
      AgentRuntimeRegistry.register(runtime2);
      AgentRuntimeRegistry.register(runtime3);

      const runtimes = AgentRuntimeRegistry.getAllRuntimes();

      expect(runtimes).toHaveLength(3);
      expect(runtimes).toContain(runtime1);
      expect(runtimes).toContain(runtime2);
      expect(runtimes).toContain(runtime3);
    });
  });

  describe('getAvailableTypes', () => {
    it('should return empty array when no runtimes registered', () => {
      const types = AgentRuntimeRegistry.getAvailableTypes();

      expect(types).toEqual([]);
    });

    it('should return all registered runtime types', () => {
      AgentRuntimeRegistry.register(new MockRuntime('claude-sdk', 'SDK'));
      AgentRuntimeRegistry.register(new MockRuntime('claude-headless', 'Headless'));
      AgentRuntimeRegistry.register(new MockRuntime('openai-api', 'OpenAI'));

      const types = AgentRuntimeRegistry.getAvailableTypes();

      expect(types).toEqual(['claude-sdk', 'claude-headless', 'openai-api']);
    });
  });

  describe('hasRuntime', () => {
    it('should return true for registered runtime', () => {
      const runtime = new MockRuntime('test-runtime', 'Test Runtime');
      AgentRuntimeRegistry.register(runtime);

      expect(AgentRuntimeRegistry.hasRuntime('test-runtime')).toBe(true);
    });

    it('should return false for unregistered runtime', () => {
      expect(AgentRuntimeRegistry.hasRuntime('non-existent')).toBe(false);
    });

    it('should return false after clearing registry', () => {
      const runtime = new MockRuntime('test-runtime', 'Test Runtime');
      AgentRuntimeRegistry.register(runtime);

      expect(AgentRuntimeRegistry.hasRuntime('test-runtime')).toBe(true);

      AgentRuntimeRegistry.clear();

      expect(AgentRuntimeRegistry.hasRuntime('test-runtime')).toBe(false);
    });
  });

  describe('clear', () => {
    it('should remove all registered runtimes', () => {
      AgentRuntimeRegistry.register(new MockRuntime('runtime-1', 'Runtime 1'));
      AgentRuntimeRegistry.register(new MockRuntime('runtime-2', 'Runtime 2'));
      AgentRuntimeRegistry.register(new MockRuntime('runtime-3', 'Runtime 3'));

      expect(AgentRuntimeRegistry.getAllRuntimes()).toHaveLength(3);

      AgentRuntimeRegistry.clear();

      expect(AgentRuntimeRegistry.getAllRuntimes()).toHaveLength(0);
      expect(AgentRuntimeRegistry.getAvailableTypes()).toEqual([]);
    });
  });

  describe('Runtime interface implementation', () => {
    it('should allow calling runtime methods through registry', async () => {
      const runtime = new MockRuntime('test-runtime', 'Test Runtime');
      AgentRuntimeRegistry.register(runtime);

      const retrieved = AgentRuntimeRegistry.getRuntime('test-runtime');

      // Test execute method
      const result = await retrieved.execute({
        systemPrompt: 'System',
        userPrompt: 'User',
        options: {}
      });
      expect(result.textOutput).toBe('Mock output');

      // Test getCapabilities method
      const capabilities = retrieved.getCapabilities();
      expect(capabilities.supportsStreaming).toBe(true);

      // Test validate method
      const validation = await retrieved.validate();
      expect(validation.valid).toBe(true);
    });
  });

  describe('Type safety', () => {
    it('should maintain type information for runtime instances', () => {
      const runtime = new MockRuntime('typed-runtime', 'Typed Runtime');
      AgentRuntimeRegistry.register(runtime);

      const retrieved = AgentRuntimeRegistry.getRuntime('typed-runtime');

      // TypeScript should recognize these as valid AgentRuntime methods
      expect(typeof retrieved.execute).toBe('function');
      expect(typeof retrieved.getCapabilities).toBe('function');
      expect(typeof retrieved.validate).toBe('function');
      expect(typeof retrieved.type).toBe('string');
      expect(typeof retrieved.name).toBe('string');
    });
  });
});
