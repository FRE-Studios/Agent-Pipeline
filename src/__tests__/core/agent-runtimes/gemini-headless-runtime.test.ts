import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { GeminiHeadlessRuntime } from '../../../core/agent-runtimes/gemini-headless-runtime.js';
import type { AgentExecutionRequest } from '../../../core/types/agent-runtime.js';
import { PipelineAbortController, PipelineAbortError } from '../../../core/abort-controller.js';

const mockSpawn = vi.fn();
vi.mock('child_process', () => ({
  spawn: (...args: any[]) => mockSpawn(...args)
}));

function createMockProcess() {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { write: vi.fn(), end: vi.fn() };
  proc.kill = vi.fn();
  proc.killed = false;
  return proc;
}

describe('GeminiHeadlessRuntime', () => {
  let runtime: GeminiHeadlessRuntime;

  beforeEach(() => {
    runtime = new GeminiHeadlessRuntime();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it('should expose type and name', () => {
    expect(runtime.type).toBe('gemini-headless');
    expect(runtime.name).toBe('Gemini Headless Mode');
  });

  it('should return capabilities with empty model list', () => {
    expect(runtime.getCapabilities()).toEqual({
      supportsStreaming: true,
      supportsTokenTracking: false,
      supportsMCP: false,
      supportsContextReduction: false,
      availableModels: [],
      permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan']
    });
  });

  it('validate should return valid when CLI is available', async () => {
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    setTimeout(() => {
      mockProcess.stdout.emit('data', Buffer.from('gemini 1.0.0'));
      mockProcess.emit('exit', 0);
    }, 10);

    const result = await runtime.validate();

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(mockSpawn).toHaveBeenCalledWith('gemini', ['--version'], expect.any(Object));
  });

  it('validate should return invalid when CLI is not found', async () => {
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    setTimeout(() => {
      mockProcess.emit('error', new Error('spawn gemini ENOENT'));
    }, 10);

    const result = await runtime.validate();

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('Gemini CLI not found');
  });

  it('execute should build args and return text from stream events', async () => {
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    const request: AgentExecutionRequest = {
      systemPrompt: 'You are a test agent',
      userPrompt: 'Do the thing',
      options: {
        permissionMode: 'acceptEdits'
      }
    };

    setTimeout(() => {
      const event = { result: 'Final output from Gemini' };
      mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(event) + '\n'));
      mockProcess.emit('exit', 0);
    }, 10);

    const result = await runtime.execute(request);

    expect(result.textOutput).toBe('Final output from Gemini');

    const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
    expect(spawnArgs).toContain('--output-format');
    expect(spawnArgs).toContain('stream-json');
    expect(spawnArgs).toContain('--approval-mode');
    expect(spawnArgs).toContain('auto_edit');
    expect(spawnArgs).toContain('-');

    // Prompt is piped via stdin
    expect(mockProcess.stdin.write).toHaveBeenCalledWith('You are a test agent\n\nDo the thing');
    expect(mockProcess.stdin.end).toHaveBeenCalled();
  });

  it('execute should throw PipelineAbortError when aborted before start', async () => {
    const abortController = new PipelineAbortController();
    abortController.abort();

    const request: AgentExecutionRequest = {
      systemPrompt: 'Test',
      userPrompt: 'Test',
      options: {}
    };

    await expect(runtime.execute(request, abortController)).rejects.toThrow(PipelineAbortError);
  });

  it('streams tool activity from JSON output', async () => {
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    const onOutputUpdate = vi.fn();

    const request: AgentExecutionRequest = {
      systemPrompt: 'You are a test agent',
      userPrompt: 'Do the thing',
      options: {
        onOutputUpdate
      }
    };

    setTimeout(() => {
      const event = {
        type: 'item.started',
        item: {
          id: 'item_1',
          type: 'command_execution',
          command: "/bin/zsh -lc 'cat package.json'"
        }
      };
      mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(event) + '\n'));

      const resultEvent = { result: 'Done' };
      mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(resultEvent) + '\n'));
      mockProcess.emit('exit', 0);
    }, 10);

    await runtime.execute(request);

    expect(onOutputUpdate).toHaveBeenCalledWith(expect.stringContaining('Running'));
  });

  it('maps permission modes to correct CLI flags', async () => {
    const testCases: { mode: string; expectedArgs: string[] }[] = [
      { mode: 'acceptEdits', expectedArgs: ['--approval-mode', 'auto_edit'] },
      { mode: 'bypassPermissions', expectedArgs: ['--yolo'] },
      { mode: 'plan', expectedArgs: ['--sandbox', 'true'] }
    ];

    for (const testCase of testCases) {
      vi.clearAllMocks();
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const request: AgentExecutionRequest = {
        systemPrompt: '',
        userPrompt: 'test',
        options: {
          permissionMode: testCase.mode as any
        }
      };

      setTimeout(() => {
        const event = { result: 'ok' };
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(event) + '\n'));
        mockProcess.emit('exit', 0);
      }, 10);

      await runtime.execute(request);

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      for (const expectedArg of testCase.expectedArgs) {
        expect(spawnArgs).toContain(expectedArg);
      }
    }
  });

  it('passes model via -m flag', async () => {
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    const request: AgentExecutionRequest = {
      systemPrompt: '',
      userPrompt: 'test',
      options: {
        model: 'gemini-2.5-flash'
      }
    };

    setTimeout(() => {
      const event = { result: 'ok' };
      mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(event) + '\n'));
      mockProcess.emit('exit', 0);
    }, 10);

    await runtime.execute(request);

    const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
    expect(spawnArgs).toContain('-m');
    expect(spawnArgs).toContain('gemini-2.5-flash');
  });

  it('default permission mode adds no extra flags', async () => {
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    const request: AgentExecutionRequest = {
      systemPrompt: '',
      userPrompt: 'test',
      options: {
        permissionMode: 'default'
      }
    };

    setTimeout(() => {
      const event = { result: 'ok' };
      mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(event) + '\n'));
      mockProcess.emit('exit', 0);
    }, 10);

    await runtime.execute(request);

    const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
    expect(spawnArgs).not.toContain('--approval-mode');
    expect(spawnArgs).not.toContain('--yolo');
    expect(spawnArgs).not.toContain('--sandbox');
  });

  it('spawns gemini with pipe for stdin to pass prompt', async () => {
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    const request: AgentExecutionRequest = {
      systemPrompt: '',
      userPrompt: 'test',
      options: {}
    };

    setTimeout(() => {
      const event = { result: 'ok' };
      mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(event) + '\n'));
      mockProcess.emit('exit', 0);
    }, 10);

    await runtime.execute(request);

    expect(mockSpawn).toHaveBeenCalledWith(
      'gemini',
      expect.any(Array),
      expect.objectContaining({
        stdio: ['pipe', 'pipe', 'pipe']
      })
    );
  });
});
