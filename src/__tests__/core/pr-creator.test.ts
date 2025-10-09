
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

