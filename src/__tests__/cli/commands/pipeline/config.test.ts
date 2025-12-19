import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { configPipelineCommand } from '../../../../cli/commands/pipeline/config.js';
import { PipelineLoader } from '../../../../config/pipeline-loader.js';
import { createTempDir, cleanupTempDir } from '../../../setup.js';

// Mock dependencies
vi.mock('../../../../config/pipeline-loader.js');

describe('configPipelineCommand', () => {
  let tempDir: string;
  let mockLoader: any;
  let processExitSpy: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;

  beforeEach(async () => {
    tempDir = await createTempDir('config-pipeline-test-');

    // Setup PipelineLoader mock
    mockLoader = {
      loadPipeline: vi.fn(),
    };
    vi.mocked(PipelineLoader).mockImplementation(() => mockLoader);

    // Spy on process.exit
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
      throw new Error(`process.exit(${code})`);
    });

    // Spy on console methods
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
    vi.clearAllMocks();
    processExitSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('Basic Execution', () => {
    it('should load pipeline configuration using PipelineLoader', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue(mockConfig);

      await configPipelineCommand(tempDir, 'test-pipeline');

      expect(PipelineLoader).toHaveBeenCalledWith(tempDir);
      expect(mockLoader.loadPipeline).toHaveBeenCalledWith('test-pipeline');
    });

    it('should display YAML format with YAML.stringify', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'post-commit',
        agents: [
          { name: 'agent1', agent: 'agent1.md' },
        ],
      };
      mockLoader.loadPipeline.mockResolvedValue(mockConfig);

      await configPipelineCommand(tempDir, 'test-pipeline');

      // Should contain YAML content
      const logCalls = consoleLogSpy.mock.calls.map(call => call[0]).join('\n');
      expect(logCalls).toContain('name: test-pipeline');
      expect(logCalls).toContain('trigger: post-commit');
      expect(logCalls).toContain('agents:');
    });

    it('should show separator lines and header', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue(mockConfig);

      await configPipelineCommand(tempDir, 'test-pipeline');

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Configuration for: test-pipeline')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith('─'.repeat(60));
    });
  });

  describe('Console Output', () => {
    it('should output configuration title with pipeline name', async () => {
      const mockConfig = {
        name: 'my-awesome-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue(mockConfig);

      await configPipelineCommand(tempDir, 'my-awesome-pipeline');

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('⚙️  Configuration for: my-awesome-pipeline')
      );
    });

    it('should output YAML content between separators', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        settings: {
          autoCommit: true,
          failureStrategy: 'continue',
        },
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue(mockConfig);

      await configPipelineCommand(tempDir, 'test-pipeline');

      const logCalls = consoleLogSpy.mock.calls;

      // Find separator indices
      const separatorIndices = logCalls
        .map((call, idx) => (call[0] === '─'.repeat(60) ? idx : -1))
        .filter(idx => idx !== -1);

      expect(separatorIndices.length).toBeGreaterThanOrEqual(2);

      // Check content between separators
      const contentCalls = logCalls.slice(separatorIndices[0] + 1, separatorIndices[1]);
      const content = contentCalls.map(call => call[0]).join('\n');

      expect(content).toContain('name:');
      expect(content).toContain('trigger:');
    });
  });

  describe('Error Handling', () => {
    it('should exit with code 1 when pipeline not found', async () => {
      mockLoader.loadPipeline.mockRejectedValue(new Error('Pipeline not found'));

      await expect(
        configPipelineCommand(tempDir, 'nonexistent-pipeline')
      ).rejects.toThrow('process.exit(1)');

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should show "Pipeline not found" error message', async () => {
      mockLoader.loadPipeline.mockRejectedValue(new Error('Pipeline not found'));

      await expect(
        configPipelineCommand(tempDir, 'missing-pipeline')
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Pipeline "missing-pipeline" not found')
      );
    });

    it('should handle load errors gracefully with generic message', async () => {
      mockLoader.loadPipeline.mockRejectedValue(new Error('YAML parse error'));

      await expect(
        configPipelineCommand(tempDir, 'test-pipeline')
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load configuration: YAML parse error')
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle large configurations with many agents', async () => {
      const mockConfig = {
        name: 'large-pipeline',
        trigger: 'post-commit',
        settings: {
          autoCommit: true,
          commitPrefix: '[pipeline:{{stage}}]',
          failureStrategy: 'continue',
          preserveWorkingTree: false,
          executionMode: 'parallel',
        },
        git: {
          baseBranch: 'main',
          branchStrategy: 'reusable',
          pullRequest: {
            autoCreate: true,
            title: 'Test PR',
          },
        },
        agents: Array.from({ length: 15 }, (_, i) => ({
          name: `agent-${i}`,
          agent: `agents/agent-${i}.md`,
          timeout: 120,
        })),
      };
      mockLoader.loadPipeline.mockResolvedValue(mockConfig);

      await configPipelineCommand(tempDir, 'large-pipeline');

      const logCalls = consoleLogSpy.mock.calls.map(call => call[0]).join('\n');

      // Should contain all agent names
      expect(logCalls).toContain('agent-0');
      expect(logCalls).toContain('agent-14');

      // Should contain settings
      expect(logCalls).toContain('settings:');
      expect(logCalls).toContain('git:');
    });

    it('should handle configurations with special characters in strings', async () => {
      const mockConfig = {
        name: 'special-chars-pipeline',
        trigger: 'manual',
        settings: {
          commitPrefix: '[pipeline:{{stage}}] 🚀',
        },
        agents: [
          {
            name: 'test-agent',
            agent: 'agents/test.md',
            commitMessage: 'Update: "quoted" and \'single\' quotes',
            inputs: {
              message: 'Line 1\nLine 2\nLine 3',
              special: 'Contains: colons, @symbols, and #hashes',
            },
          },
        ],
      };
      mockLoader.loadPipeline.mockResolvedValue(mockConfig);

      await configPipelineCommand(tempDir, 'special-chars-pipeline');

      const logCalls = consoleLogSpy.mock.calls.map(call => call[0]).join('\n');

      // YAML should properly escape special characters
      expect(logCalls).toContain('special-chars-pipeline');
      expect(logCalls).toContain('test-agent');
    });
  });

  describe('Integration', () => {
    it('should complete full workflow from load to display', async () => {
      const mockConfig = {
        name: 'integration-pipeline',
        trigger: 'post-commit',
        settings: {
          autoCommit: true,
          failureStrategy: 'stop',
        },
        agents: [
          { name: 'code-review', agent: 'code-reviewer.md' },
          { name: 'quality-check', agent: 'quality-checker.md' },
        ],
      };
      mockLoader.loadPipeline.mockResolvedValue(mockConfig);

      await configPipelineCommand(tempDir, 'integration-pipeline');

      // Verify complete workflow
      expect(PipelineLoader).toHaveBeenCalledWith(tempDir);
      expect(mockLoader.loadPipeline).toHaveBeenCalledWith('integration-pipeline');

      // Verify output structure
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Configuration for: integration-pipeline')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith('─'.repeat(60));

      const logCalls = consoleLogSpy.mock.calls.map(call => call[0]).join('\n');
      expect(logCalls).toContain('name: integration-pipeline');
      expect(logCalls).toContain('code-review');
      expect(logCalls).toContain('quality-check');
    });

    it('should work with complex pipeline configurations', async () => {
      const mockConfig = {
        name: 'complex-pipeline',
        trigger: 'post-commit',
        settings: {
          autoCommit: true,
          commitPrefix: '[{{stage}}]',
          failureStrategy: 'continue',
          executionMode: 'parallel',
        },
        git: {
          baseBranch: 'develop',
          branchStrategy: 'unique-per-run',
          pullRequest: {
            autoCreate: true,
            title: '🤖 Automated PR',
            reviewers: ['dev1', 'dev2'],
            labels: ['automated', 'review'],
            draft: false,
          },
        },
        notifications: {
          enabled: true,
          events: ['pipeline.completed', 'pipeline.failed'],
          channels: {
            local: { enabled: true },
            slack: {
              enabled: true,
              webhookUrl: 'https://hooks.slack.com/services/xxx',
              channel: '#notifications',
            },
          },
        },
        agents: [
          {
            name: 'stage1',
            agent: 'agent1.md',
            timeout: 120,
          },
          {
            name: 'stage2',
            agent: 'agent2.md',
            dependsOn: ['stage1'],
            retry: {
              maxAttempts: 3,
              backoff: 'exponential',
            },
          },
        ],
      };
      mockLoader.loadPipeline.mockResolvedValue(mockConfig);

      await configPipelineCommand(tempDir, 'complex-pipeline');

      const logCalls = consoleLogSpy.mock.calls.map(call => call[0]).join('\n');

      // Should contain all complex config elements
      expect(logCalls).toContain('complex-pipeline');
      expect(logCalls).toContain('parallel');
      expect(logCalls).toContain('notifications:');
      expect(logCalls).toContain('dependsOn:');
      expect(logCalls).toContain('retry:');
    });
  });
});
