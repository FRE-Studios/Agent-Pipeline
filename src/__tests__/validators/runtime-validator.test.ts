import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RuntimeValidator } from '../../validators/runtime-validator.js';
import { ValidationContext } from '../../validators/types.js';
import { PipelineConfig } from '../../config/schema.js';
import { AgentRuntimeRegistry } from '../../core/agent-runtime-registry.js';
import type { AgentRuntime, AgentRuntimeCapabilities, ValidationResult } from '../../core/types/agent-runtime.js';

// Mock the AgentRuntimeRegistry
vi.mock('../../core/agent-runtime-registry.js', () => ({
  AgentRuntimeRegistry: {
    hasRuntime: vi.fn(),
    getRuntime: vi.fn(),
    getAvailableTypes: vi.fn(),
  },
}));

describe('RuntimeValidator', () => {
  let validator: RuntimeValidator;
  let baseConfig: PipelineConfig;

  // Helper to create a mock runtime
  function createMockRuntime(overrides: Partial<{
    type: string;
    name: string;
    capabilities: Partial<AgentRuntimeCapabilities>;
    validationResult: Partial<ValidationResult>;
    validateError?: Error;
  }> = {}): AgentRuntime {
    const capabilities: AgentRuntimeCapabilities = {
      supportsStreaming: true,
      supportsTokenTracking: true,
      supportsMCP: true,
      supportsContextReduction: true,
      availableModels: ['haiku', 'sonnet', 'opus'],
      permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
      ...overrides.capabilities,
    };

    const validationResult: ValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
      ...overrides.validationResult,
    };

    return {
      type: overrides.type || 'claude-sdk',
      name: overrides.name || 'Claude SDK',
      execute: vi.fn(),
      getCapabilities: vi.fn().mockReturnValue(capabilities),
      validate: overrides.validateError
        ? vi.fn().mockRejectedValue(overrides.validateError)
        : vi.fn().mockResolvedValue(validationResult),
    };
  }

  beforeEach(() => {
    validator = new RuntimeValidator();
    baseConfig = {
      name: 'test-pipeline',
      trigger: 'manual',
      agents: [
        {
          name: 'test-stage',
          agent: '.agent-pipeline/agents/test-agent.md',
        },
      ],
    };
    vi.clearAllMocks();

    // Default mock behavior
    vi.mocked(AgentRuntimeRegistry.getAvailableTypes).mockReturnValue(['claude-sdk', 'claude-code-headless']);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function createContext(config: PipelineConfig): ValidationContext {
    return {
      config,
      repoPath: '/test/repo',
      errors: [],
    };
  }

  describe('validator properties', () => {
    it('should have name "runtime"', () => {
      expect(validator.name).toBe('runtime');
    });

    it('should have priority 0', () => {
      expect(validator.priority).toBe(0);
    });
  });

  describe('shouldRun', () => {
    it('should return false when no runtime config anywhere', () => {
      const context = createContext(baseConfig);

      const result = validator.shouldRun(context);

      expect(result).toBe(false);
    });

    it('should return true when pipeline-level runtime exists', () => {
      const config: PipelineConfig = {
        ...baseConfig,
        runtime: {
          type: 'claude-sdk',
        },
      };
      const context = createContext(config);

      const result = validator.shouldRun(context);

      expect(result).toBe(true);
    });

    it('should return true when any agent has runtime', () => {
      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'test-stage',
            agent: '.agent-pipeline/agents/test-agent.md',
            runtime: {
              type: 'claude-code-headless',
            },
          },
        ],
      };
      const context = createContext(config);

      const result = validator.shouldRun(context);

      expect(result).toBe(true);
    });

    it('should return false when agents array is empty and no pipeline runtime', () => {
      const config: PipelineConfig = {
        ...baseConfig,
        agents: [],
      };
      const context = createContext(config);

      const result = validator.shouldRun(context);

      expect(result).toBe(false);
    });

    it('should return true when multiple agents and one has runtime', () => {
      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'stage-1',
            agent: '.agent-pipeline/agents/agent1.md',
          },
          {
            name: 'stage-2',
            agent: '.agent-pipeline/agents/agent2.md',
            runtime: {
              type: 'claude-sdk',
            },
          },
        ],
      };
      const context = createContext(config);

      const result = validator.shouldRun(context);

      expect(result).toBe(true);
    });
  });

  describe('validate - unknown runtime type', () => {
    it('should error when runtime type is unknown', async () => {
      vi.mocked(AgentRuntimeRegistry.hasRuntime).mockReturnValue(false);
      vi.mocked(AgentRuntimeRegistry.getAvailableTypes).mockReturnValue(['claude-sdk', 'claude-code-headless']);

      const config: PipelineConfig = {
        ...baseConfig,
        runtime: {
          type: 'unknown-runtime',
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(1);
      expect(context.errors[0]).toEqual({
        field: 'runtime',
        message: 'Unknown runtime type: unknown-runtime. Available runtimes: [claude-sdk, claude-code-headless]',
        severity: 'error',
      });
    });

    it('should show empty list when no runtimes available', async () => {
      vi.mocked(AgentRuntimeRegistry.hasRuntime).mockReturnValue(false);
      vi.mocked(AgentRuntimeRegistry.getAvailableTypes).mockReturnValue([]);

      const config: PipelineConfig = {
        ...baseConfig,
        runtime: {
          type: 'unknown-runtime',
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(1);
      expect(context.errors[0].message).toBe('Unknown runtime type: unknown-runtime. Available runtimes: []');
    });
  });

  describe('validate - valid runtime type', () => {
    it('should pass when runtime type is registered', async () => {
      const mockRuntime = createMockRuntime();
      vi.mocked(AgentRuntimeRegistry.hasRuntime).mockReturnValue(true);
      vi.mocked(AgentRuntimeRegistry.getRuntime).mockReturnValue(mockRuntime);

      const config: PipelineConfig = {
        ...baseConfig,
        runtime: {
          type: 'claude-sdk',
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(0);
      expect(AgentRuntimeRegistry.hasRuntime).toHaveBeenCalledWith('claude-sdk');
      expect(AgentRuntimeRegistry.getRuntime).toHaveBeenCalledWith('claude-sdk');
    });
  });

  describe('validate - runtime validation errors become warnings', () => {
    it('should convert runtime validation errors to warnings', async () => {
      const mockRuntime = createMockRuntime({
        validationResult: {
          valid: false,
          errors: ['API key not found', 'CLI not installed'],
          warnings: [],
        },
      });
      vi.mocked(AgentRuntimeRegistry.hasRuntime).mockReturnValue(true);
      vi.mocked(AgentRuntimeRegistry.getRuntime).mockReturnValue(mockRuntime);

      const config: PipelineConfig = {
        ...baseConfig,
        runtime: {
          type: 'claude-sdk',
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(2);
      expect(context.errors[0]).toEqual({
        field: 'runtime',
        message: 'Runtime availability: API key not found',
        severity: 'warning',
      });
      expect(context.errors[1]).toEqual({
        field: 'runtime',
        message: 'Runtime availability: CLI not installed',
        severity: 'warning',
      });
    });
  });

  describe('validate - runtime validation warnings are passed through', () => {
    it('should pass through runtime validation warnings', async () => {
      const mockRuntime = createMockRuntime({
        validationResult: {
          valid: true,
          errors: [],
          warnings: ['Rate limiting detected', 'Using fallback endpoint'],
        },
      });
      vi.mocked(AgentRuntimeRegistry.hasRuntime).mockReturnValue(true);
      vi.mocked(AgentRuntimeRegistry.getRuntime).mockReturnValue(mockRuntime);

      const config: PipelineConfig = {
        ...baseConfig,
        runtime: {
          type: 'claude-sdk',
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(2);
      expect(context.errors[0]).toEqual({
        field: 'runtime',
        message: 'Rate limiting detected',
        severity: 'warning',
      });
      expect(context.errors[1]).toEqual({
        field: 'runtime',
        message: 'Using fallback endpoint',
        severity: 'warning',
      });
    });

    it('should handle both errors and warnings from validation', async () => {
      const mockRuntime = createMockRuntime({
        validationResult: {
          valid: false,
          errors: ['Missing API key'],
          warnings: ['Using default region'],
        },
      });
      vi.mocked(AgentRuntimeRegistry.hasRuntime).mockReturnValue(true);
      vi.mocked(AgentRuntimeRegistry.getRuntime).mockReturnValue(mockRuntime);

      const config: PipelineConfig = {
        ...baseConfig,
        runtime: {
          type: 'claude-sdk',
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(2);
      expect(context.errors.some(e => e.message === 'Runtime availability: Missing API key' && e.severity === 'warning')).toBe(true);
      expect(context.errors.some(e => e.message === 'Using default region' && e.severity === 'warning')).toBe(true);
    });
  });

  describe('validate - runtime validation exception handling', () => {
    it('should handle runtime validation exceptions as warnings', async () => {
      const mockRuntime = createMockRuntime({
        validateError: new Error('Network timeout'),
      });
      vi.mocked(AgentRuntimeRegistry.hasRuntime).mockReturnValue(true);
      vi.mocked(AgentRuntimeRegistry.getRuntime).mockReturnValue(mockRuntime);

      const config: PipelineConfig = {
        ...baseConfig,
        runtime: {
          type: 'claude-sdk',
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors.some(e =>
        e.field === 'runtime' &&
        e.message === 'Runtime validation failed: Network timeout' &&
        e.severity === 'warning'
      )).toBe(true);
    });

    it('should handle non-Error exceptions', async () => {
      const mockRuntime = createMockRuntime();
      mockRuntime.validate = vi.fn().mockRejectedValue('String error');
      vi.mocked(AgentRuntimeRegistry.hasRuntime).mockReturnValue(true);
      vi.mocked(AgentRuntimeRegistry.getRuntime).mockReturnValue(mockRuntime);

      const config: PipelineConfig = {
        ...baseConfig,
        runtime: {
          type: 'claude-sdk',
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors.some(e =>
        e.field === 'runtime' &&
        e.message === 'Runtime validation failed: String error' &&
        e.severity === 'warning'
      )).toBe(true);
    });
  });

  describe('validate - invalid model for runtime', () => {
    it('should error when model is not available for runtime', async () => {
      const mockRuntime = createMockRuntime({
        capabilities: {
          availableModels: ['haiku', 'sonnet'],
        },
      });
      vi.mocked(AgentRuntimeRegistry.hasRuntime).mockReturnValue(true);
      vi.mocked(AgentRuntimeRegistry.getRuntime).mockReturnValue(mockRuntime);

      const config: PipelineConfig = {
        ...baseConfig,
        runtime: {
          type: 'claude-sdk',
          options: {
            model: 'opus',
          },
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors.some(e =>
        e.field === 'runtime.options.model' &&
        e.message === 'Model "opus" not available for runtime "claude-sdk". Available models: [haiku, sonnet]' &&
        e.severity === 'error'
      )).toBe(true);
    });

    it('should error on completely invalid model', async () => {
      const mockRuntime = createMockRuntime({
        capabilities: {
          availableModels: ['haiku', 'sonnet', 'opus'],
        },
      });
      vi.mocked(AgentRuntimeRegistry.hasRuntime).mockReturnValue(true);
      vi.mocked(AgentRuntimeRegistry.getRuntime).mockReturnValue(mockRuntime);

      const config: PipelineConfig = {
        ...baseConfig,
        runtime: {
          type: 'claude-sdk',
          options: {
            model: 'gpt-4',
          },
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors.some(e =>
        e.field === 'runtime.options.model' &&
        e.message.includes('Model "gpt-4" not available') &&
        e.severity === 'error'
      )).toBe(true);
    });
  });

  describe('validate - valid model for runtime', () => {
    it('should pass when model is available for runtime', async () => {
      const mockRuntime = createMockRuntime({
        capabilities: {
          availableModels: ['haiku', 'sonnet', 'opus'],
        },
      });
      vi.mocked(AgentRuntimeRegistry.hasRuntime).mockReturnValue(true);
      vi.mocked(AgentRuntimeRegistry.getRuntime).mockReturnValue(mockRuntime);

      const config: PipelineConfig = {
        ...baseConfig,
        runtime: {
          type: 'claude-sdk',
          options: {
            model: 'sonnet',
          },
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      const modelErrors = context.errors.filter(e => e.field.includes('model'));
      expect(modelErrors).toHaveLength(0);
    });

    it('should skip model validation when no model specified', async () => {
      const mockRuntime = createMockRuntime();
      vi.mocked(AgentRuntimeRegistry.hasRuntime).mockReturnValue(true);
      vi.mocked(AgentRuntimeRegistry.getRuntime).mockReturnValue(mockRuntime);

      const config: PipelineConfig = {
        ...baseConfig,
        runtime: {
          type: 'claude-sdk',
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      const modelErrors = context.errors.filter(e => e.field.includes('model'));
      expect(modelErrors).toHaveLength(0);
    });

    it('should skip model validation when model is not a string', async () => {
      const mockRuntime = createMockRuntime();
      vi.mocked(AgentRuntimeRegistry.hasRuntime).mockReturnValue(true);
      vi.mocked(AgentRuntimeRegistry.getRuntime).mockReturnValue(mockRuntime);

      const config: PipelineConfig = {
        ...baseConfig,
        runtime: {
          type: 'claude-sdk',
          options: {
            model: 123 as unknown as string,
          },
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      const modelErrors = context.errors.filter(e => e.field.includes('model'));
      expect(modelErrors).toHaveLength(0);
    });
  });

  describe('validate - invalid permission mode for runtime', () => {
    it('should error when permission mode is not supported by runtime', async () => {
      const mockRuntime = createMockRuntime({
        capabilities: {
          permissionModes: ['default', 'acceptEdits'],
        },
      });
      vi.mocked(AgentRuntimeRegistry.hasRuntime).mockReturnValue(true);
      vi.mocked(AgentRuntimeRegistry.getRuntime).mockReturnValue(mockRuntime);

      const config: PipelineConfig = {
        ...baseConfig,
        runtime: {
          type: 'claude-sdk',
          options: {
            permissionMode: 'bypassPermissions',
          },
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors.some(e =>
        e.field === 'runtime.options.permissionMode' &&
        e.message === 'Permission mode "bypassPermissions" not supported by runtime "claude-sdk". Supported modes: [default, acceptEdits]' &&
        e.severity === 'error'
      )).toBe(true);
    });
  });

  describe('validate - valid permission mode for runtime', () => {
    it('should pass when permission mode is supported by runtime', async () => {
      const mockRuntime = createMockRuntime({
        capabilities: {
          permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
        },
      });
      vi.mocked(AgentRuntimeRegistry.hasRuntime).mockReturnValue(true);
      vi.mocked(AgentRuntimeRegistry.getRuntime).mockReturnValue(mockRuntime);

      const config: PipelineConfig = {
        ...baseConfig,
        runtime: {
          type: 'claude-sdk',
          options: {
            permissionMode: 'acceptEdits',
          },
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      const permErrors = context.errors.filter(e => e.field.includes('permissionMode'));
      expect(permErrors).toHaveLength(0);
    });

    it('should skip permission mode validation when not specified', async () => {
      const mockRuntime = createMockRuntime();
      vi.mocked(AgentRuntimeRegistry.hasRuntime).mockReturnValue(true);
      vi.mocked(AgentRuntimeRegistry.getRuntime).mockReturnValue(mockRuntime);

      const config: PipelineConfig = {
        ...baseConfig,
        runtime: {
          type: 'claude-sdk',
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      const permErrors = context.errors.filter(e => e.field.includes('permissionMode'));
      expect(permErrors).toHaveLength(0);
    });
  });

  describe('validate - stage-level runtime overrides are validated', () => {
    it('should validate stage-level runtime configuration', async () => {
      const mockRuntime = createMockRuntime({
        capabilities: {
          availableModels: ['haiku', 'sonnet'],
        },
      });
      vi.mocked(AgentRuntimeRegistry.hasRuntime).mockReturnValue(true);
      vi.mocked(AgentRuntimeRegistry.getRuntime).mockReturnValue(mockRuntime);

      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'test-stage',
            agent: '.agent-pipeline/agents/test-agent.md',
            runtime: {
              type: 'claude-sdk',
              options: {
                model: 'opus',
              },
            },
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors.some(e =>
        e.field === 'agents.test-stage.runtime.options.model' &&
        e.message.includes('Model "opus" not available') &&
        e.severity === 'error'
      )).toBe(true);
    });

    it('should validate multiple stage-level runtimes', async () => {
      vi.mocked(AgentRuntimeRegistry.hasRuntime).mockImplementation((type) => type === 'claude-sdk');
      vi.mocked(AgentRuntimeRegistry.getAvailableTypes).mockReturnValue(['claude-sdk']);

      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'stage-1',
            agent: '.agent-pipeline/agents/agent1.md',
            runtime: {
              type: 'unknown-runtime',
            },
          },
          {
            name: 'stage-2',
            agent: '.agent-pipeline/agents/agent2.md',
            runtime: {
              type: 'another-unknown',
            },
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(2);
      expect(context.errors[0].field).toBe('agents.stage-1.runtime');
      expect(context.errors[0].message).toContain('Unknown runtime type: unknown-runtime');
      expect(context.errors[1].field).toBe('agents.stage-2.runtime');
      expect(context.errors[1].message).toContain('Unknown runtime type: another-unknown');
    });

    it('should validate both pipeline-level and stage-level runtimes', async () => {
      const mockRuntime = createMockRuntime({
        capabilities: {
          availableModels: ['haiku', 'sonnet'],
          permissionModes: ['default'],
        },
      });
      vi.mocked(AgentRuntimeRegistry.hasRuntime).mockReturnValue(true);
      vi.mocked(AgentRuntimeRegistry.getRuntime).mockReturnValue(mockRuntime);

      const config: PipelineConfig = {
        ...baseConfig,
        runtime: {
          type: 'claude-sdk',
          options: {
            model: 'opus',
          },
        },
        agents: [
          {
            name: 'test-stage',
            agent: '.agent-pipeline/agents/test-agent.md',
            runtime: {
              type: 'claude-sdk',
              options: {
                permissionMode: 'acceptEdits',
              },
            },
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(2);
      expect(context.errors.some(e =>
        e.field === 'runtime.options.model' &&
        e.severity === 'error'
      )).toBe(true);
      expect(context.errors.some(e =>
        e.field === 'agents.test-stage.runtime.options.permissionMode' &&
        e.severity === 'error'
      )).toBe(true);
    });
  });

  describe('validate - permission mode from pipeline settings is considered', () => {
    it('should validate pipeline settings permission mode against runtime', async () => {
      const mockRuntime = createMockRuntime({
        capabilities: {
          permissionModes: ['default', 'acceptEdits'],
        },
      });
      vi.mocked(AgentRuntimeRegistry.hasRuntime).mockReturnValue(true);
      vi.mocked(AgentRuntimeRegistry.getRuntime).mockReturnValue(mockRuntime);

      const config: PipelineConfig = {
        ...baseConfig,
        runtime: {
          type: 'claude-sdk',
        },
        git: {
          autoCommit: true,
          commitPrefix: '[pipeline:{{stage}}]',
        },
        execution: {
          failureStrategy: 'stop',
          permissionMode: 'bypassPermissions',
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors.some(e =>
        e.field === 'runtime.options.permissionMode' &&
        e.message === 'Permission mode "bypassPermissions" not supported by runtime "claude-sdk". Supported modes: [default, acceptEdits]' &&
        e.severity === 'error'
      )).toBe(true);
    });

    it('should prefer runtime option permission mode over pipeline execution settings', async () => {
      const mockRuntime = createMockRuntime({
        capabilities: {
          permissionModes: ['default', 'bypassPermissions'],
        },
      });
      vi.mocked(AgentRuntimeRegistry.hasRuntime).mockReturnValue(true);
      vi.mocked(AgentRuntimeRegistry.getRuntime).mockReturnValue(mockRuntime);

      const config: PipelineConfig = {
        ...baseConfig,
        runtime: {
          type: 'claude-sdk',
          options: {
            permissionMode: 'acceptEdits', // This should be validated, not the pipeline setting
          },
        },
        git: {
          autoCommit: true,
          commitPrefix: '[pipeline:{{stage}}]',
        },
        execution: {
          failureStrategy: 'stop',
          permissionMode: 'default', // This should be ignored since runtime has its own
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors.some(e =>
        e.field === 'runtime.options.permissionMode' &&
        e.message.includes('Permission mode "acceptEdits" not supported') &&
        e.severity === 'error'
      )).toBe(true);
    });

    it('should pass when pipeline execution permission mode is supported', async () => {
      const mockRuntime = createMockRuntime({
        capabilities: {
          permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
        },
      });
      vi.mocked(AgentRuntimeRegistry.hasRuntime).mockReturnValue(true);
      vi.mocked(AgentRuntimeRegistry.getRuntime).mockReturnValue(mockRuntime);

      const config: PipelineConfig = {
        ...baseConfig,
        runtime: {
          type: 'claude-sdk',
        },
        git: {
          autoCommit: true,
          commitPrefix: '[pipeline:{{stage}}]',
        },
        execution: {
          failureStrategy: 'stop',
          permissionMode: 'acceptEdits',
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      const permErrors = context.errors.filter(e => e.field.includes('permissionMode'));
      expect(permErrors).toHaveLength(0);
    });

    it('should validate stage runtime with pipeline settings permission mode', async () => {
      const mockRuntime = createMockRuntime({
        capabilities: {
          permissionModes: ['default'],
        },
      });
      vi.mocked(AgentRuntimeRegistry.hasRuntime).mockReturnValue(true);
      vi.mocked(AgentRuntimeRegistry.getRuntime).mockReturnValue(mockRuntime);

      const config: PipelineConfig = {
        ...baseConfig,
        git: {
          autoCommit: true,
          commitPrefix: '[pipeline:{{stage}}]',
        },
        execution: {
          failureStrategy: 'stop',
          permissionMode: 'acceptEdits', // Pipeline-level setting
        },
        agents: [
          {
            name: 'test-stage',
            agent: '.agent-pipeline/agents/test-agent.md',
            runtime: {
              type: 'claude-sdk',
              // No permissionMode in runtime options, should fall back to pipeline setting
            },
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors.some(e =>
        e.field === 'agents.test-stage.runtime.options.permissionMode' &&
        e.message.includes('Permission mode "acceptEdits" not supported') &&
        e.severity === 'error'
      )).toBe(true);
    });
  });

  describe('validate - edge cases', () => {
    it('should handle empty agents array with pipeline runtime', async () => {
      const mockRuntime = createMockRuntime();
      vi.mocked(AgentRuntimeRegistry.hasRuntime).mockReturnValue(true);
      vi.mocked(AgentRuntimeRegistry.getRuntime).mockReturnValue(mockRuntime);

      const config: PipelineConfig = {
        ...baseConfig,
        runtime: {
          type: 'claude-sdk',
        },
        agents: [],
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(0);
    });

    it('should skip further validation after unknown runtime error', async () => {
      vi.mocked(AgentRuntimeRegistry.hasRuntime).mockReturnValue(false);
      vi.mocked(AgentRuntimeRegistry.getAvailableTypes).mockReturnValue(['claude-sdk']);

      const config: PipelineConfig = {
        ...baseConfig,
        runtime: {
          type: 'unknown',
          options: {
            model: 'invalid-model',
            permissionMode: 'invalid-mode',
          },
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      // Should only have the unknown runtime error, not model/permission mode errors
      expect(context.errors).toHaveLength(1);
      expect(context.errors[0].message).toContain('Unknown runtime type');
    });

    it('should handle undefined agents array', async () => {
      const mockRuntime = createMockRuntime();
      vi.mocked(AgentRuntimeRegistry.hasRuntime).mockReturnValue(true);
      vi.mocked(AgentRuntimeRegistry.getRuntime).mockReturnValue(mockRuntime);

      const config: PipelineConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        runtime: {
          type: 'claude-sdk',
        },
      } as PipelineConfig;
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(0);
    });
  });
});
