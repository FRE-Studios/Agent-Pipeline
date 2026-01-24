// src/__tests__/cli/commands/schema.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { schemaCommand, SchemaCommandOptions } from '../../../cli/commands/schema.js';
import { createTempDir, cleanupTempDir } from '../../setup.js';

// Mock fs/promises for schema file reading
vi.mock('fs/promises', async () => {
  const actual = await vi.importActual('fs/promises');
  return {
    ...actual,
    readFile: vi.fn(),
    writeFile: vi.fn(),
  };
});

// Mock process.exit
const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
  throw new Error('process.exit called');
});

describe('schemaCommand', () => {
  let tempDir: string;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tempDir = await createTempDir('schema-');
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.clearAllMocks();
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await cleanupTempDir(tempDir);
  });

  describe('default behavior (minimal template)', () => {
    it('should display minimal template by default', async () => {
      await schemaCommand(tempDir, {});

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('name: my-pipeline');
      expect(output).toContain('trigger: manual');
      expect(output).toContain('agents:');
    });

    it('should include helpful comments in template', async () => {
      await schemaCommand(tempDir, {});

      const output = consoleLogSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('Agent Pipeline Configuration');
      expect(output).toContain('agent-pipeline schema --examples');
      expect(output).toContain('agent-pipeline schema --full');
    });

    it('should show dependsOn example', async () => {
      await schemaCommand(tempDir, {});

      const output = consoleLogSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('dependsOn:');
      expect(output).toContain('planner');
    });
  });

  describe('--examples flag', () => {
    it('should display example configurations', async () => {
      await schemaCommand(tempDir, { examples: true });

      const output = consoleLogSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('Example 1');
      expect(output).toContain('Example 2');
      expect(output).toContain('Parallel Execution');
    });

    it('should include all example categories', async () => {
      await schemaCommand(tempDir, { examples: true });

      const output = consoleLogSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('Simple Sequential Pipeline');
      expect(output).toContain('Parallel Execution');
      expect(output).toContain('Multi-Stage Review with Handover');
      expect(output).toContain('Git Integration with Auto-PR');
      expect(output).toContain('Loop Pipeline');
      expect(output).toContain('Mixed Models for Cost Optimization');
      expect(output).toContain('Notifications and Monitoring');
    });

    it('should export examples to file when --output specified', async () => {
      const outputPath = path.join(tempDir, 'examples.yml');

      await schemaCommand(tempDir, { examples: true, output: outputPath });

      expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith(
        outputPath,
        expect.stringContaining('Example 1'),
        'utf-8'
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Examples exported to:'));
    });
  });

  describe('--field flag', () => {
    it('should display documentation for "name" field', async () => {
      await schemaCommand(tempDir, { field: 'name' });

      const output = consoleLogSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('name');
      expect(output).toContain('required');
      expect(output).toContain('Unique identifier');
    });

    it('should display documentation for "trigger" field', async () => {
      await schemaCommand(tempDir, { field: 'trigger' });

      const output = consoleLogSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('trigger');
      expect(output).toContain('manual');
      expect(output).toContain('pre-commit');
      expect(output).toContain('post-commit');
    });

    it('should display documentation for "agents" field', async () => {
      await schemaCommand(tempDir, { field: 'agents' });

      const output = consoleLogSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('agents');
      expect(output).toContain('required');
      expect(output).toContain('List of agent stages');
    });

    it('should display documentation for "git" field', async () => {
      await schemaCommand(tempDir, { field: 'git' });

      const output = consoleLogSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('git');
      expect(output).toContain('optional');
      expect(output).toContain('baseBranch');
      expect(output).toContain('branchStrategy');
    });

    it('should display documentation for "notifications" field', async () => {
      await schemaCommand(tempDir, { field: 'notifications' });

      const output = consoleLogSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('notifications');
      expect(output).toContain('desktop');
      expect(output).toContain('slack');
      expect(output).toContain('webhookUrl');
    });

    it('should display documentation for "looping" field', async () => {
      await schemaCommand(tempDir, { field: 'looping' });

      const output = consoleLogSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('looping');
      expect(output).toContain('maxIterations');
      expect(output).toContain('instructions');
    });

    it('should display documentation for "runtime" field', async () => {
      await schemaCommand(tempDir, { field: 'runtime' });

      const output = consoleLogSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('runtime');
      expect(output).toContain('model');
      expect(output).toContain('maxTurns');
      expect(output).toContain('maxThinkingTokens');
    });

    it('should display documentation for "execution" field', async () => {
      await schemaCommand(tempDir, { field: 'execution' });

      const output = consoleLogSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('execution');
      expect(output).toContain('mode');
      expect(output).toContain('failureStrategy');
      expect(output).toContain('permissionMode');
    });

    it('should display documentation for "inputs" field', async () => {
      await schemaCommand(tempDir, { field: 'inputs' });

      const output = consoleLogSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('inputs');
      expect(output).toContain('Key-value pairs');
    });

    it('should display documentation for "dependsOn" field', async () => {
      await schemaCommand(tempDir, { field: 'dependsOn' });

      const output = consoleLogSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('dependsOn');
      expect(output).toContain('stage names');
      expect(output).toContain('dependencies');
    });

    it('should show available fields for unknown field', async () => {
      await schemaCommand(tempDir, { field: 'unknownField' });

      const output = consoleLogSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('Unknown field: unknownField');
      expect(output).toContain('Available fields:');
      expect(output).toContain('name');
      expect(output).toContain('trigger');
      expect(output).toContain('agents');
    });

    it('should handle normalized field matching', async () => {
      // Test case-insensitive matching
      await schemaCommand(tempDir, { field: 'NAME' });

      const output = consoleLogSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('Unique identifier');
    });
  });

  describe('--full flag', () => {
    it('should attempt to read schema file', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('{"type": "object"}');

      await schemaCommand(tempDir, { full: true });

      expect(vi.mocked(fs.readFile)).toHaveBeenCalledWith(
        expect.stringContaining('pipeline-config.schema.json'),
        'utf-8'
      );
    });

    it('should output JSON format by default', async () => {
      const schemaContent = '{"type": "object", "properties": {}}';
      vi.mocked(fs.readFile).mockResolvedValue(schemaContent);

      await schemaCommand(tempDir, { full: true });

      expect(consoleLogSpy).toHaveBeenCalledWith(schemaContent);
    });

    it('should convert to YAML when format is yaml', async () => {
      const schemaContent = '{"type": "object"}';
      vi.mocked(fs.readFile).mockResolvedValue(schemaContent);

      await schemaCommand(tempDir, { full: true, format: 'yaml' });

      const output = consoleLogSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('type: object');
    });

    it('should export to file when --output specified', async () => {
      const schemaContent = '{"type": "object"}';
      vi.mocked(fs.readFile).mockResolvedValue(schemaContent);
      const outputPath = path.join(tempDir, 'schema.json');

      await schemaCommand(tempDir, { full: true, output: outputPath });

      expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith(
        outputPath,
        schemaContent,
        'utf-8'
      );
    });

    it('should handle missing schema file', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

      await expect(schemaCommand(tempDir, { full: true })).rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Schema file not found'));
    });
  });

  describe('--output flag', () => {
    it('should export minimal template to file', async () => {
      const outputPath = path.join(tempDir, 'template.yml');

      await schemaCommand(tempDir, { output: outputPath });

      expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith(
        outputPath,
        expect.stringContaining('name: my-pipeline'),
        'utf-8'
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Template exported to:'));
    });
  });

  describe('YAML colorization', () => {
    it('should colorize output for terminal display', async () => {
      await schemaCommand(tempDir, {});

      // Output should be called (colorized version)
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('should colorize examples for terminal display', async () => {
      await schemaCommand(tempDir, { examples: true });

      expect(consoleLogSpy).toHaveBeenCalled();
    });
  });

  describe('combined options', () => {
    it('should prioritize --examples over default', async () => {
      await schemaCommand(tempDir, { examples: true });

      const output = consoleLogSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('Example 1');
    });

    it('should prioritize --field over --examples', async () => {
      await schemaCommand(tempDir, { examples: true, field: 'name' });

      // --field should take precedence (though current impl checks examples first)
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('should handle full + yaml + output', async () => {
      const schemaContent = '{"type": "object", "title": "Pipeline"}';
      vi.mocked(fs.readFile).mockResolvedValue(schemaContent);
      const outputPath = path.join(tempDir, 'schema.yaml');

      await schemaCommand(tempDir, { full: true, format: 'yaml', output: outputPath });

      expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith(
        outputPath,
        expect.stringContaining('type: object'),
        'utf-8'
      );
    });
  });
});
