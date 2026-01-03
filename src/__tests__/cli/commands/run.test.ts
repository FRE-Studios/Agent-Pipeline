import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runCommand } from '../../../cli/commands/run.js';
import { PipelineLoader } from '../../../config/pipeline-loader.js';
import { PipelineValidator } from '../../../validators/pipeline-validator.js';
import { PipelineRunner } from '../../../core/pipeline-runner.js';
import { createTempDir, cleanupTempDir } from '../../setup.js';

// Mock dependencies
vi.mock('../../../config/pipeline-loader.js');
vi.mock('../../../validators/pipeline-validator.js');
vi.mock('../../../core/pipeline-runner.js');
vi.mock('ink', () => ({
  render: vi.fn(() => ({
    unmount: vi.fn(),
    waitUntilExit: vi.fn(() => Promise.resolve()),
  })),
}));

describe('runCommand', () => {
  let tempDir: string;
  let mockLoader: any;
  let mockValidator: any;
  let mockRunner: any;
  let processExitSpy: any;
  let mockRender: any;

  beforeEach(async () => {
    tempDir = await createTempDir('run-command-test-');

    // Setup PipelineLoader mock
    mockLoader = {
      loadPipeline: vi.fn(),
    };
    vi.mocked(PipelineLoader).mockImplementation(() => mockLoader);

    // Setup PipelineValidator mock
    mockValidator = {
      validateAndReport: vi.fn(),
    };
    vi.mocked(PipelineValidator).validateAndReport = mockValidator.validateAndReport;

    // Setup PipelineRunner mock
    mockRunner = {
      runPipeline: vi.fn(),
      onStateChange: vi.fn(),
    };
    vi.mocked(PipelineRunner).mockImplementation(() => mockRunner);

    // Setup Ink render mock
    const { render } = await import('ink');
    mockRender = vi.mocked(render);

    // Spy on process.exit
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
    vi.clearAllMocks();
    processExitSpy.mockRestore();
  });

  describe('Basic Execution', () => {
    it('should load pipeline configuration', async () => {
      const config = { name: 'test-pipeline', trigger: 'manual', agents: [] };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockValidator.validateAndReport.mockResolvedValue(true);
      mockRunner.runPipeline.mockResolvedValue({ status: 'completed' });

      try {
        await runCommand(tempDir, 'test-pipeline');
      } catch (error) {
        // Expected to exit
      }

      expect(PipelineLoader).toHaveBeenCalledWith(tempDir);
      expect(mockLoader.loadPipeline).toHaveBeenCalledWith('test-pipeline');
    });

    it('should validate pipeline before running', async () => {
      const config = { name: 'test-pipeline', trigger: 'manual', agents: [] };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockValidator.validateAndReport.mockResolvedValue(true);
      mockRunner.runPipeline.mockResolvedValue({ status: 'completed' });

      try {
        await runCommand(tempDir, 'test-pipeline');
      } catch (error) {
        // Expected
      }

      expect(mockValidator.validateAndReport).toHaveBeenCalledWith(config, tempDir);
    });

    it('should exit with code 1 when validation fails', async () => {
      const config = { name: 'invalid-pipeline', trigger: 'manual', agents: [] };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockValidator.validateAndReport.mockResolvedValue(false);

      await expect(
        runCommand(tempDir, 'invalid-pipeline')
      ).rejects.toThrow('process.exit(1)');

      expect(mockRunner.runPipeline).not.toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should create PipelineRunner with correct parameters', async () => {
      const config = { name: 'test-pipeline', trigger: 'manual', agents: [] };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockValidator.validateAndReport.mockResolvedValue(true);
      mockRunner.runPipeline.mockResolvedValue({ status: 'completed' });

      try {
        await runCommand(tempDir, 'test-pipeline');
      } catch (error) {
        // Expected
      }

      expect(PipelineRunner).toHaveBeenCalledWith(tempDir, undefined);
    });

    it('should run pipeline with config', async () => {
      const config = { name: 'test-pipeline', trigger: 'manual', agents: [] };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockValidator.validateAndReport.mockResolvedValue(true);
      mockRunner.runPipeline.mockResolvedValue({ status: 'completed' });

      try {
        await runCommand(tempDir, 'test-pipeline');
      } catch (error) {
        // Expected
      }

      expect(mockRunner.runPipeline).toHaveBeenCalledWith(config, expect.objectContaining({
        interactive: true
      }));
    });
  });

  describe('CLI Flag Overrides', () => {
    it('should disable notifications when --no-notifications flag set', async () => {
      const config = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
        notifications: { enabled: true },
      };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockValidator.validateAndReport.mockResolvedValue(true);
      mockRunner.runPipeline.mockResolvedValue({ status: 'completed' });

      try {
        await runCommand(tempDir, 'test-pipeline', { noNotifications: true });
      } catch (error) {
        // Expected
      }

      expect(mockValidator.validateAndReport).toHaveBeenCalledWith(
        expect.objectContaining({
          notifications: { enabled: false },
        }),
        tempDir
      );
    });

    it('should override base branch when --base-branch flag set', async () => {
      const config = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
        git: {
          baseBranch: 'main',
        },
      };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockValidator.validateAndReport.mockResolvedValue(true);
      mockRunner.runPipeline.mockResolvedValue({ status: 'completed' });

      try {
        await runCommand(tempDir, 'test-pipeline', { baseBranch: 'develop' });
      } catch (error) {
        // Expected
      }

      expect(mockValidator.validateAndReport).toHaveBeenCalledWith(
        expect.objectContaining({
          git: expect.objectContaining({
            baseBranch: 'develop',
          }),
        }),
        tempDir
      );
    });

    it('should set PR as draft when --pr-draft flag set', async () => {
      const config = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
        git: {
          pullRequest: { draft: false },
        },
      };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockValidator.validateAndReport.mockResolvedValue(true);
      mockRunner.runPipeline.mockResolvedValue({ status: 'completed' });

      try {
        await runCommand(tempDir, 'test-pipeline', { prDraft: true });
      } catch (error) {
        // Expected
      }

      expect(mockValidator.validateAndReport).toHaveBeenCalledWith(
        expect.objectContaining({
          git: expect.objectContaining({
            pullRequest: expect.objectContaining({
              draft: true,
            }),
          }),
        }),
        tempDir
      );
    });

    it('should enable web mode when --pr-web flag set', async () => {
      const config = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
        git: {
          pullRequest: {},
        },
      };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockValidator.validateAndReport.mockResolvedValue(true);
      mockRunner.runPipeline.mockResolvedValue({ status: 'completed' });

      try {
        await runCommand(tempDir, 'test-pipeline', { prWeb: true });
      } catch (error) {
        // Expected
      }

      expect(mockValidator.validateAndReport).toHaveBeenCalledWith(
        expect.objectContaining({
          git: expect.objectContaining({
            pullRequest: expect.objectContaining({
              web: true,
            }),
          }),
        }),
        tempDir
      );
    });

    it('should enable dry-run mode when --dry-run flag set', async () => {
      const config = { name: 'test-pipeline', trigger: 'manual', agents: [] };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockValidator.validateAndReport.mockResolvedValue(true);
      mockRunner.runPipeline.mockResolvedValue({ status: 'completed' });

      try {
        await runCommand(tempDir, 'test-pipeline', { dryRun: true });
      } catch (error) {
        // Expected
      }

      expect(PipelineRunner).toHaveBeenCalledWith(tempDir, true);
    });

    it('should apply multiple flag overrides together', async () => {
      const config = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
        notifications: { enabled: true },
        git: {
          baseBranch: 'main',
          mergeStrategy: 'pull-request',
          pullRequest: { draft: false },
        },
      };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockValidator.validateAndReport.mockResolvedValue(true);
      mockRunner.runPipeline.mockResolvedValue({ status: 'completed' });

      try {
        await runCommand(tempDir, 'test-pipeline', {
          noNotifications: true,
          baseBranch: 'staging',
          prDraft: true,
          dryRun: true,
        });
      } catch (error) {
        // Expected
      }

      expect(PipelineRunner).toHaveBeenCalledWith(tempDir, true);
      expect(mockValidator.validateAndReport).toHaveBeenCalledWith(
        expect.objectContaining({
          notifications: { enabled: false },
          git: expect.objectContaining({
            baseBranch: 'staging',
            pullRequest: expect.objectContaining({
              draft: true,
            }),
          }),
        }),
        tempDir
      );
    });
  });

  describe('Interactive Mode', () => {
    it('should run in interactive mode by default', async () => {
      const config = { name: 'test-pipeline', trigger: 'manual', agents: [] };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockValidator.validateAndReport.mockResolvedValue(true);
      mockRunner.runPipeline.mockResolvedValue({ status: 'completed' });

      try {
        await runCommand(tempDir, 'test-pipeline');
      } catch (error) {
        // Expected
      }

      expect(mockRender).toHaveBeenCalled();
      expect(mockRunner.runPipeline).toHaveBeenCalledWith(config, expect.objectContaining({
        interactive: true
      }));
    });

    it('should disable interactive mode when --no-interactive flag set', async () => {
      const config = { name: 'test-pipeline', trigger: 'manual', agents: [] };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockValidator.validateAndReport.mockResolvedValue(true);
      mockRunner.runPipeline.mockResolvedValue({ status: 'completed' });

      try {
        await runCommand(tempDir, 'test-pipeline', { interactive: false });
      } catch (error) {
        // Expected
      }

      expect(mockRender).not.toHaveBeenCalled();
      expect(mockRunner.runPipeline).toHaveBeenCalledWith(config, expect.objectContaining({
        interactive: false
      }));
    });

    it('should render UI when interactive mode is enabled', async () => {
      const config = { name: 'test-pipeline', trigger: 'manual', agents: [] };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockValidator.validateAndReport.mockResolvedValue(true);
      mockRunner.runPipeline.mockResolvedValue({ status: 'completed' });

      try {
        await runCommand(tempDir, 'test-pipeline', { interactive: true });
      } catch (error) {
        // Expected
      }

      expect(mockRender).toHaveBeenCalled();
    });

    it('should register onStateChange callback when UI is rendered', async () => {
      const config = { name: 'test-pipeline', trigger: 'manual', agents: [] };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockValidator.validateAndReport.mockResolvedValue(true);
      mockRunner.runPipeline.mockResolvedValue({ status: 'completed' });

      try {
        await runCommand(tempDir, 'test-pipeline');
      } catch (error) {
        // Expected
      }

      // UI component should receive onStateChange prop
      const renderCall = mockRender.mock.calls[0];
      expect(renderCall).toBeDefined();
      expect(renderCall[0].props.onStateChange).toBeInstanceOf(Function);
    });

    it('should unmount UI after pipeline completes', async () => {
      const config = { name: 'test-pipeline', trigger: 'manual', agents: [] };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockValidator.validateAndReport.mockResolvedValue(true);
      mockRunner.runPipeline.mockResolvedValue({ status: 'completed' });

      const mockUnmount = vi.fn();
      mockRender.mockReturnValue({ unmount: mockUnmount, waitUntilExit: vi.fn(() => Promise.resolve()) });

      try {
        await runCommand(tempDir, 'test-pipeline');
      } catch (error) {
        // Expected
      }

      expect(mockUnmount).toHaveBeenCalled();
    });

    it('should unmount UI on error', async () => {
      const config = { name: 'test-pipeline', trigger: 'manual', agents: [] };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockValidator.validateAndReport.mockResolvedValue(true);
      mockRunner.runPipeline.mockRejectedValue(new Error('Pipeline failed'));

      const mockUnmount = vi.fn();
      mockRender.mockReturnValue({ unmount: mockUnmount, waitUntilExit: vi.fn(() => Promise.resolve()) });

      try {
        await runCommand(tempDir, 'test-pipeline');
      } catch (error) {
        // Expected
      }

      expect(mockUnmount).toHaveBeenCalled();
    });
  });

  describe('Exit Codes', () => {
    it('should exit with code 0 when pipeline completes successfully', async () => {
      const config = { name: 'test-pipeline', trigger: 'manual', agents: [] };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockValidator.validateAndReport.mockResolvedValue(true);
      mockRunner.runPipeline.mockResolvedValue({ status: 'completed' });

      await expect(
        runCommand(tempDir, 'test-pipeline')
      ).rejects.toThrow('process.exit(0)');

      expect(processExitSpy).toHaveBeenCalledWith(0);
    });

    it('should exit with code 1 when pipeline fails', async () => {
      const config = { name: 'test-pipeline', trigger: 'manual', agents: [] };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockValidator.validateAndReport.mockResolvedValue(true);
      mockRunner.runPipeline.mockResolvedValue({ status: 'failed' });

      await expect(
        runCommand(tempDir, 'test-pipeline')
      ).rejects.toThrow('process.exit(1)');

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should exit with code 1 when validation fails', async () => {
      const config = { name: 'test-pipeline', trigger: 'manual', agents: [] };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockValidator.validateAndReport.mockResolvedValue(false);

      await expect(
        runCommand(tempDir, 'test-pipeline')
      ).rejects.toThrow('process.exit(1)');

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should exit with code 1 for partial pipeline completion', async () => {
      const config = { name: 'test-pipeline', trigger: 'manual', agents: [] };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockValidator.validateAndReport.mockResolvedValue(true);
      mockRunner.runPipeline.mockResolvedValue({ status: 'partial' });

      await expect(
        runCommand(tempDir, 'test-pipeline')
      ).rejects.toThrow('process.exit(1)');

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('Error Handling', () => {
    it('should handle pipeline load errors', async () => {
      mockLoader.loadPipeline.mockRejectedValue(new Error('Pipeline not found'));

      await expect(
        runCommand(tempDir, 'nonexistent-pipeline')
      ).rejects.toThrow('Pipeline not found');

      expect(mockValidator.validateAndReport).not.toHaveBeenCalled();
      expect(mockRunner.runPipeline).not.toHaveBeenCalled();
    });

    it('should handle runner errors and unmount UI', async () => {
      const config = { name: 'test-pipeline', trigger: 'manual', agents: [] };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockValidator.validateAndReport.mockResolvedValue(true);
      mockRunner.runPipeline.mockRejectedValue(new Error('Runner error'));

      const mockUnmount = vi.fn();
      mockRender.mockReturnValue({ unmount: mockUnmount, waitUntilExit: vi.fn(() => Promise.resolve()) });

      await expect(
        runCommand(tempDir, 'test-pipeline')
      ).rejects.toThrow('Runner error');

      expect(mockUnmount).toHaveBeenCalled();
    });

    it('should propagate errors after cleanup', async () => {
      const config = { name: 'test-pipeline', trigger: 'manual', agents: [] };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockValidator.validateAndReport.mockResolvedValue(true);
      mockRunner.runPipeline.mockRejectedValue(new Error('Custom error'));

      mockRender.mockReturnValue({ unmount: vi.fn(), waitUntilExit: vi.fn(() => Promise.resolve()) });

      await expect(
        runCommand(tempDir, 'test-pipeline')
      ).rejects.toThrow('Custom error');
    });

    it('should handle validation errors', async () => {
      const config = { name: 'test-pipeline', trigger: 'manual', agents: [] };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockValidator.validateAndReport.mockRejectedValue(new Error('Validation error'));

      await expect(
        runCommand(tempDir, 'test-pipeline')
      ).rejects.toThrow('Validation error');
    });
  });

  describe('Edge Cases', () => {
    it('should handle pipelines without git config', async () => {
      const config = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
        // No git config
      };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockValidator.validateAndReport.mockResolvedValue(true);
      mockRunner.runPipeline.mockResolvedValue({ status: 'completed' });

      try {
        await runCommand(tempDir, 'test-pipeline', { baseBranch: 'main' });
      } catch (error) {
        // Expected
      }

      // Should not crash
      expect(mockRunner.runPipeline).toHaveBeenCalled();
    });

    it('should handle pipelines without notification config', async () => {
      const config = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
        // No notifications
      };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockValidator.validateAndReport.mockResolvedValue(true);
      mockRunner.runPipeline.mockResolvedValue({ status: 'completed' });

      try {
        await runCommand(tempDir, 'test-pipeline', { noNotifications: true });
      } catch (error) {
        // Expected
      }

      expect(mockValidator.validateAndReport).toHaveBeenCalledWith(
        expect.objectContaining({
          notifications: { enabled: false },
        }),
        tempDir
      );
    });

    it('should handle pipelines without PR config', async () => {
      const config = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
        git: {},
      };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockValidator.validateAndReport.mockResolvedValue(true);
      mockRunner.runPipeline.mockResolvedValue({ status: 'completed' });

      try {
        await runCommand(tempDir, 'test-pipeline');
      } catch (error) {
        // Expected
      }

      // Should not crash when git.pullRequest doesn't exist
      expect(mockRunner.runPipeline).toHaveBeenCalled();
    });

    it('should handle very long pipeline names', async () => {
      const longName = 'very-long-pipeline-name-that-might-cause-issues';
      const config = { name: longName, trigger: 'manual', agents: [] };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockValidator.validateAndReport.mockResolvedValue(true);
      mockRunner.runPipeline.mockResolvedValue({ status: 'completed' });

      try {
        await runCommand(tempDir, longName);
      } catch (error) {
        // Expected
      }

      expect(mockLoader.loadPipeline).toHaveBeenCalledWith(longName);
    });
  });

  describe('Loop Options', () => {
    it('should pass loop flag to runner when --loop provided', async () => {
      const config = { name: 'test-pipeline', trigger: 'manual', agents: [] };
      const metadata = { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata });
      mockValidator.validateAndReport.mockResolvedValue(true);
      mockRunner.runPipeline.mockResolvedValue({ status: 'completed' });

      try {
        await runCommand(tempDir, 'test-pipeline', { loop: true });
      } catch (error) {
        // Expected
      }

      expect(mockRunner.runPipeline).toHaveBeenCalledWith(config, {
        interactive: true,
        verbose: false,
        loop: true,
        loopMetadata: metadata,
        maxLoopIterations: undefined
      });
    });

    it('should pass maxLoopIterations to runner when provided', async () => {
      const config = { name: 'test-pipeline', trigger: 'manual', agents: [] };
      const metadata = { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata });
      mockValidator.validateAndReport.mockResolvedValue(true);
      mockRunner.runPipeline.mockResolvedValue({ status: 'completed' });

      try {
        await runCommand(tempDir, 'test-pipeline', { loop: true, maxLoopIterations: 50 });
      } catch (error) {
        // Expected
      }

      expect(mockRunner.runPipeline).toHaveBeenCalledWith(config, {
        interactive: true,
        verbose: false,
        loop: true,
        loopMetadata: metadata,
        maxLoopIterations: 50
      });
    });

    it('should use metadata from loader as loopMetadata when not provided', async () => {
      const config = { name: 'test-pipeline', trigger: 'manual', agents: [] };
      const metadata = { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata });
      mockValidator.validateAndReport.mockResolvedValue(true);
      mockRunner.runPipeline.mockResolvedValue({ status: 'completed' });

      try {
        await runCommand(tempDir, 'test-pipeline', { loop: true });
      } catch (error) {
        // Expected
      }

      expect(mockRunner.runPipeline).toHaveBeenCalledWith(config,
        expect.objectContaining({
          loopMetadata: metadata
        })
      );
    });

    it('should override loopMetadata when explicitly provided', async () => {
      const config = { name: 'test-pipeline', trigger: 'manual', agents: [] };
      const loaderMetadata = { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() };
      const customMetadata = { sourcePath: "/custom/path.yml", sourceType: "loop-pending" as const, loadedAt: new Date().toISOString() };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: loaderMetadata });
      mockValidator.validateAndReport.mockResolvedValue(true);
      mockRunner.runPipeline.mockResolvedValue({ status: 'completed' });

      try {
        await runCommand(tempDir, 'test-pipeline', {
          loop: true,
          loopMetadata: customMetadata
        });
      } catch (error) {
        // Expected
      }

      expect(mockRunner.runPipeline).toHaveBeenCalledWith(config,
        expect.objectContaining({
          loopMetadata: customMetadata
        })
      );
    });

    it('should work without loop flag (default behavior)', async () => {
      const config = { name: 'test-pipeline', trigger: 'manual', agents: [] };
      const metadata = { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata });
      mockValidator.validateAndReport.mockResolvedValue(true);
      mockRunner.runPipeline.mockResolvedValue({ status: 'completed' });

      try {
        await runCommand(tempDir, 'test-pipeline');
      } catch (error) {
        // Expected
      }

      expect(mockRunner.runPipeline).toHaveBeenCalledWith(config, {
        interactive: true,
        verbose: false,
        loop: undefined,
        loopMetadata: metadata,
        maxLoopIterations: undefined
      });
    });

    it('should combine loop options with other flags', async () => {
      const config = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
        git: { baseBranch: 'main' }
      };
      const metadata = { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata });
      mockValidator.validateAndReport.mockResolvedValue(true);
      mockRunner.runPipeline.mockResolvedValue({ status: 'completed' });

      try {
        await runCommand(tempDir, 'test-pipeline', {
          loop: true,
          maxLoopIterations: 10,
          dryRun: true,
          interactive: false,
          baseBranch: 'develop'
        });
      } catch (error) {
        // Expected
      }

      expect(PipelineRunner).toHaveBeenCalledWith(tempDir, true);
      expect(mockRunner.runPipeline).toHaveBeenCalledWith(
        expect.objectContaining({
          git: expect.objectContaining({
            baseBranch: 'develop'
          })
        }),
        {
          interactive: false,
          verbose: false,
          loop: true,
          loopMetadata: metadata,
          maxLoopIterations: 10
        }
      );
    });

    // Part E: UI Lifecycle and Exit Code Tests
    it('should keep UI mounted and only unmount in finally block', async () => {
      const config = { name: 'test-pipeline', trigger: 'manual', agents: [] };
      const metadata = { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata });
      mockValidator.validateAndReport.mockResolvedValue(true);
      mockRunner.runPipeline.mockResolvedValue({ status: 'completed' });

      const mockUnmount = vi.fn();
      mockRender.mockReturnValue({ unmount: mockUnmount, waitUntilExit: vi.fn(() => Promise.resolve()) });

      try {
        await runCommand(tempDir, 'test-pipeline', { interactive: true, loop: true });
      } catch (error) {
        // Expected - process.exit throws
      }

      // UI should be rendered
      expect(mockRender).toHaveBeenCalled();

      // Unmount should be called exactly once (in finally block)
      expect(mockUnmount).toHaveBeenCalledTimes(1);
    });

    it('should exit with code 1 when loop limit is reached', async () => {
      const config = { name: 'test-pipeline', trigger: 'manual', agents: [] };
      const metadata = { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata });
      mockValidator.validateAndReport.mockResolvedValue(true);
      // Simulate loop limit reached by returning failed status
      mockRunner.runPipeline.mockResolvedValue({ status: 'failed' });

      try {
        await runCommand(tempDir, 'test-pipeline', { loop: true, maxLoopIterations: 2 });
      } catch (error: any) {
        expect(error.message).toBe('process.exit(1)');
      }

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should exit with code 0 on natural loop completion', async () => {
      const config = { name: 'test-pipeline', trigger: 'manual', agents: [] };
      const metadata = { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata });
      mockValidator.validateAndReport.mockResolvedValue(true);
      mockRunner.runPipeline.mockResolvedValue({ status: 'completed' });

      try {
        await runCommand(tempDir, 'test-pipeline', { loop: true });
      } catch (error: any) {
        expect(error.message).toBe('process.exit(0)');
      }

      expect(processExitSpy).toHaveBeenCalledWith(0);
    });

    it('should unmount UI even when runner throws error', async () => {
      const config = { name: 'test-pipeline', trigger: 'manual', agents: [] };
      const metadata = { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata });
      mockValidator.validateAndReport.mockResolvedValue(true);
      mockRunner.runPipeline.mockRejectedValue(new Error('Pipeline execution failed'));

      const mockUnmount = vi.fn();
      mockRender.mockReturnValue({ unmount: mockUnmount, waitUntilExit: vi.fn(() => Promise.resolve()) });

      try {
        await runCommand(tempDir, 'test-pipeline', { interactive: true });
      } catch (error) {
        // Expected - error from runner
      }

      // UI should still be unmounted in finally block
      expect(mockUnmount).toHaveBeenCalledTimes(1);
    });

    it('should not attempt to unmount UI in non-interactive mode', async () => {
      const config = { name: 'test-pipeline', trigger: 'manual', agents: [] };
      const metadata = { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata });
      mockValidator.validateAndReport.mockResolvedValue(true);
      mockRunner.runPipeline.mockResolvedValue({ status: 'completed' });

      const mockUnmount = vi.fn();
      mockRender.mockReturnValue({ unmount: mockUnmount, waitUntilExit: vi.fn(() => Promise.resolve()) });

      try {
        await runCommand(tempDir, 'test-pipeline', { interactive: false });
      } catch (error) {
        // Expected - process.exit throws
      }

      // UI should not be rendered in non-interactive mode
      expect(mockRender).not.toHaveBeenCalled();
      expect(mockUnmount).not.toHaveBeenCalled();
    });
  });

  describe('Integration', () => {
    it('should complete full workflow successfully', async () => {
      const config = {
        name: 'full-pipeline',
        trigger: 'post-commit',
        agents: [
          { name: 'reviewer', agent: '.agent-pipeline/agents/reviewer.md' },
        ],
        git: {
          baseBranch: 'main',
          mergeStrategy: 'pull-request',
        },
      };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockValidator.validateAndReport.mockResolvedValue(true);
      mockRunner.runPipeline.mockResolvedValue({ status: 'completed' });

      mockRender.mockReturnValue({ unmount: vi.fn(), waitUntilExit: vi.fn(() => Promise.resolve()) });

      try {
        await runCommand(tempDir, 'full-pipeline');
      } catch (error) {
        // Expected to exit
      }

      expect(PipelineLoader).toHaveBeenCalledWith(tempDir);
      expect(mockLoader.loadPipeline).toHaveBeenCalledWith('full-pipeline');
      expect(mockValidator.validateAndReport).toHaveBeenCalledWith(config, tempDir);
      expect(PipelineRunner).toHaveBeenCalledWith(tempDir, undefined);
      expect(mockRunner.runPipeline).toHaveBeenCalledWith(config, expect.objectContaining({
        interactive: true
      }));
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });

    it('should work with different repository paths', async () => {
      const customPath = '/custom/repo/path';
      const config = { name: 'test-pipeline', trigger: 'manual', agents: [] };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockValidator.validateAndReport.mockResolvedValue(true);
      mockRunner.runPipeline.mockResolvedValue({ status: 'completed' });

      try {
        await runCommand(customPath, 'test-pipeline');
      } catch (error) {
        // Expected
      }

      expect(PipelineLoader).toHaveBeenCalledWith(customPath);
      expect(PipelineRunner).toHaveBeenCalledWith(customPath, undefined);
    });

    it('should handle complete workflow with all flags', async () => {
      const config = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
        git: {
          baseBranch: 'main',
          mergeStrategy: 'pull-request',
          pullRequest: { draft: false },
        },
        notifications: { enabled: true },
      };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockValidator.validateAndReport.mockResolvedValue(true);
      mockRunner.runPipeline.mockResolvedValue({ status: 'completed' });

      try {
        await runCommand(tempDir, 'test-pipeline', {
          dryRun: true,
          interactive: false,
          baseBranch: 'develop',
          prDraft: true,
          prWeb: true,
          noNotifications: true,
        });
      } catch (error) {
        // Expected
      }

      expect(PipelineRunner).toHaveBeenCalledWith(tempDir, true);
      expect(mockRender).not.toHaveBeenCalled();
      expect(mockRunner.runPipeline).toHaveBeenCalledWith(
        expect.objectContaining({
          git: expect.objectContaining({
            baseBranch: 'develop',
            pullRequest: expect.objectContaining({
              draft: true,
              web: true,
            }),
          }),
          notifications: { enabled: false },
        }),
        expect.objectContaining({
          interactive: false
        })
      );
    });
  });
});
