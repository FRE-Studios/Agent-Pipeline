import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { AntigravityHeadlessRuntime } from '../../../core/agent-runtimes/antigravity-headless-runtime.js';
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
  // stdio[0] is 'ignore' for `agy`, so a real process has no stdin pipe.
  // Kept as a spy to prove the runtime never writes to it.
  proc.stdin = { write: vi.fn(), end: vi.fn() };
  proc.killed = false;
  proc.kill = vi.fn(() => {
    if (proc.killed) return true;
    proc.killed = true;
    // A signalled process exits; without this the runtime promise never settles.
    setImmediate(() => proc.emit('exit', null));
    return true;
  });
  return proc;
}

/** NDJSON line for a terminal `result` event. */
function resultLine(result: Record<string, unknown>): string {
  return JSON.stringify({ event: 'result', result }) + '\n';
}

/** NDJSON line for a `step_update` event. */
function stepLine(step: Record<string, unknown>): string {
  return JSON.stringify({ event: 'step_update', step_update: step }) + '\n';
}

const SUCCESS = { status: 'SUCCESS', response: 'ok' };

/** Drive a mock process to a successful completion on the next tick. */
function complete(
  proc: any,
  result: Record<string, unknown> = SUCCESS,
  opts: { stdoutLines?: string[]; stderr?: string; exitCode?: number } = {}
) {
  setTimeout(() => {
    for (const line of opts.stdoutLines ?? []) {
      proc.stdout.emit('data', Buffer.from(line));
    }
    if (result) proc.stdout.emit('data', Buffer.from(resultLine(result)));
    if (opts.stderr) proc.stderr.emit('data', Buffer.from(opts.stderr));
    proc.emit('exit', opts.exitCode ?? 0);
  }, 10);
}

/** Value following a flag, so `--mode accept-edits` is asserted as a pair. */
function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function request(overrides: Partial<AgentExecutionRequest> = {}): AgentExecutionRequest {
  return {
    systemPrompt: '',
    userPrompt: 'test',
    options: {},
    ...overrides
  };
}

