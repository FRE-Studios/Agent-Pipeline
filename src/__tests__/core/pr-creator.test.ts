
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  prPipelineStateCompleted,
  prPipelineStatePartial,
  prPipelineStateWithRetries,
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
import { EventEmitter } from 'events';

// Mock child_process
const mockSpawn = vi.hoisted(() => {
  const mock = vi.fn();
  return {
    spawn: mock,
  };
});

vi.mock('child_process', () => ({
  spawn: mockSpawn.spawn,
}));

// Import after mocks
import { PRCreator } from '../../core/pr-creator.js';

class MockProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  constructor(private stdoutData: string, private stderrData: string, private exitCode: number) {
    super();
  }
  run() {
    if (this.stdoutData) this.stdout.emit('data', this.stdoutData);
    if (this.stderrData) this.stderr.emit('data', this.stderrData);
    this.emit('close', this.exitCode);
  }
}

// Helper to configure mock responses
function configureMockSpawn(config: {
  version?: any;
  auth?: any;
  prCreate?: any;
  prView?: any;
  default?: any;
}) {
  mockSpawn.spawn.mockImplementation((command: string, args: string[]) => {
    let response: any;
    const commandStr = args.join(' ');

    if (commandStr.includes('--version')) {
      response = config.version;
    } else if (commandStr.includes('auth status')) {
      response = config.auth;
    } else if (commandStr.includes('pr create')) {
      response = config.prCreate;
    } else if (commandStr.includes('pr view')) {
      response = config.prView;
    } else {
      response = config.default;
    }

    if (response instanceof Error) {
      const proc = new MockProcess('', response.message, 1);
      setTimeout(() => proc.run(), 0);
      return proc;
    }

    const { stdout = '', stderr = '', code = 0 } = response || {};
    const proc = new MockProcess(stdout, stderr, code);
    setTimeout(() => proc.run(), 0);
    return proc;
  });
}

