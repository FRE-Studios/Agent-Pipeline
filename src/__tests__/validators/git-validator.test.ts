import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GitValidator } from '../../validators/git-validator.js';
import { ValidationContext } from '../../validators/types.js';
import { PipelineConfig } from '../../config/schema.js';
import { createMockGit } from '../mocks/simple-git.js';
import * as ghCliChecker from '../../utils/gh-cli-checker.js';

// Mock simple-git at module level
const mockGit = createMockGit();
vi.mock('simple-git', () => ({
  simpleGit: vi.fn(() => mockGit),
}));

describe('GitValidator', () => {
  let validator: GitValidator;
  let baseConfig: PipelineConfig;

  beforeEach(() => {
    validator = new GitValidator();
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

    // Reset mock implementations to defaults
    mockGit.checkIsRepo.mockResolvedValue(true);
    mockGit.getConfig.mockImplementation(async (key: string) => {
      if (key === 'user.name') return { value: 'Test User' };
      if (key === 'user.email') return { value: 'test@example.com' };
      return { value: null };
    });
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
    it('should have correct name "git"', () => {
      expect(validator.name).toBe('git');
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

  describe('validateRepository', () => {
    it('should pass when in a valid git repository', async () => {
      mockGit.checkIsRepo.mockResolvedValue(true);
      const context = createContext(baseConfig);

      await validator.validate(context);

      const repoErrors = context.errors.filter(e => e.field === 'repository');
      expect(repoErrors).toHaveLength(0);
    });

    it('should error when not a git repository', async () => {
      mockGit.checkIsRepo.mockRejectedValue(new Error('Not a git repository'));
      const context = createContext(baseConfig);

      await validator.validate(context);

      expect(context.errors).toContainEqual({
        field: 'repository',
        message: 'Not a git repository. Initialize with: git init',
        severity: 'error',
      });
    });
  });

  describe('validateUserConfig', () => {
    it('should pass when user.name and user.email are configured', async () => {
      mockGit.getConfig.mockImplementation(async (key: string) => {
        if (key === 'user.name') return { value: 'Test User' };
        if (key === 'user.email') return { value: 'test@example.com' };
        return { value: null };
      });
      const context = createContext(baseConfig);

      await validator.validate(context);

      const gitConfigErrors = context.errors.filter(e => e.field === 'git.config');
      expect(gitConfigErrors).toHaveLength(0);
    });

    it('should error when user.name is missing', async () => {
      mockGit.getConfig.mockImplementation(async (key: string) => {
        if (key === 'user.name') return { value: null };
        if (key === 'user.email') return { value: 'test@example.com' };
        return { value: null };
      });
      const context = createContext(baseConfig);

      await validator.validate(context);

      expect(context.errors).toContainEqual({
        field: 'git.config',
        message: 'Git user.name not configured. Run: git config user.name "Your Name"',
        severity: 'error',
      });
    });

    it('should error when user.email is missing', async () => {
      mockGit.getConfig.mockImplementation(async (key: string) => {
        if (key === 'user.name') return { value: 'Test User' };
        if (key === 'user.email') return { value: null };
        return { value: null };
      });
      const context = createContext(baseConfig);

      await validator.validate(context);

      expect(context.errors).toContainEqual({
        field: 'git.config',
        message: 'Git user.email not configured. Run: git config user.email "you@example.com"',
        severity: 'error',
      });
    });

    it('should error for both user.name and user.email when both are missing', async () => {
      mockGit.getConfig.mockImplementation(async () => ({ value: null }));
      const context = createContext(baseConfig);

      await validator.validate(context);

      const gitConfigErrors = context.errors.filter(e => e.field === 'git.config');
      expect(gitConfigErrors).toHaveLength(2);
      expect(gitConfigErrors.some(e => e.message.includes('user.name'))).toBe(true);
      expect(gitConfigErrors.some(e => e.message.includes('user.email'))).toBe(true);
    });

    it('should skip user config validation when autoCommit is false', async () => {
      mockGit.getConfig.mockImplementation(async () => ({ value: null }));
      const config: PipelineConfig = {
        ...baseConfig,
        git: {
          autoCommit: false,
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      const gitConfigErrors = context.errors.filter(e => e.field === 'git.config');
      expect(gitConfigErrors).toHaveLength(0);
    });

    it('should validate user config when autoCommit is true', async () => {
      mockGit.getConfig.mockImplementation(async () => ({ value: null }));
      const config: PipelineConfig = {
        ...baseConfig,
        git: {
          autoCommit: true,
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      const gitConfigErrors = context.errors.filter(e => e.field === 'git.config');
      expect(gitConfigErrors).toHaveLength(2);
    });

    it('should validate user config when autoCommit is not set (defaults to true)', async () => {
      mockGit.getConfig.mockImplementation(async () => ({ value: null }));
      const context = createContext(baseConfig);

      await validator.validate(context);

      const gitConfigErrors = context.errors.filter(e => e.field === 'git.config');
      expect(gitConfigErrors).toHaveLength(2);
    });
  });

  describe('validateStrategies - branchStrategy', () => {
    it('should pass with branchStrategy "reusable"', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        git: {
          branchStrategy: 'reusable',
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      const branchErrors = context.errors.filter(e => e.field === 'git.branchStrategy');
      expect(branchErrors).toHaveLength(0);
    });

    it('should pass with branchStrategy "unique-per-run"', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        git: {
          branchStrategy: 'unique-per-run',
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      const branchErrors = context.errors.filter(e => e.field === 'git.branchStrategy');
      expect(branchErrors).toHaveLength(0);
    });

    it('should pass with branchStrategy "unique-and-delete"', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        git: {
          branchStrategy: 'unique-and-delete',
          mergeStrategy: 'local-merge', // Avoid work-lost error
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      const branchErrors = context.errors.filter(e => e.field === 'git.branchStrategy');
      expect(branchErrors).toHaveLength(0);
    });

    it('should error on invalid branchStrategy', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        git: {
          branchStrategy: 'invalid-strategy' as any,
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toContainEqual({
        field: 'git.branchStrategy',
        message: 'Invalid branch strategy: invalid-strategy. Must be one of: reusable, unique-per-run, unique-and-delete',
        severity: 'error',
      });
    });

    it('should not validate branchStrategy when not set', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        git: {},
      };
      const context = createContext(config);

      await validator.validate(context);

      const branchErrors = context.errors.filter(e =>
        e.field === 'git.branchStrategy' && e.message.includes('Invalid branch strategy')
      );
      expect(branchErrors).toHaveLength(0);
    });
  });

  describe('validateStrategies - mergeStrategy', () => {
    it('should pass with mergeStrategy "pull-request"', async () => {
      vi.spyOn(ghCliChecker, 'checkGHCLI').mockResolvedValue({
        installed: true,
        authenticated: true,
      });
      const config: PipelineConfig = {
        ...baseConfig,
        git: {
          mergeStrategy: 'pull-request',
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      const mergeErrors = context.errors.filter(e =>
        e.field === 'git.mergeStrategy' && e.message.includes('Invalid merge strategy')
      );
      expect(mergeErrors).toHaveLength(0);
    });

    it('should pass with mergeStrategy "local-merge"', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        git: {
          mergeStrategy: 'local-merge',
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      const mergeErrors = context.errors.filter(e =>
        e.field === 'git.mergeStrategy' && e.message.includes('Invalid merge strategy')
      );
      expect(mergeErrors).toHaveLength(0);
    });

    it('should pass with mergeStrategy "none"', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        git: {
          mergeStrategy: 'none',
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      const mergeErrors = context.errors.filter(e =>
        e.field === 'git.mergeStrategy' && e.message.includes('Invalid merge strategy')
      );
      expect(mergeErrors).toHaveLength(0);
    });

    it('should error on invalid mergeStrategy', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        git: {
          mergeStrategy: 'invalid-merge' as any,
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toContainEqual({
        field: 'git.mergeStrategy',
        message: 'Invalid merge strategy: invalid-merge. Must be one of: pull-request, local-merge, none',
        severity: 'error',
      });
    });
  });

  describe('validateStrategies - unique-and-delete + none combination', () => {
    it('should error when branchStrategy is unique-and-delete and mergeStrategy is none', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        git: {
          branchStrategy: 'unique-and-delete',
          mergeStrategy: 'none',
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toContainEqual({
        field: 'git.branchStrategy',
        message:
          "Cannot use 'unique-and-delete' with 'none' merge strategy - work would be lost. " +
          "Use 'pull-request' or 'local-merge' to preserve work, or change branchStrategy to 'reusable' or 'unique-per-run'.",
        severity: 'error',
      });
    });

    it('should pass when branchStrategy is unique-and-delete and mergeStrategy is pull-request', async () => {
      vi.spyOn(ghCliChecker, 'checkGHCLI').mockResolvedValue({
        installed: true,
        authenticated: true,
      });
      const config: PipelineConfig = {
        ...baseConfig,
        git: {
          branchStrategy: 'unique-and-delete',
          mergeStrategy: 'pull-request',
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      const workLostErrors = context.errors.filter(e =>
        e.field === 'git.branchStrategy' && e.message.includes('work would be lost')
      );
      expect(workLostErrors).toHaveLength(0);
    });

    it('should pass when branchStrategy is unique-and-delete and mergeStrategy is local-merge', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        git: {
          branchStrategy: 'unique-and-delete',
          mergeStrategy: 'local-merge',
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      const workLostErrors = context.errors.filter(e =>
        e.field === 'git.branchStrategy' && e.message.includes('work would be lost')
      );
      expect(workLostErrors).toHaveLength(0);
    });
  });

  describe('validateStrategies - looping + unique-and-delete combination', () => {
    it('should error when looping is enabled and branchStrategy is unique-and-delete', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        git: {
          branchStrategy: 'unique-and-delete',
          mergeStrategy: 'pull-request',
        },
        looping: {
          enabled: true,
          maxIterations: 10,
          directories: {
            pending: '',
            running: '',
            finished: '',
            failed: '',
          },
        },
      };
      vi.spyOn(ghCliChecker, 'checkGHCLI').mockResolvedValue({
        installed: true,
        authenticated: true,
      });
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toContainEqual({
        field: 'git.branchStrategy',
        message:
          "Cannot use 'unique-and-delete' with looping enabled - worktree cleanup would delete " +
          "loop session files before they can be copied to the main repo. " +
          "Use 'reusable' or 'unique-per-run' branchStrategy instead.",
        severity: 'error',
      });
    });

    it('should pass when looping is enabled with reusable branchStrategy', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        git: {
          branchStrategy: 'reusable',
        },
        looping: {
          enabled: true,
          maxIterations: 10,
          directories: {
            pending: '',
            running: '',
            finished: '',
            failed: '',
          },
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      const loopingErrors = context.errors.filter(e =>
        e.field === 'git.branchStrategy' && e.message.includes('looping')
      );
      expect(loopingErrors).toHaveLength(0);
    });

    it('should pass when looping is disabled with unique-and-delete branchStrategy', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        git: {
          branchStrategy: 'unique-and-delete',
          mergeStrategy: 'pull-request',
        },
        looping: {
          enabled: false,
          maxIterations: 10,
          directories: {
            pending: '',
            running: '',
            finished: '',
            failed: '',
          },
        },
      };
      vi.spyOn(ghCliChecker, 'checkGHCLI').mockResolvedValue({
        installed: true,
        authenticated: true,
      });
      const context = createContext(config);

      await validator.validate(context);

      const loopingErrors = context.errors.filter(e =>
        e.field === 'git.branchStrategy' && e.message.includes('looping')
      );
      expect(loopingErrors).toHaveLength(0);
    });
  });

  describe('validateStrategies - pullRequest config warning', () => {
    it('should warn when pullRequest config exists but mergeStrategy is not pull-request', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        git: {
          mergeStrategy: 'local-merge',
          pullRequest: {
            title: 'My PR',
            body: 'Description',
          },
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toContainEqual({
        field: 'git.pullRequest',
        message:
          "pullRequest settings are configured but mergeStrategy is not 'pull-request'. " +
          'These settings will be ignored.',
        severity: 'warning',
      });
    });

    it('should not warn when pullRequest config exists and mergeStrategy is pull-request', async () => {
      vi.spyOn(ghCliChecker, 'checkGHCLI').mockResolvedValue({
        installed: true,
        authenticated: true,
      });
      const config: PipelineConfig = {
        ...baseConfig,
        git: {
          mergeStrategy: 'pull-request',
          pullRequest: {
            title: 'My PR',
            body: 'Description',
          },
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      const prWarnings = context.errors.filter(e =>
        e.field === 'git.pullRequest' && e.severity === 'warning'
      );
      expect(prWarnings).toHaveLength(0);
    });

    it('should warn when pullRequest config exists and mergeStrategy is none', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        git: {
          mergeStrategy: 'none',
          pullRequest: {
            title: 'My PR',
          },
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors.some(e =>
        e.field === 'git.pullRequest' &&
        e.severity === 'warning' &&
        e.message.includes('will be ignored')
      )).toBe(true);
    });
  });

  describe('validateGitHubCLI', () => {
    it('should error when gh is not installed', async () => {
      vi.spyOn(ghCliChecker, 'checkGHCLI').mockResolvedValue({
        installed: false,
        authenticated: false,
      });
      const config: PipelineConfig = {
        ...baseConfig,
        git: {
          mergeStrategy: 'pull-request',
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toContainEqual({
        field: 'git.mergeStrategy',
        message:
          "GitHub CLI (gh) is not installed. Install from https://cli.github.com/ or change mergeStrategy to 'local-merge' or 'none'",
        severity: 'error',
      });
    });

    it('should error when gh is installed but not authenticated', async () => {
      vi.spyOn(ghCliChecker, 'checkGHCLI').mockResolvedValue({
        installed: true,
        authenticated: false,
      });
      const config: PipelineConfig = {
        ...baseConfig,
        git: {
          mergeStrategy: 'pull-request',
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toContainEqual({
        field: 'git.mergeStrategy',
        message:
          "GitHub CLI is not authenticated. Run 'gh auth login' or change mergeStrategy to 'local-merge' or 'none'",
        severity: 'error',
      });
    });

    it('should pass when gh is installed and authenticated', async () => {
      vi.spyOn(ghCliChecker, 'checkGHCLI').mockResolvedValue({
        installed: true,
        authenticated: true,
      });
      const config: PipelineConfig = {
        ...baseConfig,
        git: {
          mergeStrategy: 'pull-request',
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      const ghErrors = context.errors.filter(e =>
        e.field === 'git.mergeStrategy' && e.message.includes('GitHub CLI')
      );
      expect(ghErrors).toHaveLength(0);
    });

    it('should not check gh CLI when mergeStrategy is local-merge', async () => {
      const checkGHCLISpy = vi.spyOn(ghCliChecker, 'checkGHCLI');
      const config: PipelineConfig = {
        ...baseConfig,
        git: {
          mergeStrategy: 'local-merge',
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(checkGHCLISpy).not.toHaveBeenCalled();
    });

    it('should not check gh CLI when mergeStrategy is none', async () => {
      const checkGHCLISpy = vi.spyOn(ghCliChecker, 'checkGHCLI');
      const config: PipelineConfig = {
        ...baseConfig,
        git: {
          mergeStrategy: 'none',
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(checkGHCLISpy).not.toHaveBeenCalled();
    });

    it('should not check gh CLI when mergeStrategy is not set', async () => {
      const checkGHCLISpy = vi.spyOn(ghCliChecker, 'checkGHCLI');
      const config: PipelineConfig = {
        ...baseConfig,
        git: {},
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(checkGHCLISpy).not.toHaveBeenCalled();
    });

    it('should not check gh CLI when git config is not present', async () => {
      const checkGHCLISpy = vi.spyOn(ghCliChecker, 'checkGHCLI');
      const context = createContext(baseConfig);

      await validator.validate(context);

      expect(checkGHCLISpy).not.toHaveBeenCalled();
    });
  });

  describe('validate - no git config', () => {
    it('should skip strategy validation when git config is not present', async () => {
      const context = createContext(baseConfig);

      await validator.validate(context);

      const strategyErrors = context.errors.filter(e =>
        e.field.startsWith('git.') && !e.field.includes('config')
      );
      expect(strategyErrors).toHaveLength(0);
    });
  });

  describe('validateCommitSettings - commitPrefix warning', () => {
    it('should warn when commitPrefix has no template variables at all', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        git: {
          commitPrefix: '[static-prefix]',
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toContainEqual({
        field: 'git.commitPrefix',
        message: 'commitPrefix should include template variables (e.g., {{stage}}, {{pipelineName}})',
        severity: 'warning',
      });
    });

    it('should not warn when commitPrefix includes {{stage}}', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        git: {
          commitPrefix: '[pipeline:{{stage}}]',
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      const prefixWarnings = context.errors.filter(
        e => e.field === 'git.commitPrefix' && e.severity === 'warning'
      );
      expect(prefixWarnings).toHaveLength(0);
    });

    it('should not warn when commitPrefix includes {{pipelineName}}', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        git: {
          commitPrefix: '[{{pipelineName}}]',
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      const prefixWarnings = context.errors.filter(
        e => e.field === 'git.commitPrefix' && e.severity === 'warning'
      );
      expect(prefixWarnings).toHaveLength(0);
    });

    it('should not warn when commitPrefix is not set', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        git: {},
      };
      const context = createContext(config);

      await validator.validate(context);

      const prefixWarnings = context.errors.filter(
        e => e.field === 'git.commitPrefix' && e.severity === 'warning'
      );
      expect(prefixWarnings).toHaveLength(0);
    });

    it('should warn when commitPrefix includes unknown template variables', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        git: {
          commitPrefix: '[{{pipelineName}}:{{unknownVar}}]',
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toContainEqual({
        field: 'git.commitPrefix',
        message: 'Unknown template variable(s) in commitPrefix: {{unknownVar}}',
        severity: 'warning',
      });
    });

    it('should warn when pullRequest.title includes unknown template variables', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        git: {
          pullRequest: {
            title: 'Pipeline {{pipelineName}} / {{badVar}}',
          },
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toContainEqual({
        field: 'git.pullRequest.title',
        message: 'Unknown template variable(s) in pullRequest.title: {{badVar}}',
        severity: 'warning',
      });
    });

    it('should warn when pullRequest.body includes unknown template variables', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        git: {
          pullRequest: {
            body: 'Branch {{branch}} / {{stage}}',
          },
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      expect(context.errors).toContainEqual({
        field: 'git.pullRequest.body',
        message: 'Unknown template variable(s) in pullRequest.body: {{stage}}',
        severity: 'warning',
      });
    });

    it('should not warn when pullRequest templates only use run-level variables', async () => {
      const config: PipelineConfig = {
        ...baseConfig,
        git: {
          pullRequest: {
            title: 'Pipeline {{pipelineName}}',
            body: 'Run {{runId}} on {{branch}}',
          },
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      const prTemplateWarnings = context.errors.filter(
        e =>
          (e.field === 'git.pullRequest.title' || e.field === 'git.pullRequest.body') &&
          e.severity === 'warning'
      );
      expect(prTemplateWarnings).toHaveLength(0);
    });
  });

  describe('validate - multiple errors', () => {
    it('should collect multiple validation errors', async () => {
      mockGit.getConfig.mockImplementation(async () => ({ value: null }));
      vi.spyOn(ghCliChecker, 'checkGHCLI').mockResolvedValue({
        installed: false,
        authenticated: false,
      });
      const config: PipelineConfig = {
        ...baseConfig,
        git: {
          branchStrategy: 'invalid' as any,
          mergeStrategy: 'pull-request',
        },
      };
      const context = createContext(config);

      await validator.validate(context);

      // Should have: user.name error, user.email error, branchStrategy error, gh not installed error
      expect(context.errors.length).toBeGreaterThanOrEqual(4);
      expect(context.errors.some(e => e.field === 'git.config' && e.message.includes('user.name'))).toBe(true);
      expect(context.errors.some(e => e.field === 'git.config' && e.message.includes('user.email'))).toBe(true);
      expect(context.errors.some(e => e.field === 'git.branchStrategy')).toBe(true);
      expect(context.errors.some(e => e.field === 'git.mergeStrategy' && e.message.includes('GitHub CLI'))).toBe(true);
    });
  });
});
