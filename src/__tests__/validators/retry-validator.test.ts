import { describe, it, expect, beforeEach } from 'vitest';
import { RetryValidator } from '../../validators/retry-validator.js';
import { ValidationContext } from '../../validators/types.js';
import { PipelineConfig } from '../../config/schema.js';

describe('RetryValidator', () => {
  let validator: RetryValidator;
  let baseConfig: PipelineConfig;

  beforeEach(() => {
    validator = new RetryValidator();
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
      expect(validator.name).toBe('retry');
    });

    it('should have priority 2', () => {
      expect(validator.priority).toBe(2);
    });
  });

  describe('shouldRun', () => {
    it('should return false when no agents have retry config', () => {
      const context = createContext(baseConfig);

      const result = validator.shouldRun(context);

      expect(result).toBe(false);
    });

    it('should return true when at least one agent has retry', () => {
      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'test-stage',
            agent: '.agent-pipeline/agents/test-agent.md',
            retry: {
              maxAttempts: 3,
            },
          },
        ],
      };
      const context = createContext(config);

      const result = validator.shouldRun(context);

      expect(result).toBe(true);
    });

    it('should return false when agents array is undefined', () => {
      const config: PipelineConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
      };
      const context = createContext(config);

      const result = validator.shouldRun(context);

      expect(result).toBe(false);
    });

    it('should return false when agents array is empty', () => {
      const config: PipelineConfig = {
        ...baseConfig,
        agents: [],
      };
      const context = createContext(config);

      const result = validator.shouldRun(context);

      expect(result).toBe(false);
    });

    it('should return true when one of multiple agents has retry', () => {
      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'no-retry-stage',
            agent: '.agent-pipeline/agents/agent1.md',
          },
          {
            name: 'retry-stage',
            agent: '.agent-pipeline/agents/agent2.md',
            retry: {
              maxAttempts: 2,
            },
          },
        ],
      };
      const context = createContext(config);

      const result = validator.shouldRun(context);

      expect(result).toBe(true);
    });
  });

  describe('validate - valid retry config', () => {
    it('should pass with valid retry config', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'test-stage',
            agent: '.agent-pipeline/agents/test-agent.md',
            retry: {
              maxAttempts: 3,
              delay: 60,
            },
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(0);
    });

    it('should return early when no agents exist', async () => {
      const config: PipelineConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(0);
    });

    it('should pass when agent has no retry config', async () => {
      const context = createContext(baseConfig);

      await validator.validate(context);

      expect(context.errors).toHaveLength(0);
    });
  });

  describe('validate - maxAttempts', () => {
    it('should warn when maxAttempts > 10', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'test-stage',
            agent: '.agent-pipeline/agents/test-agent.md',
            retry: {
              maxAttempts: 15,
            },
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(1);
      expect(context.errors[0]).toEqual({
        field: 'agents.test-stage.retry',
        message: 'maxAttempts (15) exceeds recommended limit. Consider reducing to <= 10 to avoid excessive delays',
        severity: 'warning',
      });
    });

    it('should pass when maxAttempts <= 10', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'test-stage',
            agent: '.agent-pipeline/agents/test-agent.md',
            retry: {
              maxAttempts: 10,
            },
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      const maxAttemptsErrors = context.errors.filter(e =>
        e.message.includes('maxAttempts')
      );
      expect(maxAttemptsErrors).toHaveLength(0);
    });

    it('should pass when maxAttempts is exactly 10', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'boundary-stage',
            agent: '.agent-pipeline/agents/test-agent.md',
            retry: {
              maxAttempts: 10,
            },
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(0);
    });

    it('should warn when maxAttempts is exactly 11', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'boundary-stage',
            agent: '.agent-pipeline/agents/test-agent.md',
            retry: {
              maxAttempts: 11,
            },
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(1);
      expect(context.errors[0].message).toContain('maxAttempts (11)');
      expect(context.errors[0].severity).toBe('warning');
    });
  });

  describe('validate - delay', () => {
    it('should warn when delay > 300', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'test-stage',
            agent: '.agent-pipeline/agents/test-agent.md',
            retry: {
              delay: 600,
            },
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(1);
      expect(context.errors[0]).toEqual({
        field: 'agents.test-stage.retry',
        message: 'Retry delay (600s) exceeds recommended maximum. Consider reducing to <= 300s (5 minutes)',
        severity: 'warning',
      });
    });

    it('should pass when delay <= 300', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'test-stage',
            agent: '.agent-pipeline/agents/test-agent.md',
            retry: {
              delay: 300,
            },
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      const delayErrors = context.errors.filter(e =>
        e.message.includes('delay')
      );
      expect(delayErrors).toHaveLength(0);
    });

    it('should pass when delay is exactly 300', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'boundary-stage',
            agent: '.agent-pipeline/agents/test-agent.md',
            retry: {
              delay: 300,
            },
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(0);
    });

    it('should warn when delay is exactly 301', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'boundary-stage',
            agent: '.agent-pipeline/agents/test-agent.md',
            retry: {
              delay: 301,
            },
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(1);
      expect(context.errors[0].message).toContain('Retry delay (301s)');
      expect(context.errors[0].severity).toBe('warning');
    });
  });

  describe('validate - multiple agents with retry issues', () => {
    it('should collect all warnings from multiple agents', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'first-stage',
            agent: '.agent-pipeline/agents/agent1.md',
            retry: {
              maxAttempts: 20,
            },
          },
          {
            name: 'second-stage',
            agent: '.agent-pipeline/agents/agent2.md',
            retry: {
              delay: 500,
            },
          },
          {
            name: 'third-stage',
            agent: '.agent-pipeline/agents/agent3.md',
            retry: {
              maxAttempts: 15,
              delay: 400,
            },
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      // first-stage: 1 warning (maxAttempts)
      // second-stage: 1 warning (delay)
      // third-stage: 2 warnings (maxAttempts + delay)
      expect(context.errors).toHaveLength(4);

      expect(context.errors.some(e =>
        e.field === 'agents.first-stage.retry' &&
        e.message.includes('maxAttempts (20)')
      )).toBe(true);

      expect(context.errors.some(e =>
        e.field === 'agents.second-stage.retry' &&
        e.message.includes('Retry delay (500s)')
      )).toBe(true);

      expect(context.errors.some(e =>
        e.field === 'agents.third-stage.retry' &&
        e.message.includes('maxAttempts (15)')
      )).toBe(true);

      expect(context.errors.some(e =>
        e.field === 'agents.third-stage.retry' &&
        e.message.includes('Retry delay (400s)')
      )).toBe(true);
    });

    it('should collect both maxAttempts and delay warnings for same agent', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'problematic-stage',
            agent: '.agent-pipeline/agents/test-agent.md',
            retry: {
              maxAttempts: 25,
              delay: 600,
            },
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(2);
      expect(context.errors.every(e => e.field === 'agents.problematic-stage.retry')).toBe(true);
      expect(context.errors.every(e => e.severity === 'warning')).toBe(true);
    });

    it('should skip agents without retry config when validating multiple agents', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        agents: [
          {
            name: 'no-retry',
            agent: '.agent-pipeline/agents/agent1.md',
          },
          {
            name: 'with-retry',
            agent: '.agent-pipeline/agents/agent2.md',
            retry: {
              maxAttempts: 50,
            },
          },
          {
            name: 'also-no-retry',
            agent: '.agent-pipeline/agents/agent3.md',
          },
        ],
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(1);
      expect(context.errors[0].field).toBe('agents.with-retry.retry');
    });
  });
});
