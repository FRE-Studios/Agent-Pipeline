// src/__tests__/core/agent-runtimes/claude-sdk-runtime.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaudeSDKRuntime } from '../../../core/agent-runtimes/claude-sdk-runtime.js';
import type { AgentExecutionRequest } from '../../../core/types/agent-runtime.js';

describe('ClaudeSDKRuntime', () => {
  let runtime: ClaudeSDKRuntime;
  let mockRunSDKQuery: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Create runtime instance
    runtime = new ClaudeSDKRuntime();

    // Spy on the private queryRunner's runSDKQuery method
    mockRunSDKQuery = vi.fn();
    (runtime as any).queryRunner = {
      runSDKQuery: mockRunSDKQuery
    };
  });

  describe('Basic Properties', () => {
    it('should have correct type identifier', () => {
      expect(runtime.type).toBe('claude-sdk');
    });

    it('should have correct name', () => {
      expect(runtime.name).toBe('Claude Agent SDK');
    });
  });

  describe('getCapabilities()', () => {
    it('should return full SDK capabilities', () => {
      const capabilities = runtime.getCapabilities();

      expect(capabilities).toEqual({
        supportsStreaming: true,
        supportsTokenTracking: true,
        supportsMCP: true,
        supportsContextReduction: true,
        availableModels: ['haiku', 'sonnet', 'opus'],
        permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan']
      });
    });
  });

  describe('validate()', () => {
    it('should always return valid (SDK is a library dependency)', async () => {
      const result = await runtime.validate();

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
    });
  });

  describe('execute()', () => {
    it('should execute agent with basic request', async () => {
      // Setup mock
      mockRunSDKQuery.mockResolvedValue({
        textOutput: 'Test output',
        tokenUsage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 10,
          cache_read_input_tokens: 20,
          thinking_tokens: 5
        },
        numTurns: 3
      });

      const request: AgentExecutionRequest = {
        systemPrompt: 'You are a test agent',
        userPrompt: 'Do something',
        options: {}
      };

      const result = await runtime.execute(request);

      // Verify AgentQueryRunner was called correctly
      expect(mockRunSDKQuery).toHaveBeenCalledWith('Do something', {
        systemPrompt: 'You are a test agent',
        permissionMode: undefined,
        model: undefined,
        maxTurns: undefined,
        maxThinkingTokens: undefined,
        onOutputUpdate: undefined,
        captureTokenUsage: true
      });

      // Verify result normalization
      expect(result.textOutput).toBe('Test output');
      expect(result.numTurns).toBe(3);
      expect(result.tokenUsage).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationTokens: 10,
        cacheReadTokens: 20,
        thinkingTokens: 5,
        totalTokens: 150
      });
    });

    it('should pass through all execution options', async () => {
      mockRunSDKQuery.mockResolvedValue({
        textOutput: 'Output',
        tokenUsage: { input_tokens: 10, output_tokens: 5 }
      });

      const onOutputUpdate = vi.fn();
      const request: AgentExecutionRequest = {
        systemPrompt: 'System',
        userPrompt: 'User',
        options: {
          timeout: 300,
          outputKeys: ['key1', 'key2'],
          permissionMode: 'acceptEdits',
          model: 'haiku',
          maxTurns: 10,
          maxThinkingTokens: 1000,
          onOutputUpdate
        }
      };

      await runtime.execute(request);

      expect(mockRunSDKQuery).toHaveBeenCalledWith('User', {
        systemPrompt: 'System',
        permissionMode: 'acceptEdits',
        model: 'haiku',
        maxTurns: 10,
        maxThinkingTokens: 1000,
        onOutputUpdate,
        captureTokenUsage: true
      });
    });

    it('should normalize token usage correctly', async () => {
      mockRunSDKQuery.mockResolvedValue({
        textOutput: 'Output',
        tokenUsage: {
          input_tokens: 100,
          output_tokens: 50
        }
      });

      const request: AgentExecutionRequest = {
        systemPrompt: 'System',
        userPrompt: 'User',
        options: {}
      };

      const result = await runtime.execute(request);

      expect(result.tokenUsage).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationTokens: undefined,
        cacheReadTokens: undefined,
        thinkingTokens: undefined,
        totalTokens: 150
      });
    });

    it('should handle missing token usage', async () => {
      mockRunSDKQuery.mockResolvedValue({
        textOutput: 'Output'
      });

      const request: AgentExecutionRequest = {
        systemPrompt: 'System',
        userPrompt: 'User',
        options: {}
      };

      const result = await runtime.execute(request);

      expect(result.tokenUsage).toBeUndefined();
    });

    it('should handle response with no token usage', async () => {
      mockRunSDKQuery.mockResolvedValue({
        textOutput: 'Some output'
      });

      const request: AgentExecutionRequest = {
        systemPrompt: 'System',
        userPrompt: 'User',
        options: {}
      };

      const result = await runtime.execute(request);

      expect(result.textOutput).toBe('Some output');
      expect(result.tokenUsage).toBeUndefined();
    });

    it('should normalize invalid model names to undefined', async () => {
      mockRunSDKQuery.mockResolvedValue({
        textOutput: 'Output'
      });

      const request: AgentExecutionRequest = {
        systemPrompt: 'System',
        userPrompt: 'User',
        options: {
          model: 'invalid-model'
        }
      };

      await runtime.execute(request);

      expect(mockRunSDKQuery).toHaveBeenCalledWith('User', expect.objectContaining({
        model: undefined // Invalid model should be normalized to undefined
      }));
    });

    it('should normalize valid model names (case insensitive)', async () => {
      mockRunSDKQuery.mockResolvedValue({
        textOutput: 'Output'
      });

      const testCases = [
        { input: 'Haiku', expected: 'haiku' },
        { input: 'SONNET', expected: 'sonnet' },
        { input: 'opus', expected: 'opus' }
      ];

      for (const { input, expected } of testCases) {
        mockRunSDKQuery.mockClear();

        const request: AgentExecutionRequest = {
          systemPrompt: 'System',
          userPrompt: 'User',
          options: { model: input }
        };

        await runtime.execute(request);

        expect(mockRunSDKQuery).toHaveBeenCalledWith('User', expect.objectContaining({
          model: expected
        }));
      }
    });

    it('should include runtime metadata in result', async () => {
      mockRunSDKQuery.mockResolvedValue({
        textOutput: 'Output'
      });

      const request: AgentExecutionRequest = {
        systemPrompt: 'System',
        userPrompt: 'User',
        options: { model: 'haiku' }
      };

      const result = await runtime.execute(request);

      expect(result.metadata).toEqual({
        runtime: 'claude-sdk',
        model: 'haiku'
      });
    });

    it('should propagate errors from SDK', async () => {
      const sdkError = new Error('SDK execution failed');
      mockRunSDKQuery.mockRejectedValue(sdkError);

      const request: AgentExecutionRequest = {
        systemPrompt: 'System',
        userPrompt: 'User',
        options: {}
      };

      await expect(runtime.execute(request)).rejects.toThrow('SDK execution failed');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty text output', async () => {
      mockRunSDKQuery.mockResolvedValue({
        textOutput: ''
      });

      const request: AgentExecutionRequest = {
        systemPrompt: 'System',
        userPrompt: 'User',
        options: {}
      };

      const result = await runtime.execute(request);

      expect(result.textOutput).toBe('');
    });

    it('should include metadata in result', async () => {
      mockRunSDKQuery.mockResolvedValue({
        textOutput: 'Output'
      });

      const request: AgentExecutionRequest = {
        systemPrompt: 'System',
        userPrompt: 'User',
        options: { model: 'sonnet' }
      };

      const result = await runtime.execute(request);

      expect(result.metadata).toEqual({
        runtime: 'claude-sdk',
        model: 'sonnet'
      });
    });
  });
});
