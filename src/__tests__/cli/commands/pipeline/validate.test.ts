import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { validatePipelineCommand } from '../../../../cli/commands/pipeline/validate.js';
import { PipelineLoader } from '../../../../config/pipeline-loader.js';
import { PipelineValidator } from '../../../../validators/pipeline-validator.js';
import { createTempDir, cleanupTempDir } from '../../../setup.js';

// Mock dependencies
vi.mock('../../../../config/pipeline-loader.js');
vi.mock('../../../../validators/pipeline-validator.js');

describe('validatePipelineCommand', () => {
  let tempDir: string;
  let mockLoader: any;
  let processExitSpy: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;

  beforeEach(async () => {
    tempDir = await createTempDir('validate-pipeline-test-');

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
    it('should load pipeline configuration', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue({
        config: mockConfig,
        metadata: {
          sourcePath: "/test/path.yml",
          sourceType: "library" as const,
          loadedAt: new Date().toISOString()
        }
      });
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);

      try {
        await validatePipelineCommand(tempDir, 'test-pipeline');
      } catch (error) {
        // Expected to exit
      }

      expect(mockLoader.loadPipeline).toHaveBeenCalledWith('test-pipeline');
    });

    it('should validate using PipelineValidator', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue({
        config: mockConfig,
        metadata: {
          sourcePath: "/test/path.yml",
          sourceType: "library" as const,
          loadedAt: new Date().toISOString()
        }
      });
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);

      try {
        await validatePipelineCommand(tempDir, 'test-pipeline');
      } catch (error) {
        // Expected to exit
      }

      expect(PipelineValidator.validateAndReport).toHaveBeenCalledWith(mockConfig, tempDir);
    });

    it('should show validation report', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue({
        config: mockConfig,
        metadata: {
          sourcePath: "/test/path.yml",
          sourceType: "library" as const,
          loadedAt: new Date().toISOString()
        }
      });
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);

      try {
        await validatePipelineCommand(tempDir, 'test-pipeline');
      } catch (error) {
        // Expected to exit
      }

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Validating pipeline: test-pipeline'));
    });
  });

  describe('Exit Codes', () => {
    it('should exit with 0 when pipeline is valid', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue({
        config: mockConfig,
        metadata: {
          sourcePath: "/test/path.yml",
          sourceType: "library" as const,
          loadedAt: new Date().toISOString()
        }
      });
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);

      try {
        await validatePipelineCommand(tempDir, 'test-pipeline');
      } catch (error) {
        // Expected to exit
      }

      expect(processExitSpy).toHaveBeenCalledWith(0);
    });

    it('should exit with 1 when pipeline is invalid', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'invalid-trigger',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue({
        config: mockConfig,
        metadata: {
          sourcePath: "/test/path.yml",
          sourceType: "library" as const,
          loadedAt: new Date().toISOString()
        }
      });
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(false);

      await expect(
        validatePipelineCommand(tempDir, 'test-pipeline')
      ).rejects.toThrow('process.exit(1)');

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('Success Messages', () => {
    it('should show success message when valid', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue({
        config: mockConfig,
        metadata: {
          sourcePath: "/test/path.yml",
          sourceType: "library" as const,
          loadedAt: new Date().toISOString()
        }
      });
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);

      try {
        await validatePipelineCommand(tempDir, 'test-pipeline');
      } catch (error) {
        // Expected to exit
      }

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Pipeline is valid'));
    });

    it('should show error message when invalid', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue({
        config: mockConfig,
        metadata: {
          sourcePath: "/test/path.yml",
          sourceType: "library" as const,
          loadedAt: new Date().toISOString()
        }
      });
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(false);

      await expect(
        validatePipelineCommand(tempDir, 'test-pipeline')
      ).rejects.toThrow('process.exit(1)');

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Pipeline has validation errors'));
    });
  });

  describe('Error Handling', () => {
    it('should exit when pipeline not found', async () => {
      mockLoader.loadPipeline.mockRejectedValue(new Error('Pipeline not found'));

      await expect(
        validatePipelineCommand(tempDir, 'nonexistent-pipeline')
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Pipeline "nonexistent-pipeline" not found')
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle validation errors', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue({
        config: mockConfig,
        metadata: {
          sourcePath: "/test/path.yml",
          sourceType: "library" as const,
          loadedAt: new Date().toISOString()
        }
      });
      vi.mocked(PipelineValidator.validateAndReport).mockRejectedValue(new Error('Validation crashed'));

      await expect(
        validatePipelineCommand(tempDir, 'test-pipeline')
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Validation failed'));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle generic errors', async () => {
      mockLoader.loadPipeline.mockRejectedValue(new Error('Some random error'));

      await expect(
        validatePipelineCommand(tempDir, 'test-pipeline')
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Validation failed'));
    });
  });

  describe('Integration', () => {
    it('should complete full workflow successfully', async () => {
      const mockConfig = {
        name: 'full-pipeline',
        trigger: 'post-commit',
        agents: [{ name: 'agent1', agent: 'agent1.md' }],
      };
      mockLoader.loadPipeline.mockResolvedValue({
        config: mockConfig,
        metadata: {
          sourcePath: "/test/path.yml",
          sourceType: "library" as const,
          loadedAt: new Date().toISOString()
        }
      });
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);

      try {
        await validatePipelineCommand(tempDir, 'full-pipeline');
      } catch (error) {
        // Expected to exit
      }

      expect(PipelineLoader).toHaveBeenCalledWith(tempDir);
      expect(mockLoader.loadPipeline).toHaveBeenCalledWith('full-pipeline');
      expect(PipelineValidator.validateAndReport).toHaveBeenCalledWith(mockConfig, tempDir);
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });

    it('should work with complex pipeline configurations', async () => {
      const mockConfig = {
        name: 'complex-pipeline',
        trigger: 'post-commit',
        settings: {
          autoCommit: true,
          failureStrategy: 'continue',
        },
        agents: [
          { name: 'agent1', agent: 'agent1.md' },
          { name: 'agent2', agent: 'agent2.md', dependsOn: ['agent1'] },
        ],
      };
      mockLoader.loadPipeline.mockResolvedValue({
        config: mockConfig,
        metadata: {
          sourcePath: "/test/path.yml",
          sourceType: "library" as const,
          loadedAt: new Date().toISOString()
        }
      });
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);

      try {
        await validatePipelineCommand(tempDir, 'complex-pipeline');
      } catch (error) {
        // Expected to exit
      }

      expect(PipelineValidator.validateAndReport).toHaveBeenCalledWith(mockConfig, tempDir);
    });
  });
});
