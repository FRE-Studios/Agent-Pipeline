// src/__tests__/core/agent-query-runner.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentQueryRunner } from '../../core/agent-query-runner.js';

// Mock the Claude Agent SDK
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn()
}));

describe('AgentQueryRunner', () => {
  let queryRunner: AgentQueryRunner;
  let mockQuery: any;

  beforeEach(async () => {
    queryRunner = new AgentQueryRunner();

    // Get the mocked query function
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    mockQuery = query as any;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('runSDKQuery', () => {
    it('should execute query and return text output', async () => {
      // Mock async generator that yields assistant message
      mockQuery.mockImplementation(() => ({
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [
                { type: 'text', text: 'Hello from agent' }
              ]
            }
          };
          yield {
            type: 'result',
            subtype: 'success',
            num_turns: 1,
            usage: {
              input_tokens: 100,
              output_tokens: 50
            }
          };
        }
      }));

      const result = await queryRunner.runSDKQuery('Test prompt', {
        systemPrompt: 'You are a helpful assistant',
        permissionMode: 'acceptEdits',
        captureTokenUsage: true
      });

      expect(result.textOutput).toBe('Hello from agent');
      expect(result.numTurns).toBe(1);
      expect(result.tokenUsage).toEqual({
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: undefined,
        cache_read_input_tokens: undefined,
        thinking_tokens: undefined
      });
    });

    it('should handle multiple assistant messages', async () => {
      mockQuery.mockImplementation(() => ({
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [
                { type: 'text', text: 'First response ' }
              ]
            }
          };
          yield {
            type: 'assistant',
            message: {
              content: [
                { type: 'text', text: 'Second response' }
              ]
            }
          };
        }
      }));

      const result = await queryRunner.runSDKQuery('Test', {
        systemPrompt: 'Test',
        captureTokenUsage: false
      });

      expect(result.textOutput).toBe('First response Second response');
    });

    it('should concatenate multiple text blocks', async () => {
      mockQuery.mockImplementation(() => ({
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [
                { type: 'text', text: 'Part 1 ' },
                { type: 'text', text: 'Part 2 ' },
                { type: 'text', text: 'Part 3' }
              ]
            }
          };
        }
      }));

      const result = await queryRunner.runSDKQuery('Test', {
        systemPrompt: 'Test',
        captureTokenUsage: false
      });

      expect(result.textOutput).toBe('Part 1 Part 2 Part 3');
    });

    it('should call onOutputUpdate callback with streaming text', async () => {
      const onOutputUpdate = vi.fn();

      mockQuery.mockImplementation(() => ({
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [
                { type: 'text', text: 'First ' }
              ]
            }
          };
          yield {
            type: 'assistant',
            message: {
              content: [
                { type: 'text', text: 'Second' }
              ]
            }
          };
        }
      }));

      await queryRunner.runSDKQuery('Test', {
        systemPrompt: 'Test',
        onOutputUpdate,
        captureTokenUsage: false
      });

      expect(onOutputUpdate).toHaveBeenCalledTimes(2);
      expect(onOutputUpdate).toHaveBeenNthCalledWith(1, 'First ');
      expect(onOutputUpdate).toHaveBeenNthCalledWith(2, 'First Second');
    });

    it('should capture full token usage including cache and thinking tokens', async () => {
      mockQuery.mockImplementation(() => ({
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: 'Response' }]
            }
          };
          yield {
            type: 'result',
            subtype: 'success',
            num_turns: 3,
            usage: {
              input_tokens: 500,
              output_tokens: 200,
              cache_creation_input_tokens: 50,
              cache_read_input_tokens: 100,
              thinking_tokens: 150
            }
          };
        }
      }));

      const result = await queryRunner.runSDKQuery('Test', {
        systemPrompt: 'Test',
        captureTokenUsage: true
      });

      expect(result.tokenUsage).toEqual({
        input_tokens: 500,
        output_tokens: 200,
        cache_creation_input_tokens: 50,
        cache_read_input_tokens: 100,
        thinking_tokens: 150
      });
      expect(result.numTurns).toBe(3);
    });

    it('should not capture token usage when captureTokenUsage is false', async () => {
      mockQuery.mockImplementation(() => ({
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: 'Response' }]
            }
          };
          yield {
            type: 'result',
            subtype: 'success',
            num_turns: 1,
            usage: {
              input_tokens: 100,
              output_tokens: 50
            }
          };
        }
      }));

      const result = await queryRunner.runSDKQuery('Test', {
        systemPrompt: 'Test',
        captureTokenUsage: false
      });

      expect(result.tokenUsage).toBeUndefined();
      expect(result.numTurns).toBeUndefined();
    });

    it('should pass all SDK options correctly', async () => {
      mockQuery.mockImplementation(() => ({
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: 'Done' }]
            }
          };
        }
      }));

      await queryRunner.runSDKQuery('Test prompt', {
        systemPrompt: 'Custom system',
        permissionMode: 'plan',
        model: 'haiku',
        maxTurns: 5,
        maxThinkingTokens: 1000,
        captureTokenUsage: false
      });

      expect(mockQuery).toHaveBeenCalledWith({
        prompt: 'Test prompt',
        options: expect.objectContaining({
          systemPrompt: 'Custom system',
          permissionMode: 'plan',
          model: 'haiku',
          maxTurns: 5,
          maxThinkingTokens: 1000,
          settingSources: ['project']
        })
      });
    });

    it('should handle result message type', async () => {
      mockQuery.mockImplementation(() => ({
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: 'Done' }]
            }
          };
          yield {
            type: 'result',
            subtype: 'success',
            num_turns: 2,
            usage: {
              input_tokens: 50,
              output_tokens: 25
            }
          };
        }
      }));

      const result = await queryRunner.runSDKQuery('Test', {
        systemPrompt: 'Test',
        captureTokenUsage: true
      });

      expect(result.textOutput).toBe('Done');
      expect(result.numTurns).toBe(2);
    });

    it('should handle empty content array', async () => {
      mockQuery.mockImplementation(() => ({
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: []
            }
          };
        }
      }));

      const result = await queryRunner.runSDKQuery('Test', {
        systemPrompt: 'Test',
        captureTokenUsage: false
      });

      expect(result.textOutput).toBe('');
    });

    it('should ignore tool_use content blocks', async () => {
      mockQuery.mockImplementation(() => ({
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [
                { type: 'text', text: 'Using tools' },
                {
                  type: 'tool_use',
                  name: 'some_tool',
                  input: { data: 'ignored' }
                }
              ]
            }
          };
        }
      }));

      const result = await queryRunner.runSDKQuery('Test', {
        systemPrompt: 'Test',
        captureTokenUsage: false
      });

      expect(result.textOutput).toBe('Using tools');
    });

    it('should use default permissionMode if not specified', async () => {
      mockQuery.mockImplementation(() => ({
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: 'Done' }]
            }
          };
        }
      }));

      await queryRunner.runSDKQuery('Test', {
        systemPrompt: 'Test',
        // permissionMode not specified
        captureTokenUsage: false
      });

      expect(mockQuery).toHaveBeenCalledWith({
        prompt: 'Test',
        options: expect.objectContaining({
          permissionMode: 'acceptEdits' // Should default to acceptEdits
        })
      });
    });

    it('should only include optional model settings when provided', async () => {
      mockQuery.mockImplementation(() => ({
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: 'Done' }]
            }
          };
        }
      }));

      await queryRunner.runSDKQuery('Test', {
        systemPrompt: 'Test',
        // No model, maxTurns, or maxThinkingTokens
        captureTokenUsage: false
      });

      const callOptions = mockQuery.mock.calls[0][0].options;
      expect(callOptions).not.toHaveProperty('model');
      expect(callOptions).not.toHaveProperty('maxTurns');
      expect(callOptions).not.toHaveProperty('maxThinkingTokens');
    });
  });
});
