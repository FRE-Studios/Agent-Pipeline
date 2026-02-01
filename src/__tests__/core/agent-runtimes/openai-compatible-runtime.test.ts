import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAICompatibleRuntime } from '../../../core/agent-runtimes/openai-compatible-runtime.js';
import type { AgentExecutionRequest } from '../../../core/types/agent-runtime.js';
import { PipelineAbortController, PipelineAbortError } from '../../../core/abort-controller.js';

// Helper to create a mock Response for non-streaming
function mockJsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(JSON.stringify(data)),
    body: null
  } as unknown as Response;
}

// Helper to create a mock Response for streaming SSE
function mockStreamResponse(chunks: string[], status = 200): Response {
  let index = 0;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]));
        index++;
      } else {
        controller.close();
      }
    }
  });

  return {
    ok: status >= 200 && status < 300,
    status,
    body: stream,
    json: vi.fn(),
    text: vi.fn().mockResolvedValue(chunks.join(''))
  } as unknown as Response;
}

// Helper to create an error response
function mockErrorResponse(body: string, status: number): Response {
  return {
    ok: false,
    status,
    json: vi.fn().mockRejectedValue(new Error('not json')),
    text: vi.fn().mockResolvedValue(body),
    body: null
  } as unknown as Response;
}

function baseRequest(overrides: Partial<AgentExecutionRequest> = {}): AgentExecutionRequest {
  return {
    systemPrompt: 'You are a test assistant.',
    userPrompt: 'Hello world',
    options: {
      runtimeOptions: {
        model: 'gpt-4o'
      }
    },
    ...overrides
  };
}

