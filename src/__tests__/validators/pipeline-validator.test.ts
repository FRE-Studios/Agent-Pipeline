import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PipelineValidator } from '../../validators/pipeline-validator.js';
import {
  simplePipelineConfig,
  parallelPipelineConfig,
  invalidPipelineConfig,
} from '../fixtures/pipeline-configs.js';
import { PipelineConfig } from '../../config/schema.js';
import { createTempDir, cleanupTempDir } from '../setup.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as ghCliChecker from '../../utils/gh-cli-checker.js';

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
            timeout: 1000, // Exceeds 900s threshold
          },
        ],
      };

      const errors = await validator.validate(warningConfig, tempDir);

      expect(errors.some(e => e.severity === 'warning' && e.message.includes('Timeout exceeds'))).toBe(true);
      expect(errors.some(e => e.severity === 'warning' && e.message.includes('900'))).toBe(true);
    });

    it('should validate context reduction configuration (summary-based)', async () => {
      const config: PipelineConfig = {
        ...simplePipelineConfig,
        settings: {
          contextReduction: {
            enabled: true,
            maxTokens: 50000,
            strategy: 'summary-based',
            contextWindow: 3,
            requireSummary: true,
            saveVerboseOutputs: true,
            compressFileList: true,
          },
        },
      };

      const errors = await validator.validate(config, tempDir);

      const contextErrors = errors.filter(e => e.field.includes('contextReduction'));
      expect(contextErrors).toHaveLength(0);
    });

    it('should validate context reduction configuration (agent-based)', async () => {
      // Create context reducer agent file
      const agentsDir = path.join(tempDir, '.claude', 'agents');
      await fs.writeFile(path.join(agentsDir, 'context-reducer.md'), '# Context Reducer', 'utf-8');

      const config: PipelineConfig = {
        ...simplePipelineConfig,
        settings: {
          contextReduction: {
            enabled: true,
            maxTokens: 50000,
            strategy: 'agent-based',
            agentPath: '.claude/agents/context-reducer.md',
            triggerThreshold: 45000,
          },
        },
      };

      const errors = await validator.validate(config, tempDir);

      const contextErrors = errors.filter(e => e.field.includes('contextReduction'));
      expect(contextErrors).toHaveLength(0);
    });

    it('should detect invalid context reduction strategy', async () => {
      const config: PipelineConfig = {
        ...simplePipelineConfig,
        settings: {
          contextReduction: {
            enabled: true,
            maxTokens: 50000,
            strategy: 'invalid-strategy' as any,
          },
        },
      };

      const errors = await validator.validate(config, tempDir);

      expect(errors.some(e => e.field.includes('contextReduction.strategy'))).toBe(true);
    });

    it('should detect negative maxTokens in context reduction', async () => {
      const config: PipelineConfig = {
        ...simplePipelineConfig,
        settings: {
          contextReduction: {
            enabled: true,
            maxTokens: -1000,
            strategy: 'summary-based',
          },
        },
      };

      const errors = await validator.validate(config, tempDir);

      expect(errors.some(e => e.message.includes('maxTokens must be a positive number'))).toBe(true);
    });

    it('should warn about very low maxTokens', async () => {
      const config: PipelineConfig = {
        ...simplePipelineConfig,
        settings: {
          contextReduction: {
            enabled: true,
            maxTokens: 1000, // Very low
            strategy: 'summary-based',
          },
        },
      };

      const errors = await validator.validate(config, tempDir);

      expect(errors.some(e => e.severity === 'warning' && e.message.includes('maxTokens is very low'))).toBe(true);
    });

    it('should detect negative contextWindow', async () => {
      const config: PipelineConfig = {
        ...simplePipelineConfig,
        settings: {
          contextReduction: {
            enabled: true,
            maxTokens: 50000,
            strategy: 'summary-based',
            contextWindow: -1,
          },
        },
      };

      const errors = await validator.validate(config, tempDir);

      expect(errors.some(e => e.message.includes('contextWindow must be a positive number'))).toBe(true);
    });

    it('should detect negative triggerThreshold', async () => {
      const config: PipelineConfig = {
        ...simplePipelineConfig,
        settings: {
          contextReduction: {
            enabled: true,
            maxTokens: 50000,
            strategy: 'agent-based',
            triggerThreshold: -1000,
          },
        },
      };

      const errors = await validator.validate(config, tempDir);

      expect(errors.some(e => e.message.includes('triggerThreshold must be a positive number'))).toBe(true);
    });

    it('should detect triggerThreshold exceeding maxTokens', async () => {
      const config: PipelineConfig = {
        ...simplePipelineConfig,
        settings: {
          contextReduction: {
            enabled: true,
            maxTokens: 50000,
            strategy: 'agent-based',
            triggerThreshold: 60000, // Greater than maxTokens
          },
        },
      };

      const errors = await validator.validate(config, tempDir);

      expect(errors.some(e => e.message.includes('triggerThreshold should be less than maxTokens'))).toBe(true);
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
      const validTimeouts = [1, 60, 120, 300, 600, 900];

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

  describe('permissionMode validation', () => {
    it('should accept valid permission modes', async () => {
      const validModes: Array<'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'> = [
        'default',
        'acceptEdits',
        'bypassPermissions',
        'plan'
      ];

      for (const mode of validModes) {
        const config: PipelineConfig = {
          ...simplePipelineConfig,
          settings: {
            ...simplePipelineConfig.settings,
            permissionMode: mode
          }
        };

        const errors = await validator.validate(config, tempDir);
        const permErrors = errors.filter(e => e.field === 'settings.permissionMode' && e.severity === 'error');
        expect(permErrors).toHaveLength(0);
      }
    });

    it('should reject invalid permission mode', async () => {
      const config: PipelineConfig = {
        ...simplePipelineConfig,
        settings: {
          ...simplePipelineConfig.settings,
          permissionMode: 'invalid-mode' as any
        }
      };

      const errors = await validator.validate(config, tempDir);
      expect(errors.some(e => e.field === 'settings.permissionMode' && e.severity === 'error')).toBe(true);
      expect(errors.some(e => e.message.includes('Invalid permission mode'))).toBe(true);
    });

    it('should warn about bypassPermissions mode', async () => {
      const config: PipelineConfig = {
        ...simplePipelineConfig,
        settings: {
          ...simplePipelineConfig.settings,
          permissionMode: 'bypassPermissions'
        }
      };

      const errors = await validator.validate(config, tempDir);
      expect(errors.some(e =>
        e.field === 'settings.permissionMode' &&
        e.severity === 'warning' &&
        e.message.includes('bypassPermissions')
      )).toBe(true);
    });

    it('should not warn about other permission modes', async () => {
      const safeModes: Array<'default' | 'acceptEdits' | 'plan'> = ['default', 'acceptEdits', 'plan'];

      for (const mode of safeModes) {
        const config: PipelineConfig = {
          ...simplePipelineConfig,
          settings: {
            ...simplePipelineConfig.settings,
            permissionMode: mode
          }
        };

        const errors = await validator.validate(config, tempDir);
        const permWarnings = errors.filter(e =>
          e.field === 'settings.permissionMode' && e.severity === 'warning'
        );
        expect(permWarnings).toHaveLength(0);
      }
    });

    it('should allow omitting permissionMode (optional field)', async () => {
      const config: PipelineConfig = {
        ...simplePipelineConfig,
        settings: {
          ...simplePipelineConfig.settings
          // permissionMode is omitted
        }
      };

      const errors = await validator.validate(config, tempDir);
      const permErrors = errors.filter(e => e.field === 'settings.permissionMode');
      expect(permErrors).toHaveLength(0);
    });
  });

  describe('Claude Agent SDK settings validation', () => {
    describe('global settings.claudeAgent', () => {
      it('should validate valid model selection', async () => {
        const config: PipelineConfig = {
          ...simplePipelineConfig,
          settings: {
            ...simplePipelineConfig.settings,
            claudeAgent: {
              model: 'haiku'
            }
          }
        };

        const errors = await validator.validate(config, tempDir);
        const modelErrors = errors.filter(e => e.field === 'settings.claudeAgent.model');
        expect(modelErrors).toHaveLength(0);
      });

      it('should reject invalid model name', async () => {
        const config: PipelineConfig = {
          ...simplePipelineConfig,
          settings: {
            ...simplePipelineConfig.settings,
            claudeAgent: {
              model: 'invalid-model' as any
            }
          }
        };

        const errors = await validator.validate(config, tempDir);
        const modelErrors = errors.filter(e =>
          e.field === 'settings.claudeAgent.model' && e.severity === 'error'
        );
        expect(modelErrors.length).toBeGreaterThan(0);
        expect(modelErrors[0].message).toContain('Invalid model');
      });

      it('should validate maxTurns as positive number', async () => {
        const config: PipelineConfig = {
          ...simplePipelineConfig,
          settings: {
            ...simplePipelineConfig.settings,
            claudeAgent: {
              maxTurns: 10
            }
          }
        };

        const errors = await validator.validate(config, tempDir);
        const turnErrors = errors.filter(e => e.field === 'settings.claudeAgent.maxTurns');
        expect(turnErrors).toHaveLength(0);
      });

      it('should reject negative maxTurns', async () => {
        const config: PipelineConfig = {
          ...simplePipelineConfig,
          settings: {
            ...simplePipelineConfig.settings,
            claudeAgent: {
              maxTurns: -5
            }
          }
        };

        const errors = await validator.validate(config, tempDir);
        const turnErrors = errors.filter(e =>
          e.field === 'settings.claudeAgent.maxTurns' && e.severity === 'error'
        );
        expect(turnErrors.length).toBeGreaterThan(0);
        expect(turnErrors[0].message).toContain('must be a positive number');
      });

      it('should warn when maxTurns exceeds 100', async () => {
        const config: PipelineConfig = {
          ...simplePipelineConfig,
          settings: {
            ...simplePipelineConfig.settings,
            claudeAgent: {
              maxTurns: 150
            }
          }
        };

        const errors = await validator.validate(config, tempDir);
        const turnWarnings = errors.filter(e =>
          e.field === 'settings.claudeAgent.maxTurns' && e.severity === 'warning'
        );
        expect(turnWarnings.length).toBeGreaterThan(0);
        expect(turnWarnings[0].message).toContain('exceeds recommended maximum of 100');
      });

      it('should validate maxThinkingTokens as positive number', async () => {
        const config: PipelineConfig = {
          ...simplePipelineConfig,
          settings: {
            ...simplePipelineConfig.settings,
            claudeAgent: {
              maxThinkingTokens: 5000
            }
          }
        };

        const errors = await validator.validate(config, tempDir);
        const tokenErrors = errors.filter(e => e.field === 'settings.claudeAgent.maxThinkingTokens');
        expect(tokenErrors).toHaveLength(0);
      });

      it('should reject negative maxThinkingTokens', async () => {
        const config: PipelineConfig = {
          ...simplePipelineConfig,
          settings: {
            ...simplePipelineConfig.settings,
            claudeAgent: {
              maxThinkingTokens: -1000
            }
          }
        };

        const errors = await validator.validate(config, tempDir);
        const tokenErrors = errors.filter(e =>
          e.field === 'settings.claudeAgent.maxThinkingTokens' && e.severity === 'error'
        );
        expect(tokenErrors.length).toBeGreaterThan(0);
        expect(tokenErrors[0].message).toContain('must be a positive number');
      });

      it('should warn when maxThinkingTokens exceeds 50000', async () => {
        const config: PipelineConfig = {
          ...simplePipelineConfig,
          settings: {
            ...simplePipelineConfig.settings,
            claudeAgent: {
              maxThinkingTokens: 60000
            }
          }
        };

        const errors = await validator.validate(config, tempDir);
        const tokenWarnings = errors.filter(e =>
          e.field === 'settings.claudeAgent.maxThinkingTokens' && e.severity === 'warning'
        );
        expect(tokenWarnings.length).toBeGreaterThan(0);
        expect(tokenWarnings[0].message).toContain('exceeds recommended maximum of 50000');
      });

      it('should allow omitting claudeAgent entirely (optional)', async () => {
        const config: PipelineConfig = {
          ...simplePipelineConfig,
          settings: {
            ...simplePipelineConfig.settings
            // claudeAgent is omitted
          }
        };

        const errors = await validator.validate(config, tempDir);
        const caErrors = errors.filter(e => e.field.startsWith('settings.claudeAgent'));
        expect(caErrors).toHaveLength(0);
      });
    });

    describe('per-stage agents[].claudeAgent', () => {
      it('should validate valid per-stage model override', async () => {
        const config: PipelineConfig = {
          ...simplePipelineConfig,
          agents: [
            {
              ...simplePipelineConfig.agents[0],
              claudeAgent: {
                model: 'opus'
              }
            }
          ]
        };

        const errors = await validator.validate(config, tempDir);
        const modelErrors = errors.filter(e =>
          e.field.includes('.claudeAgent.model')
        );
        expect(modelErrors).toHaveLength(0);
      });

      it('should reject invalid per-stage model', async () => {
        const config: PipelineConfig = {
          ...simplePipelineConfig,
          agents: [
            {
              ...simplePipelineConfig.agents[0],
              claudeAgent: {
                model: 'invalid' as any
              }
            }
          ]
        };

        const errors = await validator.validate(config, tempDir);
        const modelErrors = errors.filter(e =>
          e.field.includes('.claudeAgent.model') && e.severity === 'error'
        );
        expect(modelErrors.length).toBeGreaterThan(0);
      });

      it('should validate per-stage maxTurns and maxThinkingTokens', async () => {
        const config: PipelineConfig = {
          ...simplePipelineConfig,
          agents: [
            {
              ...simplePipelineConfig.agents[0],
              claudeAgent: {
                maxTurns: 5,
                maxThinkingTokens: 10000
              }
            }
          ]
        };

        const errors = await validator.validate(config, tempDir);
        const caErrors = errors.filter(e =>
          e.field.includes('.claudeAgent') && e.severity === 'error'
        );
        expect(caErrors).toHaveLength(0);
      });

      it('should allow omitting per-stage claudeAgent (optional)', async () => {
        const config: PipelineConfig = {
          ...simplePipelineConfig,
          agents: [
            {
              ...simplePipelineConfig.agents[0]
              // claudeAgent is omitted
            }
          ]
        };

        const errors = await validator.validate(config, tempDir);
        const caErrors = errors.filter(e => e.field.includes('.claudeAgent'));
        expect(caErrors).toHaveLength(0);
      });
    });

    describe('combined global and per-stage settings', () => {
      it('should validate both global and per-stage claudeAgent settings', async () => {
        const config: PipelineConfig = {
          ...simplePipelineConfig,
          settings: {
            ...simplePipelineConfig.settings,
            claudeAgent: {
              model: 'sonnet',
              maxTurns: 10
            }
          },
          agents: [
            {
              ...simplePipelineConfig.agents[0],
              claudeAgent: {
                model: 'haiku',
                maxTurns: 5
              }
            }
          ]
        };

        const errors = await validator.validate(config, tempDir);
        const caErrors = errors.filter(e =>
          e.field.includes('claudeAgent') && e.severity === 'error'
        );
        expect(caErrors).toHaveLength(0);
      });
    });
  });

  describe('GitHub CLI validation', () => {
    beforeEach(() => {
      // Reset all mocks before each test
      vi.restoreAllMocks();
    });

    it('should not validate GitHub CLI when autoCreate is false', async () => {
      const checkGHCLISpy = vi.spyOn(ghCliChecker, 'checkGHCLI');

      const config: PipelineConfig = {
        ...simplePipelineConfig,
        git: {
          pullRequest: {
            autoCreate: false
          }
        }
      };

      const errors = await validator.validate(config, tempDir);

      // checkGHCLI should not be called when autoCreate is false
      expect(checkGHCLISpy).not.toHaveBeenCalled();
      const ghErrors = errors.filter(e => e.field === 'git.pullRequest.autoCreate');
      expect(ghErrors).toHaveLength(0);
    });

    it('should not validate GitHub CLI when autoCreate is undefined', async () => {
      const checkGHCLISpy = vi.spyOn(ghCliChecker, 'checkGHCLI');

      const config: PipelineConfig = {
        ...simplePipelineConfig,
        git: {
          pullRequest: {
            // autoCreate is undefined
          }
        }
      };

      const errors = await validator.validate(config, tempDir);

      // checkGHCLI should not be called when autoCreate is undefined
      expect(checkGHCLISpy).not.toHaveBeenCalled();
      const ghErrors = errors.filter(e => e.field === 'git.pullRequest.autoCreate');
      expect(ghErrors).toHaveLength(0);
    });

    it('should not validate GitHub CLI when git config is omitted', async () => {
      const checkGHCLISpy = vi.spyOn(ghCliChecker, 'checkGHCLI');

      const config: PipelineConfig = {
        ...simplePipelineConfig
        // git is omitted entirely
      };

      const errors = await validator.validate(config, tempDir);

      // checkGHCLI should not be called when git config is omitted
      expect(checkGHCLISpy).not.toHaveBeenCalled();
      const ghErrors = errors.filter(e => e.field === 'git.pullRequest.autoCreate');
      expect(ghErrors).toHaveLength(0);
    });

    it('should error when autoCreate is true but gh not installed', async () => {
      vi.spyOn(ghCliChecker, 'checkGHCLI').mockResolvedValue({
        installed: false,
        authenticated: false
      });

      const config: PipelineConfig = {
        ...simplePipelineConfig,
        git: {
          pullRequest: {
            autoCreate: true
          }
        }
      };

      const errors = await validator.validate(config, tempDir);

      const ghErrors = errors.filter(e =>
        e.field === 'git.pullRequest.autoCreate' && e.severity === 'error'
      );
      expect(ghErrors.length).toBeGreaterThan(0);
      expect(ghErrors[0].message).toContain('GitHub CLI (gh) is not installed');
      expect(ghErrors[0].message).toContain('https://cli.github.com/');
    });

    it('should error when autoCreate is true but gh not authenticated', async () => {
      vi.spyOn(ghCliChecker, 'checkGHCLI').mockResolvedValue({
        installed: true,
        authenticated: false
      });

      const config: PipelineConfig = {
        ...simplePipelineConfig,
        git: {
          pullRequest: {
            autoCreate: true
          }
        }
      };

      const errors = await validator.validate(config, tempDir);

      const ghErrors = errors.filter(e =>
        e.field === 'git.pullRequest.autoCreate' && e.severity === 'error'
      );
      expect(ghErrors.length).toBeGreaterThan(0);
      expect(ghErrors[0].message).toContain('GitHub CLI is not authenticated');
      expect(ghErrors[0].message).toContain('gh auth login');
    });

    it('should pass when autoCreate is true and gh is installed and authenticated', async () => {
      vi.spyOn(ghCliChecker, 'checkGHCLI').mockResolvedValue({
        installed: true,
        authenticated: true
      });

      const config: PipelineConfig = {
        ...simplePipelineConfig,
        git: {
          pullRequest: {
            autoCreate: true
          }
        }
      };

      const errors = await validator.validate(config, tempDir);

      const ghErrors = errors.filter(e => e.field === 'git.pullRequest.autoCreate');
      expect(ghErrors).toHaveLength(0);
    });
  });
});
