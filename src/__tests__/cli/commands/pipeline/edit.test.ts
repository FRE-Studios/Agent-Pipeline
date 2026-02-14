import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { editPipelineCommand } from '../../../../cli/commands/pipeline/edit.js';
import { PipelineLoader } from '../../../../config/pipeline-loader.js';
import { PipelineValidator } from '../../../../validators/pipeline-validator.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createTempDir, cleanupTempDir } from '../../../setup.js';
import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';

// Mock dependencies
vi.mock('fs/promises');
vi.mock('../../../../config/pipeline-loader.js');
vi.mock('../../../../validators/pipeline-validator.js');
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

describe('editPipelineCommand', () => {
  let tempDir: string;
  let mockLoader: any;
  let processExitSpy: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    tempDir = await createTempDir('edit-pipeline-test-');

    // Save original env
    originalEnv = { ...process.env };

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
    process.env = originalEnv;
    vi.clearAllMocks();
    processExitSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('Basic Execution', () => {
    it('should verify pipeline exists before opening', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue(mockConfig);

      const mockChild = {
        on: vi.fn((event, callback) => {
          if (event === 'exit') {
            setTimeout(() => callback(0), 0);
          }
        }),
      } as unknown as ChildProcess;

      vi.mocked(spawn).mockReturnValue(mockChild);
      vi.mocked(fs.readFile).mockResolvedValue('name: test-pipeline\ntrigger: manual\nagents: []');
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);

      process.env.EDITOR = 'vi';

      try {
        await editPipelineCommand(tempDir, 'test-pipeline');
      } catch (error) {
        // Expected
      }

      expect(mockLoader.loadPipeline).toHaveBeenCalledWith('test-pipeline');
    });

    it('should use EDITOR environment variable', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue(mockConfig);

      const mockChild = {
        on: vi.fn((event, callback) => {
          if (event === 'exit') {
            setTimeout(() => callback(0), 0);
          }
        }),
      } as unknown as ChildProcess;

      vi.mocked(spawn).mockReturnValue(mockChild);
      vi.mocked(fs.readFile).mockResolvedValue('name: test-pipeline\ntrigger: manual\nagents: []');
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);

      process.env.EDITOR = 'nano';

      try {
        await editPipelineCommand(tempDir, 'test-pipeline');
      } catch (error) {
        // Expected
      }

      expect(spawn).toHaveBeenCalledWith(
        'nano',
        [path.join(tempDir, '.agent-pipeline', 'pipelines', 'test-pipeline.yml')],
        expect.objectContaining({ stdio: 'inherit' })
      );
    });

    it('should use VISUAL environment variable if EDITOR not set', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue(mockConfig);

      const mockChild = {
        on: vi.fn((event, callback) => {
          if (event === 'exit') {
            setTimeout(() => callback(0), 0);
          }
        }),
      } as unknown as ChildProcess;

      vi.mocked(spawn).mockReturnValue(mockChild);
      vi.mocked(fs.readFile).mockResolvedValue('name: test-pipeline\ntrigger: manual\nagents: []');
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);

      delete process.env.EDITOR;
      process.env.VISUAL = 'emacs';

      try {
        await editPipelineCommand(tempDir, 'test-pipeline');
      } catch (error) {
        // Expected
      }

      expect(spawn).toHaveBeenCalledWith(
        'emacs',
        expect.any(Array),
        expect.any(Object)
      );
    });

    it('should parse editor with arguments (e.g. "code --wait")', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue(mockConfig);

      const mockChild = {
        on: vi.fn((event, callback) => {
          if (event === 'exit') {
            setTimeout(() => callback(0), 0);
          }
        }),
      } as unknown as ChildProcess;

      vi.mocked(spawn).mockReturnValue(mockChild);
      vi.mocked(fs.readFile).mockResolvedValue('name: test-pipeline\ntrigger: manual\nagents: []');
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);

      process.env.EDITOR = 'code --wait';

      try {
        await editPipelineCommand(tempDir, 'test-pipeline');
      } catch (error) {
        // Expected
      }

      expect(spawn).toHaveBeenCalledWith(
        'code',
        ['--wait', path.join(tempDir, '.agent-pipeline', 'pipelines', 'test-pipeline.yml')],
        expect.objectContaining({ stdio: 'inherit' })
      );
    });

    it('should fall back to vi if no editor env vars set', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue(mockConfig);

      const mockChild = {
        on: vi.fn((event, callback) => {
          if (event === 'exit') {
            setTimeout(() => callback(0), 0);
          }
        }),
      } as unknown as ChildProcess;

      vi.mocked(spawn).mockReturnValue(mockChild);
      vi.mocked(fs.readFile).mockResolvedValue('name: test-pipeline\ntrigger: manual\nagents: []');
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);

      delete process.env.EDITOR;
      delete process.env.VISUAL;

      try {
        await editPipelineCommand(tempDir, 'test-pipeline');
      } catch (error) {
        // Expected
      }

      expect(spawn).toHaveBeenCalledWith(
        'vi',
        expect.any(Array),
        expect.any(Object)
      );
    });

    it('should spawn editor with correct file path', async () => {
      const mockConfig = {
        name: 'my-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue(mockConfig);

      const mockChild = {
        on: vi.fn((event, callback) => {
          if (event === 'exit') {
            setTimeout(() => callback(0), 0);
          }
        }),
      } as unknown as ChildProcess;

      vi.mocked(spawn).mockReturnValue(mockChild);
      vi.mocked(fs.readFile).mockResolvedValue('name: my-pipeline\ntrigger: manual\nagents: []');
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);

      process.env.EDITOR = 'vi';

      try {
        await editPipelineCommand(tempDir, 'my-pipeline');
      } catch (error) {
        // Expected
      }

      expect(spawn).toHaveBeenCalledWith(
        'vi',
        [path.join(tempDir, '.agent-pipeline', 'pipelines', 'my-pipeline.yml')],
        expect.objectContaining({ stdio: 'inherit' })
      );
    });

    it('should wait for editor to close', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue(mockConfig);

      let exitCallback: any = null;
      const mockChild = {
        on: vi.fn((event, callback) => {
          if (event === 'exit') {
            exitCallback = callback;
          }
          return mockChild; // Return for chaining
        }),
      } as unknown as ChildProcess;

      vi.mocked(spawn).mockReturnValue(mockChild);
      vi.mocked(fs.readFile).mockResolvedValue('name: test-pipeline\ntrigger: manual\nagents: []');
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);

      process.env.EDITOR = 'vi';

      const promise = editPipelineCommand(tempDir, 'test-pipeline');

      // Wait for the callback to be registered
      await new Promise(resolve => setTimeout(resolve, 10));

      // Editor hasn't closed yet, validation shouldn't be called
      expect(PipelineValidator.validateAndReport).not.toHaveBeenCalled();

      // Now close the editor
      if (exitCallback) {
        exitCallback(0);
      }

      try {
        await promise;
      } catch (error) {
        // Expected
      }

      // Now validation should be called
      expect(PipelineValidator.validateAndReport).toHaveBeenCalled();
    });
  });

  describe('Post-Edit Validation', () => {
    it('should read file after edit', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue(mockConfig);

      const mockChild = {
        on: vi.fn((event, callback) => {
          if (event === 'exit') {
            setTimeout(() => callback(0), 0);
          }
        }),
      } as unknown as ChildProcess;

      vi.mocked(spawn).mockReturnValue(mockChild);
      vi.mocked(fs.readFile).mockResolvedValue('name: test-pipeline\ntrigger: manual\nagents: []');
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);

      process.env.EDITOR = 'vi';

      try {
        await editPipelineCommand(tempDir, 'test-pipeline');
      } catch (error) {
        // Expected
      }

      expect(fs.readFile).toHaveBeenCalledWith(
        path.join(tempDir, '.agent-pipeline', 'pipelines', 'test-pipeline.yml'),
        'utf-8'
      );
    });

    it('should parse YAML after edit', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue(mockConfig);

      const mockChild = {
        on: vi.fn((event, callback) => {
          if (event === 'exit') {
            setTimeout(() => callback(0), 0);
          }
        }),
      } as unknown as ChildProcess;

      vi.mocked(spawn).mockReturnValue(mockChild);
      const yamlContent = 'name: updated-pipeline\ntrigger: post-commit\nagents: []';
      vi.mocked(fs.readFile).mockResolvedValue(yamlContent);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);

      process.env.EDITOR = 'vi';

      try {
        await editPipelineCommand(tempDir, 'test-pipeline');
      } catch (error) {
        // Expected
      }

      expect(PipelineValidator.validateAndReport).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'updated-pipeline',
          trigger: 'post-commit',
        }),
        tempDir
      );
    });

    it('should validate pipeline after edit', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue(mockConfig);

      const mockChild = {
        on: vi.fn((event, callback) => {
          if (event === 'exit') {
            setTimeout(() => callback(0), 0);
          }
        }),
      } as unknown as ChildProcess;

      vi.mocked(spawn).mockReturnValue(mockChild);
      vi.mocked(fs.readFile).mockResolvedValue('name: test-pipeline\ntrigger: manual\nagents: []');
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);

      process.env.EDITOR = 'vi';

      try {
        await editPipelineCommand(tempDir, 'test-pipeline');
      } catch (error) {
        // Expected
      }

      expect(PipelineValidator.validateAndReport).toHaveBeenCalled();
    });

    it('should show success message when valid', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue(mockConfig);

      const mockChild = {
        on: vi.fn((event, callback) => {
          if (event === 'exit') {
            setTimeout(() => callback(0), 0);
          }
        }),
      } as unknown as ChildProcess;

      vi.mocked(spawn).mockReturnValue(mockChild);
      vi.mocked(fs.readFile).mockResolvedValue('name: test-pipeline\ntrigger: manual\nagents: []');
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);

      process.env.EDITOR = 'vi';

      try {
        await editPipelineCommand(tempDir, 'test-pipeline');
      } catch (error) {
        // Expected
      }

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Pipeline is valid'));
    });

    it('should exit when validation fails', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue(mockConfig);

      const mockChild = {
        on: vi.fn((event, callback) => {
          if (event === 'exit') {
            setTimeout(() => callback(0), 0);
          }
        }),
      } as unknown as ChildProcess;

      vi.mocked(spawn).mockReturnValue(mockChild);
      vi.mocked(fs.readFile).mockResolvedValue('name: test-pipeline\ntrigger: invalid\nagents: []');
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(false);

      process.env.EDITOR = 'vi';

      await expect(
        editPipelineCommand(tempDir, 'test-pipeline')
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Pipeline has validation errors'));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('Error Handling', () => {
    it('should exit when pipeline not found', async () => {
      mockLoader.loadPipeline.mockRejectedValue(new Error('Pipeline not found'));

      await expect(
        editPipelineCommand(tempDir, 'nonexistent-pipeline')
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Pipeline "nonexistent-pipeline" not found')
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle editor exit with non-zero code', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue(mockConfig);

      const mockChild = {
        on: vi.fn((event, callback) => {
          if (event === 'exit') {
            setTimeout(() => callback(1), 0);
          }
        }),
      } as unknown as ChildProcess;

      vi.mocked(spawn).mockReturnValue(mockChild);

      process.env.EDITOR = 'vi';

      await expect(
        editPipelineCommand(tempDir, 'test-pipeline')
      ).rejects.toThrow('process.exit(1)');

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle editor spawn errors', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue(mockConfig);

      const mockChild = {
        on: vi.fn((event, callback) => {
          if (event === 'error') {
            setTimeout(() => callback(new Error('Editor not found')), 0);
          }
        }),
      } as unknown as ChildProcess;

      vi.mocked(spawn).mockReturnValue(mockChild);

      process.env.EDITOR = 'nonexistent-editor';

      await expect(
        editPipelineCommand(tempDir, 'test-pipeline')
      ).rejects.toThrow('process.exit(1)');

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle file read errors after edit', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue(mockConfig);

      const mockChild = {
        on: vi.fn((event, callback) => {
          if (event === 'exit') {
            setTimeout(() => callback(0), 0);
          }
        }),
      } as unknown as ChildProcess;

      vi.mocked(spawn).mockReturnValue(mockChild);
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File deleted'));

      process.env.EDITOR = 'vi';

      await expect(
        editPipelineCommand(tempDir, 'test-pipeline')
      ).rejects.toThrow('process.exit(1)');

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle YAML parse errors', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue(mockConfig);

      const mockChild = {
        on: vi.fn((event, callback) => {
          if (event === 'exit') {
            setTimeout(() => callback(0), 0);
          }
        }),
      } as unknown as ChildProcess;

      vi.mocked(spawn).mockReturnValue(mockChild);
      vi.mocked(fs.readFile).mockResolvedValue('invalid: yaml: content: {{{');

      process.env.EDITOR = 'vi';

      await expect(
        editPipelineCommand(tempDir, 'test-pipeline')
      ).rejects.toThrow('process.exit(1)');

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle generic errors', async () => {
      mockLoader.loadPipeline.mockRejectedValue(new Error('Some random error'));

      await expect(
        editPipelineCommand(tempDir, 'test-pipeline')
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to edit pipeline')
      );
    });
  });

  describe('Integration', () => {
    it('should complete full workflow successfully', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue(mockConfig);

      const mockChild = {
        on: vi.fn((event, callback) => {
          if (event === 'exit') {
            setTimeout(() => callback(0), 0);
          }
        }),
      } as unknown as ChildProcess;

      vi.mocked(spawn).mockReturnValue(mockChild);
      vi.mocked(fs.readFile).mockResolvedValue('name: test-pipeline\ntrigger: post-commit\nagents: []');
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);

      process.env.EDITOR = 'nano';

      try {
        await editPipelineCommand(tempDir, 'test-pipeline');
      } catch (error) {
        // Expected
      }

      expect(PipelineLoader).toHaveBeenCalledWith(tempDir);
      expect(mockLoader.loadPipeline).toHaveBeenCalledWith('test-pipeline');
      expect(spawn).toHaveBeenCalled();
      expect(fs.readFile).toHaveBeenCalled();
      expect(PipelineValidator.validateAndReport).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Pipeline is valid'));
    });
  });
});
