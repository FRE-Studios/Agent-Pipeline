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
  let originalIsTTY: boolean | undefined;

  beforeEach(async () => {
    tempDir = await createTempDir('create-pipeline-test-');

    // Save original TTY state and mock as interactive terminal
    originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true });

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
    // Restore original TTY state
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, writable: true });
  });

  /**
   * Helper to set up common mocks for successful pipeline creation.
   * The fs.access mock is set up to:
   * - Resolve for agents directory check (first call)
   * - Reject for pipeline file existence check (second call) - means file doesn't exist
   */
  function setupSuccessMocks(agents: string[] = ['agent.md']) {
    vi.mocked(fs.access)
      .mockResolvedValueOnce(undefined)  // agents dir exists
      .mockRejectedValueOnce(new Error('File not found'));  // pipeline file doesn't exist
    vi.mocked(fs.readdir).mockResolvedValue(agents as any);
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);
  }

  describe('TTY Check', () => {
    it('should exit when not running in interactive terminal', async () => {
      Object.defineProperty(process.stdin, 'isTTY', { value: false, writable: true });

      await expect(createPipelineCommand(tempDir)).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('requires an interactive terminal'));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should suggest init command for non-interactive setup', async () => {
      Object.defineProperty(process.stdin, 'isTTY', { value: false, writable: true });

      await expect(createPipelineCommand(tempDir)).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('agent-pipeline init'));
    });
  });

  describe('Agents Directory Check', () => {
    it('should show helpful error when agents directory does not exist', async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

      await expect(createPipelineCommand(tempDir)).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('No agents directory found'));
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('agent-pipeline init'));
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('agent-pipeline agent pull'));
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Manually copy agent .md files'));
    });

    it('should exit when no agents found in directory', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue([] as any);

      await expect(createPipelineCommand(tempDir)).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('No agents found'));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should filter out hidden files when checking agents', async () => {
      setupSuccessMocks(['.hidden.md', 'valid-agent.md', '.DS_Store']);
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('test-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('manual').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(true);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['valid-agent.md']);

      await createPipelineCommand(tempDir);

      // Should only count the valid agent
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Found 1 agent(s)'));
    });
  });

  describe('Pipeline Name Validation', () => {
    it('should exit when pipeline name is empty', async () => {
      setupSuccessMocks();
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('');

      await expect(createPipelineCommand(tempDir)).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Pipeline name is required'));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should exit when pipeline name starts with number', async () => {
      setupSuccessMocks();
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('123-pipeline');

      await expect(createPipelineCommand(tempDir)).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('must start with a letter'));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should exit when pipeline name contains spaces', async () => {
      setupSuccessMocks();
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('my pipeline');

      await expect(createPipelineCommand(tempDir)).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('must start with a letter'));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should exit when pipeline name contains special characters', async () => {
      setupSuccessMocks();
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('my@pipeline!');

      await expect(createPipelineCommand(tempDir)).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('must start with a letter'));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should exit when pipeline name is too long', async () => {
      setupSuccessMocks();
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('a'.repeat(51));

      await expect(createPipelineCommand(tempDir)).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('50 characters or less'));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should accept valid pipeline names with hyphens and underscores', async () => {
      setupSuccessMocks();
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('my-pipeline_v2');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('manual').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(true);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['agent.md']);

      await createPipelineCommand(tempDir);

      expect(fs.writeFile).toHaveBeenCalled();
    });
  });

  describe('Basic Execution', () => {
    it('should check for agents directory and list available agents', async () => {
      const mockAgents = ['code-reviewer.md', 'security-auditor.md'];
      setupSuccessMocks(mockAgents);
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('test-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('manual').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(true);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['code-reviewer.md']);

      await createPipelineCommand(tempDir);

      expect(fs.readdir).toHaveBeenCalledWith(path.join(tempDir, '.agent-pipeline', 'agents'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Found 2 agent(s)'));
    });

    it('should prompt for pipeline name', async () => {
      setupSuccessMocks();
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('my-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('manual').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(true);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['agent.md']);

      await createPipelineCommand(tempDir);

      expect(InteractivePrompts.ask).toHaveBeenCalledWith('Pipeline name');
    });

    it('should prompt for trigger type', async () => {
      setupSuccessMocks();
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('test-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('post-commit').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(true);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['agent.md']);

      await createPipelineCommand(tempDir);

      expect(InteractivePrompts.choose).toHaveBeenCalledWith(
        expect.stringContaining('Trigger type'),
        ['manual', 'pre-commit', 'post-commit', 'pre-push', 'post-merge'],
        'manual'
      );
    });

    it('should prompt for execution mode', async () => {
      setupSuccessMocks();
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('test-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('manual').mockResolvedValueOnce('sequential');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(true);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['agent.md']);

      await createPipelineCommand(tempDir);

      expect(InteractivePrompts.choose).toHaveBeenCalledWith(
        expect.stringContaining('Execution mode'),
        ['parallel', 'sequential'],
        'parallel'
      );
    });

    it('should prompt for auto-commit with correct default based on trigger', async () => {
      setupSuccessMocks();
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('test-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('post-commit').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(true);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['agent.md']);

      await createPipelineCommand(tempDir);

      // post-commit should default to true
      expect(InteractivePrompts.confirm).toHaveBeenCalledWith(
        expect.stringContaining('Auto-commit'),
        true
      );
    });

    it('should default auto-commit to false for pre-commit trigger', async () => {
      setupSuccessMocks();
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('test-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('pre-commit').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(false);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['agent.md']);

      await createPipelineCommand(tempDir);

      // pre-commit should default to false
      expect(InteractivePrompts.confirm).toHaveBeenCalledWith(
        expect.stringContaining('Auto-commit'),
        false
      );
    });

    it('should prompt for agent selection', async () => {
      const mockAgents = ['code-reviewer.md', 'security-auditor.md', 'quality-checker.md'];
      setupSuccessMocks(mockAgents);
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('test-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('manual').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(true);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['code-reviewer.md', 'security-auditor.md']);

      await createPipelineCommand(tempDir);

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
      setupSuccessMocks();
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('test-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('manual').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(true);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['agent.md']);

      await createPipelineCommand(tempDir);

      expect(PipelineValidator.validateAndReport).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test-pipeline',
          trigger: 'manual',
        }),
        tempDir
      );
    });

    it('should create pipelines directory if missing', async () => {
      setupSuccessMocks();
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('test-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('manual').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(true);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['agent.md']);

      await createPipelineCommand(tempDir);

      expect(fs.mkdir).toHaveBeenCalledWith(
        path.join(tempDir, '.agent-pipeline', 'pipelines'),
        { recursive: true }
      );
    });

    it('should write YAML file to correct location', async () => {
      setupSuccessMocks();
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('my-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('manual').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(true);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['agent.md']);

      await createPipelineCommand(tempDir);

      expect(fs.writeFile).toHaveBeenCalledWith(
        path.join(tempDir, '.agent-pipeline', 'pipelines', 'my-pipeline.yml'),
        expect.any(String),
        'utf-8'
      );
    });

    it('should build correct pipeline config with all settings', async () => {
      setupSuccessMocks(['agent1.md', 'agent2.md']);
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('full-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('post-commit').mockResolvedValueOnce('sequential');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(false);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['agent1.md', 'agent2.md']);

      await createPipelineCommand(tempDir);

      expect(PipelineValidator.validateAndReport).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'full-pipeline',
          trigger: 'post-commit',
          git: expect.objectContaining({
            autoCommit: false,
            commitPrefix: '[pipeline:{{stage}}]',
          }),
          execution: expect.objectContaining({
            failureStrategy: 'stop',
            mode: 'sequential',
          }),
          agents: expect.arrayContaining([
            expect.objectContaining({ name: 'agent1', agent: '.agent-pipeline/agents/agent1.md', timeout: 300 }),
            expect.objectContaining({ name: 'agent2', agent: '.agent-pipeline/agents/agent2.md', timeout: 300 }),
          ]),
        }),
        tempDir
      );
    });
  });

  describe('Overwrite Confirmation', () => {
    it('should check if pipeline already exists', async () => {
      vi.mocked(fs.access)
        .mockResolvedValueOnce(undefined)  // agents dir exists
        .mockResolvedValueOnce(undefined); // pipeline file exists
      vi.mocked(fs.readdir).mockResolvedValue(['agent.md'] as any);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('existing-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('manual').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValueOnce(true).mockResolvedValueOnce(true);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['agent.md']);

      await createPipelineCommand(tempDir);

      // Second fs.access call should be for the pipeline file
      expect(fs.access).toHaveBeenCalledWith(
        path.join(tempDir, '.agent-pipeline', 'pipelines', 'existing-pipeline.yml')
      );
    });

    it('should prompt for overwrite when pipeline exists', async () => {
      vi.mocked(fs.access)
        .mockResolvedValueOnce(undefined)  // agents dir exists
        .mockResolvedValueOnce(undefined); // pipeline file exists
      vi.mocked(fs.readdir).mockResolvedValue(['agent.md'] as any);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('existing-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('manual').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValueOnce(true).mockResolvedValueOnce(true);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['agent.md']);

      await createPipelineCommand(tempDir);

      expect(InteractivePrompts.confirm).toHaveBeenCalledWith(
        expect.stringContaining('already exists. Overwrite?'),
        false
      );
    });

    it('should overwrite when user confirms', async () => {
      vi.mocked(fs.access)
        .mockResolvedValueOnce(undefined)  // agents dir exists
        .mockResolvedValueOnce(undefined); // pipeline file exists
      vi.mocked(fs.readdir).mockResolvedValue(['agent.md'] as any);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('existing-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('manual').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValueOnce(true).mockResolvedValueOnce(true); // auto-commit, then overwrite
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['agent.md']);

      await createPipelineCommand(tempDir);

      expect(fs.writeFile).toHaveBeenCalled();
    });

    it('should cancel when user declines overwrite', async () => {
      vi.mocked(fs.access)
        .mockResolvedValueOnce(undefined)  // agents dir exists
        .mockResolvedValueOnce(undefined); // pipeline file exists
      vi.mocked(fs.readdir).mockResolvedValue(['agent.md'] as any);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('existing-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('manual').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValueOnce(true).mockResolvedValueOnce(false); // auto-commit, then decline overwrite
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['agent.md']);

      await createPipelineCommand(tempDir);

      expect(fs.writeFile).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith('Cancelled.');
    });
  });

  describe('Error Handling', () => {
    it('should exit when no agents selected', async () => {
      setupSuccessMocks();
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('test-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('manual').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(true);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue([]);

      await expect(createPipelineCommand(tempDir)).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('At least one agent must be selected'));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should exit when validation fails', async () => {
      vi.mocked(fs.access).mockResolvedValueOnce(undefined);
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

    it('should handle file write errors', async () => {
      setupSuccessMocks();
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('test-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('manual').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(true);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['agent.md']);
      vi.mocked(fs.writeFile).mockRejectedValue(new Error('Permission denied'));

      await expect(createPipelineCommand(tempDir)).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to write pipeline file'));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle pipelines directory creation errors', async () => {
      vi.mocked(fs.access).mockResolvedValueOnce(undefined);
      vi.mocked(fs.readdir).mockResolvedValue(['agent.md'] as any);
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('test-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('manual').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(true);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['agent.md']);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);
      vi.mocked(fs.mkdir).mockRejectedValue(new Error('Permission denied'));

      await expect(createPipelineCommand(tempDir)).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to create pipelines directory'));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('Different Trigger Types', () => {
    it('should create config with pre-commit trigger', async () => {
      setupSuccessMocks();
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('test-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('pre-commit').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(false);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['agent.md']);

      await createPipelineCommand(tempDir);

      expect(PipelineValidator.validateAndReport).toHaveBeenCalledWith(
        expect.objectContaining({
          trigger: 'pre-commit',
          git: expect.objectContaining({
            autoCommit: false,
          }),
        }),
        tempDir
      );
    });

    it('should create config with pre-push trigger', async () => {
      setupSuccessMocks();
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('test-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('pre-push').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(false);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['agent.md']);

      await createPipelineCommand(tempDir);

      expect(PipelineValidator.validateAndReport).toHaveBeenCalledWith(
        expect.objectContaining({
          trigger: 'pre-push',
          git: expect.objectContaining({
            autoCommit: false,
          }),
        }),
        tempDir
      );
    });

    it('should create config with post-merge trigger and auto-commit enabled', async () => {
      setupSuccessMocks();
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('test-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('post-merge').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(true);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['agent.md']);

      await createPipelineCommand(tempDir);

      expect(PipelineValidator.validateAndReport).toHaveBeenCalledWith(
        expect.objectContaining({
          trigger: 'post-merge',
          git: expect.objectContaining({
            autoCommit: true,
          }),
        }),
        tempDir
      );
    });
  });

  describe('Success Output', () => {
    it('should show success message after creating pipeline', async () => {
      setupSuccessMocks();
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('success-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('manual').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(true);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['agent.md']);

      await createPipelineCommand(tempDir);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Pipeline created successfully'));
    });

    it('should show next steps for manual trigger', async () => {
      setupSuccessMocks();
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('manual-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('manual').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(true);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['agent.md']);

      await createPipelineCommand(tempDir);

      // Should not show install hook message for manual trigger
      const allCalls = consoleLogSpy.mock.calls.map(call => call[0]);
      const hasInstallMessage = allCalls.some((msg: any) => msg?.includes && msg.includes('Install git hook'));
      expect(hasInstallMessage).toBe(false);
    });

    it('should show install hook suggestion for non-manual triggers', async () => {
      setupSuccessMocks();
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('post-commit-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('post-commit').mockResolvedValueOnce('parallel');
      vi.mocked(InteractivePrompts.confirm).mockResolvedValue(true);
      vi.mocked(InteractivePrompts.multiSelect).mockResolvedValue(['agent.md']);

      await createPipelineCommand(tempDir);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Install git hook'));
    });
  });
});
