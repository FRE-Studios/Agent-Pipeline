import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { importPipelineCommand } from '../../../../cli/commands/pipeline/import.js';
import { PipelineValidator } from '../../../../validators/pipeline-validator.js';
import { InteractivePrompts } from '../../../../cli/utils/interactive-prompts.js';
import { createTempDir, cleanupTempDir } from '../../../setup.js';
import * as fs from 'fs/promises';

// Mock dependencies
vi.mock('../../../../validators/pipeline-validator.js');
vi.mock('../../../../cli/utils/interactive-prompts.js');
vi.mock('fs/promises');

describe('importPipelineCommand', () => {
  let tempDir: string;
  let processExitSpy: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let fetchSpy: any;

  beforeEach(async () => {
    tempDir = await createTempDir('import-pipeline-test-');

    // Spy on process.exit
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
      throw new Error(`process.exit(${code})`);
    });

    // Spy on console methods
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Mock global fetch
    fetchSpy = vi.fn();
    global.fetch = fetchSpy as any;
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
    vi.clearAllMocks();
    processExitSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('Local File Import', () => {
    it('should read from local file path', async () => {
      const yamlContent = 'name: test-pipeline\ntrigger: manual\nagents: []';
      vi.mocked(fs.readFile).mockResolvedValue(yamlContent);
      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT')); // File doesn't exist yet
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);

      await importPipelineCommand(tempDir, '/tmp/pipeline.yml');

      expect(vi.mocked(fs.readFile)).toHaveBeenCalledWith('/tmp/pipeline.yml', 'utf-8');
    });

    it('should parse YAML content correctly', async () => {
      const yamlContent = `name: parsed-pipeline
trigger: post-commit
agents:
  - name: agent1
    agent: agent1.md`;

      vi.mocked(fs.readFile).mockResolvedValue(yamlContent);
      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);

      await importPipelineCommand(tempDir, '/tmp/pipeline.yml');

      // Verify the parsed config was passed to validator
      expect(PipelineValidator.validateAndReport).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'parsed-pipeline',
          trigger: 'post-commit',
        }),
        tempDir
      );
    });

    it('should validate pipeline before saving', async () => {
      const yamlContent = 'name: test-pipeline\ntrigger: manual\nagents: []';
      vi.mocked(fs.readFile).mockResolvedValue(yamlContent);
      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);

      await importPipelineCommand(tempDir, '/tmp/pipeline.yml');

      expect(PipelineValidator.validateAndReport).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Validating pipeline'));
    });

    it('should save to .agent-pipeline/pipelines/ directory', async () => {
      const yamlContent = 'name: test-pipeline\ntrigger: manual\nagents: []';
      vi.mocked(fs.readFile).mockResolvedValue(yamlContent);
      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);

      await importPipelineCommand(tempDir, '/tmp/pipeline.yml');

      expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith(
        expect.stringContaining('.agent-pipeline/pipelines/test-pipeline.yml'),
        expect.any(String),
        'utf-8'
      );
    });
  });

  describe('URL Import', () => {
    it('should detect http:// URLs', async () => {
      const yamlContent = 'name: url-pipeline\ntrigger: manual\nagents: []';
      fetchSpy.mockResolvedValue({
        ok: true,
        text: async () => yamlContent,
      });
      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);

      await importPipelineCommand(tempDir, 'http://example.com/pipeline.yml');

      expect(fetchSpy).toHaveBeenCalledWith('http://example.com/pipeline.yml');
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Fetching from: http://example.com/pipeline.yml')
      );
    });

    it('should detect https:// URLs', async () => {
      const yamlContent = 'name: secure-pipeline\ntrigger: manual\nagents: []';
      fetchSpy.mockResolvedValue({
        ok: true,
        text: async () => yamlContent,
      });
      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);

      await importPipelineCommand(tempDir, 'https://example.com/pipeline.yml');

      expect(fetchSpy).toHaveBeenCalledWith('https://example.com/pipeline.yml');
    });

    it('should handle HTTP 404 errors', async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      await expect(
        importPipelineCommand(tempDir, 'https://example.com/missing.yml')
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to import pipeline')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('HTTP 404')
      );
    });

    it('should handle HTTP 500 errors', async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(
        importPipelineCommand(tempDir, 'https://example.com/pipeline.yml')
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('HTTP 500')
      );
    });

    it('should parse remote YAML content', async () => {
      const yamlContent = `name: remote-pipeline
trigger: post-commit
settings:
  autoCommit: true
agents:
  - name: remote-agent
    agent: remote.md`;

      fetchSpy.mockResolvedValue({
        ok: true,
        text: async () => yamlContent,
      });
      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);

      await importPipelineCommand(tempDir, 'https://example.com/pipeline.yml');

      expect(PipelineValidator.validateAndReport).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'remote-pipeline',
          trigger: 'post-commit',
          settings: expect.objectContaining({
            autoCommit: true,
          }),
        }),
        tempDir
      );
    });

    it('should show fetching progress message', async () => {
      const yamlContent = 'name: test\ntrigger: manual\nagents: []';
      fetchSpy.mockResolvedValue({
        ok: true,
        text: async () => yamlContent,
      });
      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);

      await importPipelineCommand(tempDir, 'https://example.com/pipeline.yml');

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('📥 Importing pipeline')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Fetching from: https://example.com/pipeline.yml')
      );
    });
  });

  describe('Name Conflicts', () => {
    it('should check if pipeline already exists', async () => {
      const yamlContent = 'name: existing-pipeline\ntrigger: manual\nagents: []';
      vi.mocked(fs.readFile).mockResolvedValue(yamlContent);
      vi.mocked(fs.access).mockResolvedValue(undefined); // File exists
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(false);

      await importPipelineCommand(tempDir, '/tmp/pipeline.yml');

      expect(vi.mocked(fs.access)).toHaveBeenCalledWith(
        expect.stringContaining('existing-pipeline.yml')
      );
    });

    it('should prompt for overwrite confirmation when pipeline exists', async () => {
      const yamlContent = 'name: existing\ntrigger: manual\nagents: []';
      vi.mocked(fs.readFile).mockResolvedValue(yamlContent);
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(false);

      await importPipelineCommand(tempDir, '/tmp/pipeline.yml');

      expect(InteractivePrompts.confirm).toHaveBeenCalledWith(
        expect.stringContaining('Pipeline "existing" already exists. Overwrite?'),
        false
      );
    });

    it('should overwrite when user confirms', async () => {
      const yamlContent = 'name: overwrite-test\ntrigger: manual\nagents: []';
      vi.mocked(fs.readFile).mockResolvedValue(yamlContent);
      vi.mocked(fs.access).mockResolvedValue(undefined); // File exists
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(true); // User confirms
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);

      await importPipelineCommand(tempDir, '/tmp/pipeline.yml');

      expect(vi.mocked(fs.writeFile)).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Pipeline imported successfully')
      );
    });

    it('should cancel when user declines', async () => {
      const yamlContent = 'name: cancel-test\ntrigger: manual\nagents: []';
      vi.mocked(fs.readFile).mockResolvedValue(yamlContent);
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(false);

      await importPipelineCommand(tempDir, '/tmp/pipeline.yml');

      expect(vi.mocked(fs.writeFile)).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Cancelled'));
    });
  });

  describe('Validation', () => {
    it('should exit when YAML is invalid', async () => {
      const invalidYaml = 'name: test\n  invalid: : : yaml';
      vi.mocked(fs.readFile).mockResolvedValue(invalidYaml);

      await expect(
        importPipelineCommand(tempDir, '/tmp/invalid.yml')
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to import pipeline')
      );
    });

    it('should exit when missing name field', async () => {
      const yamlContent = 'trigger: manual\nagents: []';
      vi.mocked(fs.readFile).mockResolvedValue(yamlContent);

      await expect(
        importPipelineCommand(tempDir, '/tmp/no-name.yml')
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid pipeline: missing name field')
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should exit when PipelineValidator fails', async () => {
      const yamlContent = 'name: invalid-pipeline\ntrigger: manual\nagents: []';
      vi.mocked(fs.readFile).mockResolvedValue(yamlContent);
      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(false);

      await expect(
        importPipelineCommand(tempDir, '/tmp/pipeline.yml')
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Pipeline validation failed')
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should show validation progress messages', async () => {
      const yamlContent = 'name: test\ntrigger: manual\nagents: []';
      vi.mocked(fs.readFile).mockResolvedValue(yamlContent);
      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);

      await importPipelineCommand(tempDir, '/tmp/pipeline.yml');

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('📋 Validating pipeline')
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors for URL imports', async () => {
      fetchSpy.mockRejectedValue(new Error('Network error: connection timeout'));

      await expect(
        importPipelineCommand(tempDir, 'https://example.com/pipeline.yml')
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to import pipeline')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Network error')
      );
    });

    it('should handle file read errors for local imports', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('EACCES: permission denied'));

      await expect(
        importPipelineCommand(tempDir, '/protected/pipeline.yml')
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to import pipeline')
      );
    });

    it('should handle YAML parse errors', async () => {
      const badYaml = 'name: test\n   bad:\n      - indentation\n  - wrong';
      vi.mocked(fs.readFile).mockResolvedValue(badYaml);

      await expect(
        importPipelineCommand(tempDir, '/tmp/bad.yml')
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to import pipeline')
      );
    });
  });

  describe('Integration', () => {
    it('should complete local import workflow', async () => {
      const yamlContent = `name: complete-local
trigger: post-commit
settings:
  autoCommit: true
agents:
  - name: agent1
    agent: agent1.md`;

      vi.mocked(fs.readFile).mockResolvedValue(yamlContent);
      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);

      await importPipelineCommand(tempDir, '/tmp/local-pipeline.yml');

      // Verify complete workflow
      expect(vi.mocked(fs.readFile)).toHaveBeenCalledWith('/tmp/local-pipeline.yml', 'utf-8');
      expect(PipelineValidator.validateAndReport).toHaveBeenCalled();
      expect(vi.mocked(fs.mkdir)).toHaveBeenCalled();
      expect(vi.mocked(fs.writeFile)).toHaveBeenCalled();

      // Verify success messages
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Pipeline imported successfully')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('💡 Next steps')
      );
    });

    it('should complete URL import workflow', async () => {
      const yamlContent = `name: complete-remote
trigger: manual
agents:
  - name: remote-agent
    agent: remote.md`;

      fetchSpy.mockResolvedValue({
        ok: true,
        text: async () => yamlContent,
      });
      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);

      await importPipelineCommand(tempDir, 'https://example.com/remote.yml');

      // Verify complete workflow
      expect(fetchSpy).toHaveBeenCalledWith('https://example.com/remote.yml');
      expect(PipelineValidator.validateAndReport).toHaveBeenCalled();
      expect(vi.mocked(fs.writeFile)).toHaveBeenCalled();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('📥 Importing pipeline')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Fetching from: https://example.com/remote.yml')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Pipeline imported successfully')
      );
    });

    it('should complete import with overwrite confirmation workflow', async () => {
      const yamlContent = 'name: overwrite-workflow\ntrigger: manual\nagents: []';
      vi.mocked(fs.readFile).mockResolvedValue(yamlContent);
      vi.mocked(fs.access).mockResolvedValue(undefined); // File exists
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(true); // User confirms
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);

      await importPipelineCommand(tempDir, '/tmp/overwrite.yml');

      // Verify complete workflow with confirmation
      expect(vi.mocked(fs.access)).toHaveBeenCalled();
      expect(InteractivePrompts.confirm).toHaveBeenCalled();
      expect(PipelineValidator.validateAndReport).toHaveBeenCalled();
      expect(vi.mocked(fs.writeFile)).toHaveBeenCalled();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Pipeline imported successfully')
      );
    });
  });
});