describe('OpenAICompatibleRuntime', () => {
  let runtime: OpenAICompatibleRuntime;
  let originalFetch: typeof globalThis.fetch;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    runtime = new OpenAICompatibleRuntime();
    originalFetch = globalThis.fetch;
    originalEnv = { ...process.env };
    process.env.OPENAI_API_KEY = 'test-key-123';
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  // --- Properties ---

  it('should expose type and name', () => {
    expect(runtime.type).toBe('openai-compatible');
    expect(runtime.name).toBe('OpenAI-Compatible API');
  });

  it('should return capabilities', () => {
    expect(runtime.getCapabilities()).toEqual({
      supportsStreaming: true,
      supportsTokenTracking: true,
      supportsMCP: false,
      supportsContextReduction: false,
      availableModels: [],
      permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan']
    });
  });

  // --- validate() ---

  it('validate should always return valid with no warnings', async () => {
    delete process.env.OPENAI_API_KEY;
    const result = await runtime.validate();
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  // --- execute() non-streaming ---

  it('should make correct API call shape', async () => {
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue(mockJsonResponse({
      choices: [{ message: { content: 'Hello!' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
    }));

    const result = await runtime.execute(baseRequest());

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.headers['Authorization']).toBe('Bearer test-key-123');

    const body = JSON.parse(init.body);
    expect(body.model).toBe('gpt-4o');
    expect(body.messages).toEqual([
      { role: 'system', content: 'You are a test assistant.' },
      { role: 'user', content: 'Hello world' }
    ]);
    expect(body.stream).toBeUndefined();

    expect(result.textOutput).toBe('Hello!');
    expect(result.numTurns).toBe(1);
    expect(result.metadata?.runtime).toBe('openai-compatible');
  });

  it('should use custom baseUrl from runtimeOptions', async () => {
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue(mockJsonResponse({
      choices: [{ message: { content: 'ok' } }]
    }));

    await runtime.execute(baseRequest({
      options: {
        runtimeOptions: {
          model: 'llama3.1:70b',
          baseUrl: 'http://localhost:11434/v1'
        }
      }
    }));

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
  });

  it('should use OPENAI_BASE_URL env var as fallback', async () => {
    process.env.OPENAI_BASE_URL = 'https://custom.api.com/v1';
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue(mockJsonResponse({
      choices: [{ message: { content: 'ok' } }]
    }));

    await runtime.execute(baseRequest({
      options: {
        runtimeOptions: { model: 'gpt-4o' }
      }
    }));

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('https://custom.api.com/v1/chat/completions');
  });

  it('should use custom apiKeyEnv', async () => {
    process.env.MY_CUSTOM_KEY = 'custom-key-456';
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue(mockJsonResponse({
      choices: [{ message: { content: 'ok' } }]
    }));

    await runtime.execute(baseRequest({
      options: {
        runtimeOptions: {
          model: 'gpt-4o',
          apiKeyEnv: 'MY_CUSTOM_KEY'
        }
      }
    }));

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers['Authorization']).toBe('Bearer custom-key-456');
  });

  it('should pass through generation params', async () => {
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue(mockJsonResponse({
      choices: [{ message: { content: 'ok' } }]
    }));

    await runtime.execute(baseRequest({
      options: {
        runtimeOptions: {
          model: 'gpt-4o',
          temperature: 0.7,
          topP: 0.9,
          maxTokens: 4096
        }
      }
    }));

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.temperature).toBe(0.7);
    expect(body.top_p).toBe(0.9);
    expect(body.max_tokens).toBe(4096);
  });

  it('should normalize token usage', async () => {
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue(mockJsonResponse({
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
    }));

    const result = await runtime.execute(baseRequest());

    expect(result.tokenUsage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150
    });
  });

  it('should handle missing usage gracefully', async () => {
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue(mockJsonResponse({
      choices: [{ message: { content: 'ok' } }]
    }));

    const result = await runtime.execute(baseRequest());
    expect(result.tokenUsage).toBeUndefined();
  });

  it('should omit system message when systemPrompt is empty', async () => {
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue(mockJsonResponse({
      choices: [{ message: { content: 'ok' } }]
    }));

    await runtime.execute(baseRequest({
      systemPrompt: '',
      userPrompt: 'Just a user message'
    }));

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.messages).toEqual([
      { role: 'user', content: 'Just a user message' }
    ]);
  });

  it('should return empty string when choices are missing', async () => {
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue(mockJsonResponse({ choices: [] }));

    const result = await runtime.execute(baseRequest());
    expect(result.textOutput).toBe('');
  });

  // --- execute() streaming ---

  it('should parse SSE stream and call onOutputUpdate', async () => {
    const sseData = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"!"}}],"usage":{"prompt_tokens":10,"completion_tokens":3,"total_tokens":13}}\n\n',
      'data: [DONE]\n\n'
    ];

    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue(mockStreamResponse(sseData));

    const updates: string[] = [];
    const result = await runtime.execute(baseRequest({
      options: {
        runtimeOptions: { model: 'gpt-4o' },
        onOutputUpdate: (output) => updates.push(output)
      }
    }));

    expect(result.textOutput).toBe('Hello world!');
    expect(updates).toEqual(['Hello', 'Hello world', 'Hello world!']);
    expect(result.tokenUsage).toEqual({
      inputTokens: 10,
      outputTokens: 3,
      totalTokens: 13
    });

    // Verify stream flag was set
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  it('should handle streaming without usage data', async () => {
    const sseData = [
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
      'data: [DONE]\n\n'
    ];

    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue(mockStreamResponse(sseData));

    const result = await runtime.execute(baseRequest({
      options: {
        runtimeOptions: { model: 'gpt-4o' },
        onOutputUpdate: vi.fn()
      }
    }));

    expect(result.textOutput).toBe('Hi');
    expect(result.tokenUsage).toBeUndefined();
  });

  it('should handle malformed SSE chunks gracefully', async () => {
    const sseData = [
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
      'data: {broken json\n\n',
      ': comment line\n\n',
      'data: [DONE]\n\n'
    ];

    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue(mockStreamResponse(sseData));

    const result = await runtime.execute(baseRequest({
      options: {
        runtimeOptions: { model: 'gpt-4o' },
        onOutputUpdate: vi.fn()
      }
    }));

    expect(result.textOutput).toBe('ok');
  });

  // --- Abort handling ---

  it('should throw PipelineAbortError when already aborted', async () => {
    const abortCtrl = new PipelineAbortController();
    abortCtrl.abort();

    await expect(runtime.execute(baseRequest(), abortCtrl))
      .rejects.toThrow(PipelineAbortError);
  });

  it('should throw PipelineAbortError on mid-flight abort', async () => {
    const abortCtrl = new PipelineAbortController();
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockImplementation((_url: string, init: RequestInit) => {
      // Simulate aborting during fetch
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      return Promise.reject(abortError);
    });

    abortCtrl.abort();

    await expect(runtime.execute(baseRequest(), abortCtrl))
      .rejects.toThrow(PipelineAbortError);
  });

  it('should clean up abort listener after successful execution', async () => {
    const abortCtrl = new PipelineAbortController();
    const offSpy = vi.spyOn(abortCtrl, 'off');

    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue(mockJsonResponse({
      choices: [{ message: { content: 'ok' } }]
    }));

    await runtime.execute(baseRequest(), abortCtrl);

    expect(offSpy).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  // --- Error handling ---

  it('should throw on HTTP errors with parsed error body', async () => {
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue(mockErrorResponse(
      JSON.stringify({ error: { message: 'Rate limit exceeded', type: 'rate_limit_error', code: 429 } }),
      429
    ));

    await expect(runtime.execute(baseRequest()))
      .rejects.toThrow('OpenAI API error (429): Rate limit exceeded');
  });

  it('should handle non-JSON error bodies', async () => {
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue(mockErrorResponse(
      'Internal Server Error',
      500
    ));

    await expect(runtime.execute(baseRequest()))
      .rejects.toThrow('OpenAI API error (500): Internal Server Error');
  });

  it('should throw on network errors', async () => {
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockRejectedValue(new TypeError('fetch failed'));

    await expect(runtime.execute(baseRequest()))
      .rejects.toThrow('fetch failed');
  });

  it('should throw when no API key is available', async () => {
    delete process.env.OPENAI_API_KEY;

    await expect(runtime.execute(baseRequest({
      options: { runtimeOptions: { model: 'gpt-4o' } }
    }))).rejects.toThrow('No API key found');
  });

  it('should mention the custom apiKeyEnv in error message', async () => {
    delete process.env.OPENAI_API_KEY;

    await expect(runtime.execute(baseRequest({
      options: { runtimeOptions: { model: 'gpt-4o', apiKeyEnv: 'GROQ_API_KEY' } }
    }))).rejects.toThrow('GROQ_API_KEY');
  });

  it('should use explicit apiKey from runtimeOptions', async () => {
    delete process.env.OPENAI_API_KEY;
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue(mockJsonResponse({
      choices: [{ message: { content: 'ok' } }]
    }));

    await runtime.execute(baseRequest({
      options: {
        runtimeOptions: {
          model: 'gpt-4o',
          apiKey: 'explicit-key-789'
        }
      }
    }));

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers['Authorization']).toBe('Bearer explicit-key-789');
  });

  it('should strip trailing slashes from baseUrl', async () => {
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue(mockJsonResponse({
      choices: [{ message: { content: 'ok' } }]
    }));

    await runtime.execute(baseRequest({
      options: {
        runtimeOptions: {
          model: 'gpt-4o',
          baseUrl: 'http://localhost:11434/v1/'
        }
      }
    }));

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
  });
});
