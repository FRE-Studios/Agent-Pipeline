import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { exportPipelineCommand } from '../../../../cli/commands/pipeline/export.js';
import { PipelineLoader } from '../../../../config/pipeline-loader.js';
import { createTempDir, cleanupTempDir } from '../../../setup.js';
import * as fs from 'fs/promises';
import * as path from 'path';

// Mock dependencies
vi.mock('../../../../config/pipeline-loader.js');
vi.mock('fs/promises');

describe('exportPipelineCommand', () => {
  let tempDir: string;
  let mockLoader: any;
  let processExitSpy: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;

  beforeEach(async () => {
    tempDir = await createTempDir('export-pipeline-test-');

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

      await exportPipelineCommand(tempDir, 'test-pipeline');

      expect(PipelineLoader).toHaveBeenCalledWith(tempDir);
      expect(mockLoader.loadPipeline).toHaveBeenCalledWith('test-pipeline');
    });

    it('should export to stdout by default (no --output flag)', async () => {
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

      await exportPipelineCommand(tempDir, 'test-pipeline');

      const logCalls = consoleLogSpy.mock.calls.map(call => call[0]).join('\n');

      // Should output YAML to console
      expect(logCalls).toContain('name: test-pipeline');
      expect(logCalls).toContain('trigger: manual');

      // Should NOT call writeFile when no output option
      expect(vi.mocked(fs.writeFile)).not.toHaveBeenCalled();
    });

    it('should export valid YAML format', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'post-commit',
        settings: {
          autoCommit: true,
          failureStrategy: 'continue',
        },
        agents: [
          { name: 'agent1', agent: 'agent1.md' },
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

      await exportPipelineCommand(tempDir, 'test-pipeline');

      const logCalls = consoleLogSpy.mock.calls.map(call => call[0]).join('\n');

      // Should be valid YAML structure
      expect(logCalls).toContain('name: test-pipeline');
      expect(logCalls).toContain('trigger: post-commit');
      expect(logCalls).toContain('settings:');
      expect(logCalls).toContain('autoCommit: true');
      expect(logCalls).toContain('agents:');
    });
  });

  describe('File Export', () => {
    it('should export to file with --output flag', async () => {
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
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const outputPath = '/tmp/exported-pipeline.yml';
      await exportPipelineCommand(tempDir, 'test-pipeline', { output: outputPath });

      expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith(
        outputPath,
        expect.stringContaining('name: test-pipeline'),
        'utf-8'
      );
    });

    it('should create output file at specified path', async () => {
      const mockConfig = {
        name: 'test-pipeline',
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
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const outputPath = '/tmp/my-export.yml';
      await exportPipelineCommand(tempDir, 'test-pipeline', { output: outputPath });

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      expect(writeCall[0]).toBe(outputPath);
      expect(writeCall[1]).toContain('name: test-pipeline');
      expect(writeCall[2]).toBe('utf-8');
    });

    it('should show success message with file path', async () => {
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
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const outputPath = '/tmp/exported.yml';
      await exportPipelineCommand(tempDir, 'test-pipeline', { output: outputPath });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Pipeline exported to: /tmp/exported.yml')
      );
    });
  });

  describe('Include Agents', () => {
    it('should include agent files with --include-agents flag', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [
          { name: 'agent1', agent: 'agents/agent1.md' },
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
      vi.mocked(fs.readFile).mockResolvedValue('# Agent 1\n\nThis is agent 1 content');

      await exportPipelineCommand(tempDir, 'test-pipeline', { includeAgents: true });

      const logCalls = consoleLogSpy.mock.calls.map(call => call[0]).join('\n');

      // Should include agent section
      expect(logCalls).toContain('# Agent Files');
      expect(logCalls).toContain('# Agent: agent1');
      expect(logCalls).toContain('```markdown');
      expect(logCalls).toContain('# Agent 1');
    });

    it('should read all agent files referenced in config', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [
          { name: 'agent1', agent: 'agents/agent1.md' },
          { name: 'agent2', agent: 'agents/agent2.md' },
          { name: 'agent3', agent: 'agents/agent3.md' },
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
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce('# Agent 1 content')
        .mockResolvedValueOnce('# Agent 2 content')
        .mockResolvedValueOnce('# Agent 3 content');

      await exportPipelineCommand(tempDir, 'test-pipeline', { includeAgents: true });

      expect(vi.mocked(fs.readFile)).toHaveBeenCalledTimes(3);
      expect(vi.mocked(fs.readFile)).toHaveBeenCalledWith(
        path.join(tempDir, 'agents/agent1.md'),
        'utf-8'
      );
      expect(vi.mocked(fs.readFile)).toHaveBeenCalledWith(
        path.join(tempDir, 'agents/agent2.md'),
        'utf-8'
      );
      expect(vi.mocked(fs.readFile)).toHaveBeenCalledWith(
        path.join(tempDir, 'agents/agent3.md'),
        'utf-8'
      );
    });

    it('should format agent content with markdown code blocks', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [
          { name: 'test-agent', agent: 'test.md' },
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
      vi.mocked(fs.readFile).mockResolvedValue('# Test Agent\n\nAgent content here');

      await exportPipelineCommand(tempDir, 'test-pipeline', { includeAgents: true });

      const logCalls = consoleLogSpy.mock.calls.map(call => call[0]).join('\n');

      // Should wrap content in markdown code blocks
      expect(logCalls).toContain('```markdown');
      expect(logCalls).toContain('# Test Agent');
      expect(logCalls).toContain('Agent content here');
      expect(logCalls).toMatch(/```\s*$/m); // Closing code block
    });

    it('should show count of included agents in success message', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [
          { name: 'agent1', agent: 'agent1.md' },
          { name: 'agent2', agent: 'agent2.md' },
          { name: 'agent3', agent: 'agent3.md' },
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
      vi.mocked(fs.readFile).mockResolvedValue('agent content');
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const outputPath = '/tmp/exported.yml';
      await exportPipelineCommand(tempDir, 'test-pipeline', {
        output: outputPath,
        includeAgents: true,
      });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('includes 3 agent file(s)')
      );
    });

    it('should handle missing agent files gracefully', async () => {
      const mockConfig = {
        name: 'test-pipeline',
        trigger: 'manual',
        agents: [
          { name: 'agent1', agent: 'agents/agent1.md' },
          { name: 'agent2', agent: 'agents/missing.md' },
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
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce('# Agent 1 content')
        .mockRejectedValueOnce(new Error('ENOENT: file not found'));

      await exportPipelineCommand(tempDir, 'test-pipeline', { includeAgents: true });

      const logCalls = consoleLogSpy.mock.calls.map(call => call[0]).join('\n');

      // Should show success for agent1
      expect(logCalls).toContain('# Agent: agent1');
      expect(logCalls).toContain('# Agent 1 content');

      // Should show error message for missing agent
      expect(logCalls).toContain('# Agent: agent2 - Could not read file');
      expect(logCalls).toContain('agents/missing.md');
    });
  });

  describe('Error Handling', () => {
    it('should exit when pipeline not found', async () => {
      mockLoader.loadPipeline.mockRejectedValue(new Error('Pipeline not found'));

      await expect(
        exportPipelineCommand(tempDir, 'nonexistent-pipeline')
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Pipeline "nonexistent-pipeline" not found')
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
      vi.mocked(fs.writeFile).mockRejectedValue(new Error('EACCES: permission denied'));

      await expect(
        exportPipelineCommand(tempDir, 'test-pipeline', { output: '/protected/file.yml' })
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to export pipeline')
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle generic errors gracefully', async () => {
      mockLoader.loadPipeline.mockRejectedValue(new Error('Unexpected error'));

      await expect(
        exportPipelineCommand(tempDir, 'test-pipeline')
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to export pipeline: Unexpected error')
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle pipelines with many agents', async () => {
      const mockConfig = {
        name: 'large-pipeline',
        trigger: 'manual',
        agents: Array.from({ length: 12 }, (_, i) => ({
          name: `agent-${i}`,
          agent: `agents/agent-${i}.md`,
        })),
      };
      mockLoader.loadPipeline.mockResolvedValue({
        config: mockConfig,
        metadata: {
          sourcePath: "/test/path.yml",
          sourceType: "library" as const,
          loadedAt: new Date().toISOString()
        }
      });
      vi.mocked(fs.readFile).mockResolvedValue('# Agent content');

      await exportPipelineCommand(tempDir, 'large-pipeline', { includeAgents: true });

      expect(vi.mocked(fs.readFile)).toHaveBeenCalledTimes(12);

      const logCalls = consoleLogSpy.mock.calls.map(call => call[0]).join('\n');
      expect(logCalls).toContain('agent-0');
      expect(logCalls).toContain('agent-11');
    });

    it('should handle mixed scenario with some agents existing and some missing', async () => {
      const mockConfig = {
        name: 'mixed-pipeline',
        trigger: 'manual',
        agents: [
          { name: 'exists1', agent: 'agents/exists1.md' },
          { name: 'missing1', agent: 'agents/missing1.md' },
          { name: 'exists2', agent: 'agents/exists2.md' },
          { name: 'missing2', agent: 'agents/missing2.md' },
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
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce('# Content 1')
        .mockRejectedValueOnce(new Error('ENOENT'))
        .mockResolvedValueOnce('# Content 2')
        .mockRejectedValueOnce(new Error('ENOENT'));

      await exportPipelineCommand(tempDir, 'mixed-pipeline', { includeAgents: true });

      const logCalls = consoleLogSpy.mock.calls.map(call => call[0]).join('\n');

      // Should show both successful reads
      expect(logCalls).toContain('# Content 1');
      expect(logCalls).toContain('# Content 2');

      // Should show error messages for missing files
      expect(logCalls).toMatch(/missing1.*Could not read file/);
      expect(logCalls).toMatch(/missing2.*Could not read file/);
    });
  });

  describe('Integration', () => {
    it('should complete full workflow: load → export to stdout', async () => {
      const mockConfig = {
        name: 'integration-test',
        trigger: 'post-commit',
        settings: {
          autoCommit: true,
        },
        agents: [
          { name: 'agent1', agent: 'agent1.md' },
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

      await exportPipelineCommand(tempDir, 'integration-test');

      // Verify loader called
      expect(PipelineLoader).toHaveBeenCalledWith(tempDir);
      expect(mockLoader.loadPipeline).toHaveBeenCalledWith('integration-test');

      // Verify YAML output
      const logCalls = consoleLogSpy.mock.calls.map(call => call[0]).join('\n');
      expect(logCalls).toContain('name: integration-test');
      expect(logCalls).toContain('trigger: post-commit');

      // Verify no file write
      expect(vi.mocked(fs.writeFile)).not.toHaveBeenCalled();
    });

    it('should complete full workflow: load → export to file with agents', async () => {
      const mockConfig = {
        name: 'full-export',
        trigger: 'manual',
        agents: [
          { name: 'agent1', agent: 'agents/agent1.md' },
          { name: 'agent2', agent: 'agents/agent2.md' },
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
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce('# Agent 1 content')
        .mockResolvedValueOnce('# Agent 2 content');
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const outputPath = '/tmp/full-export.yml';
      await exportPipelineCommand(tempDir, 'full-export', {
        output: outputPath,
        includeAgents: true,
      });

      // Verify loader
      expect(mockLoader.loadPipeline).toHaveBeenCalledWith('full-export');

      // Verify agent files read
      expect(vi.mocked(fs.readFile)).toHaveBeenCalledTimes(2);

      // Verify file written with all content
      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      expect(writeCall[0]).toBe(outputPath);

      const content = writeCall[1] as string;
      expect(content).toContain('name: full-export');
      expect(content).toContain('# Agent Files');
      expect(content).toContain('# Agent 1 content');
      expect(content).toContain('# Agent 2 content');

      // Verify success message
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Pipeline exported to: /tmp/full-export.yml')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('includes 2 agent file(s)')
      );
    });
  });
});
