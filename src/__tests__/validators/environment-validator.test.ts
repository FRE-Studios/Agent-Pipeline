import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EnvironmentValidator } from '../../validators/environment-validator.js';
import { ValidationContext } from '../../validators/types.js';
import { PipelineConfig } from '../../config/schema.js';

describe('EnvironmentValidator', () => {
  let validator: EnvironmentValidator;
  let baseConfig: PipelineConfig;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    validator = new EnvironmentValidator();
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
    // Save original environment
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  function createContext(config: PipelineConfig): ValidationContext {
    return {
      config,
      repoPath: '/test/repo',
      errors: [],
    };
  }

  describe('validator properties', () => {
    it('should have correct name "environment"', () => {
      expect(validator.name).toBe('environment');
    });

    it('should have priority 0', () => {
      expect(validator.priority).toBe(0);
    });
  });

  describe('shouldRun', () => {
    it('should always return true', () => {
      const context = createContext(baseConfig);

      const result = validator.shouldRun(context);

      expect(result).toBe(true);
    });

    it('should return true regardless of config content', () => {
      const emptyConfig: PipelineConfig = {
        name: 'empty-pipeline',
        trigger: 'manual',
        agents: [],
      };
      const context = createContext(emptyConfig);

      const result = validator.shouldRun(context);

      expect(result).toBe(true);
    });
  });

  describe('validate - claude-sdk runtime requires API key', () => {
    beforeEach(() => {
      // Clear API key environment variables
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.CLAUDE_API_KEY;
    });

    it('should error when claude-sdk runtime is used and no API key is set', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        runtime: { type: 'claude-sdk' },
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(1);
      expect(context.errors[0]).toEqual({
        field: 'environment',
        message:
          'Claude API key not set. Set environment variable: export ANTHROPIC_API_KEY=sk-ant-...',
        severity: 'error',
      });
    });

    it('should pass when claude-sdk runtime is used and ANTHROPIC_API_KEY is set', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
      const config: PipelineConfig = {
        ...baseConfig,
        runtime: { type: 'claude-sdk' },
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(0);
    });

    it('should pass when claude-sdk runtime is used and CLAUDE_API_KEY is set', async () => {
      process.env.CLAUDE_API_KEY = 'sk-ant-test-key';
      const config: PipelineConfig = {
        ...baseConfig,
        runtime: { type: 'claude-sdk' },
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(0);
    });

    it('should pass when both ANTHROPIC_API_KEY and CLAUDE_API_KEY are set', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-anthropic-key';
      process.env.CLAUDE_API_KEY = 'sk-ant-claude-key';
      const config: PipelineConfig = {
        ...baseConfig,
        runtime: { type: 'claude-sdk' },
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(0);
    });
  });

  describe('validate - claude-code-headless runtime does not check API key', () => {
    beforeEach(() => {
      // Clear API key environment variables
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.CLAUDE_API_KEY;
    });

    it('should not error when claude-code-headless runtime is used without API key', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        runtime: { type: 'claude-code-headless' },
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(0);
    });

    it('should default to claude-code-headless when no runtime is specified', async () => {
      // baseConfig has no runtime specified
      const context = createContext(baseConfig);

      await validator.validate(context);

      // No error expected because default is claude-code-headless
      expect(context.errors).toHaveLength(0);
    });
  });

  describe('validate - mixed runtimes', () => {
    beforeEach(() => {
      // Clear API key environment variables
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.CLAUDE_API_KEY;
    });

    it('should error if any stage uses claude-sdk and no API key is set', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        runtime: { type: 'claude-code-headless' },
        agents: [
          {
            name: 'stage-1',
            agent: '.agent-pipeline/agents/test-agent.md',
            // Uses pipeline-level runtime (claude-code-headless)
          },
          {
            name: 'stage-2',
            agent: '.agent-pipeline/agents/test-agent.md',
            runtime: { type: 'claude-sdk' },
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(1);
      expect(context.errors[0].field).toBe('environment');
      expect(context.errors[0].severity).toBe('error');
    });

    it('should pass if claude-sdk is used at stage level and API key is set', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
      const config: PipelineConfig = {
        ...baseConfig,
        runtime: { type: 'claude-code-headless' },
        agents: [
          {
            name: 'stage-1',
            agent: '.agent-pipeline/agents/test-agent.md',
          },
          {
            name: 'stage-2',
            agent: '.agent-pipeline/agents/test-agent.md',
            runtime: { type: 'claude-sdk' },
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(0);
    });

    it('should not error when all stages use claude-code-headless without API key', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        runtime: { type: 'claude-code-headless' },
        agents: [
          {
            name: 'stage-1',
            agent: '.agent-pipeline/agents/test-agent.md',
          },
          {
            name: 'stage-2',
            agent: '.agent-pipeline/agents/test-agent.md',
            runtime: { type: 'claude-code-headless' },
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(0);
    });
  });

  describe('validate - stage-level runtime overrides', () => {
    beforeEach(() => {
      // Clear API key environment variables
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.CLAUDE_API_KEY;
    });

    it('should consider stage-level runtime override for claude-sdk', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        // No pipeline-level runtime (defaults to claude-code-headless)
        agents: [
          {
            name: 'sdk-stage',
            agent: '.agent-pipeline/agents/test-agent.md',
            runtime: { type: 'claude-sdk' },
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(1);
      expect(context.errors[0].field).toBe('environment');
    });

    it('should collect all unique runtimes from stages', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        runtime: { type: 'claude-code-headless' },
        agents: [
          {
            name: 'stage-1',
            agent: '.agent-pipeline/agents/test-agent.md',
            runtime: { type: 'claude-sdk' },
          },
          {
            name: 'stage-2',
            agent: '.agent-pipeline/agents/test-agent.md',
            runtime: { type: 'claude-sdk' },
          },
          {
            name: 'stage-3',
            agent: '.agent-pipeline/agents/test-agent.md',
            // Uses pipeline runtime
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      // Only one error even though two stages use claude-sdk
      expect(context.errors).toHaveLength(1);
    });

    it('should pass when stage overrides to claude-code-headless from claude-sdk pipeline', async () => {
      // Pipeline uses claude-sdk but stage overrides to claude-code-headless
      // Still needs API key because pipeline-level uses claude-sdk
      const config: PipelineConfig = {
        ...baseConfig,
        runtime: { type: 'claude-sdk' },
        agents: [
          {
            name: 'headless-stage',
            agent: '.agent-pipeline/agents/test-agent.md',
            runtime: { type: 'claude-code-headless' },
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      // Error expected because pipeline-level runtime is claude-sdk
      expect(context.errors).toHaveLength(1);
    });
  });

  describe('validate - empty agents array', () => {
    beforeEach(() => {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.CLAUDE_API_KEY;
    });

    it('should validate pipeline-level runtime when agents array is empty', async () => {
      const config: PipelineConfig = {
        name: 'empty-agents-pipeline',
        trigger: 'manual',
        runtime: { type: 'claude-sdk' },
        agents: [],
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(1);
      expect(context.errors[0].field).toBe('environment');
    });

    it('should pass with empty agents and claude-code-headless runtime', async () => {
      const config: PipelineConfig = {
        name: 'empty-agents-pipeline',
        trigger: 'manual',
        runtime: { type: 'claude-code-headless' },
        agents: [],
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(0);
    });
  });

  describe('validate - undefined agents', () => {
    beforeEach(() => {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.CLAUDE_API_KEY;
    });

    it('should handle config without agents property gracefully', async () => {
      const config = {
        name: 'no-agents-pipeline',
        trigger: 'manual',
        runtime: { type: 'claude-sdk' },
      } as PipelineConfig;
      const context = createContext(config);

      await validator.validate(context);

      // Should still check pipeline-level runtime
      expect(context.errors).toHaveLength(1);
      expect(context.errors[0].field).toBe('environment');
    });
  });
});
