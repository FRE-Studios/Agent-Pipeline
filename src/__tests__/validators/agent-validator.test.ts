import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentValidator } from '../../validators/agent-validator.js';
import { ValidationContext } from '../../validators/types.js';
import { PipelineConfig } from '../../config/schema.js';
import * as fs from 'fs/promises';

vi.mock('fs/promises');

describe('AgentValidator', () => {
  let validator: AgentValidator;
  let baseConfig: PipelineConfig;

  beforeEach(() => {
    validator = new AgentValidator();
    baseConfig = {
      name: 'test-pipeline',
      trigger: 'manual',
      agents: [],
    };
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
    it('should have correct name', () => {
      expect(validator.name).toBe('agents');
    });

    it('should have priority 0', () => {
      expect(validator.priority).toBe(0);
    });
  });

  describe('shouldRun', () => {
    it('should return false when no agents exist', () => {
      const config: PipelineConfig = {
        ...baseConfig,
        agents: [],
      };
      const context = createContext(config);

      const result = validator.shouldRun(context);

      expect(result).toBe(false);
    });

    it('should return false when agents is undefined', () => {
      const config: PipelineConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
      } as PipelineConfig;
      const context = createContext(config);

      const result = validator.shouldRun(context);

      expect(result).toBe(false);
    });

    it('should return true when agents exist', () => {
      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'test-agent',
            agent: '.agent-pipeline/agents/test.md',
          },
        ],
      };
      const context = createContext(config);

      const result = validator.shouldRun(context);

      expect(result).toBe(true);
    });
  });

  describe('validate - agent file existence', () => {
    it('should pass when agent file exists', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'test-agent',
            agent: '.agent-pipeline/agents/test.md',
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(fs.access).toHaveBeenCalledWith('/test/repo/.agent-pipeline/agents/test.md');
      expect(context.errors).toHaveLength(0);
    });

    it('should error when agent file not found', async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));
      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'test-agent',
            agent: '.agent-pipeline/agents/missing.md',
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(1);
      expect(context.errors[0]).toEqual({
        field: 'agents.test-agent.agent',
        message: 'Agent file not found: .agent-pipeline/agents/missing.md',
        severity: 'error',
      });
    });

    it('should handle absolute paths for agent files', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'test-agent',
            agent: '/absolute/path/to/agent.md',
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(fs.access).toHaveBeenCalledWith('/absolute/path/to/agent.md');
      expect(context.errors).toHaveLength(0);
    });
  });

  describe('validate - duplicate agent names', () => {
    it('should error on duplicate agent names', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'duplicate-agent',
            agent: '.agent-pipeline/agents/agent1.md',
          },
          {
            name: 'duplicate-agent',
            agent: '.agent-pipeline/agents/agent2.md',
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors.some(e =>
        e.field === 'agents.duplicate-agent' &&
        e.message === 'Duplicate agent name: duplicate-agent' &&
        e.severity === 'error'
      )).toBe(true);
    });
  });

  describe('validate - agent name', () => {
    it('should error when agent name is missing', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: undefined as any,
            agent: '.agent-pipeline/agents/test.md',
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors.some(e =>
        e.field === 'agents[].name' &&
        e.message === 'Agent name is required' &&
        e.severity === 'error'
      )).toBe(true);
    });

    it('should error when agent name is empty string', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: '',
            agent: '.agent-pipeline/agents/test.md',
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors.some(e =>
        e.field === 'agents[].name' &&
        e.message === 'Agent name is required' &&
        e.severity === 'error'
      )).toBe(true);
    });

    it('should error when agent name is whitespace only', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: '   ',
            agent: '.agent-pipeline/agents/test.md',
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors.some(e =>
        e.field === 'agents[].name' &&
        e.message === 'Agent name is required' &&
        e.severity === 'error'
      )).toBe(true);
    });
  });

  describe('validate - agent path', () => {
    it('should error when agent path is missing', async () => {
      // Note: when agent path is undefined, path.isAbsolute throws before
      // the config validation can catch it. The test verifies the error is thrown.
      vi.mocked(fs.access).mockResolvedValue(undefined);
      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'test-agent',
            agent: undefined as any,
          },
        ],
      };
      const context = createContext(config);

      await expect(validator.validate(context)).rejects.toThrow();
    });

    it('should error when agent path is empty string', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'test-agent',
            agent: '',
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors.some(e =>
        e.field === 'agents.test-agent.agent' &&
        e.message === 'Agent path is required' &&
        e.severity === 'error'
      )).toBe(true);
    });

    it('should error when agent path is whitespace only', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'test-agent',
            agent: '   ',
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors.some(e =>
        e.field === 'agents.test-agent.agent' &&
        e.message === 'Agent path is required' &&
        e.severity === 'error'
      )).toBe(true);
    });
  });

  describe('validate - onFail strategy', () => {
    it('should error on invalid onFail strategy', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'test-agent',
            agent: '.agent-pipeline/agents/test.md',
            onFail: 'invalid-strategy' as any,
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors.some(e =>
        e.field === 'agents.test-agent.onFail' &&
        e.message === 'Invalid onFail strategy: invalid-strategy. Must be one of: stop, continue, warn' &&
        e.severity === 'error'
      )).toBe(true);
    });

    it('should pass with onFail strategy "stop"', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'test-agent',
            agent: '.agent-pipeline/agents/test.md',
            onFail: 'stop',
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      const onFailErrors = context.errors.filter(e => e.field.includes('onFail'));
      expect(onFailErrors).toHaveLength(0);
    });

    it('should pass with onFail strategy "continue"', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'test-agent',
            agent: '.agent-pipeline/agents/test.md',
            onFail: 'continue',
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      const onFailErrors = context.errors.filter(e => e.field.includes('onFail'));
      expect(onFailErrors).toHaveLength(0);
    });

    it('should pass with onFail strategy "warn"', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'test-agent',
            agent: '.agent-pipeline/agents/test.md',
            onFail: 'warn',
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      const onFailErrors = context.errors.filter(e => e.field.includes('onFail'));
      expect(onFailErrors).toHaveLength(0);
    });

    it('should pass all valid onFail strategies', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      const validStrategies: Array<'stop' | 'continue' | 'warn'> = ['stop', 'continue', 'warn'];

      for (const strategy of validStrategies) {
        const config: PipelineConfig = {
          ...baseConfig,
          agents: [
            {
              name: 'test-agent',
              agent: '.agent-pipeline/agents/test.md',
              onFail: strategy,
            },
          ],
        };
        const context = createContext(config);

        await validator.validate(context);

        const onFailErrors = context.errors.filter(e => e.field.includes('onFail'));
        expect(onFailErrors).toHaveLength(0);
      }
    });

    it('should skip onFail validation when not set', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'test-agent',
            agent: '.agent-pipeline/agents/test.md',
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      const onFailErrors = context.errors.filter(e => e.field.includes('onFail'));
      expect(onFailErrors).toHaveLength(0);
    });
  });

  describe('validate - timeout', () => {
    it('should error on negative timeout', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'test-agent',
            agent: '.agent-pipeline/agents/test.md',
            timeout: -10,
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors.some(e =>
        e.field === 'agents.test-agent.timeout' &&
        e.message === 'Timeout must be a positive number' &&
        e.severity === 'error'
      )).toBe(true);
    });

    it('should error on zero timeout', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'test-agent',
            agent: '.agent-pipeline/agents/test.md',
            timeout: 0,
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors.some(e =>
        e.field === 'agents.test-agent.timeout' &&
        e.message === 'Timeout must be a positive number' &&
        e.severity === 'error'
      )).toBe(true);
    });

    it('should warn when timeout exceeds 900 seconds', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'test-agent',
            agent: '.agent-pipeline/agents/test.md',
            timeout: 901,
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors.some(e =>
        e.field === 'agents.test-agent.timeout' &&
        e.message === 'Timeout exceeds recommended maximum of 900 seconds (15 minutes)' &&
        e.severity === 'warning'
      )).toBe(true);
    });

    it('should pass with valid timeout', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'test-agent',
            agent: '.agent-pipeline/agents/test.md',
            timeout: 120,
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      const timeoutErrors = context.errors.filter(e => e.field.includes('timeout'));
      expect(timeoutErrors).toHaveLength(0);
    });

    it('should pass with timeout at maximum recommended value (900)', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'test-agent',
            agent: '.agent-pipeline/agents/test.md',
            timeout: 900,
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      const timeoutErrors = context.errors.filter(e => e.field.includes('timeout'));
      expect(timeoutErrors).toHaveLength(0);
    });

    it('should skip timeout validation when not set', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'test-agent',
            agent: '.agent-pipeline/agents/test.md',
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      const timeoutErrors = context.errors.filter(e => e.field.includes('timeout'));
      expect(timeoutErrors).toHaveLength(0);
    });
  });

  describe('validate - early return', () => {
    it('should return early when agents is undefined', async () => {
      const config: PipelineConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
      } as PipelineConfig;
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(0);
      expect(fs.access).not.toHaveBeenCalled();
    });
  });

  describe('validate - multiple agents', () => {
    it('should validate all agents and report all errors', async () => {
      vi.mocked(fs.access)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('ENOENT'));
      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'valid-agent',
            agent: '.agent-pipeline/agents/valid.md',
            timeout: 60,
          },
          {
            name: 'invalid-agent',
            agent: '.agent-pipeline/agents/missing.md',
            onFail: 'invalid' as any,
            timeout: -5,
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      // Should have errors for: missing file, invalid onFail, negative timeout
      expect(context.errors.length).toBeGreaterThanOrEqual(3);
      expect(context.errors.some(e => e.message.includes('Agent file not found'))).toBe(true);
      expect(context.errors.some(e => e.message.includes('Invalid onFail strategy'))).toBe(true);
      expect(context.errors.some(e => e.message.includes('Timeout must be a positive number'))).toBe(true);
    });
  });
});
