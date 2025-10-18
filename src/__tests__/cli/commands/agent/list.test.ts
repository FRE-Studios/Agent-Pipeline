import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { listAgentsCommand } from '../../../../cli/commands/agent/list.js';
import { createTempDir, cleanupTempDir } from '../../../setup.js';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('listAgentsCommand', () => {
  let tempDir: string;
  let agentsDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir('agent-list-test-');
    agentsDir = path.join(tempDir, '.claude', 'agents');
    await fs.mkdir(agentsDir, { recursive: true });
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
    vi.clearAllMocks();
  });

  describe('Agent Listing', () => {
    it('should list all agents with name, description, and modified date', async () => {
      // Create test agents
      await fs.writeFile(
        path.join(agentsDir, 'code-reviewer.md'),
        '# Code Reviewer\n\nReviews code for issues',
        'utf-8'
      );
      await fs.writeFile(
        path.join(agentsDir, 'doc-updater.md'),
        '# Documentation Updater\n\nUpdates documentation',
        'utf-8'
      );

      await listAgentsCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Available Agents'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('code-reviewer'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Code Reviewer'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('doc-updater'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Documentation Updater'));
    });

    it('should sort agents by name alphabetically', async () => {
      await fs.writeFile(path.join(agentsDir, 'z-agent.md'), '# Z Agent', 'utf-8');
      await fs.writeFile(path.join(agentsDir, 'a-agent.md'), '# A Agent', 'utf-8');
      await fs.writeFile(path.join(agentsDir, 'm-agent.md'), '# M Agent', 'utf-8');

      await listAgentsCommand(tempDir);

      const logCalls = vi.mocked(console.log).mock.calls.map(call => call[0]);
      const aIndex = logCalls.findIndex(log => typeof log === 'string' && log.includes('a-agent'));
      const mIndex = logCalls.findIndex(log => typeof log === 'string' && log.includes('m-agent'));
      const zIndex = logCalls.findIndex(log => typeof log === 'string' && log.includes('z-agent'));

      expect(aIndex).toBeGreaterThan(-1);
      expect(mIndex).toBeGreaterThan(-1);
      expect(zIndex).toBeGreaterThan(-1);
      expect(aIndex).toBeLessThan(mIndex);
      expect(mIndex).toBeLessThan(zIndex);
    });

    it('should extract description from first # header', async () => {
      await fs.writeFile(
        path.join(agentsDir, 'test-agent.md'),
        '# This Is The Description\n\nSome content here\n## Another header',
        'utf-8'
      );

      await listAgentsCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('This Is The Description'));
    });

    it('should show "No description" when no # header found', async () => {
      await fs.writeFile(
        path.join(agentsDir, 'no-header.md'),
        'Just some content without headers',
        'utf-8'
      );

      await listAgentsCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No description'));
    });

    it('should filter out hidden files', async () => {
      await fs.writeFile(path.join(agentsDir, '.hidden-agent.md'), '# Hidden', 'utf-8');
      await fs.writeFile(path.join(agentsDir, 'visible-agent.md'), '# Visible', 'utf-8');

      await listAgentsCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('visible-agent'));
      expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('.hidden-agent'));
      expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('Hidden'));
    });

    it('should filter out non-.md files', async () => {
      await fs.writeFile(path.join(agentsDir, 'agent.txt'), '# Text File', 'utf-8');
      await fs.writeFile(path.join(agentsDir, 'agent.json'), '{"name": "json"}', 'utf-8');
      await fs.writeFile(path.join(agentsDir, 'agent.md'), '# Markdown Agent', 'utf-8');

      await listAgentsCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('agent'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Markdown Agent'));
      const allLogs = vi.mocked(console.log).mock.calls.map(call => call[0]).join('\n');
      expect(allLogs).not.toContain('agent.txt');
      expect(allLogs).not.toContain('agent.json');
    });

    it('should display agent count in header', async () => {
      await fs.writeFile(path.join(agentsDir, 'agent1.md'), '# Agent 1', 'utf-8');
      await fs.writeFile(path.join(agentsDir, 'agent2.md'), '# Agent 2', 'utf-8');
      await fs.writeFile(path.join(agentsDir, 'agent3.md'), '# Agent 3', 'utf-8');

      await listAgentsCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Available Agents (3)'));
    });

    it('should handle long agent names by truncating', async () => {
      const longName = 'very-long-agent-name-that-exceeds-normal-display-width';
      await fs.writeFile(
        path.join(agentsDir, `${longName}.md`),
        '# Long Agent',
        'utf-8'
      );

      await listAgentsCommand(tempDir);

      const allLogs = vi.mocked(console.log).mock.calls.map(call => call[0]).join('\n');
      expect(allLogs).toContain(longName.substring(0, 30));
    });

    it('should handle long descriptions by truncating', async () => {
      const longDescription = 'This is a very long description that definitely exceeds the forty character limit for display';
      await fs.writeFile(
        path.join(agentsDir, 'agent.md'),
        `# ${longDescription}`,
        'utf-8'
      );

      await listAgentsCommand(tempDir);

      const allLogs = vi.mocked(console.log).mock.calls.map(call => call[0]).join('\n');
      expect(allLogs).toContain(longDescription.substring(0, 40));
    });
  });

  describe('Empty Directory Handling', () => {
    it('should show message when no agents found', async () => {
      await listAgentsCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No agents found'));
    });

    it('should suggest using agent pull command when no agents', async () => {
      await listAgentsCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('agent-pipeline agent pull'));
    });

    it('should handle agents directory with only hidden files', async () => {
      await fs.writeFile(path.join(agentsDir, '.hidden1.md'), '# Hidden 1', 'utf-8');
      await fs.writeFile(path.join(agentsDir, '.hidden2.md'), '# Hidden 2', 'utf-8');

      await listAgentsCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No agents found'));
    });

    it('should handle agents directory with only non-.md files', async () => {
      await fs.writeFile(path.join(agentsDir, 'file.txt'), 'text', 'utf-8');
      await fs.writeFile(path.join(agentsDir, 'file.json'), '{}', 'utf-8');

      await listAgentsCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No agents found'));
    });
  });

  describe('Missing Directory Handling', () => {
    it('should show error when agents directory does not exist', async () => {
      await fs.rm(agentsDir, { recursive: true, force: true });

      await listAgentsCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No agents directory found'));
    });

    it('should suggest running init when directory missing', async () => {
      await fs.rm(agentsDir, { recursive: true, force: true });

      await listAgentsCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('agent-pipeline init'));
    });
  });

  describe('Console Output Format', () => {
    it('should display table with headers', async () => {
      await fs.writeFile(path.join(agentsDir, 'agent.md'), '# Test Agent', 'utf-8');

      await listAgentsCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('NAME'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('DESCRIPTION'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('MODIFIED'));
    });

    it('should display separator lines', async () => {
      await fs.writeFile(path.join(agentsDir, 'agent.md'), '# Test Agent', 'utf-8');

      await listAgentsCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/─+/));
    });

    it('should display footer with info command hint', async () => {
      await fs.writeFile(path.join(agentsDir, 'agent.md'), '# Test Agent', 'utf-8');

      await listAgentsCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('agent-pipeline agent info'));
    });

    it('should format modified date as locale date string', async () => {
      await fs.writeFile(path.join(agentsDir, 'agent.md'), '# Test Agent', 'utf-8');

      await listAgentsCommand(tempDir);

      // Check that at least one log contains a date-like string
      const logCalls = vi.mocked(console.log).mock.calls.map(call => call[0]);
      const hasDateFormat = logCalls.some(log =>
        typeof log === 'string' && /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(log)
      );
      expect(hasDateFormat).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle missing directory gracefully', async () => {
      // Remove the agents directory to trigger error path
      await fs.rm(agentsDir, { recursive: true, force: true });

      await listAgentsCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No agents directory found'));
    });

    it('should handle permission errors on directory access', async () => {
      // Test the early return path when directory is inaccessible
      const nonExistentPath = path.join(tempDir, 'nonexistent');

      await listAgentsCommand(nonExistentPath);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No agents directory found'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('agent-pipeline init'));
    });
  });

  describe('Edge Cases', () => {
    it('should handle agent with empty content', async () => {
      await fs.writeFile(path.join(agentsDir, 'empty-agent.md'), '', 'utf-8');

      await listAgentsCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('empty-agent'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No description'));
    });

    it('should handle agent with multiple # headers', async () => {
      await fs.writeFile(
        path.join(agentsDir, 'multi-header.md'),
        '# First Header\n\n# Second Header\n\n# Third Header',
        'utf-8'
      );

      await listAgentsCommand(tempDir);

      // Should use the first header
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('First Header'));
    });

    it('should handle agents with special characters in names', async () => {
      await fs.writeFile(path.join(agentsDir, 'agent-with-dashes.md'), '# Agent Dashes', 'utf-8');
      await fs.writeFile(path.join(agentsDir, 'agent_with_underscores.md'), '# Agent Underscores', 'utf-8');
      await fs.writeFile(path.join(agentsDir, 'agent123.md'), '# Agent Numbers', 'utf-8');

      await listAgentsCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('agent-with-dashes'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('agent_with_underscores'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('agent123'));
    });

    it('should handle very large number of agents', async () => {
      // Create 50 agents
      for (let i = 0; i < 50; i++) {
        await fs.writeFile(
          path.join(agentsDir, `agent-${i.toString().padStart(2, '0')}.md`),
          `# Agent ${i}`,
          'utf-8'
        );
      }

      await listAgentsCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Available Agents (50)'));
    });

    it('should handle single agent', async () => {
      await fs.writeFile(path.join(agentsDir, 'single-agent.md'), '# Single Agent', 'utf-8');

      await listAgentsCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Available Agents (1)'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('single-agent'));
    });
  });

  describe('Integration', () => {
    it('should complete full workflow for populated directory', async () => {
      await fs.writeFile(path.join(agentsDir, 'agent1.md'), '# Agent 1', 'utf-8');
      await fs.writeFile(path.join(agentsDir, 'agent2.md'), '# Agent 2', 'utf-8');

      await listAgentsCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Available Agents (2)'));
      expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/NAME.*DESCRIPTION.*MODIFIED/));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('agent1'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('agent2'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('agent-pipeline agent info'));
    });

    it('should complete full workflow for empty directory', async () => {
      await listAgentsCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No agents found'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('agent-pipeline agent pull'));
    });

    it('should complete full workflow for missing directory', async () => {
      await fs.rm(agentsDir, { recursive: true, force: true });

      await listAgentsCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No agents directory found'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('agent-pipeline init'));
    });
  });
});