describe('PRCreator', () => {
  let prCreator: PRCreator;
  let consoleLogSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    configureMockSpawn({
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

  describe('checkGHCLI', () => {
    it('should return installed and authenticated when both succeed', async () => {
      const result = await prCreator.checkGHCLI();
      expect(result).toEqual({ installed: true, authenticated: true });
      expect(mockSpawn.spawn).toHaveBeenCalledWith('gh', ['--version']);
      expect(mockSpawn.spawn).toHaveBeenCalledWith('gh', ['auth', 'status']);
    });

    it('should return installed but not authenticated when auth fails', async () => {
      configureMockSpawn({
        version: ghVersionOutput,
        auth: ghAuthStatusNotAuthenticated,
      });
      const result = await prCreator.checkGHCLI();
      expect(result).toEqual({ installed: true, authenticated: false });
    });

    it('should return not installed when gh --version fails', async () => {
      configureMockSpawn({ version: ghVersionNotInstalled });
      const result = await prCreator.checkGHCLI();
      expect(result).toEqual({ installed: false, authenticated: false });
    });
  });

  describe('createPR - Prerequisites', () => {
    it('should throw error when gh CLI not installed', async () => {
      configureMockSpawn({ version: ghVersionNotInstalled });
      await expect(
        prCreator.createPR('feature-branch', 'main', {}, prPipelineStateCompleted)
      ).rejects.toThrow('GitHub CLI (gh) is not installed');
    });

    it('should throw error with full message when gh CLI not installed', async () => {
      configureMockSpawn({ version: ghVersionNotInstalled });
      try {
        await prCreator.createPR('feature-branch', 'main', {}, prPipelineStateCompleted);
        expect.fail('Should have thrown error');
      } catch (error: any) {
        expect(error.message).toContain('GitHub CLI (gh) is not installed');
        expect(error.message).toContain('Install from: https://cli.github.com/');
        expect(error.message).toContain('Or disable PR creation:');
        expect(error.message).toContain('- Remove git.pullRequest.autoCreate from your pipeline config');
        expect(error.message).toContain('- Or run with: agent-pipeline run <pipeline> --no-pr');
      }
    });

    it('should throw error when gh CLI not authenticated', async () => {
      configureMockSpawn({
        version: ghVersionOutput,
        auth: ghAuthStatusNotAuthenticated,
      });
      await expect(
        prCreator.createPR('feature-branch', 'main', {}, prPipelineStateCompleted)
      ).rejects.toThrow('GitHub CLI is not authenticated');
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
      expect(mockSpawn.spawn).toHaveBeenCalledWith('gh', expect.arrayContaining(['--title', 'Custom PR Title']));
    });

    it('should use default title with pipeline name when not provided', async () => {
      await prCreator.createPR('feature-branch', 'main', {}, prPipelineStateCompleted);
      expect(mockSpawn.spawn).toHaveBeenCalledWith('gh', expect.arrayContaining(['--title', '🤖 [Agent Pipeline] test-pipeline']));
    });

    it('should use custom body when provided', async () => {
        await prCreator.createPR(
          'feature-branch',
          'main',
          { body: 'Custom PR body content' },
          prPipelineStateCompleted
        );
        expect(mockSpawn.spawn).toHaveBeenCalledWith('gh', expect.arrayContaining(['--body', 'Custom PR body content']));
      });

    it('should generate default body without hardcoded repository URL', async () => {
        await prCreator.createPR('feature-branch', 'main', {}, prPipelineStateCompleted);
        const bodyArg = mockSpawn.spawn.mock.calls.find((call: any) =>
          call[1].includes('--body')
        )?.[1];
        const bodyIndex = bodyArg?.indexOf('--body');
        const body = bodyIndex !== undefined ? bodyArg[bodyIndex + 1] : '';

        expect(body).toContain('Agent Pipeline Summary');
        expect(body).toContain('test-pipeline');
        expect(body).not.toContain('github.com/yourusername');
        expect(body).toContain('This PR was automatically generated by Agent Pipeline');
      });

    it('should include retry information in default body when stages have retries', async () => {
        await prCreator.createPR('feature-branch', 'main', {}, prPipelineStateWithRetries);
        const bodyArg = mockSpawn.spawn.mock.calls.find((call: any) =>
          call[1].includes('--body')
        )?.[1];
        const bodyIndex = bodyArg?.indexOf('--body');
        const body = bodyIndex !== undefined ? bodyArg[bodyIndex + 1] : '';

        expect(body).toContain('2 retries');
        expect(body).toContain('1 retries');
      });

    it('should include failed and skipped stage icons in default body', async () => {
        await prCreator.createPR('feature-branch', 'main', {}, prPipelineStatePartial);
        const bodyArg = mockSpawn.spawn.mock.calls.find((call: any) =>
          call[1].includes('--body')
        )?.[1];
        const bodyIndex = bodyArg?.indexOf('--body');
        const body = bodyIndex !== undefined ? bodyArg[bodyIndex + 1] : '';

        // Should contain success, failed, and skipped icons
        expect(body).toContain('✅'); // success icon
        expect(body).toContain('❌'); // failed icon
        expect(body).toContain('⏭️'); // skipped icon
        expect(body).toContain('lint'); // lint stage succeeded
        expect(body).toContain('build'); // build stage failed
        expect(body).toContain('deploy'); // deploy stage skipped
      });
  });

  describe('createPR - Command Building', () => {
    it('should build basic gh pr create command with base and head', async () => {
        await prCreator.createPR('feature-branch', 'main', {}, prPipelineStateCompleted);
        expect(mockSpawn.spawn).toHaveBeenCalledWith('gh', expect.arrayContaining(['--base', 'main']));
        expect(mockSpawn.spawn).toHaveBeenCalledWith('gh', expect.arrayContaining(['--head', 'feature-branch']));
    });

    it('should add --draft flag when draft is true', async () => {
        await prCreator.createPR('feature-branch', 'main', { draft: true }, prPipelineStateCompleted);
        expect(mockSpawn.spawn).toHaveBeenCalledWith('gh', expect.arrayContaining(['--draft']));
    });

    it('should add --reviewer flag with comma-separated reviewers', async () => {
        await prCreator.createPR('feature-branch', 'main', { reviewers: ['user1', 'user2'] }, prPipelineStateCompleted);
        expect(mockSpawn.spawn).toHaveBeenCalledWith('gh', expect.arrayContaining(['--reviewer', 'user1,user2']));
    });
  });

  describe('createPR - Output Parsing', () => {
    it('should extract PR URL and number from gh CLI output', async () => {
        const result = await prCreator.createPR('feature-branch', 'main', {}, prPipelineStateCompleted);
        expect(result.url).toBe('https://github.com/testuser/testrepo/pull/123');
        expect(result.number).toBe(123);
    });

    it('should handle missing URL in output', async () => {
        configureMockSpawn({ prCreate: ghPrCreateNoUrl });
        const result = await prCreator.createPR('feature-branch', 'main', {}, prPipelineStateCompleted);
        expect(result.url).toBe('');
        expect(result.number).toBe(999);
    });

    it('should handle missing PR number in output', async () => {
        configureMockSpawn({ prCreate: ghPrCreateNoNumber });
        const result = await prCreator.createPR('feature-branch', 'main', {}, prPipelineStateCompleted);
        expect(result.url).toBe('https://github.com/testuser/testrepo/pull/unknown');
        expect(result.number).toBe(0);
    });
  });

  describe('createPR - Error Handling', () => {
    it('should throw descriptive error when PR already exists', async () => {
        configureMockSpawn({ prCreate: ghPrAlreadyExistsError });
        await expect(
            prCreator.createPR('feature-branch', 'main', {}, prPipelineStateCompleted)
        ).rejects.toThrow('already exists');
    });

    it('should throw generic error for other gh CLI failures', async () => {
        configureMockSpawn({ prCreate: ghPrCreateGenericError });
        await expect(
            prCreator.createPR('feature-branch', 'main', {}, prPipelineStateCompleted)
        ).rejects.toThrow('Failed to create PR');
    });

    it('should re-throw non-Error instances', async () => {
        // Configure spawn to succeed for checkGHCLI but fail with non-Error on PR creation
        mockSpawn.spawn.mockImplementation((command: string, args: string[]) => {
          const commandStr = args.join(' ');

          // Let checkGHCLI succeed
          if (commandStr.includes('--version')) {
            const proc = new MockProcess(ghVersionOutput.stdout, '', 0);
            setTimeout(() => proc.run(), 0);
            return proc;
          }
          if (commandStr.includes('auth status')) {
            const proc = new MockProcess(ghAuthStatusOutput.stdout, '', 0);
            setTimeout(() => proc.run(), 0);
            return proc;
          }

          // Throw non-Error on PR creation
          if (commandStr.includes('pr create')) {
            const proc = new MockProcess('', '', 0);
            setTimeout(() => {
              proc.emit('error', 'string error'); // Non-Error instance
            }, 0);
            return proc;
          }

          const proc = new MockProcess('', '', 0);
          setTimeout(() => proc.run(), 0);
          return proc;
        });

        await expect(
            prCreator.createPR('feature-branch', 'main', {}, prPipelineStateCompleted)
        ).rejects.toBe('string error');
    });
  });

  describe('viewPR', () => {
    it('should execute gh pr view with --web flag', async () => {
        await prCreator.viewPR('feature-branch');
        expect(mockSpawn.spawn).toHaveBeenCalledWith('gh', ['pr', 'view', 'feature-branch', '--web']);
    });
  });

  describe('prExists', () => {
    it('should return true when PR exists', async () => {
        const result = await prCreator.prExists('feature-branch');
        expect(result).toBe(true);
        expect(mockSpawn.spawn).toHaveBeenCalledWith('gh', ['pr', 'view', 'feature-branch']);
    });

    it('should return false when PR does not exist', async () => {
        configureMockSpawn({ prView: ghPrViewNotFound });
        const result = await prCreator.prExists('nonexistent-branch');
        expect(result).toBe(false);
    });
  });
});

