import { describe, it, expect, beforeEach } from 'vitest';
import { SettingsValidator } from '../../validators/settings-validator.js';
import { ValidationContext, ValidationError } from '../../validators/types.js';
import { PipelineConfig } from '../../config/schema.js';

describe('SettingsValidator', () => {
  let validator: SettingsValidator;
  let baseConfig: PipelineConfig;

  beforeEach(() => {
    validator = new SettingsValidator();
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
      expect(validator.name).toBe('settings');
    });

    it('should have priority 0', () => {
      expect(validator.priority).toBe(0);
    });
  });

  describe('shouldRun', () => {
    it('should return false when no settings exist', () => {
      const context = createContext(baseConfig);

      const result = validator.shouldRun(context);

      expect(result).toBe(false);
    });

    it('should return true when settings exist', () => {
      const config: PipelineConfig = {
        ...baseConfig,
        settings: {
          autoCommit: true,
        },
      };
      const context = createContext(config);

      const result = validator.shouldRun(context);

      expect(result).toBe(true);
    });

    it('should return true when settings is empty object', () => {
      const config: PipelineConfig = {
        ...baseConfig,
        settings: {},
      };
      const context = createContext(config);

      const result = validator.shouldRun(context);

      expect(result).toBe(true);
    });
  });

  describe('validate - general', () => {
    it('should pass with valid settings', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        settings: {
          autoCommit: true,
          failureStrategy: 'continue',
          commitPrefix: '[pipeline:{{stage}}]',
          permissionMode: 'acceptEdits',
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(0);
    });

    it('should return early when no settings exist', async () => {
      const context = createContext(baseConfig);

      await validator.validate(context);

      expect(context.errors).toHaveLength(0);
    });
  });

  describe('validate - failureStrategy', () => {
    it('should error on invalid failureStrategy', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        settings: {
          failureStrategy: 'invalid' as any,
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(1);
      expect(context.errors[0]).toEqual({
        field: 'settings.failureStrategy',
        message: 'Invalid failure strategy: invalid. Must be one of: stop, continue, warn',
        severity: 'error',
      });
    });

    it('should pass with failureStrategy "stop"', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        settings: {
          failureStrategy: 'stop',
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      const strategyErrors = context.errors.filter(e => e.field === 'settings.failureStrategy');
      expect(strategyErrors).toHaveLength(0);
    });

    it('should pass with failureStrategy "continue"', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        settings: {
          failureStrategy: 'continue',
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      const strategyErrors = context.errors.filter(e => e.field === 'settings.failureStrategy');
      expect(strategyErrors).toHaveLength(0);
    });

    it('should pass with failureStrategy "warn"', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        settings: {
          failureStrategy: 'warn',
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      const strategyErrors = context.errors.filter(e => e.field === 'settings.failureStrategy');
      expect(strategyErrors).toHaveLength(0);
    });

    it('should pass all valid failure strategies', async () => {
      const validStrategies: Array<'stop' | 'continue' | 'warn'> = ['stop', 'continue', 'warn'];

      for (const strategy of validStrategies) {
        const config: PipelineConfig = {
          ...baseConfig,
          settings: {
            failureStrategy: strategy,
          },
        };
        const context = createContext(config);

        await validator.validate(context);

        const strategyErrors = context.errors.filter(e => e.field === 'settings.failureStrategy');
        expect(strategyErrors).toHaveLength(0);
      }
    });

    it('should skip validation when failureStrategy is not set', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        settings: {
          autoCommit: true,
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      const strategyErrors = context.errors.filter(e => e.field === 'settings.failureStrategy');
      expect(strategyErrors).toHaveLength(0);
    });
  });

  describe('validate - commitPrefix', () => {
    it('should warn when commitPrefix does not include {{stage}}', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        settings: {
          commitPrefix: 'PIPELINE:',
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(1);
      expect(context.errors[0]).toEqual({
        field: 'settings.commitPrefix',
        message: 'commitPrefix should include {{stage}} template variable',
        severity: 'warning',
      });
    });

    it('should pass when commitPrefix includes {{stage}}', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        settings: {
          commitPrefix: '[pipeline:{{stage}}]',
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      const prefixErrors = context.errors.filter(e => e.field === 'settings.commitPrefix');
      expect(prefixErrors).toHaveLength(0);
    });

    it('should pass when commitPrefix has {{stage}} at the end', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        settings: {
          commitPrefix: 'chore(pipeline): {{stage}}',
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      const prefixErrors = context.errors.filter(e => e.field === 'settings.commitPrefix');
      expect(prefixErrors).toHaveLength(0);
    });

    it('should skip validation when commitPrefix is not set', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        settings: {
          autoCommit: true,
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      const prefixErrors = context.errors.filter(e => e.field === 'settings.commitPrefix');
      expect(prefixErrors).toHaveLength(0);
    });
  });

  describe('validate - permissionMode', () => {
    it('should error on invalid permissionMode', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        settings: {
          permissionMode: 'invalid-mode' as any,
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors.some(e =>
        e.field === 'settings.permissionMode' &&
        e.severity === 'error' &&
        e.message.includes('Invalid permission mode: invalid-mode')
      )).toBe(true);
    });

    it('should warn about bypassPermissions mode', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        settings: {
          permissionMode: 'bypassPermissions',
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors.some(e =>
        e.field === 'settings.permissionMode' &&
        e.severity === 'warning' &&
        e.message.includes('bypassPermissions mode bypasses all permission checks')
      )).toBe(true);
    });

    it('should pass with permissionMode "default"', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        settings: {
          permissionMode: 'default',
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      const permErrors = context.errors.filter(e => e.field === 'settings.permissionMode');
      expect(permErrors).toHaveLength(0);
    });

    it('should pass with permissionMode "acceptEdits"', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        settings: {
          permissionMode: 'acceptEdits',
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      const permErrors = context.errors.filter(e => e.field === 'settings.permissionMode');
      expect(permErrors).toHaveLength(0);
    });

    it('should pass with permissionMode "plan"', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        settings: {
          permissionMode: 'plan',
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      const permErrors = context.errors.filter(e => e.field === 'settings.permissionMode');
      expect(permErrors).toHaveLength(0);
    });

    it('should pass all valid permission modes without error', async () => {
      const validModes: Array<'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'> = [
        'default',
        'acceptEdits',
        'bypassPermissions',
        'plan'
      ];

      for (const mode of validModes) {
        const config: PipelineConfig = {
          ...baseConfig,
          settings: {
            permissionMode: mode,
          },
        };
        const context = createContext(config);

        await validator.validate(context);

        const permErrors = context.errors.filter(e =>
          e.field === 'settings.permissionMode' && e.severity === 'error'
        );
        expect(permErrors).toHaveLength(0);
      }
    });

    it('should not warn for permission modes other than bypassPermissions', async () => {
      const safeModes: Array<'default' | 'acceptEdits' | 'plan'> = ['default', 'acceptEdits', 'plan'];

      for (const mode of safeModes) {
        const config: PipelineConfig = {
          ...baseConfig,
          settings: {
            permissionMode: mode,
          },
        };
        const context = createContext(config);

        await validator.validate(context);

        const permWarnings = context.errors.filter(e =>
          e.field === 'settings.permissionMode' && e.severity === 'warning'
        );
        expect(permWarnings).toHaveLength(0);
      }
    });

    it('should skip validation when permissionMode is not set', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        settings: {
          autoCommit: true,
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      const permErrors = context.errors.filter(e => e.field === 'settings.permissionMode');
      expect(permErrors).toHaveLength(0);
    });
  });

  describe('validate - multiple settings', () => {
    it('should report multiple errors for multiple invalid settings', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        settings: {
          failureStrategy: 'invalid-strategy' as any,
          commitPrefix: 'NO_STAGE_PREFIX:',
          permissionMode: 'invalid-mode' as any,
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      // Should have 3 errors: failureStrategy (error), commitPrefix (warning), permissionMode (error)
      expect(context.errors).toHaveLength(3);
      expect(context.errors.some(e => e.field === 'settings.failureStrategy' && e.severity === 'error')).toBe(true);
      expect(context.errors.some(e => e.field === 'settings.commitPrefix' && e.severity === 'warning')).toBe(true);
      expect(context.errors.some(e => e.field === 'settings.permissionMode' && e.severity === 'error')).toBe(true);
    });

    it('should validate bypassPermissions with correct warning message', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        settings: {
          permissionMode: 'bypassPermissions',
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toHaveLength(1);
      expect(context.errors[0]).toEqual({
        field: 'settings.permissionMode',
        message: 'bypassPermissions mode bypasses all permission checks. Use with caution in production.',
        severity: 'warning',
      });
    });
  });
});
