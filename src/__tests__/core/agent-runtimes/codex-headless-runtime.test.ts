import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { CodexHeadlessRuntime } from '../../../core/agent-runtimes/codex-headless-runtime.js';
import type { AgentExecutionRequest } from '../../../core/types/agent-runtime.js';
import { PipelineAbortController, PipelineAbortError } from '../../../core/abort-controller.js';

const mockSpawn = vi.fn();
vi.mock('child_process', () => ({
  spawn: (...args: any[]) => mockSpawn(...args)
}));

const mockMkdtemp = vi.fn();
const mockReadFile = vi.fn();
vi.mock('fs/promises', () => ({
  mkdtemp: (...args: any[]) => mockMkdtemp(...args),
  readFile: (...args: any[]) => mockReadFile(...args)
}));

function createMockProcess() {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  proc.killed = false;
  return proc;
}

describe('CodexHeadlessRuntime', () => {
  let runtime: CodexHeadlessRuntime;

  beforeEach(() => {
    runtime = new CodexHeadlessRuntime();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it('should expose type and name', () => {
    expect(runtime.type).toBe('codex-headless');
    expect(runtime.name).toBe('Codex Headless Mode');
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
      mockProcess.stdout.emit('data', Buffer.from('codex 0.0.1'));
      mockProcess.emit('exit', 0);
    }, 10);

    const result = await runtime.validate();

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(mockSpawn).toHaveBeenCalledWith('codex', ['--version'], expect.any(Object));
  });

  it('validate should return invalid when CLI is not found', async () => {
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    setTimeout(() => {
      mockProcess.emit('error', new Error('spawn codex ENOENT'));
    }, 10);

    const result = await runtime.validate();

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('execute should build args and return text output from file', async () => {
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);
    mockMkdtemp.mockResolvedValue('/tmp/codex-test');
    mockReadFile.mockResolvedValue('Final output');

    const request: AgentExecutionRequest = {
      systemPrompt: 'You are a test agent',
      userPrompt: 'Do the thing',
      options: {
        permissionMode: 'acceptEdits'
      }
    };

    setTimeout(() => {
      mockProcess.stdout.emit('data', Buffer.from('stream chunk'));
      mockProcess.emit('exit', 0);
    }, 10);

    const result = await runtime.execute(request);

    expect(result.textOutput).toBe('Final output');

    const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
    expect(spawnArgs).toContain('exec');
    expect(spawnArgs).toContain('--output-last-message');
    expect(spawnArgs).toContain('/tmp/codex-test/output.txt');
    expect(spawnArgs).toContain('--full-auto');
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
});
