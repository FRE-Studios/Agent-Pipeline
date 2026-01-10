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

  /**
   * Helper to set up mocks for single agent selection (no dependency prompts)
   */
  function setupSingleAgentMocks(pipelineName: string, trigger: string = 'manual', autoCommit: boolean = true) {
    vi.mocked(InteractivePrompts.ask).mockResolvedValue(pipelineName);
    vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce(trigger);
    vi.mocked(InteractivePrompts.selectSingle).mockResolvedValueOnce('agent.md');
    // confirm calls: autoCommit, then "add another agent?" (no)
    vi.mocked(InteractivePrompts.confirm)
      .mockResolvedValueOnce(autoCommit)
      .mockResolvedValueOnce(false);
  }

  /**
   * Helper to set up mocks for two agent selection with dependency
   */
  function setupTwoAgentMocks(
    pipelineName: string,
    trigger: string = 'manual',
    autoCommit: boolean = true,
    secondAgentDeps: string[] = []
  ) {
    vi.mocked(InteractivePrompts.ask).mockResolvedValue(pipelineName);
    vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce(trigger);
    vi.mocked(InteractivePrompts.selectSingle)
      .mockResolvedValueOnce('agent1.md')
      .mockResolvedValueOnce('agent2.md');
    // confirm calls: autoCommit, "add another agent?" (yes), "add another agent?" (no)
    vi.mocked(InteractivePrompts.confirm)
      .mockResolvedValueOnce(autoCommit)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    // multiSelect for dependencies
    vi.mocked(InteractivePrompts.multiSelect).mockResolvedValueOnce(secondAgentDeps);
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
      setupSingleAgentMocks('test-pipeline');
      vi.mocked(InteractivePrompts.selectSingle).mockReset();
      vi.mocked(InteractivePrompts.selectSingle).mockResolvedValueOnce('valid-agent.md');

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
      setupSingleAgentMocks('my-pipeline_v2');

      await createPipelineCommand(tempDir);

      expect(fs.writeFile).toHaveBeenCalled();
    });
  });

  describe('Basic Execution', () => {
    it('should check for agents directory and list available agents', async () => {
      const mockAgents = ['code-reviewer.md', 'security-auditor.md'];
      setupSuccessMocks(mockAgents);
      setupSingleAgentMocks('test-pipeline');
      vi.mocked(InteractivePrompts.selectSingle).mockReset();
      vi.mocked(InteractivePrompts.selectSingle).mockResolvedValueOnce('code-reviewer.md');

      await createPipelineCommand(tempDir);

      expect(fs.readdir).toHaveBeenCalledWith(path.join(tempDir, '.agent-pipeline', 'agents'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Found 2 agent(s)'));
    });

    it('should prompt for pipeline name', async () => {
      setupSuccessMocks();
      setupSingleAgentMocks('my-pipeline');

      await createPipelineCommand(tempDir);

      expect(InteractivePrompts.ask).toHaveBeenCalledWith('Pipeline name');
    });

    it('should prompt for trigger type', async () => {
      setupSuccessMocks();
      setupSingleAgentMocks('test-pipeline', 'post-commit');

      await createPipelineCommand(tempDir);

      expect(InteractivePrompts.choose).toHaveBeenCalledWith(
        expect.stringContaining('Trigger type'),
        ['manual', 'pre-commit', 'post-commit', 'pre-push', 'post-merge'],
        'manual'
      );
    });

    it('should prompt for auto-commit with correct default based on trigger', async () => {
      setupSuccessMocks();
      setupSingleAgentMocks('test-pipeline', 'post-commit');

      await createPipelineCommand(tempDir);

      // post-commit should default to true
      expect(InteractivePrompts.confirm).toHaveBeenCalledWith(
        expect.stringContaining('Auto-commit'),
        true
      );
    });

    it('should default auto-commit to false for pre-commit trigger', async () => {
      setupSuccessMocks();
      setupSingleAgentMocks('test-pipeline', 'pre-commit', false);

      await createPipelineCommand(tempDir);

      // pre-commit should default to false
      expect(InteractivePrompts.confirm).toHaveBeenCalledWith(
        expect.stringContaining('Auto-commit'),
        false
      );
    });

    it('should validate pipeline configuration before saving', async () => {
      setupSuccessMocks();
      setupSingleAgentMocks('test-pipeline');

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
      setupSingleAgentMocks('test-pipeline');

      await createPipelineCommand(tempDir);

      expect(fs.mkdir).toHaveBeenCalledWith(
        path.join(tempDir, '.agent-pipeline', 'pipelines'),
        { recursive: true }
      );
    });

    it('should write YAML file to correct location', async () => {
      setupSuccessMocks();
      setupSingleAgentMocks('my-pipeline');

      await createPipelineCommand(tempDir);

      expect(fs.writeFile).toHaveBeenCalledWith(
        path.join(tempDir, '.agent-pipeline', 'pipelines', 'my-pipeline.yml'),
        expect.any(String),
        'utf-8'
      );
    });

    it('should build minimal pipeline config without execution section', async () => {
      setupSuccessMocks(['agent1.md', 'agent2.md']);
      setupTwoAgentMocks('full-pipeline', 'post-commit', true, ['agent1']);

      await createPipelineCommand(tempDir);

      expect(PipelineValidator.validateAndReport).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'full-pipeline',
          trigger: 'post-commit',
          git: expect.objectContaining({
            autoCommit: true,
            commitPrefix: '[pipeline:{{stage}}]',
          }),
          agents: expect.arrayContaining([
            expect.objectContaining({ name: 'agent1', agent: '.agent-pipeline/agents/agent1.md' }),
            expect.objectContaining({ name: 'agent2', agent: '.agent-pipeline/agents/agent2.md', dependsOn: ['agent1'] }),
          ]),
        }),
        tempDir
      );

      // Should NOT have execution section (uses defaults)
      expect(PipelineValidator.validateAndReport).not.toHaveBeenCalledWith(
        expect.objectContaining({
          execution: expect.anything(),
        }),
        tempDir
      );
    });

    it('should omit git section when autoCommit is false', async () => {
      setupSuccessMocks();
      setupSingleAgentMocks('test-pipeline', 'pre-commit', false);

      await createPipelineCommand(tempDir);

      // Should NOT have git section when autoCommit is false
      expect(PipelineValidator.validateAndReport).not.toHaveBeenCalledWith(
        expect.objectContaining({
          git: expect.anything(),
        }),
        tempDir
      );
    });

    it('should not include timeout in agent config (uses default)', async () => {
      setupSuccessMocks();
      setupSingleAgentMocks('test-pipeline');

      await createPipelineCommand(tempDir);

      expect(PipelineValidator.validateAndReport).toHaveBeenCalledWith(
        expect.objectContaining({
          agents: [
            expect.not.objectContaining({ timeout: expect.any(Number) }),
          ],
        }),
        tempDir
      );
    });
  });

  describe('One-at-a-time Agent Selection', () => {
    it('should select first agent without dependency prompt', async () => {
      setupSuccessMocks(['agent1.md', 'agent2.md']);
      setupSingleAgentMocks('test-pipeline');
      vi.mocked(InteractivePrompts.selectSingle).mockReset();
      vi.mocked(InteractivePrompts.selectSingle).mockResolvedValueOnce('agent1.md');

      await createPipelineCommand(tempDir);

      expect(InteractivePrompts.selectSingle).toHaveBeenCalledWith(
        'Select first agent:',
        expect.arrayContaining([
          { name: 'agent1', value: 'agent1.md' },
          { name: 'agent2', value: 'agent2.md' },
        ])
      );
    });

    it('should prompt to add another agent after first selection', async () => {
      setupSuccessMocks(['agent1.md', 'agent2.md']);
      setupSingleAgentMocks('test-pipeline');

      await createPipelineCommand(tempDir);

      // Second confirm call should be "Add another agent?"
      expect(InteractivePrompts.confirm).toHaveBeenCalledWith(
        expect.stringContaining('Add another agent'),
        true
      );
    });

    it('should prompt for dependencies when adding second agent', async () => {
      setupSuccessMocks(['agent1.md', 'agent2.md']);
      setupTwoAgentMocks('test-pipeline', 'manual', true, []);

      await createPipelineCommand(tempDir);

      // Should ask for dependencies for second agent
      expect(InteractivePrompts.multiSelect).toHaveBeenCalledWith(
        expect.stringContaining('wait for'),
        expect.arrayContaining([{ name: 'agent1', value: 'agent1' }])
      );
    });

    it('should include dependsOn when dependencies are selected', async () => {
      setupSuccessMocks(['agent1.md', 'agent2.md']);
      setupTwoAgentMocks('test-pipeline', 'manual', true, ['agent1']);

      await createPipelineCommand(tempDir);

      expect(PipelineValidator.validateAndReport).toHaveBeenCalledWith(
        expect.objectContaining({
          agents: expect.arrayContaining([
            expect.objectContaining({ name: 'agent1' }),
            expect.objectContaining({ name: 'agent2', dependsOn: ['agent1'] }),
          ]),
        }),
        tempDir
      );
    });

    it('should not include dependsOn when no dependencies selected', async () => {
      setupSuccessMocks(['agent1.md', 'agent2.md']);
      setupTwoAgentMocks('test-pipeline', 'manual', true, []);

      await createPipelineCommand(tempDir);

      expect(PipelineValidator.validateAndReport).toHaveBeenCalledWith(
        expect.objectContaining({
          agents: [
            expect.not.objectContaining({ dependsOn: expect.anything() }),
            expect.not.objectContaining({ dependsOn: expect.anything() }),
          ],
        }),
        tempDir
      );
    });
  });

  describe('Dependency Patterns', () => {
    it('should offer pattern shortcuts with 3+ agents and no manual deps', async () => {
      setupSuccessMocks(['agent1.md', 'agent2.md', 'agent3.md']);
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('test-pipeline');
      vi.mocked(InteractivePrompts.choose)
        .mockResolvedValueOnce('manual')  // trigger
        .mockResolvedValueOnce('all-parallel');  // pattern
      vi.mocked(InteractivePrompts.selectSingle)
        .mockResolvedValueOnce('agent1.md')
        .mockResolvedValueOnce('agent2.md')
        .mockResolvedValueOnce('agent3.md');
      vi.mocked(InteractivePrompts.confirm)
        .mockResolvedValueOnce(true)   // autoCommit
        .mockResolvedValueOnce(true)   // add agent2?
        .mockResolvedValueOnce(true)   // add agent3?
        .mockResolvedValueOnce(false); // add more?
      vi.mocked(InteractivePrompts.multiSelect)
        .mockResolvedValueOnce([])  // deps for agent2
        .mockResolvedValueOnce([]); // deps for agent3

      await createPipelineCommand(tempDir);

      // Should offer pattern choice
      expect(InteractivePrompts.choose).toHaveBeenCalledWith(
        '',
        ['all-parallel', 'sequential-chain', 'fan-out'],
        'all-parallel'
      );
    });

    it('should apply sequential-chain pattern correctly', async () => {
      setupSuccessMocks(['agent1.md', 'agent2.md', 'agent3.md']);
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('test-pipeline');
      vi.mocked(InteractivePrompts.choose)
        .mockResolvedValueOnce('manual')
        .mockResolvedValueOnce('sequential-chain');
      vi.mocked(InteractivePrompts.selectSingle)
        .mockResolvedValueOnce('agent1.md')
        .mockResolvedValueOnce('agent2.md')
        .mockResolvedValueOnce('agent3.md');
      vi.mocked(InteractivePrompts.confirm)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      vi.mocked(InteractivePrompts.multiSelect)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await createPipelineCommand(tempDir);

      expect(PipelineValidator.validateAndReport).toHaveBeenCalledWith(
        expect.objectContaining({
          agents: [
            expect.objectContaining({ name: 'agent1' }),
            expect.objectContaining({ name: 'agent2', dependsOn: ['agent1'] }),
            expect.objectContaining({ name: 'agent3', dependsOn: ['agent2'] }),
          ],
        }),
        tempDir
      );
    });

    it('should apply fan-out pattern correctly', async () => {
      setupSuccessMocks(['agent1.md', 'agent2.md', 'agent3.md']);
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('test-pipeline');
      vi.mocked(InteractivePrompts.choose)
        .mockResolvedValueOnce('manual')
        .mockResolvedValueOnce('fan-out');
      vi.mocked(InteractivePrompts.selectSingle)
        .mockResolvedValueOnce('agent1.md')
        .mockResolvedValueOnce('agent2.md')
        .mockResolvedValueOnce('agent3.md');
      vi.mocked(InteractivePrompts.confirm)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      vi.mocked(InteractivePrompts.multiSelect)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await createPipelineCommand(tempDir);

      expect(PipelineValidator.validateAndReport).toHaveBeenCalledWith(
        expect.objectContaining({
          agents: [
            expect.objectContaining({ name: 'agent1' }),
            expect.objectContaining({ name: 'agent2', dependsOn: ['agent1'] }),
            expect.objectContaining({ name: 'agent3', dependsOn: ['agent1'] }),
          ],
        }),
        tempDir
      );
    });

    it('should skip pattern shortcuts when manual dependencies configured', async () => {
      setupSuccessMocks(['agent1.md', 'agent2.md', 'agent3.md']);
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('test-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('manual');
      vi.mocked(InteractivePrompts.selectSingle)
        .mockResolvedValueOnce('agent1.md')
        .mockResolvedValueOnce('agent2.md')
        .mockResolvedValueOnce('agent3.md');
      vi.mocked(InteractivePrompts.confirm)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      // Manual dependency on agent2
      vi.mocked(InteractivePrompts.multiSelect)
        .mockResolvedValueOnce(['agent1'])  // agent2 depends on agent1
        .mockResolvedValueOnce([]);

      await createPipelineCommand(tempDir);

      // Should NOT offer pattern choice since manual deps were configured
      expect(InteractivePrompts.choose).toHaveBeenCalledTimes(1); // Only trigger type
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
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('manual');
      vi.mocked(InteractivePrompts.selectSingle).mockResolvedValueOnce('agent.md');
      // With only 1 agent, no "Add another agent?" prompt
      vi.mocked(InteractivePrompts.confirm)
        .mockResolvedValueOnce(true)   // autoCommit
        .mockResolvedValueOnce(true);  // overwrite

      await createPipelineCommand(tempDir);

      // Second fs.access call should be for the pipeline file
      expect(fs.access).toHaveBeenCalledWith(
        path.join(tempDir, '.agent-pipeline', 'pipelines', 'existing-pipeline.yml')
      );
    });

    it('should prompt for overwrite when pipeline exists', async () => {
      vi.mocked(fs.access)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);
      vi.mocked(fs.readdir).mockResolvedValue(['agent.md'] as any);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('existing-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('manual');
      vi.mocked(InteractivePrompts.selectSingle).mockResolvedValueOnce('agent.md');
      // With only 1 agent, no "Add another agent?" prompt
      vi.mocked(InteractivePrompts.confirm)
        .mockResolvedValueOnce(true)   // autoCommit
        .mockResolvedValueOnce(true);  // overwrite

      await createPipelineCommand(tempDir);

      expect(InteractivePrompts.confirm).toHaveBeenCalledWith(
        expect.stringContaining('already exists. Overwrite?'),
        false
      );
    });

    it('should overwrite when user confirms', async () => {
      vi.mocked(fs.access)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);
      vi.mocked(fs.readdir).mockResolvedValue(['agent.md'] as any);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('existing-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('manual');
      vi.mocked(InteractivePrompts.selectSingle).mockResolvedValueOnce('agent.md');
      // With only 1 agent, there's no "Add another agent?" prompt (remaining is empty)
      // So confirm calls are: autoCommit, overwrite
      vi.mocked(InteractivePrompts.confirm)
        .mockResolvedValueOnce(true)   // autoCommit
        .mockResolvedValueOnce(true);  // overwrite

      await createPipelineCommand(tempDir);

      expect(fs.writeFile).toHaveBeenCalled();
    });

    it('should cancel when user declines overwrite', async () => {
      vi.mocked(fs.access)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);
      vi.mocked(fs.readdir).mockResolvedValue(['agent.md'] as any);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('existing-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('manual');
      vi.mocked(InteractivePrompts.selectSingle).mockResolvedValueOnce('agent.md');
      // With only 1 agent, no "Add another agent?" prompt
      vi.mocked(InteractivePrompts.confirm)
        .mockResolvedValueOnce(true)    // autoCommit
        .mockResolvedValueOnce(false);  // decline overwrite

      await createPipelineCommand(tempDir);

      expect(fs.writeFile).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith('Cancelled.');
    });
  });

  describe('Error Handling', () => {
    it('should exit when no agents selected (user declines to add any)', async () => {
      setupSuccessMocks();
      vi.mocked(InteractivePrompts.ask).mockResolvedValue('test-pipeline');
      vi.mocked(InteractivePrompts.choose).mockResolvedValueOnce('manual');
      vi.mocked(InteractivePrompts.selectSingle).mockResolvedValueOnce('agent.md');
      vi.mocked(InteractivePrompts.confirm)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      // This should succeed since we select one agent
      await createPipelineCommand(tempDir);
      expect(fs.writeFile).toHaveBeenCalled();
    });

    it('should exit when validation fails', async () => {
      vi.mocked(fs.access).mockResolvedValueOnce(undefined);
      vi.mocked(fs.readdir).mockResolvedValue(['agent.md'] as any);
      setupSingleAgentMocks('invalid-pipeline');
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(false);

      await expect(createPipelineCommand(tempDir)).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Pipeline configuration is invalid'));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle file write errors', async () => {
      setupSuccessMocks();
      setupSingleAgentMocks('test-pipeline');
      vi.mocked(fs.writeFile).mockRejectedValue(new Error('Permission denied'));

      await expect(createPipelineCommand(tempDir)).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to write pipeline file'));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle pipelines directory creation errors', async () => {
      vi.mocked(fs.access).mockResolvedValueOnce(undefined);
      vi.mocked(fs.readdir).mockResolvedValue(['agent.md'] as any);
      setupSingleAgentMocks('test-pipeline');
      vi.mocked(PipelineValidator.validateAndReport).mockResolvedValue(true);
      vi.mocked(fs.mkdir).mockRejectedValue(new Error('Permission denied'));

      await expect(createPipelineCommand(tempDir)).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to create pipelines directory'));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('Different Trigger Types', () => {
    it('should create config with pre-commit trigger without git section', async () => {
      setupSuccessMocks();
      setupSingleAgentMocks('test-pipeline', 'pre-commit', false);

      await createPipelineCommand(tempDir);

      expect(PipelineValidator.validateAndReport).toHaveBeenCalledWith(
        expect.objectContaining({
          trigger: 'pre-commit',
        }),
        tempDir
      );
      // No git section when autoCommit is false
      expect(PipelineValidator.validateAndReport).not.toHaveBeenCalledWith(
        expect.objectContaining({
          git: expect.anything(),
        }),
        tempDir
      );
    });

    it('should create config with pre-push trigger without git section', async () => {
      setupSuccessMocks();
      setupSingleAgentMocks('test-pipeline', 'pre-push', false);

      await createPipelineCommand(tempDir);

      expect(PipelineValidator.validateAndReport).toHaveBeenCalledWith(
        expect.objectContaining({
          trigger: 'pre-push',
        }),
        tempDir
      );
      // No git section when autoCommit is false
      expect(PipelineValidator.validateAndReport).not.toHaveBeenCalledWith(
        expect.objectContaining({
          git: expect.anything(),
        }),
        tempDir
      );
    });

    it('should create config with post-merge trigger and git section', async () => {
      setupSuccessMocks();
      setupSingleAgentMocks('test-pipeline', 'post-merge', true);

      await createPipelineCommand(tempDir);

      expect(PipelineValidator.validateAndReport).toHaveBeenCalledWith(
        expect.objectContaining({
          trigger: 'post-merge',
          git: expect.objectContaining({
            autoCommit: true,
            commitPrefix: '[pipeline:{{stage}}]',
          }),
        }),
        tempDir
      );
    });
  });

  describe('Success Output', () => {
    it('should show success message after creating pipeline', async () => {
      setupSuccessMocks();
      setupSingleAgentMocks('success-pipeline');

      await createPipelineCommand(tempDir);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Pipeline created successfully'));
    });

    it('should show default timeout message', async () => {
      setupSuccessMocks();
      setupSingleAgentMocks('test-pipeline');

      await createPipelineCommand(tempDir);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('default timeout'));
    });

    it('should show next steps for manual trigger', async () => {
      setupSuccessMocks();
      setupSingleAgentMocks('manual-pipeline');

      await createPipelineCommand(tempDir);

      // Should not show install hook message for manual trigger
      const allCalls = consoleLogSpy.mock.calls.map(call => call[0]);
      const hasInstallMessage = allCalls.some((msg: any) => msg?.includes && msg.includes('Install git hook'));
      expect(hasInstallMessage).toBe(false);
    });

    it('should show install hook suggestion for non-manual triggers', async () => {
      setupSuccessMocks();
      setupSingleAgentMocks('post-commit-pipeline', 'post-commit');

      await createPipelineCommand(tempDir);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Install git hook'));
    });
  });
});
