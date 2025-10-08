import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  prPipelineStateCompleted,
  prPipelineStatePartial,
  prPipelineStateWithRetries,
  prPipelineStateSingleStage,
  prPipelineStateNoCommits,
} from '../fixtures/pr-states.js';
import {
  ghVersionOutput,
  ghAuthStatusOutput,
  ghAuthStatusNotAuthenticated,
  ghVersionNotInstalled,
  ghPrCreateSuccess,
  ghPrAlreadyExistsError,
  ghPrCreateGenericError,
  ghPrViewOutput,
  ghPrViewNotFound,
  ghPrCreateNoUrl,
  ghPrCreateNoNumber,
} from '../fixtures/gh-outputs.js';

// Create a mock execAsync using vi.hoisted to ensure it's available during hoisting
const mockExecAsync = vi.hoisted(() => {
  return vi.fn();
});

// Mock util.promisify to return our mock
vi.mock('util', () => ({
  promisify: () => mockExecAsync,
}));

// Mock child_process
vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

// Import after mocks
import { PRCreator } from '../../core/pr-creator.js';

// Helper to configure mock responses
function configureMockExec(config: {
  version?: any;
  auth?: any;
  prCreate?: any;
  prView?: any;
  default?: any;
}) {
  mockExecAsync.mockImplementation((command: string) => {
    if (command.includes('gh --version')) {
      return config.version instanceof Error
        ? Promise.reject(config.version)
        : Promise.resolve(config.version || ghVersionOutput);
    }
    if (command.includes('gh auth status')) {
      return config.auth instanceof Error
        ? Promise.reject(config.auth)
        : Promise.resolve(config.auth || ghAuthStatusOutput);
    }
    if (command.includes('gh pr create')) {
      return config.prCreate instanceof Error
        ? Promise.reject(config.prCreate)
        : Promise.resolve(config.prCreate || ghPrCreateSuccess);
    }
    if (command.includes('gh pr view')) {
      return config.prView instanceof Error
        ? Promise.reject(config.prView)
        : Promise.resolve(config.prView || ghPrViewOutput);
    }
    return config.default instanceof Error
      ? Promise.reject(config.default)
      : Promise.resolve(config.default || { stdout: '' });
  });
}

