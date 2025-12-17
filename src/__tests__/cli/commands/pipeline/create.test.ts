import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPipelineCommand } from '../../../../cli/commands/pipeline/create.js';
import { InteractivePrompts } from '../../../../cli/utils/interactive-prompts.js';
import { PipelineValidator } from '../../../../validators/pipeline-validator.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createTempDir, cleanupTempDir } from '../../../setup.js';

// Mock dependencies
vi.mock('fs/promises');
vi.mock('../../../../cli/utils/interactive-prompts.js');
vi.mock('../../../../validators/pipeline-validator.js');

describe('createPipelineCommand', () => {
  let tempDir: string;
  let processExitSpy: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;

  beforeEach(async () => {
    tempDir = await createTempDir('create-pipeline-test-');

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
    it('should check for agents directory and list available agents', async () => {
      const mockAgents = ['code-reviewer.md', 'security-auditor.md'];
      vi.mocked(fs.readdir).mockResolvedValue(mockAgents as any);
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('test-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('manual').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(true);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['code-reviewer.md']);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      try {
        await createPipelineCommand(tempDir);
      } catch (error) {
        // Expected - exits at end
      }

      expect(fs.readdir).toHaveBeenCalledWith(path.join(tempDir, '.agent-pipeline', 'agents'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Found 2 agent(s)'));
    });

    it('should prompt for pipeline name', async () => {
      vi.mocked(fs.readdir).mockResolvedValue(['agent.md'] as any);
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('my-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('manual').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(true);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['agent.md']);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      try {
        await createPipelineCommand(tempDir);
      } catch (error) {
        // Expected
      }

      expect(InteractivePrompts.ask).toHaveBeenCalledWith('Pipeline name');
    });

    it('should prompt for trigger type', async () => {
      vi.mocked(fs.readdir).mockResolvedValue(['agent.md'] as any);
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('test-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('post-commit').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(true);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['agent.md']);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      try {
        await createPipelineCommand(tempDir);
      } catch (error) {
        // Expected
      }

      expect(InteractivePrompts.choose).toHaveBeenCalledWith(
        expect.stringContaining('Trigger type'),
        ['manual', 'pre-commit', 'post-commit', 'pre-push', 'post-merge'],
        'manual'
      );
    });

    it('should prompt for execution mode', async () => {
      vi.mocked(fs.readdir).mockResolvedValue(['agent.md'] as any);
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('test-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('manual').mockResolvedValueOnce('sequential');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(true);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['agent.md']);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      try {
        await createPipelineCommand(tempDir);
      } catch (error) {
        // Expected
      }

      expect(InteractivePrompts.choose).toHaveBeenCalledWith(
        expect.stringContaining('Execution mode'),
        ['parallel', 'sequential'],
        'parallel'
      );
    });

    it('should prompt for auto-commit with correct default based on trigger', async () => {
      vi.mocked(fs.readdir).mockResolvedValue(['agent.md'] as any);
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('test-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('post-commit').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(true);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['agent.md']);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      try {
        await createPipelineCommand(tempDir);
      } catch (error) {
        // Expected
      }

      // post-commit should default to true
      expect(InteractivePrompts.confirm).toHaveBeenCalledWith(
        expect.stringContaining('Auto-commit'),
        true
      );
    });

    it('should default auto-commit to false for pre-commit trigger', async () => {
      vi.mocked(fs.readdir).mockResolvedValue(['agent.md'] as any);
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('test-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('pre-commit').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(false);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['agent.md']);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      try {
        await createPipelineCommand(tempDir);
      } catch (error) {
        // Expected
      }

      // pre-commit should default to false
      expect(InteractivePrompts.confirm).toHaveBeenCalledWith(
        expect.stringContaining('Auto-commit'),
        false
      );
    });

    it('should prompt for agent selection', async () => {
      const mockAgents = ['code-reviewer.md', 'security-auditor.md', 'quality-checker.md'];
      vi.mocked(fs.readdir).mockResolvedValue(mockAgents as any);
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('test-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('manual').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(true);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['code-reviewer.md', 'security-auditor.md']);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      try {
        await createPipelineCommand(tempDir);
      } catch (error) {
        // Expected
      }

      expect(InteractivePrompts.multiSelect).toHaveBeenCalledWith(
        expect.stringContaining('Select agents'),
        expect.arrayContaining([
          { name: 'code-reviewer', value: 'code-reviewer.md' },
          { name: 'security-auditor', value: 'security-auditor.md' },
          { name: 'quality-checker', value: 'quality-checker.md' },
        ])
      );
    });

    it('should validate pipeline configuration before saving', async () => {
      vi.mocked(fs.readdir).mockResolvedValue(['agent.md'] as any);
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('test-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('manual').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(true);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['agent.md']);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      try {
        await createPipelineCommand(tempDir);
      } catch (error) {
        // Expected
      }

      expect(PipelineValidator.validateAndReport).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test-pipeline',
          trigger: 'manual',
        }),
        tempDir
      );
    });

    it('should create pipelines directory if missing', async () => {
      vi.mocked(fs.readdir).mockResolvedValue(['agent.md'] as any);
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('test-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('manual').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(true);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['agent.md']);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      try {
        await createPipelineCommand(tempDir);
      } catch (error) {
        // Expected
      }

      expect(fs.mkdir).toHaveBeenCalledWith(
        path.join(tempDir, '.agent-pipeline', 'pipelines'),
        { recursive: true }
      );
    });

    it('should write YAML file to correct location', async () => {
      vi.mocked(fs.readdir).mockResolvedValue(['agent.md'] as any);
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('my-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('manual').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(true);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['agent.md']);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      try {
        await createPipelineCommand(tempDir);
      } catch (error) {
        // Expected
      }

      expect(fs.writeFile).toHaveBeenCalledWith(
        path.join(tempDir, '.agent-pipeline', 'pipelines', 'my-pipeline.yml'),
        expect.any(String),
        'utf-8'
      );
    });

    it('should build correct pipeline config with all settings', async () => {
      vi.mocked(fs.readdir).mockResolvedValue(['agent1.md', 'agent2.md'] as any);
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('full-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('post-commit').mockResolvedValueOnce('sequential');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(false);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['agent1.md', 'agent2.md']);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      try {
        await createPipelineCommand(tempDir);
      } catch (error) {
        // Expected
      }

      expect(PipelineValidator.validateAndReport).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'full-pipeline',
          trigger: 'post-commit',
          settings: expect.objectContaining({
            autoCommit: false,
            commitPrefix: '[pipeline:{{stage}}]',
            failureStrategy: 'continue',
            preserveWorkingTree: false,
            executionMode: 'sequential',
          }),
          agents: expect.arrayContaining([
            expect.objectContaining({ name: 'agent1', agent: '.agent-pipeline/agents/agent1.md', timeout: 120 }),
            expect.objectContaining({ name: 'agent2', agent: '.agent-pipeline/agents/agent2.md', timeout: 120 }),
          ]),
        }),
        tempDir
      );
    });
  });

  describe('Overwrite Confirmation', () => {
    it('should check if pipeline already exists', async () => {
      vi.mocked(fs.readdir).mockResolvedValue(['agent.md'] as any);
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('existing-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('manual').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValueOnce(true).mockResolvedValueOnce(true);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['agent.md']);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.access).mockResolvedValue(undefined); // File exists
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      try {
        await createPipelineCommand(tempDir);
      } catch (error) {
        // Expected
      }

      expect(fs.access).toHaveBeenCalledWith(
        path.join(tempDir, '.agent-pipeline', 'pipelines', 'existing-pipeline.yml')
      );
    });

    it('should prompt for overwrite when pipeline exists', async () => {
      vi.mocked(fs.readdir).mockResolvedValue(['agent.md'] as any);
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('existing-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('manual').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValueOnce(true).mockResolvedValueOnce(true);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['agent.md']);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.access).mockResolvedValue(undefined); // File exists
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      try {
        await createPipelineCommand(tempDir);
      } catch (error) {
        // Expected
      }

      expect(InteractivePrompts.confirm).toHaveBeenCalledWith(
        expect.stringContaining('already exists. Overwrite?'),
        false
      );
    });

    it('should overwrite when user confirms', async () => {
      vi.mocked(fs.readdir).mockResolvedValue(['agent.md'] as any);
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('existing-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('manual').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValueOnce(true).mockResolvedValueOnce(true); // auto-commit, then overwrite
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['agent.md']);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.access).mockResolvedValue(undefined); // File exists
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      try {
        await createPipelineCommand(tempDir);
      } catch (error) {
        // Expected
      }

      expect(fs.writeFile).toHaveBeenCalled();
    });

    it('should cancel when user declines overwrite', async () => {
      vi.mocked(fs.readdir).mockResolvedValue(['agent.md'] as any);
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('existing-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('manual').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValueOnce(true).mockResolvedValueOnce(false); // auto-commit, then decline overwrite
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['agent.md']);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.access).mockResolvedValue(undefined); // File exists
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await createPipelineCommand(tempDir);

      expect(fs.writeFile).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith('Cancelled.');
    });
  });

  describe('Error Handling', () => {
    it('should exit when no agents found', async () => {
      vi.mocked(fs.readdir).mockResolvedValue([] as any);

      await expect(createPipelineCommand(tempDir)).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('No agents found'));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should filter out hidden files when checking agents', async () => {
      vi.mocked(fs.readdir).mockResolvedValue(['.hidden.md', 'valid-agent.md', '.DS_Store'] as any);
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('test-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('manual').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(true);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['valid-agent.md']);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      try {
        await createPipelineCommand(tempDir);
      } catch (error) {
        // Expected
      }

      // Should only count the valid agent
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Found 1 agent(s)'));
    });

    it('should exit when pipeline name is empty', async () => {
      vi.mocked(fs.readdir).mockResolvedValue(['agent.md'] as any);
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('');

      await expect(createPipelineCommand(tempDir)).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith('Pipeline name is required');
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should exit when no agents selected', async () => {
      vi.mocked(fs.readdir).mockResolvedValue(['agent.md'] as any);
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('test-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('manual').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(true);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue([]);

      await expect(createPipelineCommand(tempDir)).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('At least one agent must be selected'));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should exit when validation fails', async () => {
      vi.mocked(fs.readdir).mockResolvedValue(['agent.md'] as any);
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('invalid-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('manual').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(true);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['agent.md']);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(false);

      await expect(createPipelineCommand(tempDir)).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Pipeline configuration is invalid'));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle agents directory read errors', async () => {
      vi.mocked(fs.readdir).mockRejectedValue(new Error('Permission denied'));

      await expect(createPipelineCommand(tempDir)).rejects.toThrow('process.exit(1)');

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle file write errors', async () => {
      vi.mocked(fs.readdir).mockResolvedValue(['agent.md'] as any);
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('test-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('manual').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(true);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['agent.md']);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockRejectedValue(new Error('Permission denied'));

      await expect(createPipelineCommand(tempDir)).rejects.toThrow('process.exit(1)');

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('Different Trigger Types', () => {
    it('should set preserveWorkingTree true for pre-commit trigger', async () => {
      vi.mocked(fs.readdir).mockResolvedValue(['agent.md'] as any);
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('test-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('pre-commit').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(false);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['agent.md']);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      try {
        await createPipelineCommand(tempDir);
      } catch (error) {
        // Expected
      }

      expect(PipelineValidator.validateAndReport).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: expect.objectContaining({
            preserveWorkingTree: true,
          }),
        }),
        tempDir
      );
    });

    it('should set preserveWorkingTree true for pre-push trigger', async () => {
      vi.mocked(fs.readdir).mockResolvedValue(['agent.md'] as any);
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('test-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('pre-push').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(false);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['agent.md']);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      try {
        await createPipelineCommand(tempDir);
      } catch (error) {
        // Expected
      }

      expect(PipelineValidator.validateAndReport).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: expect.objectContaining({
            preserveWorkingTree: true,
          }),
        }),
        tempDir
      );
    });

    it('should set preserveWorkingTree false for post-merge trigger', async () => {
      vi.mocked(fs.readdir).mockResolvedValue(['agent.md'] as any);
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('test-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('post-merge').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(true);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['agent.md']);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      try {
        await createPipelineCommand(tempDir);
      } catch (error) {
        // Expected
      }

      expect(PipelineValidator.validateAndReport).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: expect.objectContaining({
            preserveWorkingTree: false,
          }),
        }),
        tempDir
      );
    });
  });

  describe('Success Output', () => {
    it('should show success message after creating pipeline', async () => {
      vi.mocked(fs.readdir).mockResolvedValue(['agent.md'] as any);
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('success-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('manual').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(true);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['agent.md']);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      try {
        await createPipelineCommand(tempDir);
      } catch (error) {
        // Expected
      }

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Pipeline created successfully'));
    });

    it('should show next steps for manual trigger', async () => {
      vi.mocked(fs.readdir).mockResolvedValue(['agent.md'] as any);
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('manual-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('manual').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(true);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['agent.md']);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      try {
        await createPipelineCommand(tempDir);
      } catch (error) {
        // Expected
      }

      // Should not show install hook message for manual trigger
      const allCalls = consoleLogSpy.mock.calls.map(call => call[0]);
      const hasInstallMessage = allCalls.some((msg: any) => msg?.includes && msg.includes('Install git hook'));
      expect(hasInstallMessage).toBe(false);
    });

    it('should show install hook suggestion for non-manual triggers', async () => {
      vi.mocked(fs.readdir).mockResolvedValue(['agent.md'] as any);
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('post-commit-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('post-commit').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(true);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['agent.md']);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      try {
        await createPipelineCommand(tempDir);
      } catch (error) {
        // Expected
      }

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Install git hook'));
    });
  });
});
