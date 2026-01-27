import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { agentInfoCommand } from '../../../../cli/commands/agent/info.js';
import { PipelineLoader } from '../../../../config/pipeline-loader.js';
import { createTempDir, cleanupTempDir } from '../../../setup.js';
import * as fs from 'fs/promises';
import * as path from 'path';

// Mock PipelineLoader
vi.mock('../../../../config/pipeline-loader.js');

describe('agentInfoCommand', () => {
  let tempDir: string;
  let agentsDir: string;
  let mockLoader: any;

  beforeEach(async () => {
    tempDir = await createTempDir('agent-info-test-');
    agentsDir = path.join(tempDir, '.agent-pipeline', 'agents');
    await fs.mkdir(agentsDir, { recursive: true });

    // Setup PipelineLoader mock
    mockLoader = {
      listPipelines: vi.fn().mockResolvedValue([]),
      loadPipeline: vi.fn(),
    };
    vi.mocked(PipelineLoader).mockImplementation(() => mockLoader);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
    vi.clearAllMocks();
  });

  describe('Agent Details Display', () => {
    it('should display agent file path, size, and modified date', async () => {
      const agentContent = '# Code Reviewer\n\nReviews code for issues';
      await fs.writeFile(path.join(agentsDir, 'code-reviewer.md'), agentContent, 'utf-8');

      await agentInfoCommand(tempDir, 'code-reviewer');

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Agent: code-reviewer'));
      expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/File:.*\.agent-pipeline\/agents\/code-reviewer\.md/));
      expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/Size: \d+ bytes/));
      expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/Modified:/));
    });

    it('should display full agent content', async () => {
      const agentContent = '# Test Agent\n\nThis is the full content\nWith multiple lines';
      await fs.writeFile(path.join(agentsDir, 'test-agent.md'), agentContent, 'utf-8');

      await agentInfoCommand(tempDir, 'test-agent');

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Content:'));
      expect(console.log).toHaveBeenCalledWith(agentContent);
    });

    it('should show pipelines using this agent', async () => {
      await fs.writeFile(path.join(agentsDir, 'reviewer.md'), '# Reviewer', 'utf-8');

      mockLoader.listPipelines.mockResolvedValue(['pipeline1', 'pipeline2']);
      mockLoader.loadPipeline.mockImplementation((name: string) => {
        if (name === 'pipeline1') {
          return Promise.resolve({
            config: {
              name: 'pipeline1',
              agents: [{ agent: '.agent-pipeline/agents/reviewer.md' }],
            },
            metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() }
          });
        }
        return Promise.resolve({
          config: {
            name: 'pipeline2',
            agents: [{ agent: '.agent-pipeline/agents/other.md' }],
          },
          metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() }
        });
      });

      await agentInfoCommand(tempDir, 'reviewer');

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Used by 1 pipeline(s):'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('pipeline1'));
      expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('pipeline2'));
    });

    it('should show message when not used by any pipelines', async () => {
      await fs.writeFile(path.join(agentsDir, 'unused.md'), '# Unused', 'utf-8');
      mockLoader.listPipelines.mockResolvedValue([]);

      await agentInfoCommand(tempDir, 'unused');

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Not currently used by any pipelines'));
    });

    it('should display multiple pipelines using the agent', async () => {
      await fs.writeFile(path.join(agentsDir, 'popular.md'), '# Popular', 'utf-8');

      mockLoader.listPipelines.mockResolvedValue(['p1', 'p2', 'p3']);
      mockLoader.loadPipeline.mockImplementation((name: string) => {
        return Promise.resolve({ config: {
          name,
          agents: [{ agent: '.agent-pipeline/agents/popular.md' }],
        }, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      });

      await agentInfoCommand(tempDir, 'popular');

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Used by 3 pipeline(s):'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('p1'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('p2'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('p3'));
    });
  });

  describe('Agent Name Handling', () => {
    it('should find agent by name without .md extension', async () => {
      await fs.writeFile(path.join(agentsDir, 'my-agent.md'), '# My Agent', 'utf-8');

      await agentInfoCommand(tempDir, 'my-agent');

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Agent: my-agent'));
    });

    it('should find agent by name with .md extension', async () => {
      await fs.writeFile(path.join(agentsDir, 'my-agent.md'), '# My Agent', 'utf-8');

      await agentInfoCommand(tempDir, 'my-agent.md');

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Agent: my-agent'));
    });

    it('should handle agent names with special characters', async () => {
      await fs.writeFile(path.join(agentsDir, 'agent-with-dashes.md'), '# Agent', 'utf-8');

      await agentInfoCommand(tempDir, 'agent-with-dashes');

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Agent: agent-with-dashes'));
    });

    it('should handle agent names with underscores', async () => {
      await fs.writeFile(path.join(agentsDir, 'agent_with_underscores.md'), '# Agent', 'utf-8');

      await agentInfoCommand(tempDir, 'agent_with_underscores');

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Agent: agent_with_underscores'));
    });
  });

  describe('Pipeline Usage Detection', () => {
    it('should detect agent usage with full path', async () => {
      await fs.writeFile(path.join(agentsDir, 'agent.md'), '# Agent', 'utf-8');

      mockLoader.listPipelines.mockResolvedValue(['test-pipeline']);
      mockLoader.loadPipeline.mockResolvedValue({
        config: {
          name: 'test-pipeline',
          agents: [{ agent: '.agent-pipeline/agents/agent.md' }],
        },
        metadata: {
          sourcePath: "/test/path.yml",
          sourceType: "library" as const,
          loadedAt: new Date().toISOString()
        }
      });

      await agentInfoCommand(tempDir, 'agent');

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Used by 1 pipeline(s):'));
    });

    it('should detect agent usage with name only', async () => {
      await fs.writeFile(path.join(agentsDir, 'agent.md'), '# Agent', 'utf-8');

      mockLoader.listPipelines.mockResolvedValue(['test-pipeline']);
      mockLoader.loadPipeline.mockResolvedValue({
        config: {
          name: 'test-pipeline',
          agents: [{ agent: 'agent' }],
        },
        metadata: {
          sourcePath: "/test/path.yml",
          sourceType: "library" as const,
          loadedAt: new Date().toISOString()
        }
      });

      await agentInfoCommand(tempDir, 'agent');

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Used by 1 pipeline(s):'));
    });

    it('should skip invalid pipelines when checking usage', async () => {
      await fs.writeFile(path.join(agentsDir, 'agent.md'), '# Agent', 'utf-8');

      mockLoader.listPipelines.mockResolvedValue(['valid', 'invalid']);
      mockLoader.loadPipeline.mockImplementation((name: string) => {
        if (name === 'valid') {
          return Promise.resolve({
            config: {
              name: 'valid',
              agents: [{ agent: '.agent-pipeline/agents/agent.md' }],
            },
            metadata: {
              sourcePath: "/test/path.yml",
              sourceType: "library" as const,
              loadedAt: new Date().toISOString()
            }
          });
        }
        return Promise.reject(new Error('Invalid pipeline'));
      });

      await agentInfoCommand(tempDir, 'agent');

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Used by 1 pipeline(s):'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('valid'));
    });

    it('should handle when PipelineLoader returns empty list', async () => {
      await fs.writeFile(path.join(agentsDir, 'agent.md'), '# Agent', 'utf-8');
      mockLoader.listPipelines.mockResolvedValue([]);

      await agentInfoCommand(tempDir, 'agent');

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Not currently used'));
    });
  });

  describe('Error Handling', () => {
    it('should show error for non-existent agent', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

      await agentInfoCommand(tempDir, 'non-existent');

      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Agent "non-existent" not found'));
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('agent-pipeline agent list'));
      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
    });

    it('should suggest using list command when agent not found', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

      await agentInfoCommand(tempDir, 'missing-agent');

      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('agent-pipeline agent list'));

      exitSpy.mockRestore();
    });

    it('should handle read errors with generic message', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

      // Test with a non-existent agent to trigger the error path
      await agentInfoCommand(tempDir, 'non-existent-agent');

      expect(console.error).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
    });

    it('should exit with code 1 on error', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

      await agentInfoCommand(tempDir, 'non-existent');

      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
    });
  });

  describe('Console Output Format', () => {
    it('should display header and footer separators', async () => {
      await fs.writeFile(path.join(agentsDir, 'agent.md'), '# Agent', 'utf-8');

      await agentInfoCommand(tempDir, 'agent');

      const allLogs = vi.mocked(console.log).mock.calls.map(call => call[0]).join('\n');

      // Check that separators are present in the output
      expect(allLogs).toContain('='.repeat(80));
      expect(allLogs).toContain('─'.repeat(80));
    });

    it('should display agent name in header', async () => {
      await fs.writeFile(path.join(agentsDir, 'test-agent.md'), '# Test Agent', 'utf-8');

      await agentInfoCommand(tempDir, 'test-agent');

      expect(console.log).toHaveBeenCalledWith('Agent: test-agent');
    });

    it('should display file path relative to repo root', async () => {
      await fs.writeFile(path.join(agentsDir, 'agent.md'), '# Agent', 'utf-8');

      await agentInfoCommand(tempDir, 'agent');

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('.agent-pipeline/agents/agent.md'));
      expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining(tempDir));
    });

    it('should format file size in bytes', async () => {
      const content = '# Agent\n\nSome content here';
      await fs.writeFile(path.join(agentsDir, 'agent.md'), content, 'utf-8');

      await agentInfoCommand(tempDir, 'agent');

      expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/Size: \d+ bytes/));
    });

    it('should format modified date as locale string', async () => {
      await fs.writeFile(path.join(agentsDir, 'agent.md'), '# Agent', 'utf-8');

      await agentInfoCommand(tempDir, 'agent');

      // Check for date-like string
      const logCalls = vi.mocked(console.log).mock.calls.map(call => call[0]);
      const hasModified = logCalls.some(
        log => typeof log === 'string' && log.includes('Modified:')
      );
      expect(hasModified).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty agent file', async () => {
      await fs.writeFile(path.join(agentsDir, 'empty.md'), '', 'utf-8');

      await agentInfoCommand(tempDir, 'empty');

      expect(console.log).toHaveBeenCalledWith('');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Size: 0 bytes'));
    });

    it('should handle very large agent file', async () => {
      const largeContent = '# Large Agent\n\n' + 'x'.repeat(10000);
      await fs.writeFile(path.join(agentsDir, 'large.md'), largeContent, 'utf-8');

      await agentInfoCommand(tempDir, 'large');

      expect(console.log).toHaveBeenCalledWith(largeContent);
      expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/Size: \d+ bytes/));
    });

    it('should handle agent with special markdown characters', async () => {
      const specialContent = '# Agent\n\n```code```\n**bold** *italic* [link](url)';
      await fs.writeFile(path.join(agentsDir, 'special.md'), specialContent, 'utf-8');

      await agentInfoCommand(tempDir, 'special');

      expect(console.log).toHaveBeenCalledWith(specialContent);
    });

    it('should handle agent used by many pipelines', async () => {
      await fs.writeFile(path.join(agentsDir, 'popular.md'), '# Popular', 'utf-8');

      const pipelines = Array.from({ length: 20 }, (_, i) => `pipeline-${i}`);
      mockLoader.listPipelines.mockResolvedValue(pipelines);
      mockLoader.loadPipeline.mockImplementation((name: string) => {
        return Promise.resolve({ config: {
          name,
          agents: [{ agent: '.agent-pipeline/agents/popular.md' }],
        }, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      });

      await agentInfoCommand(tempDir, 'popular');

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Used by 20 pipeline(s):'));
    });

    it('should handle agent with newlines in content', async () => {
      const contentWithNewlines = '# Agent\n\nLine 1\n\nLine 2\n\nLine 3';
      await fs.writeFile(path.join(agentsDir, 'newlines.md'), contentWithNewlines, 'utf-8');

      await agentInfoCommand(tempDir, 'newlines');

      expect(console.log).toHaveBeenCalledWith(contentWithNewlines);
    });
  });

  describe('Integration', () => {
    it('should complete full workflow for existing agent', async () => {
      const agentContent = '# Test Agent\n\nThis is a test agent';
      await fs.writeFile(path.join(agentsDir, 'test-agent.md'), agentContent, 'utf-8');

      mockLoader.listPipelines.mockResolvedValue(['pipeline1']);
      mockLoader.loadPipeline.mockResolvedValue({
        config: {
          name: 'pipeline1',
          agents: [{ agent: '.agent-pipeline/agents/test-agent.md' }],
        },
        metadata: {
          sourcePath: "/test/path.yml",
          sourceType: "library" as const,
          loadedAt: new Date().toISOString()
        }
      });

      await agentInfoCommand(tempDir, 'test-agent');

      expect(PipelineLoader).toHaveBeenCalledWith(tempDir);
      expect(mockLoader.listPipelines).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Agent: test-agent'));
      expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/File:.*test-agent\.md/));
      expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/Size: \d+ bytes/));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Used by 1 pipeline(s):'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Content:'));
      expect(console.log).toHaveBeenCalledWith(agentContent);
    });

    it('should complete full workflow for unused agent', async () => {
      const agentContent = '# Unused Agent';
      await fs.writeFile(path.join(agentsDir, 'unused.md'), agentContent, 'utf-8');
      mockLoader.listPipelines.mockResolvedValue([]);

      await agentInfoCommand(tempDir, 'unused');

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Agent: unused'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Not currently used by any pipelines'));
      expect(console.log).toHaveBeenCalledWith(agentContent);
    });

    it('should complete error workflow for missing agent', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

      await agentInfoCommand(tempDir, 'missing');

      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Agent "missing" not found'));
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('agent-pipeline agent list'));
      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
    });
  });
});
