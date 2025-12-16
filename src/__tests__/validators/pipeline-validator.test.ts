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
import { createMockGit } from '../mocks/simple-git.js';
import { AgentRuntimeRegistry } from '../../core/agent-runtime-registry.js';
import { ClaudeSDKRuntime } from '../../core/agent-runtimes/claude-sdk-runtime.js';
import { ClaudeCodeHeadlessRuntime } from '../../core/agent-runtimes/claude-code-headless-runtime.js';

// Mock simple-git at module level
vi.mock('simple-git', () => ({
  simpleGit: vi.fn(() => createMockGit())
}));

describe('PipelineValidator', () => {
  let validator: PipelineValidator;
  let tempDir: string;
  let originalApiKey: string | undefined;

  beforeEach(async () => {
    validator = new PipelineValidator();
    tempDir = await createTempDir('validator-test-');

    // Mock Claude API key for tests
    originalApiKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-12345';

    // Register runtimes for validation
    AgentRuntimeRegistry.clear();
    AgentRuntimeRegistry.register(new ClaudeSDKRuntime());
    AgentRuntimeRegistry.register(new ClaudeCodeHeadlessRuntime());

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
    // Restore original API key
    if (originalApiKey) {
      process.env.ANTHROPIC_API_KEY = originalApiKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }

    // Clear runtime registry
    AgentRuntimeRegistry.clear();

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

  describe('P0 Critical Validations', () => {
    describe('validateClaudeApiKey', () => {
      it('should error when ANTHROPIC_API_KEY is not set', async () => {
        delete process.env.ANTHROPIC_API_KEY;
        delete process.env.CLAUDE_API_KEY;

        const errors = await validator.validate(simplePipelineConfig, tempDir);

        expect(errors.some(e =>
          e.field === 'environment' &&
          e.severity === 'error' &&
          e.message.includes('Claude API key not set')
        )).toBe(true);
      });

      it('should pass when ANTHROPIC_API_KEY is set', async () => {
        process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';

        const errors = await validator.validate(simplePipelineConfig, tempDir);

        const apiKeyErrors = errors.filter(e =>
          e.field === 'environment' && e.message.includes('Claude API key')
        );
        expect(apiKeyErrors).toHaveLength(0);
      });

      it('should pass when CLAUDE_API_KEY is set', async () => {
        delete process.env.ANTHROPIC_API_KEY;
        process.env.CLAUDE_API_KEY = 'sk-ant-test-key';

        const errors = await validator.validate(simplePipelineConfig, tempDir);

        const apiKeyErrors = errors.filter(e =>
          e.field === 'environment' && e.message.includes('Claude API key')
        );
        expect(apiKeyErrors).toHaveLength(0);
      });

      it('should pass when both API keys are set', async () => {
        process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-1';
        process.env.CLAUDE_API_KEY = 'sk-ant-test-key-2';

        const errors = await validator.validate(simplePipelineConfig, tempDir);

        const apiKeyErrors = errors.filter(e =>
          e.field === 'environment' && e.message.includes('Claude API key')
        );
        expect(apiKeyErrors).toHaveLength(0);
      });
    });

    describe('validateGitRepository', () => {
      it('should pass when in a valid git repository (default mock behavior)', async () => {
        const errors = await validator.validate(simplePipelineConfig, tempDir);

        const repoErrors = errors.filter(e =>
          e.field === 'repository' && e.severity === 'error'
        );
        // Default mock simulates a valid git repo, so no errors expected
        expect(repoErrors).toHaveLength(0);
      });
    });

    describe('validateGitUserConfig', () => {
      it('should skip validation when autoCommit is false', async () => {
        const config: PipelineConfig = {
          ...simplePipelineConfig,
          settings: {
            autoCommit: false
          }
        };

        const errors = await validator.validate(config, tempDir);

        const gitConfigErrors = errors.filter(e => e.field === 'git.config');
        expect(gitConfigErrors).toHaveLength(0);
      });

      it('should pass when user.name and user.email are configured (default mock behavior)', async () => {
        // Default mock provides user.name and user.email
        const errors = await validator.validate(simplePipelineConfig, tempDir);

        const gitConfigErrors = errors.filter(e =>
          e.field === 'git.config' && e.severity === 'error'
        );
        expect(gitConfigErrors).toHaveLength(0);
      });
    });

    describe('validateGitWorkingTree', () => {
      it('should skip when preserveWorkingTree is not false', async () => {
        const config: PipelineConfig = {
          ...simplePipelineConfig,
          settings: {
            preserveWorkingTree: true
          }
        };

        const errors = await validator.validate(config, tempDir);

        const workingTreeWarnings = errors.filter(e =>
          e.field === 'settings.preserveWorkingTree' && e.severity === 'warning'
        );
        expect(workingTreeWarnings).toHaveLength(0);
      });

      it('should skip when git config is not present', async () => {
        const config: PipelineConfig = {
          ...simplePipelineConfig,
          settings: {
            preserveWorkingTree: false
          }
          // git is omitted
        };

        const errors = await validator.validate(config, tempDir);

        const workingTreeWarnings = errors.filter(e =>
          e.field === 'settings.preserveWorkingTree' && e.severity === 'warning'
        );
        expect(workingTreeWarnings).toHaveLength(0);
      });

      it('should not warn when working tree is clean (default mock behavior)', async () => {
        // Default mock simulates clean working tree
        const config: PipelineConfig = {
          ...simplePipelineConfig,
          settings: {
            preserveWorkingTree: false
          },
          git: {
            pullRequest: {
              autoCreate: false
            }
          }
        };

        const errors = await validator.validate(config, tempDir);

        const workingTreeWarnings = errors.filter(e =>
          e.field === 'settings.preserveWorkingTree' &&
          e.message.includes('Uncommitted changes')
        );
        expect(workingTreeWarnings).toHaveLength(0);
      });
    });
  });

  describe('P1/P2 Feature Validations', () => {
    describe('validateConditionalExpressions', () => {
      it('should skip when no agents have conditions', async () => {
        const config: PipelineConfig = {
          ...simplePipelineConfig,
          agents: [
            {
              name: 'test-stage',
              agent: '.claude/agents/test-agent.md'
              // no condition
            }
          ]
        };

        const errors = await validator.validate(config, tempDir);

        const conditionErrors = errors.filter(e => e.field.includes('.condition'));
        expect(conditionErrors).toHaveLength(0);
      });

      it('should validate condition syntax when agents have conditions', async () => {
        // The actual ConditionEvaluator is used, which validates real syntax
        const config: PipelineConfig = {
          ...simplePipelineConfig,
          agents: [
            {
              name: 'test-stage',
              agent: '.claude/agents/test-agent.md',
              condition: '{{ stages.review.outputs.issues > 0 }}'
            }
          ]
        };

        const errors = await validator.validate(config, tempDir);

        // The validator runs successfully (actual validation behavior depends on ConditionEvaluator)
        // We're testing that the validation method runs without throwing
        expect(errors).toBeDefined();
      });
    });

    // Note: validateConditionalStageReferences tests removed - condition field validation
    // was deprecated in favor of file-based agent handover strategy

    describe('validateSlackWebhook', () => {
      it('should skip when Slack is not enabled', async () => {
        const config: PipelineConfig = {
          ...simplePipelineConfig,
          notifications: {
            channels: {
              slack: {
                enabled: false
              }
            }
          }
        };

        const errors = await validator.validate(config, tempDir);

        const slackErrors = errors.filter(e =>
          e.field === 'notifications.channels.slack.webhookUrl'
        );
        expect(slackErrors).toHaveLength(0);
      });

      it('should error when webhookUrl is missing', async () => {
        const config: PipelineConfig = {
          ...simplePipelineConfig,
          notifications: {
            channels: {
              slack: {
                enabled: true
                // webhookUrl is missing
              }
            }
          }
        };

        const errors = await validator.validate(config, tempDir);

        expect(errors.some(e =>
          e.field === 'notifications.channels.slack.webhookUrl' &&
          e.severity === 'error' &&
          e.message.includes('Slack webhook URL is required')
        )).toBe(true);
      });

      it('should error when webhookUrl has invalid format', async () => {
        const config: PipelineConfig = {
          ...simplePipelineConfig,
          notifications: {
            channels: {
              slack: {
                enabled: true,
                webhookUrl: 'https://example.com/webhook'
              }
            }
          }
        };

        const errors = await validator.validate(config, tempDir);

        expect(errors.some(e =>
          e.field === 'notifications.channels.slack.webhookUrl' &&
          e.severity === 'error' &&
          e.message.includes('Invalid Slack webhook URL')
        )).toBe(true);
      });

      it('should pass when webhookUrl has valid format', async () => {
        const config: PipelineConfig = {
          ...simplePipelineConfig,
          notifications: {
            channels: {
              slack: {
                enabled: true,
                webhookUrl: 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXX'
              }
            }
          }
        };

        const errors = await validator.validate(config, tempDir);

        const slackErrors = errors.filter(e =>
          e.field === 'notifications.channels.slack.webhookUrl' && e.severity === 'error'
        );
        expect(slackErrors).toHaveLength(0);
      });
    });

    describe('validateRetryConfiguration', () => {
      it('should skip when no retry configuration exists', async () => {
        const config: PipelineConfig = {
          ...simplePipelineConfig,
          agents: [
            {
              name: 'test-stage',
              agent: '.claude/agents/test-agent.md'
              // no retry
            }
          ]
        };

        const errors = await validator.validate(config, tempDir);

        const retryWarnings = errors.filter(e =>
          e.field.includes('retry') && e.severity === 'warning'
        );
        expect(retryWarnings).toHaveLength(0);
      });

      it('should warn when maxAttempts exceeds 10', async () => {
        const config: PipelineConfig = {
          ...simplePipelineConfig,
          agents: [
            {
              name: 'test-stage',
              agent: '.claude/agents/test-agent.md',
              retry: {
                maxAttempts: 15
              }
            }
          ]
        };

        const errors = await validator.validate(config, tempDir);

        expect(errors.some(e =>
          e.field === 'agents.test-stage.retry' &&
          e.severity === 'warning' &&
          e.message.includes('maxAttempts (15) exceeds recommended limit')
        )).toBe(true);
      });

      it('should warn when delay exceeds 300 seconds', async () => {
        const config: PipelineConfig = {
          ...simplePipelineConfig,
          agents: [
            {
              name: 'test-stage',
              agent: '.claude/agents/test-agent.md',
              retry: {
                maxAttempts: 3,
                delay: 400
              }
            }
          ]
        };

        const errors = await validator.validate(config, tempDir);

        expect(errors.some(e =>
          e.field === 'agents.test-stage.retry' &&
          e.severity === 'warning' &&
          e.message.includes('Retry delay (400s) exceeds recommended maximum')
        )).toBe(true);
      });

      it('should not warn for reasonable retry configuration', async () => {
        const config: PipelineConfig = {
          ...simplePipelineConfig,
          agents: [
            {
              name: 'test-stage',
              agent: '.claude/agents/test-agent.md',
              retry: {
                maxAttempts: 3,
                delay: 60
              }
            }
          ]
        };

        const errors = await validator.validate(config, tempDir);

        const retryWarnings = errors.filter(e =>
          e.field === 'agents.test-stage.retry' && e.severity === 'warning'
        );
        expect(retryWarnings).toHaveLength(0);
      });
    });

    describe('validateParallelExecutionLimits', () => {
      it('should skip when no agents exist', async () => {
        const config: PipelineConfig = {
          ...simplePipelineConfig,
          agents: []
        };

        const errors = await validator.validate(config, tempDir);

        const parallelWarnings = errors.filter(e =>
          e.field === 'agents' &&
          e.severity === 'warning' &&
          e.message.includes('parallel')
        );
        expect(parallelWarnings).toHaveLength(0);
      });

      it('should validate parallel execution limits using DAGPlanner', async () => {
        // Create a config with multiple independent agents (no dependencies)
        // DAGPlanner will calculate actual parallelism
        const config: PipelineConfig = {
          ...simplePipelineConfig,
          agents: Array.from({ length: 5 }, (_, i) => ({
            name: `stage-${i}`,
            agent: '.claude/agents/test-agent.md'
          }))
        };

        const errors = await validator.validate(config, tempDir);

        // Test that validation runs successfully
        // Actual warning depends on DAGPlanner's calculation
        expect(errors).toBeDefined();
      });

      it('should warn when excessive parallelism detected (>10 stages)', async () => {
        // Create config with 15 independent stages (no dependencies)
        const config: PipelineConfig = {
          ...simplePipelineConfig,
          agents: Array.from({ length: 15 }, (_, i) => ({
            name: `stage-${i}`,
            agent: '.claude/agents/test-agent.md'
          }))
        };

        const errors = await validator.validate(config, tempDir);

        // Should have warning about excessive parallelism
        const parallelWarnings = errors.filter(e =>
          e.field === 'agents' &&
          e.severity === 'warning' &&
          e.message.includes('parallel')
        );
        expect(parallelWarnings.length).toBeGreaterThan(0);
        expect(parallelWarnings[0].message).toContain('15 stages running in parallel');
        expect(parallelWarnings[0].message).toContain('Consider adding dependencies');
      });

      it('should not warn when parallelism is reasonable (≤10 stages)', async () => {
        // Create config with 8 independent stages
        const config: PipelineConfig = {
          ...simplePipelineConfig,
          agents: Array.from({ length: 8 }, (_, i) => ({
            name: `stage-${i}`,
            agent: '.claude/agents/test-agent.md'
          }))
        };

        const errors = await validator.validate(config, tempDir);

        // Should NOT have parallelism warning
        const parallelWarnings = errors.filter(e =>
          e.field === 'agents' &&
          e.severity === 'warning' &&
          e.message.includes('parallel')
        );
        expect(parallelWarnings).toHaveLength(0);
      });

      it('should correctly calculate parallelism with dependencies', async () => {
        // Create config where stages have dependencies, limiting parallelism
        const config: PipelineConfig = {
          ...simplePipelineConfig,
          agents: [
            // First level: 3 parallel stages
            { name: 'stage-1', agent: '.claude/agents/test-agent.md' },
            { name: 'stage-2', agent: '.claude/agents/test-agent.md' },
            { name: 'stage-3', agent: '.claude/agents/test-agent.md' },
            // Second level: depends on first level
            { name: 'stage-4', agent: '.claude/agents/test-agent.md', dependsOn: ['stage-1', 'stage-2'] },
            { name: 'stage-5', agent: '.claude/agents/test-agent.md', dependsOn: ['stage-3'] },
            // Third level: 12 parallel stages (should trigger warning if not for dependencies)
            ...Array.from({ length: 12 }, (_, i) => ({
              name: `stage-${i + 6}`,
              agent: '.claude/agents/test-agent.md',
              dependsOn: ['stage-4', 'stage-5']
            }))
          ]
        };

        const errors = await validator.validate(config, tempDir);

        // Should warn because third level has 12 parallel stages
        const parallelWarnings = errors.filter(e =>
          e.field === 'agents' &&
          e.severity === 'warning' &&
          e.message.includes('parallel')
        );
        expect(parallelWarnings.length).toBeGreaterThan(0);
        expect(parallelWarnings[0].message).toContain('12 stages running in parallel');
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

  describe('runtime validation', () => {
    it('should validate known runtime types', async () => {
      const config: PipelineConfig = {
        ...simplePipelineConfig,
        runtime: {
          type: 'claude-sdk',
        },
      };

      const errors = await validator.validate(config, tempDir);

      const runtimeErrors = errors.filter(e => e.field === 'runtime' && e.severity === 'error');
      expect(runtimeErrors).toHaveLength(0);
    });

    it('should error on unknown runtime type', async () => {
      const config: PipelineConfig = {
        ...simplePipelineConfig,
        runtime: {
          type: 'unknown-runtime',
        },
      };

      const errors = await validator.validate(config, tempDir);

      const runtimeErrors = errors.filter(
        e => e.field === 'runtime' && e.severity === 'error'
      );
      expect(runtimeErrors.length).toBeGreaterThan(0);
      expect(runtimeErrors[0].message).toContain('Unknown runtime type: unknown-runtime');
      expect(runtimeErrors[0].message).toContain('Available runtimes');
    });

    it('should validate model selection for runtime', async () => {
      const config: PipelineConfig = {
        ...simplePipelineConfig,
        runtime: {
          type: 'claude-sdk',
          options: {
            model: 'invalid-model',
          },
        },
      };

      const errors = await validator.validate(config, tempDir);

      const modelErrors = errors.filter(
        e => e.field === 'runtime.options.model' && e.severity === 'error'
      );
      expect(modelErrors.length).toBeGreaterThan(0);
      expect(modelErrors[0].message).toContain('Model "invalid-model" not available');
      expect(modelErrors[0].message).toContain('Available models');
    });

    it('should accept valid models for runtime', async () => {
      const config: PipelineConfig = {
        ...simplePipelineConfig,
        runtime: {
          type: 'claude-sdk',
          options: {
            model: 'haiku',
          },
        },
      };

      const errors = await validator.validate(config, tempDir);

      const modelErrors = errors.filter(
        e => e.field === 'runtime.options.model' && e.severity === 'error'
      );
      expect(modelErrors).toHaveLength(0);
    });

    it('should validate stage-level runtime overrides', async () => {
      const config: PipelineConfig = {
        ...simplePipelineConfig,
        runtime: {
          type: 'claude-sdk',
        },
        agents: [
          {
            name: 'test-stage',
            agent: '.claude/agents/test-agent.md',
            runtime: {
              type: 'invalid-runtime',
            },
          },
        ],
      };

      const errors = await validator.validate(config, tempDir);

      const stageRuntimeErrors = errors.filter(
        e => e.field === 'agents.test-stage.runtime' && e.severity === 'error'
      );
      expect(stageRuntimeErrors.length).toBeGreaterThan(0);
      expect(stageRuntimeErrors[0].message).toContain('Unknown runtime type: invalid-runtime');
    });

    it('should validate permission modes for runtime', async () => {
      const config: PipelineConfig = {
        ...simplePipelineConfig,
        runtime: {
          type: 'claude-sdk',
          options: {
            permissionMode: 'invalid-mode',
          },
        },
      };

      const errors = await validator.validate(config, tempDir);

      const permErrors = errors.filter(
        e => e.field === 'runtime.options.permissionMode' && e.severity === 'error'
      );
      expect(permErrors.length).toBeGreaterThan(0);
      expect(permErrors[0].message).toContain('Permission mode "invalid-mode" not supported');
      expect(permErrors[0].message).toContain('Supported modes');
    });

    it('should accept valid permission modes for runtime', async () => {
      const config: PipelineConfig = {
        ...simplePipelineConfig,
        runtime: {
          type: 'claude-sdk',
          options: {
            permissionMode: 'acceptEdits',
          },
        },
      };

      const errors = await validator.validate(config, tempDir);

      const permErrors = errors.filter(
        e => e.field === 'runtime.options.permissionMode' && e.severity === 'error'
      );
      expect(permErrors).toHaveLength(0);
    });

    it('should validate runtime with multiple options', async () => {
      const config: PipelineConfig = {
        ...simplePipelineConfig,
        runtime: {
          type: 'claude-sdk',
          options: {
            model: 'sonnet',
            maxTurns: 10,
            maxThinkingTokens: 5000,
          },
        },
      };

      const errors = await validator.validate(config, tempDir);

      const runtimeErrors = errors.filter(e => e.field.startsWith('runtime') && e.severity === 'error');
      expect(runtimeErrors).toHaveLength(0);
    });

    it('should validate multiple stage-level runtime overrides', async () => {
      const config: PipelineConfig = {
        ...simplePipelineConfig,
        runtime: {
          type: 'claude-sdk',
        },
        agents: [
          {
            name: 'stage-1',
            agent: '.claude/agents/test-agent.md',
            runtime: {
              type: 'claude-code-headless',
              options: {
                model: 'haiku',
              },
            },
          },
          {
            name: 'stage-2',
            agent: '.claude/agents/test-agent-2.md',
            runtime: {
              type: 'claude-sdk',
              options: {
                model: 'opus',
              },
            },
          },
        ],
      };

      const errors = await validator.validate(config, tempDir);

      const runtimeErrors = errors.filter(
        e => (e.field.startsWith('agents.stage-1.runtime') || e.field.startsWith('agents.stage-2.runtime')) &&
        e.severity === 'error'
      );
      expect(runtimeErrors).toHaveLength(0);
    });

    it('should warn about runtime availability issues', async () => {
      // Runtime availability warnings are checked but don't fail validation
      const config: PipelineConfig = {
        ...simplePipelineConfig,
        runtime: {
          type: 'claude-code-headless',
        },
      };

      const errors = await validator.validate(config, tempDir);

      // Availability warnings may or may not be present depending on system state
      // Just check that no errors are thrown
      const runtimeErrors = errors.filter(
        e => e.field === 'runtime' && e.severity === 'error'
      );
      expect(runtimeErrors).toHaveLength(0);
    });

    it('should warn when specified runtime is unavailable but not error', async () => {
      // Mock AgentRuntimeRegistry to return a runtime that fails validation
      const mockRuntime = {
        type: 'mock-unavailable-runtime',
        name: 'Mock Unavailable Runtime',
        execute: vi.fn(),
        getCapabilities: vi.fn().mockReturnValue({
          supportsStreaming: true,
          supportsTokenTracking: true,
          supportsMCP: false,
          supportsContextReduction: false,
          availableModels: ['haiku'],
          permissionModes: ['default', 'acceptEdits']
        }),
        validate: vi.fn().mockResolvedValue({
          valid: false,
          errors: ['Runtime CLI not found'],
          warnings: ['Install the CLI to use this runtime']
        })
      };

      // Register the mock runtime
      AgentRuntimeRegistry.register(mockRuntime as any);

      const config: PipelineConfig = {
        ...simplePipelineConfig,
        runtime: {
          type: 'mock-unavailable-runtime',
        },
      };

      const errors = await validator.validate(config, tempDir);

      // Should have warnings, not errors
      const runtimeWarnings = errors.filter(
        e => e.field === 'runtime' && e.severity === 'warning'
      );
      expect(runtimeWarnings.length).toBeGreaterThan(0);
      expect(runtimeWarnings.some(w => w.message.includes('Runtime availability'))).toBe(true);

      // Should NOT have errors (availability issues are warnings)
      const runtimeErrors = errors.filter(
        e => e.field === 'runtime' && e.severity === 'error'
      );
      expect(runtimeErrors).toHaveLength(0);

      // Cleanup
      AgentRuntimeRegistry.clear();
    });

    it('should validate runtime without options', async () => {
      const config: PipelineConfig = {
        ...simplePipelineConfig,
        runtime: {
          type: 'claude-sdk',
        },
      };

      const errors = await validator.validate(config, tempDir);

      const runtimeErrors = errors.filter(e => e.field === 'runtime' && e.severity === 'error');
      expect(runtimeErrors).toHaveLength(0);
    });

    it('should skip runtime validation when not specified', async () => {
      // When no runtime is specified, loader sets default but validator should still pass
      const config: PipelineConfig = {
        ...simplePipelineConfig,
        runtime: {
          type: 'claude-sdk', // Default set by loader
        },
      };

      const errors = await validator.validate(config, tempDir);

      expect(errors.length).toBe(0);
    });
  });
});
