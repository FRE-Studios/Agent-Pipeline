import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { PiAgentHeadlessRuntime } from '../../../core/agent-runtimes/pi-agent-headless-runtime.js';
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

describe('PiAgentHeadlessRuntime', () => {
  let runtime: PiAgentHeadlessRuntime;

  beforeEach(() => {
    runtime = new PiAgentHeadlessRuntime();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it('should expose type and name', () => {
    expect(runtime.type).toBe('pi-agent');
    expect(runtime.name).toBe('Pi Agent Headless Mode');
  });

  it('should return capabilities', () => {
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
      mockProcess.stdout.emit('data', Buffer.from('pi-coding-agent 1.0.0'));
      mockProcess.emit('exit', 0);
    }, 10);

    const result = await runtime.validate();

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(mockSpawn).toHaveBeenCalledWith('pi', ['--version'], expect.any(Object));
  });

  it('validate should return invalid when CLI is not found', async () => {
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    setTimeout(() => {
      mockProcess.emit('error', new Error('spawn pi ENOENT'));
    }, 10);

    const result = await runtime.validate();

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('Pi Agent CLI not found');
    expect(result.warnings).toContain('Install Pi Agent CLI with: npm install -g @mariozechner/pi-coding-agent');
  });

  it('execute should build args and return text from NDJSON events', async () => {
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    const request: AgentExecutionRequest = {
      systemPrompt: 'You are a test agent',
      userPrompt: 'Do the thing',
      options: {
        runtimeOptions: {
          model: 'claude-sonnet-4-20250514'
        }
      }
    };

    setTimeout(() => {
      const event = {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'Final output from Pi Agent' }
      };
      mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(event) + '\n'));
      const endEvent = { type: 'agent_end' };
      mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(endEvent) + '\n'));
      mockProcess.emit('exit', 0);
    }, 10);

    const result = await runtime.execute(request);

    expect(result.textOutput).toBe('Final output from Pi Agent');

    const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
    expect(spawnArgs).toContain('-p');
    expect(spawnArgs).toContain('--mode');
    expect(spawnArgs).toContain('json');
    expect(spawnArgs).toContain('--no-session');
    expect(spawnArgs).toContain('--model');
    expect(spawnArgs).toContain('claude-sonnet-4-20250514');
    expect(spawnArgs).toContain('-');

    // Prompt is piped via stdin (system + user combined by default)
    expect(mockProcess.stdin.write).toHaveBeenCalledWith('You are a test agent\n\nDo the thing');
    expect(mockProcess.stdin.end).toHaveBeenCalled();
  });

  it('execute should accumulate multiple text deltas', async () => {
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    const request: AgentExecutionRequest = {
      systemPrompt: '',
      userPrompt: 'test',
      options: {
        runtimeOptions: { model: 'gpt-4o' }
      }
    };

    setTimeout(() => {
      const delta1 = {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'Hello ' }
      };
      const delta2 = {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'World!' }
      };
      mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(delta1) + '\n' + JSON.stringify(delta2) + '\n'));
      mockProcess.emit('exit', 0);
    }, 10);

    const result = await runtime.execute(request);
    expect(result.textOutput).toBe('Hello World!');
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

  it('streams tool activity from NDJSON tool_execution_start events', async () => {
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    const onOutputUpdate = vi.fn();

    const request: AgentExecutionRequest = {
      systemPrompt: '',
      userPrompt: 'Do the thing',
      options: {
        onOutputUpdate,
        runtimeOptions: { model: 'test-model' }
      }
    };

    setTimeout(() => {
      const toolEvent = {
        type: 'tool_execution_start',
        toolName: 'bash',
        args: { command: 'ls -la' },
        id: 'tool_1'
      };
      mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(toolEvent) + '\n'));

      const textEvent = {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'Done' }
      };
      mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(textEvent) + '\n'));
      mockProcess.emit('exit', 0);
    }, 10);

    await runtime.execute(request);

    expect(onOutputUpdate).toHaveBeenCalledWith(expect.stringContaining('Running'));
    expect(onOutputUpdate).toHaveBeenCalledWith(expect.stringContaining('ls -la'));
  });

  it('deduplicates tool activities by id', async () => {
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    const onOutputUpdate = vi.fn();

    const request: AgentExecutionRequest = {
      systemPrompt: '',
      userPrompt: 'test',
      options: {
        onOutputUpdate,
        runtimeOptions: { model: 'test-model' }
      }
    };

    setTimeout(() => {
      const toolEvent = {
        type: 'tool_execution_start',
        toolName: 'read',
        args: { path: 'file.txt' },
        id: 'tool_dup'
      };
      // Same event emitted twice
      mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(toolEvent) + '\n'));
      mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(toolEvent) + '\n'));

      const endEvent = { type: 'agent_end' };
      mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(endEvent) + '\n'));
      mockProcess.emit('exit', 0);
    }, 10);

    await runtime.execute(request);

    const readCalls = onOutputUpdate.mock.calls.filter(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('Reading')
    );
    expect(readCalls.length).toBe(1);
  });

  it('extracts outputs from JSON blocks in text', async () => {
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    const request: AgentExecutionRequest = {
      systemPrompt: '',
      userPrompt: 'test',
      options: {
        outputKeys: ['summary', 'score'],
        runtimeOptions: { model: 'test-model' }
      }
    };

    const textWithJson = 'Here are the results:\n```json\n{"summary": "Good code", "score": 95}\n```';
    setTimeout(() => {
      const event = {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: textWithJson }
      };
      mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(event) + '\n'));
      mockProcess.emit('exit', 0);
    }, 10);

    const result = await runtime.execute(request);

    expect(result.extractedData).toEqual({ summary: 'Good code', score: 95 });
  });

  it('extracts outputs from key-value patterns as fallback', async () => {
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    const request: AgentExecutionRequest = {
      systemPrompt: '',
      userPrompt: 'test',
      options: {
        outputKeys: ['status'],
        runtimeOptions: { model: 'test-model' }
      }
    };

    setTimeout(() => {
      const event = {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'Analysis complete.\nstatus: passed' }
      };
      mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(event) + '\n'));
      mockProcess.emit('exit', 0);
    }, 10);

    const result = await runtime.execute(request);

    expect(result.extractedData).toEqual({ status: 'passed' });
  });

  describe('buildCliArgs', () => {
    it('includes required flags: -p, --mode json, --no-session', () => {
      const request: AgentExecutionRequest = {
        systemPrompt: '',
        userPrompt: 'test',
        options: {
          runtimeOptions: { model: 'test-model' }
        }
      };

      const args = runtime.buildCliArgs(request);
      expect(args).toContain('-p');
      expect(args).toContain('--mode');
      expect(args[args.indexOf('--mode') + 1]).toBe('json');
      expect(args).toContain('--no-session');
      expect(args[args.length - 1]).toBe('-');
    });

    it('passes model from runtimeOptions', () => {
      const request: AgentExecutionRequest = {
        systemPrompt: '',
        userPrompt: 'test',
        options: {
          runtimeOptions: { model: 'claude-sonnet-4-20250514' }
        }
      };

      const args = runtime.buildCliArgs(request);
      expect(args).toContain('--model');
      expect(args[args.indexOf('--model') + 1]).toBe('claude-sonnet-4-20250514');
    });

    it('passes model from options.model when runtimeOptions.model is not set', () => {
      const request: AgentExecutionRequest = {
        systemPrompt: '',
        userPrompt: 'test',
        options: {
          model: 'sonnet'
        }
      };

      const args = runtime.buildCliArgs(request);
      expect(args).toContain('--model');
      expect(args[args.indexOf('--model') + 1]).toBe('sonnet');
    });

    it('passes provider when specified', () => {
      const request: AgentExecutionRequest = {
        systemPrompt: '',
        userPrompt: 'test',
        options: {
          runtimeOptions: { model: 'llama-3.3-70b', provider: 'groq' }
        }
      };

      const args = runtime.buildCliArgs(request);
      expect(args).toContain('--provider');
      expect(args[args.indexOf('--provider') + 1]).toBe('groq');
    });

    it('passes apiKey directly when provided', () => {
      const request: AgentExecutionRequest = {
        systemPrompt: '',
        userPrompt: 'test',
        options: {
          runtimeOptions: { model: 'test', apiKey: 'sk-test-key-123' }
        }
      };

      const args = runtime.buildCliArgs(request);
      expect(args).toContain('--api-key');
      expect(args[args.indexOf('--api-key') + 1]).toBe('sk-test-key-123');
    });

    it('resolves apiKey from environment variable', () => {
      process.env.MY_CUSTOM_KEY = 'sk-from-env';
      const request: AgentExecutionRequest = {
        systemPrompt: '',
        userPrompt: 'test',
        options: {
          runtimeOptions: { model: 'test', apiKeyEnv: 'MY_CUSTOM_KEY' }
        }
      };

      const args = runtime.buildCliArgs(request);
      expect(args).toContain('--api-key');
      expect(args[args.indexOf('--api-key') + 1]).toBe('sk-from-env');

      delete process.env.MY_CUSTOM_KEY;
    });

    it('does not pass --api-key when no key is resolved', () => {
      const request: AgentExecutionRequest = {
        systemPrompt: '',
        userPrompt: 'test',
        options: {
          runtimeOptions: { model: 'test' }
        }
      };

      const args = runtime.buildCliArgs(request);
      expect(args).not.toContain('--api-key');
    });

    it('passes thinking level', () => {
      const request: AgentExecutionRequest = {
        systemPrompt: '',
        userPrompt: 'test',
        options: {
          runtimeOptions: { model: 'test', thinking: 'high' }
        }
      };

      const args = runtime.buildCliArgs(request);
      expect(args).toContain('--thinking');
      expect(args[args.indexOf('--thinking') + 1]).toBe('high');
    });

    it('passes maxTurns from options', () => {
      const request: AgentExecutionRequest = {
        systemPrompt: '',
        userPrompt: 'test',
        options: {
          maxTurns: 10,
          runtimeOptions: { model: 'test' }
        }
      };

      const args = runtime.buildCliArgs(request);
      expect(args).toContain('--max-turns');
      expect(args[args.indexOf('--max-turns') + 1]).toBe('10');
    });

    it('passes tools list', () => {
      const request: AgentExecutionRequest = {
        systemPrompt: '',
        userPrompt: 'test',
        options: {
          runtimeOptions: { model: 'test', tools: 'read,bash,edit' }
        }
      };

      const args = runtime.buildCliArgs(request);
      expect(args).toContain('--tools');
      expect(args[args.indexOf('--tools') + 1]).toBe('read,bash,edit');
    });

    it('passes --no-tools flag', () => {
      const request: AgentExecutionRequest = {
        systemPrompt: '',
        userPrompt: 'test',
        options: {
          runtimeOptions: { model: 'test', noTools: true }
        }
      };

      const args = runtime.buildCliArgs(request);
      expect(args).toContain('--no-tools');
      expect(args).not.toContain('--tools');
    });

    it('passes --system-prompt with replace mode', () => {
      const request: AgentExecutionRequest = {
        systemPrompt: 'Be helpful',
        userPrompt: 'test',
        options: {
          runtimeOptions: { model: 'test', systemPromptMode: 'replace' }
        }
      };

      const args = runtime.buildCliArgs(request);
      expect(args).toContain('--system-prompt');
      expect(args[args.indexOf('--system-prompt') + 1]).toBe('Be helpful');
    });

    it('passes --append-system-prompt with append mode', () => {
      const request: AgentExecutionRequest = {
        systemPrompt: 'Additional context',
        userPrompt: 'test',
        options: {
          runtimeOptions: { model: 'test', systemPromptMode: 'append' }
        }
      };

      const args = runtime.buildCliArgs(request);
      expect(args).toContain('--append-system-prompt');
      expect(args[args.indexOf('--append-system-prompt') + 1]).toBe('Additional context');
    });

    it('passes --verbose flag', () => {
      const request: AgentExecutionRequest = {
        systemPrompt: '',
        userPrompt: 'test',
        options: {
          runtimeOptions: { model: 'test', verbose: true }
        }
      };

      const args = runtime.buildCliArgs(request);
      expect(args).toContain('--verbose');
    });

    it('passes extra args', () => {
      const request: AgentExecutionRequest = {
        systemPrompt: '',
        userPrompt: 'test',
        options: {
          runtimeOptions: { model: 'test', args: ['--custom-flag', 'value'] }
        }
      };

      const args = runtime.buildCliArgs(request);
      expect(args).toContain('--custom-flag');
      expect(args).toContain('value');
    });
  });

  it('handles spawn error gracefully', async () => {
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    const request: AgentExecutionRequest = {
      systemPrompt: '',
      userPrompt: 'test',
      options: {
        runtimeOptions: { model: 'test' }
      }
    };

    setTimeout(() => {
      mockProcess.emit('error', new Error('spawn pi ENOENT'));
    }, 10);

    await expect(runtime.execute(request)).rejects.toThrow('Failed to spawn pi CLI');
  });

  it('handles non-zero exit code', async () => {
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    const request: AgentExecutionRequest = {
      systemPrompt: '',
      userPrompt: 'test',
      options: {
        runtimeOptions: { model: 'test' }
      }
    };

    setTimeout(() => {
      mockProcess.stderr.emit('data', Buffer.from('Error: model not found'));
      mockProcess.emit('exit', 1);
    }, 10);

    await expect(runtime.execute(request)).rejects.toThrow('Pi Agent CLI exited with code 1');
  });

  it('falls back to raw stdout when no text deltas found', async () => {
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    const request: AgentExecutionRequest = {
      systemPrompt: '',
      userPrompt: 'test',
      options: {
        runtimeOptions: { model: 'test' }
      }
    };

    setTimeout(() => {
      mockProcess.stdout.emit('data', Buffer.from('raw text output without JSON'));
      mockProcess.emit('exit', 0);
    }, 10);

    const result = await runtime.execute(request);
    expect(result.textOutput).toBe('raw text output without JSON');
  });

  it('spawns pi with pipe for stdin', async () => {
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    const request: AgentExecutionRequest = {
      systemPrompt: '',
      userPrompt: 'test',
      options: {
        runtimeOptions: { model: 'test' }
      }
    };

    setTimeout(() => {
      const event = {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'ok' }
      };
      mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(event) + '\n'));
      mockProcess.emit('exit', 0);
    }, 10);

    await runtime.execute(request);

    expect(mockSpawn).toHaveBeenCalledWith(
      'pi',
      expect.any(Array),
      expect.objectContaining({
        stdio: ['pipe', 'pipe', 'pipe']
      })
    );
  });

  it('returns metadata with runtime type and duration', async () => {
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    const request: AgentExecutionRequest = {
      systemPrompt: '',
      userPrompt: 'test',
      options: {
        runtimeOptions: { model: 'test' }
      }
    };

    setTimeout(() => {
      const event = {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'ok' }
      };
      mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(event) + '\n'));
      mockProcess.emit('exit', 0);
    }, 10);

    const result = await runtime.execute(request);

    expect(result.metadata?.runtime).toBe('pi-agent');
    expect(result.metadata?.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.tokenUsage).toBeUndefined();
  });
});
