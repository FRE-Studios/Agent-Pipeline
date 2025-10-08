import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PipelineValidator } from './pipeline-validator.js';
import {
  simplePipelineConfig,
  parallelPipelineConfig,
  invalidPipelineConfig,
} from '../__tests__/fixtures/pipeline-configs.js';
import { PipelineConfig } from '../config/schema.js';
import { createTempDir, cleanupTempDir } from '../__tests__/setup.js';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('PipelineValidator', () => {
  let validator: PipelineValidator;
  let tempDir: string;

  beforeEach(async () => {
    validator = new PipelineValidator();
    tempDir = await createTempDir('validator-test-');

    // Create agent files that are referenced in configs
    const agentsDir = path.join(tempDir, '.claude', 'agents');
    await fs.mkdir(agentsDir, { recursive: true });

    // Create test agent files
    await fs.writeFile(path.join(agentsDir, 'test-agent.md'), '# Test Agent', 'utf-8');
    await fs.writeFile(path.join(agentsDir, 'test-agent-2.md'), '# Test Agent 2', 'utf-8');
    await fs.writeFile(path.join(agentsDir, 'reviewer.md'), '# Reviewer', 'utf-8');
    await fs.writeFile(path.join(agentsDir, 'security.md'), '# Security', 'utf-8');
    await fs.writeFile(path.join(agentsDir, 'quality.md'), '# Quality', 'utf-8');
    await fs.writeFile(path.join(agentsDir, 'summary.md'), '# Summary', 'utf-8');
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('validate', () => {
    it('should validate a correct pipeline configuration', async () => {
      const errors = await validator.validate(simplePipelineConfig, tempDir);

      expect(errors).toHaveLength(0);
    });

    it('should validate parallel pipeline configuration', async () => {
      const errors = await validator.validate(parallelPipelineConfig, tempDir);

      expect(errors).toHaveLength(0);
    });

    it('should detect missing pipeline name', async () => {
      const invalidConfig: PipelineConfig = {
        ...simplePipelineConfig,
        name: '',
      };

      const errors = await validator.validate(invalidConfig, tempDir);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.field === 'name' && e.severity === 'error')).toBe(true);
    });

    it('should detect invalid trigger', async () => {
      const invalidConfig = {
        ...simplePipelineConfig,
        trigger: 'invalid-trigger' as any,
      };

      const errors = await validator.validate(invalidConfig, tempDir);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.field === 'trigger' && e.severity === 'error')).toBe(true);
    });

    it('should detect missing agents array', async () => {
      const invalidConfig = {
        ...simplePipelineConfig,
        agents: [],
      };

      const errors = await validator.validate(invalidConfig, tempDir);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.field === 'agents' && e.severity === 'error')).toBe(true);
    });

    it('should detect missing agent file', async () => {
      const invalidConfig: PipelineConfig = {
        ...simplePipelineConfig,
        agents: [
          {
            name: 'test-stage',
            agent: '.claude/agents/non-existent.md',
          },
        ],
      };

      const errors = await validator.validate(invalidConfig, tempDir);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.message.includes('Agent file not found'))).toBe(true);
    });

    it('should detect duplicate agent names', async () => {
      const invalidConfig: PipelineConfig = {
        ...simplePipelineConfig,
        agents: [
          {
            name: 'duplicate',
            agent: '.claude/agents/test-agent.md',
          },
          {
            name: 'duplicate',
            agent: '.claude/agents/test-agent-2.md',
          },
        ],
      };

      const errors = await validator.validate(invalidConfig, tempDir);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.message.includes('Duplicate agent name'))).toBe(true);
    });

    it('should detect invalid failure strategy', async () => {
      const invalidConfig: PipelineConfig = {
        ...simplePipelineConfig,
        settings: {
          failureStrategy: 'invalid' as any,
        },
      };

      const errors = await validator.validate(invalidConfig, tempDir);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.field.includes('failureStrategy'))).toBe(true);
    });

    it('should warn about commitPrefix without {{stage}} template', async () => {
      const warningConfig: PipelineConfig = {
        ...simplePipelineConfig,
        settings: {
          commitPrefix: 'PIPELINE:',
        },
      };

      const errors = await validator.validate(warningConfig, tempDir);

      expect(errors.some(e => e.severity === 'warning' && e.field.includes('commitPrefix'))).toBe(true);
    });

    it('should validate agent-specific settings', async () => {
      const invalidConfig: PipelineConfig = {
        ...simplePipelineConfig,
        agents: [
          {
            name: 'test-stage',
            agent: '',
          },
        ],
      };

      const errors = await validator.validate(invalidConfig, tempDir);

      expect(errors.some(e => e.message.includes('Agent path is required'))).toBe(true);
    });

    it('should detect invalid onFail strategy', async () => {
      const invalidConfig: PipelineConfig = {
        ...simplePipelineConfig,
        agents: [
          {
            name: 'test-stage',
            agent: '.claude/agents/test-agent.md',
            onFail: 'invalid' as any,
          },
        ],
      };

      const errors = await validator.validate(invalidConfig, tempDir);

      expect(errors.some(e => e.message.includes('Invalid onFail strategy'))).toBe(true);
    });

    it('should detect invalid timeout', async () => {
      const invalidConfig: PipelineConfig = {
        ...simplePipelineConfig,
        agents: [
          {
            name: 'test-stage',
            agent: '.claude/agents/test-agent.md',
            timeout: -10,
          },
        ],
      };

      const errors = await validator.validate(invalidConfig, tempDir);

      expect(errors.some(e => e.message.includes('Timeout must be a positive number'))).toBe(true);
    });

    it('should warn about very high timeout', async () => {
      const warningConfig: PipelineConfig = {
        ...simplePipelineConfig,
        agents: [
          {
            name: 'test-stage',
            agent: '.claude/agents/test-agent.md',
            timeout: 700,
          },
        ],
      };

      const errors = await validator.validate(warningConfig, tempDir);

      expect(errors.some(e => e.severity === 'warning' && e.message.includes('Timeout exceeds'))).toBe(true);
    });
  });

  describe('validateAndReport', () => {
    it('should return true for valid configuration', async () => {
      const result = await PipelineValidator.validateAndReport(simplePipelineConfig, tempDir);

      expect(result).toBe(true);
    });

    it('should return false for invalid configuration', async () => {
      const result = await PipelineValidator.validateAndReport(invalidPipelineConfig, tempDir);

      expect(result).toBe(false);
    });

    it('should return true for configuration with warnings only', async () => {
      const warningConfig: PipelineConfig = {
        ...simplePipelineConfig,
        settings: {
          commitPrefix: 'PREFIX:',
        },
      };

      const result = await PipelineValidator.validateAndReport(warningConfig, tempDir);

      expect(result).toBe(true);
    });

    it('should return false for configuration with errors', async () => {
      const errorConfig: PipelineConfig = {
        ...simplePipelineConfig,
        name: '',
      };

      const result = await PipelineValidator.validateAndReport(errorConfig, tempDir);

      expect(result).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle absolute agent paths', async () => {
      const absolutePath = path.join(tempDir, '.claude', 'agents', 'test-agent.md');
      const config: PipelineConfig = {
        ...simplePipelineConfig,
        agents: [
          {
            name: 'test-stage',
            agent: absolutePath,
          },
        ],
      };

      const errors = await validator.validate(config, tempDir);

      expect(errors).toHaveLength(0);
    });

    it('should handle relative agent paths', async () => {
      const config: PipelineConfig = {
        ...simplePipelineConfig,
        agents: [
          {
            name: 'test-stage',
            agent: '.claude/agents/test-agent.md',
          },
        ],
      };

      const errors = await validator.validate(config, tempDir);

      expect(errors).toHaveLength(0);
    });

    it('should handle multiple validation errors', async () => {
      const multiErrorConfig: PipelineConfig = {
        name: '',
        trigger: 'invalid' as any,
        agents: [],
      };

      const errors = await validator.validate(multiErrorConfig, tempDir);

      expect(errors.length).toBeGreaterThanOrEqual(3);
    });

    it('should handle empty agent name', async () => {
      const config: PipelineConfig = {
        ...simplePipelineConfig,
        agents: [
          {
            name: '',
            agent: '.claude/agents/test-agent.md',
          },
        ],
      };

      const errors = await validator.validate(config, tempDir);

      expect(errors.some(e => e.message.includes('Agent name is required'))).toBe(true);
    });

    it('should handle whitespace-only agent name', async () => {
      const config: PipelineConfig = {
        ...simplePipelineConfig,
        agents: [
          {
            name: '   ',
            agent: '.claude/agents/test-agent.md',
          },
        ],
      };

      const errors = await validator.validate(config, tempDir);

      expect(errors.some(e => e.message.includes('Agent name is required'))).toBe(true);
    });

    it('should validate all valid failure strategies', async () => {
      const validStrategies: Array<'stop' | 'continue' | 'warn'> = ['stop', 'continue', 'warn'];

      for (const strategy of validStrategies) {
        const config: PipelineConfig = {
          ...simplePipelineConfig,
          settings: {
            failureStrategy: strategy,
          },
        };

        const errors = await validator.validate(config, tempDir);
        const strategyErrors = errors.filter(e => e.field.includes('failureStrategy'));
        expect(strategyErrors).toHaveLength(0);
      }
    });

    it('should validate all valid triggers', async () => {
      const validTriggers: Array<'manual' | 'post-commit'> = ['manual', 'post-commit'];

      for (const trigger of validTriggers) {
        const config: PipelineConfig = {
          ...simplePipelineConfig,
          trigger,
        };

        const errors = await validator.validate(config, tempDir);
        const triggerErrors = errors.filter(e => e.field === 'trigger');
        expect(triggerErrors).toHaveLength(0);
      }
    });

    it('should handle zero timeout as invalid', async () => {
      const config: PipelineConfig = {
        ...simplePipelineConfig,
        agents: [
          {
            name: 'test-stage',
            agent: '.claude/agents/test-agent.md',
            timeout: 0,
          },
        ],
      };

      const errors = await validator.validate(config, tempDir);

      expect(errors.some(e => e.message.includes('Timeout must be a positive number'))).toBe(true);
    });

    it('should handle valid timeout values', async () => {
      const validTimeouts = [1, 60, 120, 300, 600];

      for (const timeout of validTimeouts) {
        const config: PipelineConfig = {
          ...simplePipelineConfig,
          agents: [
            {
              name: 'test-stage',
              agent: '.claude/agents/test-agent.md',
              timeout,
            },
          ],
        };

        const errors = await validator.validate(config, tempDir);
        const timeoutErrors = errors.filter(e => e.field.includes('timeout') && e.severity === 'error');
        expect(timeoutErrors).toHaveLength(0);
      }
    });
  });

  describe('concurrent validation', () => {
    it('should handle concurrent validations', async () => {
      const results = await Promise.all([
        validator.validate(simplePipelineConfig, tempDir),
        validator.validate(parallelPipelineConfig, tempDir),
        validator.validate(simplePipelineConfig, tempDir),
      ]);

      expect(results[0]).toHaveLength(0);
      expect(results[1]).toHaveLength(0);
      expect(results[2]).toHaveLength(0);
    });
  });
});
