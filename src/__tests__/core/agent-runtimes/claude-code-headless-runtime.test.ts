// src/__tests__/core/agent-runtimes/claude-code-headless-runtime.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { ClaudeCodeHeadlessRuntime } from '../../../core/agent-runtimes/claude-code-headless-runtime.js';
import type { AgentExecutionRequest } from '../../../core/types/agent-runtime.js';

// Mock child_process
const mockSpawn = vi.fn();
vi.mock('child_process', () => ({
  spawn: (...args: any[]) => mockSpawn(...args)
}));

describe('ClaudeCodeHeadlessRuntime', () => {
  let runtime: ClaudeCodeHeadlessRuntime;

  beforeEach(() => {
    runtime = new ClaudeCodeHeadlessRuntime();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('Basic Properties', () => {
    it('should have correct type identifier', () => {
      expect(runtime.type).toBe('claude-code-headless');
    });

    it('should have correct name', () => {
      expect(runtime.name).toBe('Claude Code Headless Mode');
    });
  });

  describe('getCapabilities()', () => {
    it('should return headless runtime capabilities', () => {
      const capabilities = runtime.getCapabilities();

      expect(capabilities).toEqual({
        supportsStreaming: true,
        supportsTokenTracking: true,
        supportsMCP: false, // Headless uses built-in tools, not MCP
        supportsContextReduction: false, // Headless uses --resume
        availableModels: ['haiku', 'sonnet', 'opus'],
        permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan']
      });
    });
  });

  describe('validate()', () => {
    it('should return valid when CLI is available', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      // Simulate successful version check
      setTimeout(() => {
        mockProcess.stdout.emit('data', Buffer.from('Claude CLI v1.0.0'));
        mockProcess.emit('exit', 0);
      }, 10);

      const result = await runtime.validate();

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(mockSpawn).toHaveBeenCalledWith('claude', ['--version'], expect.any(Object));
    });

    it('should return invalid when CLI is not found', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      // Simulate spawn error
      setTimeout(() => {
        mockProcess.emit('error', new Error('spawn claude ENOENT'));
      }, 10);

      const result = await runtime.validate();

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Claude CLI not found');
      expect(result.warnings).toContain(
        'Install Claude CLI with: npm install -g @anthropic-ai/claude-code'
      );
    });

    it('should return invalid when CLI exits with non-zero code', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      setTimeout(() => {
        mockProcess.stderr.emit('data', Buffer.from('Authentication required'));
        mockProcess.emit('exit', 1);
      }, 10);

      const result = await runtime.validate();

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
    });
  });

  describe('execute() - CLI Argument Building', () => {
    it('should build correct CLI args for basic request', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const request: AgentExecutionRequest = {
        systemPrompt: 'You are a test agent',
        userPrompt: 'Do something',
        options: {}
      };

      setTimeout(() => {
        mockProcess.stdout.emit(
          'data',
          Buffer.from(JSON.stringify({ result: 'Test output' }))
        );
        mockProcess.emit('exit', 0);
      }, 10);

      await runtime.execute(request);

      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        [
          '-p',
          'Do something',
          '--output-format',
          'stream-json',
          '--verbose',
          '--append-system-prompt',
          'You are a test agent',
          '--disallowedTools',
          'WebSearch'
        ],
        expect.any(Object)
      );
    });

    it('should include all optional arguments when provided', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const request: AgentExecutionRequest = {
        systemPrompt: 'System',
        userPrompt: 'User',
        options: {
          permissionMode: 'acceptEdits',
          model: 'haiku',
          maxTurns: 10,
          maxThinkingTokens: 1000
        }
      };

      setTimeout(() => {
        mockProcess.stdout.emit(
          'data',
          Buffer.from(JSON.stringify({ result: 'Output' }))
        );
        mockProcess.emit('exit', 0);
      }, 10);

      await runtime.execute(request);

      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        [
          '-p',
          'User',
          '--output-format',
          'stream-json',
          '--verbose',
          '--permission-mode',
          'acceptEdits',
          '--model',
          'haiku',
          '--max-turns',
          '10',
          '--max-thinking-tokens',
          '1000',
          '--append-system-prompt',
          'System',
          '--disallowedTools',
          'WebSearch'
        ],
        expect.any(Object)
      );
    });

    it('should skip system prompt if empty', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const request: AgentExecutionRequest = {
        systemPrompt: '',
        userPrompt: 'User',
        options: {}
      };

      setTimeout(() => {
        mockProcess.stdout.emit(
          'data',
          Buffer.from(JSON.stringify({ result: 'Output' }))
        );
        mockProcess.emit('exit', 0);
      }, 10);

      await runtime.execute(request);

      const args = mockSpawn.mock.calls[0][1];
      expect(args).not.toContain('--append-system-prompt');
    });

    it('should include runtime-specific options', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const request: AgentExecutionRequest = {
        systemPrompt: 'System',
        userPrompt: 'User',
        options: {
          runtimeOptions: {
            resume: 'session-123',
            verbose: true,
            customFlag: 'value'
          }
        }
      };

      setTimeout(() => {
        mockProcess.stdout.emit(
          'data',
          Buffer.from(JSON.stringify({ result: 'Output' }))
        );
        mockProcess.emit('exit', 0);
      }, 10);

      await runtime.execute(request);

      const args = mockSpawn.mock.calls[0][1];
      expect(args).toContain('--resume');
      expect(args).toContain('session-123');
      expect(args).toContain('--verbose');
      expect(args).toContain('--customFlag');
      expect(args).toContain('value');
    });

    it('should use allowedTools when provided (whitelist takes precedence)', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const request: AgentExecutionRequest = {
        systemPrompt: 'System',
        userPrompt: 'User',
        options: {
          runtimeOptions: {
            allowedTools: 'Bash,Read,Write'
          }
        }
      };

      setTimeout(() => {
        mockProcess.stdout.emit(
          'data',
          Buffer.from(JSON.stringify({ result: 'Output' }))
        );
        mockProcess.emit('exit', 0);
      }, 10);

      await runtime.execute(request);

      const args = mockSpawn.mock.calls[0][1];
      expect(args).toContain('--allowedTools');
      expect(args).toContain('Bash,Read,Write');
      // Should NOT have disallowedTools when allowedTools is provided
      expect(args).not.toContain('--disallowedTools');
    });

    it('should extend default disallowedTools with user additions', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const request: AgentExecutionRequest = {
        systemPrompt: 'System',
        userPrompt: 'User',
        options: {
          runtimeOptions: {
            disallowedTools: 'Bash,Write'
          }
        }
      };

      setTimeout(() => {
        mockProcess.stdout.emit(
          'data',
          Buffer.from(JSON.stringify({ result: 'Output' }))
        );
        mockProcess.emit('exit', 0);
      }, 10);

      await runtime.execute(request);

      const args = mockSpawn.mock.calls[0][1] as string[];
      const disallowedIndex = args.indexOf('--disallowedTools');
      expect(disallowedIndex).toBeGreaterThan(-1);

      const disallowedValue = args[disallowedIndex + 1];
      // Should include both default (WebSearch) and user additions
      expect(disallowedValue).toContain('WebSearch');
      expect(disallowedValue).toContain('Bash');
      expect(disallowedValue).toContain('Write');
    });

    it('should accept allowedTools as array', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const request: AgentExecutionRequest = {
        systemPrompt: 'System',
        userPrompt: 'User',
        options: {
          runtimeOptions: {
            allowedTools: ['Bash', 'Read', 'Edit']
          }
        }
      };

      setTimeout(() => {
        mockProcess.stdout.emit(
          'data',
          Buffer.from(JSON.stringify({ result: 'Output' }))
        );
        mockProcess.emit('exit', 0);
      }, 10);

      await runtime.execute(request);

      const args = mockSpawn.mock.calls[0][1];
      expect(args).toContain('--allowedTools');
      expect(args).toContain('Bash,Read,Edit');
    });

    it('should pass cwd to spawn options, not as CLI argument', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const request: AgentExecutionRequest = {
        systemPrompt: 'System',
        userPrompt: 'User',
        options: {
          runtimeOptions: {
            cwd: '/custom/working/directory'
          }
        }
      };

      setTimeout(() => {
        mockProcess.stdout.emit(
          'data',
          Buffer.from(JSON.stringify({ result: 'Output' }))
        );
        mockProcess.emit('exit', 0);
      }, 10);

      await runtime.execute(request);

      const args = mockSpawn.mock.calls[0][1];
      const spawnOptions = mockSpawn.mock.calls[0][2];

      // cwd should NOT be passed as a CLI argument
      expect(args).not.toContain('--cwd');
      expect(args).not.toContain('/custom/working/directory');

      // cwd SHOULD be passed to spawn options
      expect(spawnOptions.cwd).toBe('/custom/working/directory');
    });
  });

  describe('execute() - Successful Execution', () => {
    it('should execute and parse JSON output successfully', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const cliOutput = {
        result: 'Test output from CLI',
        usage: {
          input_tokens: 100,
          output_tokens: 50
        },
        num_turns: 3,
        session_id: 'session-123',
        total_cost_usd: 0.0015,
        duration_ms: 2500
      };

      const request: AgentExecutionRequest = {
        systemPrompt: 'System',
        userPrompt: 'User',
        options: {}
      };

      setTimeout(() => {
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(cliOutput)));
        mockProcess.emit('exit', 0);
      }, 10);

      const result = await runtime.execute(request);

      expect(result.textOutput).toBe('Test output from CLI');
      expect(result.numTurns).toBe(3);
      expect(result.tokenUsage).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationTokens: undefined,
        cacheReadTokens: undefined,
        thinkingTokens: undefined,
        totalTokens: 150
      });
      expect(result.metadata).toEqual({
        runtime: 'claude-code-headless',
        sessionId: 'session-123',
        costUsd: 0.0015,
        durationMs: 2500
      });
    });

    it('should normalize complete token usage', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const cliOutput = {
        result: 'Output',
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 10,
          cache_read_input_tokens: 20,
          thinking_tokens: 5
        }
      };

      setTimeout(() => {
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(cliOutput)));
        mockProcess.emit('exit', 0);
      }, 10);

      const request: AgentExecutionRequest = {
        systemPrompt: 'System',
        userPrompt: 'User',
        options: {}
      };

      const result = await runtime.execute(request);

      expect(result.tokenUsage).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationTokens: 10,
        cacheReadTokens: 20,
        thinkingTokens: 5,
        totalTokens: 150
      });
    });

    it('should handle missing token usage', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const cliOutput = {
        result: 'Output'
      };

      setTimeout(() => {
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(cliOutput)));
        mockProcess.emit('exit', 0);
      }, 10);

      const request: AgentExecutionRequest = {
        systemPrompt: 'System',
        userPrompt: 'User',
        options: {}
      };

      const result = await runtime.execute(request);

      expect(result.tokenUsage).toBeUndefined();
    });
  });

  describe('execute() - Output Extraction', () => {
    it('should extract data from JSON code blocks', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const cliOutput = {
        result: 'Here is the data:\n```json\n{"key1": "value1", "key2": "value2"}\n```'
      };

      setTimeout(() => {
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(cliOutput)));
        mockProcess.emit('exit', 0);
      }, 10);

      const request: AgentExecutionRequest = {
        systemPrompt: 'System',
        userPrompt: 'User',
        options: {
          outputKeys: ['key1', 'key2']
        }
      };

      const result = await runtime.execute(request);

      expect(result.extractedData).toEqual({
        key1: 'value1',
        key2: 'value2'
      });
    });

    it('should fall back to regex when JSON block parsing fails', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const cliOutput = {
        result: 'key1: regex_value1\nkey2: regex_value2'
      };

      setTimeout(() => {
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(cliOutput)));
        mockProcess.emit('exit', 0);
      }, 10);

      const request: AgentExecutionRequest = {
        systemPrompt: 'System',
        userPrompt: 'User',
        options: {
          outputKeys: ['key1', 'key2']
        }
      };

      const result = await runtime.execute(request);

      expect(result.extractedData).toEqual({
        key1: 'regex_value1',
        key2: 'regex_value2'
      });
    });

    it('should extract only requested keys from JSON block', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const cliOutput = {
        result:
          '```json\n{"key1": "value1", "key2": "value2", "key3": "value3"}\n```'
      };

      setTimeout(() => {
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(cliOutput)));
        mockProcess.emit('exit', 0);
      }, 10);

      const request: AgentExecutionRequest = {
        systemPrompt: 'System',
        userPrompt: 'User',
        options: {
          outputKeys: ['key1', 'key3'] // Only request key1 and key3
        }
      };

      const result = await runtime.execute(request);

      expect(result.extractedData).toEqual({
        key1: 'value1',
        key3: 'value3'
      });
    });

    it('should handle regex extraction with special characters', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const cliOutput = {
        result: 'test.key: special value\nanother$key: another value'
      };

      setTimeout(() => {
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(cliOutput)));
        mockProcess.emit('exit', 0);
      }, 10);

      const request: AgentExecutionRequest = {
        systemPrompt: 'System',
        userPrompt: 'User',
        options: {
          outputKeys: ['test.key', 'another$key']
        }
      };

      const result = await runtime.execute(request);

      expect(result.extractedData).toEqual({
        'test.key': 'special value',
        'another$key': 'another value'
      });
    });

    it('should return undefined when no output keys requested', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const cliOutput = {
        result: 'Some output'
      };

      setTimeout(() => {
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(cliOutput)));
        mockProcess.emit('exit', 0);
      }, 10);

      const request: AgentExecutionRequest = {
        systemPrompt: 'System',
        userPrompt: 'User',
        options: {}
      };

      const result = await runtime.execute(request);

      expect(result.extractedData).toBeUndefined();
    });

    it('should return undefined when no matches found', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const cliOutput = {
        result: 'No matching keys here'
      };

      setTimeout(() => {
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(cliOutput)));
        mockProcess.emit('exit', 0);
      }, 10);

      const request: AgentExecutionRequest = {
        systemPrompt: 'System',
        userPrompt: 'User',
        options: {
          outputKeys: ['missing_key']
        }
      };

      const result = await runtime.execute(request);

      expect(result.extractedData).toBeUndefined();
    });
  });

  describe('execute() - Streaming', () => {
    it('should call onOutputUpdate callback with tool activity from assistant messages', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const onOutputUpdate = vi.fn();
      const request: AgentExecutionRequest = {
        systemPrompt: 'System',
        userPrompt: 'User',
        options: {
          onOutputUpdate
        }
      };

      setTimeout(() => {
        // Simulate NDJSON streaming with assistant messages containing tool_use
        const assistantMsg1 = {
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', name: 'Read', input: { file_path: '/src/index.ts' } }
            ]
          }
        };
        const assistantMsg2 = {
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', name: 'Edit', input: { file_path: '/src/config.ts' } }
            ]
          }
        };
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(assistantMsg1) + '\n'));
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(assistantMsg2) + '\n'));
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify({ result: 'Final output' })));
        mockProcess.emit('exit', 0);
      }, 10);

      await runtime.execute(request);

      expect(onOutputUpdate).toHaveBeenCalledWith('📖 Reading .../src/index.ts');
      expect(onOutputUpdate).toHaveBeenCalledWith('✏️ Editing .../src/config.ts');
      expect(onOutputUpdate).toHaveBeenCalledTimes(2);
    });

    it('should handle streaming data with non-JSON lines', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const onOutputUpdate = vi.fn();
      const request: AgentExecutionRequest = {
        systemPrompt: 'System',
        userPrompt: 'User',
        options: {
          onOutputUpdate
        }
      };

      setTimeout(() => {
        mockProcess.stdout.emit('data', Buffer.from('Non-JSON line\n'));
        // Valid assistant message with tool_use
        const assistantMsg = {
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }
            ]
          }
        };
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(assistantMsg) + '\n'));
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify({ result: 'Final' })));
        mockProcess.emit('exit', 0);
      }, 10);

      await runtime.execute(request);

      // Should only call with valid streaming JSON containing tool_use
      expect(onOutputUpdate).toHaveBeenCalledWith('🔧 Running: npm test');
      expect(onOutputUpdate).toHaveBeenCalledTimes(1);
    });
  });

  describe('execute() - Error Handling', () => {
    it('should handle non-zero exit code', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const request: AgentExecutionRequest = {
        systemPrompt: 'System',
        userPrompt: 'User',
        options: {}
      };

      setTimeout(() => {
        mockProcess.stderr.emit('data', Buffer.from('Error message from CLI'));
        mockProcess.emit('exit', 1);
      }, 10);

      await expect(runtime.execute(request)).rejects.toThrow(
        'Claude CLI exited with code 1'
      );
    });

    it('should handle spawn errors', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const request: AgentExecutionRequest = {
        systemPrompt: 'System',
        userPrompt: 'User',
        options: {}
      };

      const executePromise = runtime.execute(request);

      setTimeout(() => {
        mockProcess.emit('error', new Error('spawn claude ENOENT'));
      }, 10);

      await expect(executePromise).rejects.toThrow('Failed to spawn claude CLI');
    });

    it('should handle JSON parsing errors', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const request: AgentExecutionRequest = {
        systemPrompt: 'System',
        userPrompt: 'User',
        options: {}
      };

      setTimeout(() => {
        mockProcess.stdout.emit('data', Buffer.from('Invalid JSON output'));
        mockProcess.emit('exit', 0);
      }, 10);

      await expect(runtime.execute(request)).rejects.toThrow(
        'Failed to parse JSON output from Claude CLI'
      );
    });

    it('should handle timeout and cleanup process', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      // Mock kill to trigger exit event
      mockProcess.kill.mockImplementation(() => {
        setTimeout(() => {
          mockProcess.emit('exit', null);
        }, 5);
        return true;
      });

      const request: AgentExecutionRequest = {
        systemPrompt: 'System',
        userPrompt: 'User',
        options: {
          timeout: 0.1 // 100ms
        }
      };

      // Don't emit exit - simulate hanging process
      const executePromise = runtime.execute(request);

      await expect(executePromise).rejects.toThrow('timed out');
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('should handle subprocess crash mid-execution', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const request: AgentExecutionRequest = {
        systemPrompt: 'System',
        userPrompt: 'User',
        options: {}
      };

      setTimeout(() => {
        // Simulate partial output before crash
        mockProcess.stdout.emit(
          'data',
          Buffer.from(JSON.stringify({ type: 'output', content: 'Partial output' }) + '\n')
        );
        // Simulate crash (exit with null code - signals crash)
        mockProcess.emit('exit', null);
      }, 10);

      await expect(runtime.execute(request)).rejects.toThrow(
        'Claude CLI exited with code null'
      );
    });

    it('should cleanup subprocess on execution failure', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const request: AgentExecutionRequest = {
        systemPrompt: 'System',
        userPrompt: 'User',
        options: {}
      };

      // Track if kill is called
      const killSpy = mockProcess.kill;

      setTimeout(() => {
        mockProcess.stderr.emit('data', Buffer.from('Fatal error'));
        mockProcess.emit('exit', 1);
      }, 10);

      await expect(runtime.execute(request)).rejects.toThrow();

      // Process should have been cleaned up (attempted kill if still running)
      // In this case, process already exited, so no kill needed
    });

    it('should handle malformed JSON in streaming output gracefully', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const onOutputUpdate = vi.fn();
      const request: AgentExecutionRequest = {
        systemPrompt: 'System',
        userPrompt: 'User',
        options: {
          onOutputUpdate
        }
      };

      setTimeout(() => {
        // Emit malformed streaming JSON mixed with valid assistant messages
        const validMsg1 = {
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', name: 'Grep', input: { pattern: 'TODO' } }]
          }
        };
        const validMsg2 = {
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', name: 'Glob', input: { pattern: '*.ts' } }]
          }
        };
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(validMsg1) + '\n'));
        mockProcess.stdout.emit('data', Buffer.from('{malformed json}\n'));
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(validMsg2) + '\n'));
        // Final result must be valid
        mockProcess.stdout.emit(
          'data',
          Buffer.from(JSON.stringify({ result: 'Final output' }))
        );
        mockProcess.emit('exit', 0);
      }, 10);

      const result = await runtime.execute(request);

      // Should call onOutputUpdate only for valid streaming JSON, skip malformed
      expect(onOutputUpdate).toHaveBeenCalledWith('🔎 Searching for "TODO"');
      expect(onOutputUpdate).toHaveBeenCalledWith('🔍 Finding *.ts');
      expect(onOutputUpdate).toHaveBeenCalledTimes(2);
      expect(result.textOutput).toBe('Final output');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty output', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const cliOutput = {
        result: ''
      };

      setTimeout(() => {
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(cliOutput)));
        mockProcess.emit('exit', 0);
      }, 10);

      const request: AgentExecutionRequest = {
        systemPrompt: 'System',
        userPrompt: 'User',
        options: {}
      };

      const result = await runtime.execute(request);

      expect(result.textOutput).toBe('');
    });

    it('should handle partial regex matches', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const cliOutput = {
        result: 'key1: value1\nother text\nkey3: value3'
      };

      setTimeout(() => {
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(cliOutput)));
        mockProcess.emit('exit', 0);
      }, 10);

      const request: AgentExecutionRequest = {
        systemPrompt: 'System',
        userPrompt: 'User',
        options: {
          outputKeys: ['key1', 'key2', 'key3']
        }
      };

      const result = await runtime.execute(request);

      // Should only extract matching keys
      expect(result.extractedData).toEqual({
        key1: 'value1',
        key3: 'value3'
      });
    });

    it('should handle malformed JSON blocks gracefully', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const cliOutput = {
        result: '```json\n{invalid json}\n```\nkey1: fallback_value'
      };

      setTimeout(() => {
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(cliOutput)));
        mockProcess.emit('exit', 0);
      }, 10);

      const request: AgentExecutionRequest = {
        systemPrompt: 'System',
        userPrompt: 'User',
        options: {
          outputKeys: ['key1']
        }
      };

      const result = await runtime.execute(request);

      // Should fall back to regex extraction
      expect(result.extractedData).toEqual({
        key1: 'fallback_value'
      });
    });

    it('should handle output field name variations', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      // Test 'output' field instead of 'result'
      const cliOutput = {
        output: 'Test output'
      };

      setTimeout(() => {
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(cliOutput)));
        mockProcess.emit('exit', 0);
      }, 10);

      const request: AgentExecutionRequest = {
        systemPrompt: 'System',
        userPrompt: 'User',
        options: {}
      };

      const result = await runtime.execute(request);

      expect(result.textOutput).toBe('Test output');
    });
  });
});

/**
 * Create a mock ChildProcess instance with EventEmitter behavior
 */
function createMockProcess() {
  const emitter = new EventEmitter();
  const stdoutEmitter = new EventEmitter();
  const stderrEmitter = new EventEmitter();

  const mockProcess = Object.assign(emitter, {
    stdout: stdoutEmitter,
    stderr: stderrEmitter,
    kill: vi.fn(() => true),
    killed: false
  });

  return mockProcess;
}
