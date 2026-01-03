import { describe, it, expect, beforeEach } from 'vitest';
import { NotificationValidator } from '../../validators/notification-validator.js';
import { ValidationContext, ValidationError } from '../../validators/types.js';
import { PipelineConfig } from '../../config/schema.js';

describe('NotificationValidator', () => {
  let validator: NotificationValidator;
  let baseConfig: PipelineConfig;

  beforeEach(() => {
    validator = new NotificationValidator();
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

  describe('metadata', () => {
    it('should have correct name', () => {
      expect(validator.name).toBe('notifications');
    });

    it('should have priority 1 (conditional feature)', () => {
      expect(validator.priority).toBe(1);
    });
  });

  describe('shouldRun', () => {
    it('should return false when Slack is not enabled', () => {
      const context: ValidationContext = {
        config: {
          ...baseConfig,
          notifications: {
            channels: {
              slack: {
                enabled: false,
              },
            },
          },
        },
        repoPath: '/tmp/test',
        errors: [],
      };

      expect(validator.shouldRun(context)).toBe(false);
    });

    it('should return false when notifications config is undefined', () => {
      const context: ValidationContext = {
        config: baseConfig,
        repoPath: '/tmp/test',
        errors: [],
      };

      expect(validator.shouldRun(context)).toBe(false);
    });

    it('should return false when channels config is undefined', () => {
      const context: ValidationContext = {
        config: {
          ...baseConfig,
          notifications: {},
        },
        repoPath: '/tmp/test',
        errors: [],
      };

      expect(validator.shouldRun(context)).toBe(false);
    });

    it('should return false when slack config is undefined', () => {
      const context: ValidationContext = {
        config: {
          ...baseConfig,
          notifications: {
            channels: {},
          },
        },
        repoPath: '/tmp/test',
        errors: [],
      };

      expect(validator.shouldRun(context)).toBe(false);
    });

    it('should return true when Slack is enabled', () => {
      const context: ValidationContext = {
        config: {
          ...baseConfig,
          notifications: {
            channels: {
              slack: {
                enabled: true,
              },
            },
          },
        },
        repoPath: '/tmp/test',
        errors: [],
      };

      expect(validator.shouldRun(context)).toBe(true);
    });

    it('should return true when Slack is enabled with webhookUrl', () => {
      const context: ValidationContext = {
        config: {
          ...baseConfig,
          notifications: {
            channels: {
              slack: {
                enabled: true,
                webhookUrl: 'https://hooks.slack.com/services/T00000000/B00000000/XXXX',
              },
            },
          },
        },
        repoPath: '/tmp/test',
        errors: [],
      };

      expect(validator.shouldRun(context)).toBe(true);
    });
  });

  describe('validate', () => {
    describe('missing webhookUrl', () => {
      it('should error when webhookUrl is missing and Slack is enabled', async () => {
        const errors: ValidationError[] = [];
        const context: ValidationContext = {
          config: {
            ...baseConfig,
            notifications: {
              channels: {
                slack: {
                  enabled: true,
                  // webhookUrl is missing
                },
              },
            },
          },
          repoPath: '/tmp/test',
          errors,
        };

        await validator.validate(context);

        expect(errors).toHaveLength(1);
        expect(errors[0].field).toBe('notifications.channels.slack.webhookUrl');
        expect(errors[0].severity).toBe('error');
        expect(errors[0].message).toContain('Slack webhook URL is required');
        expect(errors[0].message).toContain('https://api.slack.com/messaging/webhooks');
      });

      it('should error when webhookUrl is empty string', async () => {
        const errors: ValidationError[] = [];
        const context: ValidationContext = {
          config: {
            ...baseConfig,
            notifications: {
              channels: {
                slack: {
                  enabled: true,
                  webhookUrl: '',
                },
              },
            },
          },
          repoPath: '/tmp/test',
          errors,
        };

        await validator.validate(context);

        expect(errors).toHaveLength(1);
        expect(errors[0].field).toBe('notifications.channels.slack.webhookUrl');
        expect(errors[0].severity).toBe('error');
        expect(errors[0].message).toContain('Slack webhook URL is required');
      });
    });

    describe('invalid webhookUrl format', () => {
      it('should error when webhookUrl does not start with https://hooks.slack.com/', async () => {
        const errors: ValidationError[] = [];
        const context: ValidationContext = {
          config: {
            ...baseConfig,
            notifications: {
              channels: {
                slack: {
                  enabled: true,
                  webhookUrl: 'https://example.com/webhook',
                },
              },
            },
          },
          repoPath: '/tmp/test',
          errors,
        };

        await validator.validate(context);

        expect(errors).toHaveLength(1);
        expect(errors[0].field).toBe('notifications.channels.slack.webhookUrl');
        expect(errors[0].severity).toBe('error');
        expect(errors[0].message).toContain('Invalid Slack webhook URL');
        expect(errors[0].message).toContain('Must start with https://hooks.slack.com/');
        expect(errors[0].message).toContain('https://api.slack.com/messaging/webhooks');
      });

      it('should error when webhookUrl uses http instead of https', async () => {
        const errors: ValidationError[] = [];
        const context: ValidationContext = {
          config: {
            ...baseConfig,
            notifications: {
              channels: {
                slack: {
                  enabled: true,
                  webhookUrl: 'http://hooks.slack.com/services/T00000000/B00000000/XXXX',
                },
              },
            },
          },
          repoPath: '/tmp/test',
          errors,
        };

        await validator.validate(context);

        expect(errors).toHaveLength(1);
        expect(errors[0].field).toBe('notifications.channels.slack.webhookUrl');
        expect(errors[0].severity).toBe('error');
        expect(errors[0].message).toContain('Invalid Slack webhook URL');
      });

      it('should error when webhookUrl is a random URL', async () => {
        const errors: ValidationError[] = [];
        const context: ValidationContext = {
          config: {
            ...baseConfig,
            notifications: {
              channels: {
                slack: {
                  enabled: true,
                  webhookUrl: 'https://malicious-site.com/steal-data',
                },
              },
            },
          },
          repoPath: '/tmp/test',
          errors,
        };

        await validator.validate(context);

        expect(errors).toHaveLength(1);
        expect(errors[0].severity).toBe('error');
        expect(errors[0].message).toContain('Invalid Slack webhook URL');
      });

      it('should error when webhookUrl is not a URL at all', async () => {
        const errors: ValidationError[] = [];
        const context: ValidationContext = {
          config: {
            ...baseConfig,
            notifications: {
              channels: {
                slack: {
                  enabled: true,
                  webhookUrl: 'not-a-url',
                },
              },
            },
          },
          repoPath: '/tmp/test',
          errors,
        };

        await validator.validate(context);

        expect(errors).toHaveLength(1);
        expect(errors[0].severity).toBe('error');
        expect(errors[0].message).toContain('Invalid Slack webhook URL');
      });
    });

    describe('valid webhookUrl', () => {
      it('should pass when webhookUrl is valid Slack webhook', async () => {
        const errors: ValidationError[] = [];
        const context: ValidationContext = {
          config: {
            ...baseConfig,
            notifications: {
              channels: {
                slack: {
                  enabled: true,
                  webhookUrl: 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXX',
                },
              },
            },
          },
          repoPath: '/tmp/test',
          errors,
        };

        await validator.validate(context);

        expect(errors).toHaveLength(0);
      });

      it('should pass with real-looking Slack webhook URL format', async () => {
        const errors: ValidationError[] = [];
        const context: ValidationContext = {
          config: {
            ...baseConfig,
            notifications: {
              channels: {
                slack: {
                  enabled: true,
                  webhookUrl: '',
                },
              },
            },
          },
          repoPath: '/tmp/test',
          errors,
        };

        await validator.validate(context);

        expect(errors).toHaveLength(0);
      });

      it('should pass with workflow webhook URL format', async () => {
        const errors: ValidationError[] = [];
        const context: ValidationContext = {
          config: {
            ...baseConfig,
            notifications: {
              channels: {
                slack: {
                  enabled: true,
                  webhookUrl: 'https://hooks.slack.com/workflows/T1234ABCD/A5678EFGH/1234567890/abcdefghijk',
                },
              },
            },
          },
          repoPath: '/tmp/test',
          errors,
        };

        await validator.validate(context);

        expect(errors).toHaveLength(0);
      });
    });

    describe('edge cases', () => {
      it('should not add additional errors if webhookUrl is missing (early return)', async () => {
        const errors: ValidationError[] = [];
        const context: ValidationContext = {
          config: {
            ...baseConfig,
            notifications: {
              channels: {
                slack: {
                  enabled: true,
                  // webhookUrl is missing
                },
              },
            },
          },
          repoPath: '/tmp/test',
          errors,
        };

        await validator.validate(context);

        // Should only have one error (missing URL), not two (missing + invalid)
        expect(errors).toHaveLength(1);
        expect(errors[0].message).toContain('required');
      });

      it('should handle undefined webhookUrl gracefully', async () => {
        const errors: ValidationError[] = [];
        const context: ValidationContext = {
          config: {
            ...baseConfig,
            notifications: {
              channels: {
                slack: {
                  enabled: true,
                  webhookUrl: undefined,
                },
              },
            },
          },
          repoPath: '/tmp/test',
          errors,
        };

        await validator.validate(context);

        expect(errors).toHaveLength(1);
        expect(errors[0].message).toContain('required');
      });
    });
  });
});