describe('PRCreator', () => {
  let prCreator: PRCreator;
  let consoleLogSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default configuration
    configureMockExec({
      version: ghVersionOutput,
      auth: ghAuthStatusOutput,
      prCreate: ghPrCreateSuccess,
      prView: ghPrViewOutput,
    });
    prCreator = new PRCreator();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  describe('constructor', () => {
    it('should initialize PRCreator instance', () => {
      const creator = new PRCreator();
      expect(creator).toBeInstanceOf(PRCreator);
    });

    it('should create instance without errors', () => {
      expect(() => new PRCreator()).not.toThrow();
    });
  });

  describe('checkGHCLI', () => {
    it('should return installed and authenticated when both succeed', async () => {
      const result = await prCreator.checkGHCLI();

      expect(result).toEqual({ installed: true, authenticated: true });
      expect(mockExecAsync).toHaveBeenCalledWith('gh --version');
      expect(mockExecAsync).toHaveBeenCalledWith('gh auth status');
    });

    it('should return installed but not authenticated when auth fails', async () => {
      configureMockExec({
        version: ghVersionOutput,
        auth: ghAuthStatusNotAuthenticated,
      });

      const result = await prCreator.checkGHCLI();

      expect(result).toEqual({ installed: true, authenticated: false });
    });

    it('should return not installed when gh --version fails', async () => {
      configureMockExec({
        version: ghVersionNotInstalled,
      });

      const result = await prCreator.checkGHCLI();

      expect(result).toEqual({ installed: false, authenticated: false });
    });

    it('should handle gh --version command execution', async () => {
      await prCreator.checkGHCLI();

      expect(mockExecAsync).toHaveBeenCalledWith('gh --version');
    });

    it('should handle gh auth status command execution', async () => {
      await prCreator.checkGHCLI();

      expect(mockExecAsync).toHaveBeenCalledWith('gh auth status');
    });

    it('should catch errors gracefully for both checks', async () => {
      configureMockExec({
        version: new Error('Unexpected error'),
        auth: new Error('Unexpected error'),
      });

      const result = await prCreator.checkGHCLI();

      expect(result).toEqual({ installed: false, authenticated: false });
    });
  });

  describe('createPR - Prerequisites', () => {
    it('should throw error when gh CLI not installed', async () => {
      configureMockExec({
        version: ghVersionNotInstalled,
      });

      await expect(
        prCreator.createPR(
          'feature-branch',
          'main',
          {},
          prPipelineStateCompleted
        )
      ).rejects.toThrow('GitHub CLI (gh) is not installed');
    });

    it('should throw error when gh CLI not authenticated', async () => {
      configureMockExec({
        version: ghVersionOutput,
        auth: ghAuthStatusNotAuthenticated,
      });

      await expect(
        prCreator.createPR(
          'feature-branch',
          'main',
          {},
          prPipelineStateCompleted
        )
      ).rejects.toThrow('GitHub CLI is not authenticated');
    });

    it('should include installation instructions in error message', async () => {
      configureMockExec({
        version: ghVersionNotInstalled,
      });

      try {
        await prCreator.createPR(
          'feature-branch',
          'main',
          {},
          prPipelineStateCompleted
        );
      } catch (error: any) {
        expect(error.message).toContain('https://cli.github.com');
        expect(error.message).toContain('--no-pr');
      }
    });

    it('should include auth instructions in error message', async () => {
      configureMockExec({
        version: ghVersionOutput,
        auth: ghAuthStatusNotAuthenticated,
      });

      try {
        await prCreator.createPR(
          'feature-branch',
          'main',
          {},
          prPipelineStateCompleted
        );
      } catch (error: any) {
        expect(error.message).toContain('gh auth login');
        expect(error.message).toContain('--no-pr');
      }
    });
  });

  describe('createPR - Title & Body', () => {
    it('should use custom title when provided', async () => {
      await prCreator.createPR(
        'feature-branch',
        'main',
        { title: 'Custom PR Title' },
        prPipelineStateCompleted
      );

      const calls = mockExecAsync.mock.calls.filter((call: any) =>
        call[0].includes('gh pr create')
      );
      expect(calls[0][0]).toContain('Custom PR Title');
    });

    it('should use default title with pipeline name when not provided', async () => {
      await prCreator.createPR(
        'feature-branch',
        'main',
        {},
        prPipelineStateCompleted
      );

      const calls = mockExecAsync.mock.calls.filter((call: any) =>
        call[0].includes('gh pr create')
      );
      expect(calls[0][0]).toContain('[Agent Pipeline] test-pipeline');
    });

    it('should use custom body when provided', async () => {
      await prCreator.createPR(
        'feature-branch',
        'main',
        { body: 'Custom PR body content' },
        prPipelineStateCompleted
      );

      const calls = mockExecAsync.mock.calls.filter((call: any) =>
        call[0].includes('gh pr create')
      );
      expect(calls[0][0]).toContain('Custom PR body content');
    });

    it('should build default body with pipeline summary when not provided', async () => {
      await prCreator.createPR(
        'feature-branch',
        'main',
        {},
        prPipelineStateCompleted
      );

      const calls = mockExecAsync.mock.calls.filter((call: any) =>
        call[0].includes('gh pr create')
      );
      const command = calls[0][0];
      expect(command).toContain('Agent Pipeline Summary');
      expect(command).toContain('test-pipeline');
    });

    it('should include run ID in default body', async () => {
      await prCreator.createPR(
        'feature-branch',
        'main',
        {},
        prPipelineStateCompleted
      );

      const calls = mockExecAsync.mock.calls.filter((call: any) =>
        call[0].includes('gh pr create')
      );
      expect(calls[0][0]).toContain('pr-run-completed-123');
    });

    it('should include stage status icons in default body', async () => {
      await prCreator.createPR(
        'feature-branch',
        'main',
        {},
        prPipelineStatePartial
      );

      const calls = mockExecAsync.mock.calls.filter((call: any) =>
        call[0].includes('gh pr create')
      );
      const command = calls[0][0];
      expect(command).toContain('✅'); // success
      expect(command).toContain('❌'); // failed
      expect(command).toContain('⏭️'); // skipped
    });

    it('should include retry attempts in default body', async () => {
      await prCreator.createPR(
        'feature-branch',
        'main',
        {},
        prPipelineStateWithRetries
      );

      const calls = mockExecAsync.mock.calls.filter((call: any) =>
        call[0].includes('gh pr create')
      );
      const command = calls[0][0];
      expect(command).toContain('2 retries');
      expect(command).toContain('1 retries');
    });

    it('should include commit SHAs in default body', async () => {
      await prCreator.createPR(
        'feature-branch',
        'main',
        {},
        prPipelineStateCompleted
      );

      const calls = mockExecAsync.mock.calls.filter((call: any) =>
        call[0].includes('gh pr create')
      );
      const command = calls[0][0];
      expect(command).toContain('build-c'); // Short SHA (first 7 chars)
      expect(command).toContain('test-co'); // Short SHA (first 7 chars)
    });
  });

  describe('createPR - Command Building', () => {
    it('should build basic gh pr create command with base and head', async () => {
      await prCreator.createPR(
        'feature-branch',
        'main',
        {},
        prPipelineStateCompleted
      );

      const calls = mockExecAsync.mock.calls.filter((call: any) =>
        call[0].includes('gh pr create')
      );
      const command = calls[0][0];
      expect(command).toContain('--base main');
      expect(command).toContain('--head feature-branch');
    });

    it('should add --draft flag when draft is true', async () => {
      await prCreator.createPR(
        'feature-branch',
        'main',
        { draft: true },
        prPipelineStateCompleted
      );

      const calls = mockExecAsync.mock.calls.filter((call: any) =>
        call[0].includes('gh pr create')
      );
      expect(calls[0][0]).toContain('--draft');
    });

    it('should add --reviewer flag with comma-separated reviewers', async () => {
      await prCreator.createPR(
        'feature-branch',
        'main',
        { reviewers: ['user1', 'user2', 'user3'] },
        prPipelineStateCompleted
      );

      const calls = mockExecAsync.mock.calls.filter((call: any) =>
        call[0].includes('gh pr create')
      );
      expect(calls[0][0]).toContain('--reviewer user1,user2,user3');
    });

    it('should add --label flag with comma-separated labels', async () => {
      await prCreator.createPR(
        'feature-branch',
        'main',
        { labels: ['bug', 'enhancement', 'urgent'] },
        prPipelineStateCompleted
      );

      const calls = mockExecAsync.mock.calls.filter((call: any) =>
        call[0].includes('gh pr create')
      );
      expect(calls[0][0]).toContain('--label bug,enhancement,urgent');
    });

    it('should add --assignee flag with comma-separated assignees', async () => {
      await prCreator.createPR(
        'feature-branch',
        'main',
        { assignees: ['assignee1', 'assignee2'] },
        prPipelineStateCompleted
      );

      const calls = mockExecAsync.mock.calls.filter((call: any) =>
        call[0].includes('gh pr create')
      );
      expect(calls[0][0]).toContain('--assignee assignee1,assignee2');
    });

    it('should add --milestone flag when provided', async () => {
      await prCreator.createPR(
        'feature-branch',
        'main',
        { milestone: 'v1.0.0' },
        prPipelineStateCompleted
      );

      const calls = mockExecAsync.mock.calls.filter((call: any) =>
        call[0].includes('gh pr create')
      );
      expect(calls[0][0]).toContain("--milestone 'v1.0.0'");
    });

    it('should add --web flag when web is true', async () => {
      await prCreator.createPR(
        'feature-branch',
        'main',
        { web: true },
        prPipelineStateCompleted
      );

      const calls = mockExecAsync.mock.calls.filter((call: any) =>
        call[0].includes('gh pr create')
      );
      expect(calls[0][0]).toContain('--web');
    });

    it('should escape shell arguments in title and body', async () => {
      await prCreator.createPR(
        'feature-branch',
        'main',
        {
          title: "Test with 'single quotes'",
          body: "Body with 'quotes' too",
        },
        prPipelineStateCompleted
      );

      const calls = mockExecAsync.mock.calls.filter((call: any) =>
        call[0].includes('gh pr create')
      );
      const command = calls[0][0];
      // Should escape single quotes properly
      expect(command).toContain("'\\''");
    });

    it('should handle special characters in title/body/milestone', async () => {
      await prCreator.createPR(
        'feature-branch',
        'main',
        {
          title: 'Fix: $variable & "quotes"',
          milestone: 'Release 2.0 (Beta)',
        },
        prPipelineStateCompleted
      );

      const calls = mockExecAsync.mock.calls.filter((call: any) =>
        call[0].includes('gh pr create')
      );
      // Should not throw and should escape properly
      expect(calls).toHaveLength(1);
    });
  });

  describe('createPR - Output Parsing', () => {
    it('should extract PR URL from gh CLI output', async () => {
      const result = await prCreator.createPR(
        'feature-branch',
        'main',
        {},
        prPipelineStateCompleted
      );

      expect(result.url).toBe('https://github.com/testuser/testrepo/pull/123');
    });

    it('should extract PR number from gh CLI output', async () => {
      const result = await prCreator.createPR(
        'feature-branch',
        'main',
        {},
        prPipelineStateCompleted
      );

      expect(result.number).toBe(123);
    });

    it('should return both url and number in response', async () => {
      const result = await prCreator.createPR(
        'feature-branch',
        'main',
        {},
        prPipelineStateCompleted
      );

      expect(result).toHaveProperty('url');
      expect(result).toHaveProperty('number');
      expect(typeof result.url).toBe('string');
      expect(typeof result.number).toBe('number');
    });

    it('should handle missing URL in output (return empty string)', async () => {
      configureMockExec({
        version: ghVersionOutput,
        auth: ghAuthStatusOutput,
        prCreate: ghPrCreateNoUrl,
      });

      const result = await prCreator.createPR(
        'feature-branch',
        'main',
        {},
        prPipelineStateCompleted
      );

      expect(result.url).toBe('');
      expect(result.number).toBe(999);
    });

    it('should handle missing PR number in output (return 0)', async () => {
      configureMockExec({
        version: ghVersionOutput,
        auth: ghAuthStatusOutput,
        prCreate: ghPrCreateNoNumber,
      });

      const result = await prCreator.createPR(
        'feature-branch',
        'main',
        {},
        prPipelineStateCompleted
      );

      expect(result.url).toBe('https://github.com/testuser/testrepo/pull/unknown');
      expect(result.number).toBe(0);
    });
  });

  describe('createPR - Error Handling', () => {
    it('should throw descriptive error when PR already exists', async () => {
      configureMockExec({
        version: ghVersionOutput,
        auth: ghAuthStatusOutput,
        prCreate: ghPrAlreadyExistsError,
      });

      await expect(
        prCreator.createPR(
          'feature-branch',
          'main',
          {},
          prPipelineStateCompleted
        )
      ).rejects.toThrow('already exists');
    });

    it('should include gh pr view command in duplicate PR error', async () => {
      configureMockExec({
        version: ghVersionOutput,
        auth: ghAuthStatusOutput,
        prCreate: ghPrAlreadyExistsError,
      });

      try {
        await prCreator.createPR(
          'feature-branch',
          'main',
          {},
          prPipelineStateCompleted
        );
      } catch (error: any) {
        expect(error.message).toContain('gh pr view feature-branch');
      }
    });

    it('should throw generic error for other gh CLI failures', async () => {
      configureMockExec({
        version: ghVersionOutput,
        auth: ghAuthStatusOutput,
        prCreate: ghPrCreateGenericError,
      });

      await expect(
        prCreator.createPR(
          'feature-branch',
          'main',
          {},
          prPipelineStateCompleted
        )
      ).rejects.toThrow('Failed to create PR');
    });
  });

  describe('buildDefaultPRBody - Indirect', () => {
    it('should include pipeline name in summary', async () => {
      await prCreator.createPR(
        'feature-branch',
        'main',
        {},
        prPipelineStateCompleted
      );

      const calls = mockExecAsync.mock.calls.filter((call: any) =>
        call[0].includes('gh pr create')
      );
      expect(calls[0][0]).toContain('test-pipeline');
    });

    it('should include run ID in summary', async () => {
      await prCreator.createPR(
        'feature-branch',
        'main',
        {},
        prPipelineStateCompleted
      );

      const calls = mockExecAsync.mock.calls.filter((call: any) =>
        call[0].includes('gh pr create')
      );
      expect(calls[0][0]).toContain('pr-run-completed-123');
    });

    it('should show ✅ for completed status', async () => {
      await prCreator.createPR(
        'feature-branch',
        'main',
        {},
        prPipelineStateCompleted
      );

      const calls = mockExecAsync.mock.calls.filter((call: any) =>
        call[0].includes('gh pr create')
      );
      expect(calls[0][0]).toContain('✅ Completed');
    });

    it('should show ⚠️ for non-completed status', async () => {
      await prCreator.createPR(
        'feature-branch',
        'main',
        {},
        prPipelineStatePartial
      );

      const calls = mockExecAsync.mock.calls.filter((call: any) =>
        call[0].includes('gh pr create')
      );
      expect(calls[0][0]).toContain('⚠️ failed');
    });

    it('should include total duration', async () => {
      await prCreator.createPR(
        'feature-branch',
        'main',
        {},
        prPipelineStateCompleted
      );

      const calls = mockExecAsync.mock.calls.filter((call: any) =>
        call[0].includes('gh pr create')
      );
      expect(calls[0][0]).toContain('180.00s');
    });

    it('should include success count ratio (e.g., 2/3)', async () => {
      await prCreator.createPR(
        'feature-branch',
        'main',
        {},
        prPipelineStatePartial
      );

      const calls = mockExecAsync.mock.calls.filter((call: any) =>
        call[0].includes('gh pr create')
      );
      expect(calls[0][0]).toContain('1/3 successful');
    });

    it('should list all stages with status icons', async () => {
      await prCreator.createPR(
        'feature-branch',
        'main',
        {},
        prPipelineStatePartial
      );

      const calls = mockExecAsync.mock.calls.filter((call: any) =>
        call[0].includes('gh pr create')
      );
      const command = calls[0][0];
      expect(command).toContain('lint');
      expect(command).toContain('build');
      expect(command).toContain('deploy');
    });

    it('should include retry attempt count for stages', async () => {
      await prCreator.createPR(
        'feature-branch',
        'main',
        {},
        prPipelineStateWithRetries
      );

      const calls = mockExecAsync.mock.calls.filter((call: any) =>
        call[0].includes('gh pr create')
      );
      expect(calls[0][0]).toContain('(2 retries)');
      expect(calls[0][0]).toContain('(1 retries)');
    });

    it('should list commits with short SHAs', async () => {
      await prCreator.createPR(
        'feature-branch',
        'main',
        {},
        prPipelineStateCompleted
      );

      const calls = mockExecAsync.mock.calls.filter((call: any) =>
        call[0].includes('gh pr create')
      );
      const command = calls[0][0];
      // Should have short 7-char SHAs
      expect(command).toMatch(/build-c/);
      expect(command).toMatch(/test-co/);
    });

    it('should format multi-stage pipelines correctly', async () => {
      await prCreator.createPR(
        'feature-branch',
        'main',
        {},
        prPipelineStatePartial
      );

      const calls = mockExecAsync.mock.calls.filter((call: any) =>
        call[0].includes('gh pr create')
      );
      const command = calls[0][0];
      // Should have numbered stages
      expect(command).toContain('1. ✅');
      expect(command).toContain('2. ❌');
      expect(command).toContain('3. ⏭️');
    });
  });

  describe('viewPR', () => {
    it('should execute gh pr view with --web flag', async () => {
      await prCreator.viewPR('feature-branch');

      expect(mockExecAsync).toHaveBeenCalledWith(
        'gh pr view feature-branch --web'
      );
    });

    it('should pass branch name to command', async () => {
      await prCreator.viewPR('my-feature-branch');

      expect(mockExecAsync).toHaveBeenCalledWith(
        'gh pr view my-feature-branch --web'
      );
    });

    it('should handle successful execution', async () => {
      await expect(prCreator.viewPR('feature-branch')).resolves.not.toThrow();
    });

    it('should throw on gh CLI error', async () => {
      configureMockExec({
        prView: ghPrViewNotFound,
      });

      await expect(prCreator.viewPR('nonexistent-branch')).rejects.toThrow();
    });
  });

  describe('prExists', () => {
    it('should return true when PR exists', async () => {
      const result = await prCreator.prExists('feature-branch');

      expect(result).toBe(true);
    });

    it('should return false when PR doesn\'t exist', async () => {
      configureMockExec({
        prView: ghPrViewNotFound,
      });

      const result = await prCreator.prExists('nonexistent-branch');

      expect(result).toBe(false);
    });

    it('should execute gh pr view command', async () => {
      await prCreator.prExists('feature-branch');

      expect(mockExecAsync).toHaveBeenCalledWith('gh pr view feature-branch');
    });

    it('should pass branch name to command', async () => {
      await prCreator.prExists('my-branch');

      expect(mockExecAsync).toHaveBeenCalledWith('gh pr view my-branch');
    });

    it('should not throw on gh CLI error (catch and return false)', async () => {
      configureMockExec({
        prView: new Error('Command failed'),
      });

      await expect(prCreator.prExists('branch')).resolves.toBe(false);
    });
  });

  describe('escapeShellArg - Indirect', () => {
    it('should wrap arguments in single quotes', async () => {
      await prCreator.createPR(
        'feature-branch',
        'main',
        { title: 'Simple Title' },
        prPipelineStateCompleted
      );

      const calls = mockExecAsync.mock.calls.filter((call: any) =>
        call[0].includes('gh pr create')
      );
      expect(calls[0][0]).toContain("'Simple Title'");
    });

    it('should escape single quotes in string', async () => {
      await prCreator.createPR(
        'feature-branch',
        'main',
        { title: "It's a test" },
        prPipelineStateCompleted
      );

      const calls = mockExecAsync.mock.calls.filter((call: any) =>
        call[0].includes('gh pr create')
      );
      // Should escape single quote: 'It'\''s a test'
      expect(calls[0][0]).toContain("'\\''");
    });

    it('should handle strings with multiple single quotes', async () => {
      await prCreator.createPR(
        'feature-branch',
        'main',
        { title: "It's Mike's PR" },
        prPipelineStateCompleted
      );

      const calls = mockExecAsync.mock.calls.filter((call: any) =>
        call[0].includes('gh pr create')
      );
      // Should escape both single quotes
      const titlePart = calls[0][0].match(/--title '([^']*(?:'\\''[^']*)*)'/);
      expect(titlePart).toBeTruthy();
    });

    it('should handle empty strings', async () => {
      await prCreator.createPR(
        'feature-branch',
        'main',
        { title: '' },
        prPipelineStateCompleted
      );

      const calls = mockExecAsync.mock.calls.filter((call: any) =>
        call[0].includes('gh pr create')
      );
      // Empty title falls back to default title
      expect(calls[0][0]).toContain('[Agent Pipeline] test-pipeline');
    });

    it('should handle special characters (!, $, `, etc.)', async () => {
      await prCreator.createPR(
        'feature-branch',
        'main',
        { title: 'Fix: $var & `cmd`!' },
        prPipelineStateCompleted
      );

      const calls = mockExecAsync.mock.calls.filter((call: any) =>
        call[0].includes('gh pr create')
      );
      // Single quotes should protect these characters
      expect(calls[0][0]).toContain('$var');
      expect(calls[0][0]).toContain('`cmd`');
    });

    it('should handle newlines in strings', async () => {
      await prCreator.createPR(
        'feature-branch',
        'main',
        { body: 'Line 1\nLine 2\nLine 3' },
        prPipelineStateCompleted
      );

      const calls = mockExecAsync.mock.calls.filter((call: any) =>
        call[0].includes('gh pr create')
      );
      // Should preserve newlines within single quotes
      expect(calls[0][0]).toContain('Line 1');
      expect(calls[0][0]).toContain('Line 2');
    });

    it('should handle unicode characters', async () => {
      await prCreator.createPR(
        'feature-branch',
        'main',
        { title: 'Fix 🐛 with 🔧' },
        prPipelineStateCompleted
      );

      const calls = mockExecAsync.mock.calls.filter((call: any) =>
        call[0].includes('gh pr create')
      );
      // Should preserve unicode
      expect(calls[0][0]).toContain('🐛');
      expect(calls[0][0]).toContain('🔧');
    });

    it('should prevent command injection attempts', async () => {
      await prCreator.createPR(
        'feature-branch',
        'main',
        { title: "'; rm -rf /; echo '" },
        prPipelineStateCompleted
      );

      const calls = mockExecAsync.mock.calls.filter((call: any) =>
        call[0].includes('gh pr create')
      );
      // Should be escaped and not execute as command
      expect(calls[0][0]).toContain("'\\''");
      // The command should be properly escaped within quotes
      // Check that the whole malicious string is wrapped in quotes
      expect(calls[0][0]).toMatch(/--title\s+'[^']*'\\''[^']*rm[^']*'\\''[^']*'/);
    });
  });

  describe('Integration & Edge Cases', () => {
    it('should create PR with all options specified', async () => {
      const result = await prCreator.createPR(
        'feature-branch',
        'develop',
        {
          title: 'Complete PR',
          body: 'Full description',
          draft: true,
          reviewers: ['user1', 'user2'],
          labels: ['bug', 'urgent'],
          assignees: ['assignee1'],
          milestone: 'v2.0',
          web: true,
        },
        prPipelineStateCompleted
      );

      expect(result.url).toBeTruthy();
      expect(result.number).toBeGreaterThan(0);
    });

    it('should create PR with minimal config (no optional fields)', async () => {
      const result = await prCreator.createPR(
        'simple-branch',
        'main',
        {},
        prPipelineStateSingleStage
      );

      expect(result.url).toBeTruthy();
      expect(result.number).toBeGreaterThan(0);
    });

    it('should handle empty reviewers/labels/assignees arrays', async () => {
      await prCreator.createPR(
        'feature-branch',
        'main',
        {
          reviewers: [],
          labels: [],
          assignees: [],
        },
        prPipelineStateCompleted
      );

      const calls = mockExecAsync.mock.calls.filter((call: any) =>
        call[0].includes('gh pr create')
      );
      const command = calls[0][0];
      // Should not include flags for empty arrays
      expect(command).not.toContain('--reviewer ');
      expect(command).not.toContain('--label ');
      expect(command).not.toContain('--assignee ');
    });

    it('should log console output during PR creation', async () => {
      await prCreator.createPR(
        'feature-branch',
        'main',
        {},
        prPipelineStateCompleted
      );

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Creating pull request')
      );
    });

    it('should handle pipeline state with mixed stage statuses', async () => {
      const result = await prCreator.createPR(
        'mixed-branch',
        'main',
        {},
        prPipelineStatePartial
      );

      expect(result.url).toBeTruthy();
      expect(result.number).toBeGreaterThan(0);
    });
  });
});
