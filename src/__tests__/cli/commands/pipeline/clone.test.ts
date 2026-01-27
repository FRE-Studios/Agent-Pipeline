import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { clonePipelineCommand } from '../../../../cli/commands/pipeline/clone.js';
import { PipelineLoader } from '../../../../config/pipeline-loader.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as YAML from 'yaml';
import { createTempDir, cleanupTempDir } from '../../../setup.js';

// Mock dependencies
vi.mock('fs/promises');
vi.mock('../../../../config/pipeline-loader.js');

describe('clonePipelineCommand', () => {
  let tempDir: string;
  let mockLoader: any;
  let processExitSpy: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;

  beforeEach(async () => {
    tempDir = await createTempDir('clone-pipeline-test-');

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
    it('should load source pipeline', async () => {
      const mockConfig = {
        name: 'source-pipeline',
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
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      try {
        await clonePipelineCommand(tempDir, 'source-pipeline');
      } catch (error) {
        // Expected
      }

      expect(mockLoader.loadPipeline).toHaveBeenCalledWith('source-pipeline');
    });

    it('should clone with "{name}-clone" when no dest name provided', async () => {
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
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      try {
        await clonePipelineCommand(tempDir, 'test-pipeline');
      } catch (error) {
        // Expected
      }

      expect(fs.writeFile).toHaveBeenCalledWith(
        path.join(tempDir, '.agent-pipeline', 'pipelines', 'test-pipeline-clone.yml'),
        expect.any(String),
        'utf-8'
      );
    });

    it('should use custom dest name when provided', async () => {
      const mockConfig = {
        name: 'source-pipeline',
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
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      try {
        await clonePipelineCommand(tempDir, 'source-pipeline', 'custom-name');
      } catch (error) {
        // Expected
      }

      expect(fs.writeFile).toHaveBeenCalledWith(
        path.join(tempDir, '.agent-pipeline', 'pipelines', 'custom-name.yml'),
        expect.any(String),
        'utf-8'
      );
    });

    it('should update name field in cloned config', async () => {
      const mockConfig = {
        name: 'source-pipeline',
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
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      try {
        await clonePipelineCommand(tempDir, 'source-pipeline', 'cloned-pipeline');
      } catch (error) {
        // Expected
      }

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const writtenYaml = writeCall[1] as string;
      const parsedConfig = YAML.parse(writtenYaml);

      expect(parsedConfig.name).toBe('cloned-pipeline');
    });

    it('should preserve all other pipeline settings', async () => {
      const mockConfig = {
        name: 'source-pipeline',
        trigger: 'post-commit',
        settings: {
          autoCommit: true,
          commitPrefix: '[test]',
          failureStrategy: 'stop',
          executionMode: 'parallel',
        },
        agents: [
          { name: 'agent1', agent: 'agent1.md' },
          { name: 'agent2', agent: 'agent2.md' },
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
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      try {
        await clonePipelineCommand(tempDir, 'source-pipeline');
      } catch (error) {
        // Expected
      }

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const writtenYaml = writeCall[1] as string;
      const parsedConfig = YAML.parse(writtenYaml);

      expect(parsedConfig.trigger).toBe('post-commit');
      expect(parsedConfig.settings).toEqual(mockConfig.settings);
      expect(parsedConfig.agents).toEqual(mockConfig.agents);
    });

    it('should write to correct file path', async () => {
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
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      try {
        await clonePipelineCommand(tempDir, 'test-pipeline');
      } catch (error) {
        // Expected
      }

      expect(fs.writeFile).toHaveBeenCalledWith(
        path.join(tempDir, '.agent-pipeline', 'pipelines', 'test-pipeline-clone.yml'),
        expect.any(String),
        'utf-8'
      );
    });
  });

  describe('Auto-incrementing Names', () => {
    it('should add -1 suffix when clone already exists', async () => {
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

      // Mock: first access (test-pipeline-clone) exists, second doesn't
      vi.mocked(fs.access)
        .mockResolvedValueOnce(undefined) // First file exists
        .mockRejectedValueOnce(new Error('File not found')); // Second file doesn't exist

      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      try {
        await clonePipelineCommand(tempDir, 'test-pipeline');
      } catch (error) {
        // Expected
      }

      expect(fs.writeFile).toHaveBeenCalledWith(
        path.join(tempDir, '.agent-pipeline', 'pipelines', 'test-pipeline-clone-1.yml'),
        expect.any(String),
        'utf-8'
      );
    });

    it('should increment suffix multiple times if needed', async () => {
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

      // Mock: first 3 files exist, 4th doesn't
      vi.mocked(fs.access)
        .mockResolvedValueOnce(undefined) // test-pipeline-clone exists
        .mockResolvedValueOnce(undefined) // test-pipeline-clone-1 exists
        .mockResolvedValueOnce(undefined) // test-pipeline-clone-2 exists
        .mockRejectedValueOnce(new Error('File not found')); // test-pipeline-clone-3 doesn't exist

      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      try {
        await clonePipelineCommand(tempDir, 'test-pipeline');
      } catch (error) {
        // Expected
      }

      expect(fs.writeFile).toHaveBeenCalledWith(
        path.join(tempDir, '.agent-pipeline', 'pipelines', 'test-pipeline-clone-3.yml'),
        expect.any(String),
        'utf-8'
      );
    });

    it('should add suffix to custom dest name when it exists', async () => {
      const mockConfig = {
        name: 'source-pipeline',
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

      // Mock: custom-name exists, custom-name-1 doesn't
      vi.mocked(fs.access)
        .mockResolvedValueOnce(undefined) // custom-name exists
        .mockRejectedValueOnce(new Error('File not found')); // custom-name-1 doesn't

      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      try {
        await clonePipelineCommand(tempDir, 'source-pipeline', 'custom-name');
      } catch (error) {
        // Expected
      }

      expect(fs.writeFile).toHaveBeenCalledWith(
        path.join(tempDir, '.agent-pipeline', 'pipelines', 'custom-name-1.yml'),
        expect.any(String),
        'utf-8'
      );
    });

    it('should update name field with incremented suffix', async () => {
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

      // Mock: clone exists, clone-1 doesn't
      vi.mocked(fs.access)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('File not found'));

      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      try {
        await clonePipelineCommand(tempDir, 'test-pipeline');
      } catch (error) {
        // Expected
      }

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const writtenYaml = writeCall[1] as string;
      const parsedConfig = YAML.parse(writtenYaml);

      expect(parsedConfig.name).toBe('test-pipeline-clone-1');
    });
  });

  describe('Success Output', () => {
    it('should show success message', async () => {
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
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      try {
        await clonePipelineCommand(tempDir, 'test-pipeline');
      } catch (error) {
        // Expected
      }

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Pipeline cloned successfully'));
    });

    it('should show source and destination names', async () => {
      const mockConfig = {
        name: 'source-pipeline',
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
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      try {
        await clonePipelineCommand(tempDir, 'source-pipeline', 'dest-pipeline');
      } catch (error) {
        // Expected
      }

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('"source-pipeline"'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('"dest-pipeline"'));
    });

    it('should show next steps with edit command', async () => {
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
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      try {
        await clonePipelineCommand(tempDir, 'test-pipeline');
      } catch (error) {
        // Expected
      }

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('agent-pipeline edit test-pipeline-clone')
      );
    });
  });

  describe('Error Handling', () => {
    it('should exit when source pipeline not found', async () => {
      mockLoader.loadPipeline.mockRejectedValue(new Error('Pipeline not found'));

      await expect(
        clonePipelineCommand(tempDir, 'nonexistent-pipeline')
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Source pipeline "nonexistent-pipeline" not found')
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle file write errors', async () => {
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
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockRejectedValue(new Error('Permission denied'));

      await expect(
        clonePipelineCommand(tempDir, 'test-pipeline')
      ).rejects.toThrow('process.exit(1)');

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle generic errors', async () => {
      mockLoader.loadPipeline.mockRejectedValue(new Error('Some random error'));

      await expect(
        clonePipelineCommand(tempDir, 'test-pipeline')
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to clone pipeline')
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long pipeline names', async () => {
      const longName = 'very-long-pipeline-name-that-might-cause-issues-with-file-systems';
      const mockConfig = {
        name: longName,
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
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      try {
        await clonePipelineCommand(tempDir, longName);
      } catch (error) {
        // Expected
      }

      expect(fs.writeFile).toHaveBeenCalledWith(
        path.join(tempDir, '.agent-pipeline', 'pipelines', `${longName}-clone.yml`),
        expect.any(String),
        'utf-8'
      );
    });

    it('should handle pipeline names with special characters', async () => {
      const specialName = 'test-pipeline_v1.0';
      const mockConfig = {
        name: specialName,
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
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      try {
        await clonePipelineCommand(tempDir, specialName);
      } catch (error) {
        // Expected
      }

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const writtenYaml = writeCall[1] as string;
      const parsedConfig = YAML.parse(writtenYaml);

      expect(parsedConfig.name).toBe('test-pipeline_v1.0-clone');
    });

    it('should handle complex pipeline configurations', async () => {
      const mockConfig = {
        name: 'complex-pipeline',
        trigger: 'post-commit',
        settings: {
          autoCommit: true,
          commitPrefix: '[pipeline:{{stage}}]',
          failureStrategy: 'continue',
          executionMode: 'parallel',
        },
        git: {
          baseBranch: 'main',
          branchStrategy: 'reusable',
          mergeStrategy: 'pull-request',
          pullRequest: {
            title: 'Test PR',
          },
        },
        agents: [
          { name: 'agent1', agent: 'agent1.md', timeout: 120 },
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
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      try {
        await clonePipelineCommand(tempDir, 'complex-pipeline');
      } catch (error) {
        // Expected
      }

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const writtenYaml = writeCall[1] as string;
      const parsedConfig = YAML.parse(writtenYaml);

      // Should preserve everything except name
      expect(parsedConfig.name).toBe('complex-pipeline-clone');
      expect(parsedConfig.trigger).toBe('post-commit');
      expect(parsedConfig.settings).toEqual(mockConfig.settings);
      expect(parsedConfig.git).toEqual(mockConfig.git);
      expect(parsedConfig.agents).toEqual(mockConfig.agents);
    });
  });

  describe('Integration', () => {
    it('should complete full workflow successfully', async () => {
      const mockConfig = {
        name: 'source-pipeline',
        trigger: 'manual',
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
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      try {
        await clonePipelineCommand(tempDir, 'source-pipeline', 'dest-pipeline');
      } catch (error) {
        // Expected
      }

      expect(PipelineLoader).toHaveBeenCalledWith(tempDir);
      expect(mockLoader.loadPipeline).toHaveBeenCalledWith('source-pipeline');
      expect(fs.writeFile).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('cloned successfully'));
    });
  });
});
