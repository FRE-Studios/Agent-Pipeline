// src/core/agent-runtimes/openai-compatible-runtime.ts

import {
  AgentRuntime,
  AgentExecutionRequest,
  AgentExecutionResult,
  AgentRuntimeCapabilities,
  ValidationResult,
  TokenUsage
} from '../types/agent-runtime.js';
import { PipelineAbortController, PipelineAbortError } from '../abort-controller.js';

/**
 * OpenAI-Compatible API Runtime
 *
 * Makes HTTP calls to any OpenAI-compatible Chat Completions endpoint
 * (OpenAI, Together, Groq, Mistral, DeepSeek, Ollama, etc.).
 * Uses Node.js built-in fetch — no new npm dependencies.
 *
 * Single-turn only: maps systemPrompt + userPrompt to messages array,
 * calls /chat/completions, returns the assistant response text.
 */
export class OpenAICompatibleRuntime implements AgentRuntime {
  readonly type = 'openai-compatible';
  readonly name = 'OpenAI-Compatible API';

  async execute(
    request: AgentExecutionRequest,
    abortController?: PipelineAbortController
  ): Promise<AgentExecutionResult> {
    if (abortController?.aborted) {
      throw new PipelineAbortError('Pipeline aborted before agent execution started');
    }

    const { systemPrompt, userPrompt, options } = request;
    const runtimeOpts = options.runtimeOptions || {};

    // Resolve API key
    const apiKey = this.resolveApiKey(runtimeOpts);
    if (!apiKey) {
      const envVar = (runtimeOpts.apiKeyEnv as string) || 'OPENAI_API_KEY';
      throw new Error(
        `No API key found. Set ${envVar} environment variable or provide apiKey in runtime options.`
      );
    }

    // Resolve base URL
    const baseUrl = this.resolveBaseUrl(runtimeOpts);

    // Build messages
    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt?.trim()) {
      messages.push({ role: 'system', content: systemPrompt.trim() });
    }
    messages.push({ role: 'user', content: userPrompt });

    // Build request body
    const model = (runtimeOpts.model as string) || options.model || 'gpt-4o';
    const body: Record<string, unknown> = {
      model,
      messages
    };

    if (runtimeOpts.temperature !== undefined) {
      body.temperature = Number(runtimeOpts.temperature);
    }
    if (runtimeOpts.topP !== undefined) {
      body.top_p = Number(runtimeOpts.topP);
    }
    if (runtimeOpts.maxTokens !== undefined) {
      body.max_tokens = Number(runtimeOpts.maxTokens);
    }

    const streaming = Boolean(options.onOutputUpdate);

    if (streaming) {
      body.stream = true;
      body.stream_options = { include_usage: true };
    }

    // Bridge PipelineAbortController to native AbortController for fetch
    const nativeAbort = new AbortController();
    let abortHandler: (() => void) | undefined;

    if (abortController) {
      abortHandler = () => nativeAbort.abort();
      abortController.on('abort', abortHandler);
    }

    try {
      const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(body),
        signal: nativeAbort.signal
      });

      if (!response.ok) {
        const errorBody = await this.safeReadBody(response);
        const parsed = this.parseErrorBody(errorBody);
        throw new Error(
          `OpenAI API error (${response.status}): ${parsed}`
        );
      }

      if (streaming) {
        return await this.handleStreamingResponse(response, options.onOutputUpdate!, model);
      } else {
        return await this.handleNonStreamingResponse(response, model);
      }
    } catch (err) {
      if (err instanceof PipelineAbortError) throw err;

      // Convert native AbortError to PipelineAbortError
      const error = err as Error;
      if (error.name === 'AbortError') {
        throw new PipelineAbortError('Agent execution aborted');
      }

      throw err;
    } finally {
      if (abortController && abortHandler) {
        abortController.off('abort', abortHandler);
      }
    }
  }

  getCapabilities(): AgentRuntimeCapabilities {
    return {
      supportsStreaming: true,
      supportsTokenTracking: true,
      supportsMCP: false,
      supportsContextReduction: false,
      availableModels: [],
      permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan']
    };
  }

  async validate(): Promise<ValidationResult> {
    const warnings: string[] = [];

    if (!process.env.OPENAI_API_KEY) {
      warnings.push(
        'OPENAI_API_KEY environment variable is not set. ' +
        'You may configure a different apiKeyEnv per pipeline.'
      );
    }

    return {
      valid: true,
      errors: [],
      warnings
    };
  }

  private resolveApiKey(runtimeOpts: Record<string, unknown>): string | undefined {
    // 1. Explicit apiKey in runtime options
    if (runtimeOpts.apiKey && typeof runtimeOpts.apiKey === 'string') {
      return runtimeOpts.apiKey;
    }

    // 2. Custom env var name
    if (runtimeOpts.apiKeyEnv && typeof runtimeOpts.apiKeyEnv === 'string') {
      const value = process.env[runtimeOpts.apiKeyEnv];
      if (value) return value;
    }

    // 3. Default env var
    return process.env.OPENAI_API_KEY;
  }

  private resolveBaseUrl(runtimeOpts: Record<string, unknown>): string {
    if (runtimeOpts.baseUrl && typeof runtimeOpts.baseUrl === 'string') {
      return runtimeOpts.baseUrl;
    }
    return process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  }

  private async handleNonStreamingResponse(
    response: Response,
    model: string
  ): Promise<AgentExecutionResult> {
    const data = await response.json() as any;

    const textOutput = data.choices?.[0]?.message?.content ?? '';
    const tokenUsage = data.usage
      ? this.normalizeTokenUsage(data.usage)
      : undefined;

    return {
      textOutput,
      tokenUsage,
      numTurns: 1,
      metadata: {
        runtime: this.type,
        model
      }
    };
  }

  private async handleStreamingResponse(
    response: Response,
    onOutputUpdate: (output: string) => void,
    model: string
  ): Promise<AgentExecutionResult> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let accumulated = '';
    let usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (!trimmed.startsWith('data: ')) continue;

          const jsonStr = trimmed.slice(6);
          try {
            const chunk = JSON.parse(jsonStr);

            // Extract content delta
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) {
              accumulated += delta;
              onOutputUpdate(accumulated);
            }

            // Extract usage from final chunk (stream_options: include_usage)
            if (chunk.usage) {
              usage = chunk.usage;
            }
          } catch {
            // Skip malformed JSON chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const tokenUsage = usage
      ? this.normalizeTokenUsage(usage)
      : undefined;

    return {
      textOutput: accumulated,
      tokenUsage,
      numTurns: 1,
      metadata: {
        runtime: this.type,
        model
      }
    };
  }

  private normalizeTokenUsage(usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  }): TokenUsage {
    const inputTokens = usage.prompt_tokens ?? 0;
    const outputTokens = usage.completion_tokens ?? 0;
    return {
      inputTokens,
      outputTokens,
      totalTokens: usage.total_tokens ?? (inputTokens + outputTokens)
    };
  }

  private async safeReadBody(response: Response): Promise<string> {
    try {
      return await response.text();
    } catch {
      return '';
    }
  }

  private parseErrorBody(body: string): string {
    if (!body) return 'Unknown error';
    try {
      const parsed = JSON.parse(body);
      if (parsed.error?.message) {
        return parsed.error.message;
      }
      return body;
    } catch {
      return body;
    }
  }
}