describe('AntigravityHeadlessRuntime', () => {
  let runtime: AntigravityHeadlessRuntime;

  beforeEach(() => {
    runtime = new AntigravityHeadlessRuntime();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('identity and capabilities', () => {
    it('exposes type and name', () => {
      expect(runtime.type).toBe('antigravity-headless');
      expect(runtime.name).toBe('Antigravity Headless Mode');
    });

    it('reports token tracking support', () => {
      expect(runtime.getCapabilities()).toEqual({
        supportsStreaming: true,
        supportsTokenTracking: true,
        supportsMCP: false,
        supportsContextReduction: false,
        availableModels: [],
        permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan']
      });
    });
  });

  describe('validate', () => {
    it('returns valid when the CLI responds', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      setTimeout(() => {
        proc.stdout.emit('data', Buffer.from('1.1.10'));
        proc.emit('exit', 0);
      }, 10);

      const result = await runtime.validate();

      expect(result).toEqual({ valid: true, errors: [], warnings: [] });
      expect(mockSpawn).toHaveBeenCalledWith('agy', ['--version'], expect.any(Object));
    });

    it('returns invalid with install guidance when the CLI is missing', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      setTimeout(() => proc.emit('error', new Error('spawn agy ENOENT')), 10);

      const result = await runtime.validate();

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Antigravity CLI not found');
      expect(result.warnings.join(' ')).toContain('agy --version');
    });
  });

  describe('prompt delivery', () => {
    it('passes the prompt as the -p value and never writes stdin', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      complete(proc);

      await runtime.execute(
        request({ systemPrompt: 'You are a test agent', userPrompt: 'Do the thing' })
      );

      const args = mockSpawn.mock.calls[0][1] as string[];
      // `agy` ignores stdin in print mode — the prompt must be the final argv pair
      expect(args[args.length - 2]).toBe('-p');
      expect(args[args.length - 1]).toContain('You are a test agent\n\nDo the thing');

      expect(proc.stdin.write).not.toHaveBeenCalled();
      expect(proc.stdin.end).not.toHaveBeenCalled();
      expect(mockSpawn).toHaveBeenCalledWith(
        'agy',
        expect.any(Array),
        expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'], shell: false })
      );
    });

    it('prepends a workspace preamble naming runtimeOptions.cwd', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      complete(proc);

      await runtime.execute(
        request({
          userPrompt: 'Do the thing',
          options: { runtimeOptions: { cwd: '/tmp/workspace' } }
        })
      );

      const args = mockSpawn.mock.calls[0][1] as string[];
      const prompt = args[args.length - 1];

      expect(prompt).toContain('Your working directory is /tmp/workspace.');
      expect(prompt).toContain('use absolute paths under it');
      expect(prompt).toContain('Do not read from or write to any scratch directory outside it');
      // Preamble leads, task follows
      expect(prompt.indexOf('Your working directory')).toBeLessThan(prompt.indexOf('Do the thing'));
    });

    it('falls back to process.cwd() when no cwd is supplied', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      complete(proc);

      await runtime.execute(request());

      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args[args.length - 1]).toContain(`Your working directory is ${process.cwd()}.`);
    });

    it('omits a blank system prompt', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      complete(proc);

      await runtime.execute(request({ systemPrompt: '   ', userPrompt: 'Only this' }));

      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args[args.length - 1]).toMatch(/scratch directory outside it\.\n\nOnly this$/);
    });

    it('spawns in the resolved cwd', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      complete(proc);

      await runtime.execute(request({ options: { runtimeOptions: { cwd: '/tmp/workspace' } } }));

      expect(mockSpawn).toHaveBeenCalledWith(
        'agy',
        expect.any(Array),
        expect.objectContaining({ cwd: '/tmp/workspace' })
      );
    });

    it('warns when the prompt approaches the OS argument limit', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      complete(proc);

      const onOutputUpdate = vi.fn();
      await runtime.execute(
        request({ userPrompt: 'x'.repeat(500_001), options: { onOutputUpdate } })
      );

      expect(onOutputUpdate).toHaveBeenCalledWith(
        expect.stringContaining('close to the OS argument-size limit')
      );
    });

    it('does not warn for ordinary prompts', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      complete(proc);

      const onOutputUpdate = vi.fn();
      await runtime.execute(request({ options: { onOutputUpdate } }));

      expect(onOutputUpdate).not.toHaveBeenCalledWith(
        expect.stringContaining('argument-size limit')
      );
    });
  });

  describe('buildCliArgs', () => {
    it('always requests the stream-json event feed', () => {
      const args = runtime.buildCliArgs(request(), 'PROMPT');
      expect(flagValue(args, '--output-format')).toBe('stream-json');
    });

    it.each([
      ['acceptEdits', '--mode', 'accept-edits'],
      ['plan', '--mode', 'plan']
    ])('maps %s to `%s %s`', (mode, flag, value) => {
      const args = runtime.buildCliArgs(
        request({ options: { permissionMode: mode as any } }),
        'PROMPT'
      );
      expect(flagValue(args, flag)).toBe(value);
    });

    it('maps bypassPermissions to the standalone skip flag', () => {
      const args = runtime.buildCliArgs(
        request({ options: { permissionMode: 'bypassPermissions' } }),
        'PROMPT'
      );
      expect(args).toContain('--dangerously-skip-permissions');
      expect(args).not.toContain('--mode');
    });

    it('adds no permission flags in default mode', () => {
      const args = runtime.buildCliArgs(
        request({ options: { permissionMode: 'default' } }),
        'PROMPT'
      );
      expect(args).not.toContain('--mode');
      expect(args).not.toContain('--dangerously-skip-permissions');
    });

    it('passes the model through --model', () => {
      const args = runtime.buildCliArgs(
        request({ options: { model: 'gemini-3.6-flash-medium' as any } }),
        'PROMPT'
      );
      expect(flagValue(args, '--model')).toBe('gemini-3.6-flash-medium');
    });

    it('derives --print-timeout from the stage timeout', () => {
      const args = runtime.buildCliArgs(request({ options: { timeout: 300 } }), 'PROMPT');
      expect(flagValue(args, '--print-timeout')).toBe('300s');
    });

    it('defaults --print-timeout to the runtime default', () => {
      const args = runtime.buildCliArgs(request(), 'PROMPT');
      expect(flagValue(args, '--print-timeout')).toBe('120s');
    });

    it('forwards effort, agent and json schema options', () => {
      const args = runtime.buildCliArgs(
        request({
          options: {
            runtimeOptions: { effort: 'high', agent: 'reviewer', jsonSchema: '{"type":"object"}' }
          }
        }),
        'PROMPT'
      );

      expect(flagValue(args, '--effort')).toBe('high');
      expect(flagValue(args, '--agent')).toBe('reviewer');
      expect(flagValue(args, '--json-schema')).toBe('{"type":"object"}');
    });

    it('treats sandbox as a boolean flag', () => {
      const enabled = runtime.buildCliArgs(
        request({ options: { runtimeOptions: { sandbox: true } } }),
        'PROMPT'
      );
      expect(enabled).toContain('--sandbox');
      // Must not consume the next arg as a value
      expect(enabled[enabled.indexOf('--sandbox') + 1]).not.toBe('true');

      const disabled = runtime.buildCliArgs(
        request({ options: { runtimeOptions: { sandbox: false } } }),
        'PROMPT'
      );
      expect(disabled).not.toContain('--sandbox');
    });

    it('repeats --add-dir per directory and ignores non-strings', () => {
      const args = runtime.buildCliArgs(
        request({ options: { runtimeOptions: { addDirs: ['/a', '/b', 42] } } }),
        'PROMPT'
      );

      expect(args.filter((a) => a === '--add-dir')).toHaveLength(2);
      expect(args).toContain('/a');
      expect(args).toContain('/b');
      expect(args).not.toContain(42 as any);
    });

    it('passes extra args through ahead of the prompt', () => {
      const args = runtime.buildCliArgs(
        request({ options: { runtimeOptions: { args: ['--project', 'demo'] } } }),
        'PROMPT'
      );

      expect(args).toContain('--project');
      expect(args.indexOf('--project')).toBeLessThan(args.indexOf('-p'));
    });

    it('places the prompt last', () => {
      const args = runtime.buildCliArgs(
        request({ options: { permissionMode: 'bypassPermissions', timeout: 60 } }),
        'PROMPT'
      );
      expect(args.slice(-2)).toEqual(['-p', 'PROMPT']);
    });
  });

  describe('result parsing', () => {
    it('returns text, usage, turns and metadata from the result event', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      complete(proc, {
        status: 'SUCCESS',
        response: '  verdict: PASS\n',
        num_turns: 3,
        usage: {
          input_tokens: 8997,
          output_tokens: 65,
          thinking_tokens: 57,
          cache_read_tokens: 8141,
          total_tokens: 9062
        }
      });

      const result = await runtime.execute(request());

      expect(result.textOutput).toBe('verdict: PASS');
      expect(result.numTurns).toBe(3);
      expect(result.tokenUsage).toEqual({
        inputTokens: 8997,
        outputTokens: 65,
        thinkingTokens: 57,
        cacheReadTokens: 8141,
        totalTokens: 9062
      });
      expect(result.metadata?.runtime).toBe('antigravity-headless');
      expect(result.metadata?.durationMs).toEqual(expect.any(Number));
    });

    it('derives totalTokens when the CLI omits it', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      complete(proc, {
        status: 'SUCCESS',
        response: 'ok',
        usage: { input_tokens: 10, output_tokens: 5 }
      });

      const result = await runtime.execute(request());

      expect(result.tokenUsage?.totalTokens).toBe(15);
    });

    it('omits token usage when the CLI reports none', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      complete(proc, { status: 'SUCCESS', response: 'ok' });

      const result = await runtime.execute(request());

      expect(result.tokenUsage).toBeUndefined();
      expect(result.numTurns).toBeUndefined();
    });

    it('finds the result event among noise and non-JSON lines', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      complete(proc, { status: 'SUCCESS', response: 'found me' }, {
        stdoutLines: [
          'not json at all\n',
          JSON.stringify({ event: 'init', permission_mode: 'request-review' }) + '\n',
          stepLine({ step_index: 1, step_type: 'agent_response', state: 'DONE' })
        ]
      });

      const result = await runtime.execute(request());

      expect(result.textOutput).toBe('found me');
    });

    it('throws when no result event is emitted', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      setTimeout(() => {
        proc.stdout.emit('data', Buffer.from(JSON.stringify({ event: 'init' }) + '\n'));
        proc.emit('exit', 0);
      }, 10);

      await expect(runtime.execute(request())).rejects.toThrow('did not emit a result event');
    });

    it('surfaces result.error on a non-SUCCESS status', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      complete(proc, { status: 'ERROR', error: 'timeout waiting for response' });

      await expect(runtime.execute(request())).rejects.toThrow(
        /status "ERROR": timeout waiting for response/
      );
    });

    it('throws with the permission hint and stderr when the response is empty', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const denial = 'jetski: no output produced — a tool required the "run_command" permission';
      complete(proc, { status: 'SUCCESS', response: '   ' }, { stderr: denial });

      // `agy` exits 0 on an auto-denied tool; silence here would commit nothing
      const error = await runtime.execute(request()).catch((err: Error) => err);

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('produced no response text');
      expect((error as Error).message).toContain('permissionMode: bypassPermissions');
      expect((error as Error).message).toContain('permissions.allow');
    });

    it('quotes stderr in the empty-response error', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const denial = 'jetski: no output produced — a tool required the "run_command" permission';
      complete(proc, { status: 'SUCCESS', response: '' }, { stderr: denial });

      await expect(runtime.execute(request())).rejects.toThrow(
        expect.objectContaining({ message: expect.stringContaining(denial) }) as any
      );
    });

    it('surfaces result.error on a non-zero exit', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      complete(proc, { status: 'ERROR', error: 'timeout waiting for response' }, { exitCode: 1 });

      await expect(runtime.execute(request())).rejects.toThrow(
        /exited with code 1: timeout waiting for response/
      );
    });

    it('reports a bare exit code when no result event explains it', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      setTimeout(() => {
        proc.stderr.emit('data', Buffer.from('fatal: boom'));
        proc.emit('exit', 2);
      }, 10);

      await expect(runtime.execute(request())).rejects.toThrow(/exited with code 2\. stderr: fatal: boom/);
    });

    it('notes an empty stderr rather than leaving it blank', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      setTimeout(() => proc.emit('exit', 3), 10);

      await expect(runtime.execute(request())).rejects.toThrow('stderr: (empty)');
    });
  });

  describe('output extraction', () => {
    it('extracts declared keys from a fenced JSON block', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      complete(proc, {
        status: 'SUCCESS',
        response: 'Here:\n```json\n{"verdict":"PASS","score":9,"extra":"ignored"}\n```'
      });

      const result = await runtime.execute(
        request({ options: { outputKeys: ['verdict', 'score'] } })
      );

      // Typed values survive the JSON path
      expect(result.extractedData).toEqual({ verdict: 'PASS', score: 9 });
    });

    it('falls back to key: value parsing', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      complete(proc, { status: 'SUCCESS', response: 'verdict: PASS\nnotes: all good' });

      const result = await runtime.execute(
        request({ options: { outputKeys: ['verdict', 'notes'] } })
      );

      expect(result.extractedData).toEqual({ verdict: 'PASS', notes: 'all good' });
    });

    it('returns undefined when no keys are requested', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      complete(proc, { status: 'SUCCESS', response: 'verdict: PASS' });

      const result = await runtime.execute(request());

      expect(result.extractedData).toBeUndefined();
    });

    it('returns undefined when requested keys are absent', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      complete(proc, { status: 'SUCCESS', response: 'nothing structured here' });

      const result = await runtime.execute(request({ options: { outputKeys: ['verdict'] } }));

      expect(result.extractedData).toBeUndefined();
    });
  });

  describe('tool activity streaming', () => {
    async function activitiesFor(steps: Record<string, unknown>[]): Promise<string[]> {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      const onOutputUpdate = vi.fn();

      complete(proc, SUCCESS, { stdoutLines: steps.map(stepLine) });
      await runtime.execute(request({ options: { onOutputUpdate } }));

      return onOutputUpdate.mock.calls.map((call) => call[0] as string);
    }

    it('announces tools using PascalCase parameter names', async () => {
      const activities = await activitiesFor([
        {
          step_index: 1,
          state: 'ACTIVE',
          step_type: 'tool',
          tool_name: 'run_command',
          tool_info: { name: 'run_command', parameters: { CommandLine: 'ls -1' } }
        },
        {
          step_index: 2,
          state: 'ACTIVE',
          step_type: 'tool',
          tool_name: 'view_file',
          tool_info: { name: 'view_file', parameters: { AbsolutePath: '/repo/src/index.ts' } }
        },
        {
          step_index: 3,
          state: 'ACTIVE',
          step_type: 'tool',
          tool_name: 'write_to_file',
          tool_info: { name: 'write_to_file', parameters: { TargetFile: '/repo/docs/out.md' } }
        },
        {
          step_index: 4,
          state: 'ACTIVE',
          step_type: 'tool',
          tool_name: 'list_dir',
          tool_info: { name: 'list_dir', parameters: { DirectoryPath: '/repo/src' } }
        },
        {
          step_index: 5,
          state: 'ACTIVE',
          step_type: 'tool',
          tool_name: 'grep_search',
          tool_info: { name: 'grep_search', parameters: { Query: 'TODO', SearchPath: '/repo' } }
        }
      ]);

      expect(activities).toEqual([
        '🔧 Running: ls -1',
        '📖 Reading .../src/index.ts',
        '📝 Writing .../docs/out.md',
        '📂 Listing .../repo/src',
        '🔎 Searching for "TODO"'
      ]);
    });

    it('emits only the ACTIVE edge of a tool step', async () => {
      const step = {
        step_index: 1,
        step_type: 'tool',
        tool_name: 'run_command',
        tool_info: { name: 'run_command', parameters: { CommandLine: 'pwd' } }
      };

      const activities = await activitiesFor([
        { ...step, state: 'ACTIVE' },
        { ...step, state: 'DONE' },
        { ...step, state: 'ERROR' }
      ]);

      expect(activities).toEqual(['🔧 Running: pwd']);
    });

    it('deduplicates repeated ACTIVE updates for one step', async () => {
      const step = {
        conversation_id: 'c1',
        step_index: 7,
        state: 'ACTIVE',
        step_type: 'tool',
        tool_name: 'run_command',
        tool_info: { name: 'run_command', parameters: { CommandLine: 'pwd' } }
      };

      expect(await activitiesFor([step, step, step])).toEqual(['🔧 Running: pwd']);
    });

    it('separates identical tools across different steps', async () => {
      const base = {
        conversation_id: 'c1',
        state: 'ACTIVE',
        step_type: 'tool',
        tool_name: 'run_command',
        tool_info: { name: 'run_command', parameters: { CommandLine: 'pwd' } }
      };

      const activities = await activitiesFor([
        { ...base, step_index: 1 },
        { ...base, step_index: 2 }
      ]);

      expect(activities).toHaveLength(2);
    });

    it('ignores non-tool steps', async () => {
      const activities = await activitiesFor([
        { step_index: 1, state: 'ACTIVE', step_type: 'agent_response', usage: { input_tokens: 1 } },
        { step_index: 2, state: 'ACTIVE', step_type: 'thinking' }
      ]);

      expect(activities).toEqual([]);
    });

    it('falls back to a generic label for unknown tools', async () => {
      const activities = await activitiesFor([
        {
          step_index: 1,
          state: 'ACTIVE',
          step_type: 'tool',
          tool_name: 'mystery_tool',
          tool_info: { name: 'mystery_tool', parameters: {} }
        }
      ]);

      expect(activities).toEqual(['⚡ mystery_tool']);
    });

    it('truncates long commands', async () => {
      const activities = await activitiesFor([
        {
          step_index: 1,
          state: 'ACTIVE',
          step_type: 'tool',
          tool_name: 'run_command',
          tool_info: { name: 'run_command', parameters: { CommandLine: 'echo ' + 'a'.repeat(80) } }
        }
      ]);

      expect(activities[0]).toHaveLength('🔧 Running: '.length + 50);
      expect(activities[0]).toMatch(/\.\.\.$/);
    });

    it('handles events split across stdout chunks', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      const onOutputUpdate = vi.fn();

      const line = stepLine({
        step_index: 1,
        state: 'ACTIVE',
        step_type: 'tool',
        tool_name: 'run_command',
        tool_info: { name: 'run_command', parameters: { CommandLine: 'pwd' } }
      });
      const split = Math.floor(line.length / 2);

      setTimeout(() => {
        proc.stdout.emit('data', Buffer.from(line.slice(0, split)));
        proc.stdout.emit('data', Buffer.from(line.slice(split)));
        proc.stdout.emit('data', Buffer.from(resultLine(SUCCESS)));
        proc.emit('exit', 0);
      }, 10);

      await runtime.execute(request({ options: { onOutputUpdate } }));

      expect(onOutputUpdate).toHaveBeenCalledWith('🔧 Running: pwd');
    });

    it('does not stream when no callback is supplied', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      complete(proc, SUCCESS, {
        stdoutLines: [
          stepLine({
            step_index: 1,
            state: 'ACTIVE',
            step_type: 'tool',
            tool_name: 'run_command',
            tool_info: { name: 'run_command', parameters: { CommandLine: 'pwd' } }
          })
        ]
      });

      await expect(runtime.execute(request())).resolves.toBeDefined();
    });
  });

  describe('process control', () => {
    it('terminates and reports on timeout', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      // Never completes; the runtime timer must fire.

      await expect(runtime.execute(request({ options: { timeout: 0.05 } }))).rejects.toThrow(
        /timed out after .*ms\. Process was terminated\./
      );
      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('throws PipelineAbortError when aborted before start', async () => {
      const abortController = new PipelineAbortController();
      abortController.abort();

      await expect(runtime.execute(request(), abortController)).rejects.toThrow(PipelineAbortError);
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('throws PipelineAbortError when aborted mid-flight', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const abortController = new PipelineAbortController();
      const pending = runtime.execute(request(), abortController);

      setTimeout(() => abortController.abort(), 10);

      await expect(pending).rejects.toThrow(PipelineAbortError);
      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('registers the child process with the abort controller', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const abortController = new PipelineAbortController();
      const spy = vi.spyOn(abortController, 'registerProcess');
      complete(proc);

      await runtime.execute(request(), abortController);

      expect(spy).toHaveBeenCalledWith(proc);
    });

    it('reports a spawn failure with install guidance', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      setTimeout(() => proc.emit('error', new Error('spawn agy ENOENT')), 10);

      await expect(runtime.execute(request())).rejects.toThrow(
        /Failed to spawn agy CLI: spawn agy ENOENT.*installed and on PATH/s
      );
    });
  });
});
