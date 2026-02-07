// src/core/agent-runtimes/pi-agent-headless-runtime.ts

import { spawn, ChildProcess } from 'child_process';
import {
  AgentRuntime,
  AgentExecutionRequest,
  AgentExecutionResult,
  AgentRuntimeCapabilities,
  ValidationResult
} from '../types/agent-runtime.js';
import { PipelineAbortController, PipelineAbortError } from '../abort-controller.js';

/**
 * Pi Agent Headless Runtime Implementation
 *
 * Executes agents via the `pi` CLI (@mariozechner/pi-coding-agent) in non-interactive mode.
 * Supports 15+ providers (Anthropic, OpenAI, Google, Mistral, Groq, xAI, OpenRouter, etc.)
 * with built-in tools (read, bash, edit, write, grep, find, ls).
 *
 * Uses `--mode json` for NDJSON event streaming with tool activity extraction.
 */
export class PiAgentHeadlessRuntime implements AgentRuntime {
  readonly type = 'pi-agent';
  readonly name = 'Pi Agent Headless Mode';

  async execute(
    request: AgentExecutionRequest,
    abortController?: PipelineAbortController
  ): Promise<AgentExecutionResult> {
    if (abortController?.aborted) {
      throw new PipelineAbortError('Pipeline aborted before agent execution started');
    }

    const { options } = request;

    const prompt = this.buildPrompt(request);
    const args = this.buildCliArgs(request);

    const cliResult = await this.executePiCLI(args, {
      timeout: options.timeout ? options.timeout * 1000 : 120000,
      onOutputUpdate: options.onOutputUpdate,
      cwd: options.runtimeOptions?.cwd as string | undefined,
      abortController,
      stdinInput: prompt
    });

    const textOutput = this.extractTextFromStreamOutput(cliResult.stdout);

    const extractedData = this.extractOutputsFromText(
      textOutput,
      options.outputKeys || []
    );

    return {
      textOutput,
      extractedData,
      tokenUsage: undefined,
      numTurns: undefined,
      metadata: {
        runtime: this.type,
        durationMs: cliResult.durationMs
      }
    };
  }

  getCapabilities(): AgentRuntimeCapabilities {
    return {
      supportsStreaming: true,
      supportsTokenTracking: false,
      supportsMCP: false,
      supportsContextReduction: false,
      availableModels: [],
      permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan']
    };
  }

  async validate(): Promise<ValidationResult> {
    try {
      await this.executePiCLI(['--version'], { timeout: 5000 });
      return {
        valid: true,
        errors: [],
        warnings: []
      };
    } catch (err) {
      const error = err as Error;
      return {
        valid: false,
        errors: [`Pi Agent CLI not found or not working: ${error.message}`],
        warnings: [
          'Install Pi Agent CLI with: npm install -g @mariozechner/pi-coding-agent',
          'Then run: pi --version'
        ]
      };
    }
  }

  private buildPrompt(request: AgentExecutionRequest): string {
    const { systemPrompt, userPrompt, options } = request;
    const runtimeOpts = options.runtimeOptions || {};
    const systemPromptMode = runtimeOpts.systemPromptMode as string | undefined;

    // When using --system-prompt or --append-system-prompt flags,
    // the system prompt is passed via CLI args, so only return the user prompt
    if (systemPrompt?.trim() && systemPromptMode) {
      return userPrompt;
    }

    // Default: combine system prompt and user prompt into a single prompt
    return systemPrompt?.trim()
      ? `${systemPrompt.trim()}\n\n${userPrompt}`
      : userPrompt;
  }

  buildCliArgs(request: AgentExecutionRequest): string[] {
    const { systemPrompt, options } = request;
    const args: string[] = [];

    const runtimeOpts = options.runtimeOptions || {};

    // Non-interactive mode: pipe prompt via stdin
    args.push('-p');

    // JSON output mode for NDJSON event streaming
    args.push('--mode', 'json');

    // No session persistence between runs
    args.push('--no-session');

    // Model (required)
    const model = (runtimeOpts.model as string) || options.model;
    if (model) {
      args.push('--model', String(model));
    }

    // Provider (optional - Pi Agent infers from model name)
    if (runtimeOpts.provider && typeof runtimeOpts.provider === 'string') {
      args.push('--provider', runtimeOpts.provider);
    }

    // API key resolution
    const apiKey = this.resolveApiKey(runtimeOpts);
    if (apiKey) {
      args.push('--api-key', apiKey);
    }

    // Thinking level
    if (runtimeOpts.thinking && typeof runtimeOpts.thinking === 'string') {
      args.push('--thinking', runtimeOpts.thinking);
    }

    // Max turns
    if (options.maxTurns !== undefined) {
      args.push('--max-turns', String(options.maxTurns));
    }

    // Tools configuration
    if (runtimeOpts.noTools === true) {
      args.push('--no-tools');
    } else if (runtimeOpts.tools && typeof runtimeOpts.tools === 'string') {
      args.push('--tools', runtimeOpts.tools);
    }

    // System prompt via CLI flag (when systemPromptMode is set)
    const systemPromptMode = runtimeOpts.systemPromptMode as string | undefined;
    if (systemPrompt?.trim() && systemPromptMode) {
      if (systemPromptMode === 'append') {
        args.push('--append-system-prompt', systemPrompt.trim());
      } else {
        args.push('--system-prompt', systemPrompt.trim());
      }
    }

    // Verbose output
    if (runtimeOpts.verbose === true) {
      args.push('--verbose');
    }

    // Extra args passthrough (string[])
    if (Array.isArray(runtimeOpts.args)) {
      for (const value of runtimeOpts.args) {
        if (typeof value === 'string') {
          args.push(value);
        }
      }
    }

    // Stdin marker: prompt is piped via stdin
    args.push('-');

    return args;
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

    // 3. Let Pi Agent handle its own env var resolution per provider
    return undefined;
  }

  private async executePiCLI(
    args: string[],
    options: {
      timeout?: number;
      onOutputUpdate?: (output: string) => void;
      cwd?: string;
      abortController?: PipelineAbortController;
      stdinInput?: string;
    }
  ): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
    durationMs?: number;
  }> {
    return new Promise((resolve, reject) => {
      const timeout = options.timeout || 120000;
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let aborted = false;
      let child: ChildProcess | null = null;
      const startTime = Date.now();
      let jsonBuffer = '';
      const emittedToolCallIds = new Set<string>();

      const timer = setTimeout(() => {
        timedOut = true;
        if (child) {
          child.kill('SIGTERM');
          setTimeout(() => {
            if (child && !child.killed) {
              child.kill('SIGKILL');
            }
          }, 5000);
        }
      }, timeout);

      const abortHandler = () => {
        aborted = true;
        if (child && !child.killed) {
          child.kill('SIGTERM');
          setTimeout(() => {
            if (child && !child.killed) {
              child.kill('SIGKILL');
            }
          }, 5000);
        }
      };

      if (options.abortController) {
        options.abortController.on('abort', abortHandler);
      }

      try {
        child = spawn('pi', args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: false,
          cwd: options.cwd || process.cwd()
        });

        if (options.abortController) {
          options.abortController.registerProcess(child);
        }

        if (options.stdinInput && child.stdin) {
          child.stdin.write(options.stdinInput);
          child.stdin.end();
        }

        child.stdout?.on('data', (data: Buffer) => {
          const chunk = data.toString();
          stdout += chunk;
          if (options.onOutputUpdate) {
            jsonBuffer += chunk;
            const lines = jsonBuffer.split('\n');
            jsonBuffer = lines.pop() ?? '';
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              try {
                const parsed = JSON.parse(trimmed);
                const activities = this.extractToolActivities(parsed, emittedToolCallIds);
                for (const activity of activities) {
                  options.onOutputUpdate!(activity);
                }
              } catch {
                // Ignore non-JSON lines
              }
            }
          }
        });

        child.stderr?.on('data', (data: Buffer) => {
          stderr += data.toString();
        });

        child.on('exit', (code) => {
          clearTimeout(timer);
          if (options.abortController) {
            options.abortController.off('abort', abortHandler);
          }

          if (aborted) {
            reject(new PipelineAbortError('Agent execution aborted'));
            return;
          }

          if (timedOut) {
            reject(new Error(`Pi Agent CLI execution timed out after ${timeout}ms. Process was terminated.`));
            return;
          }

          if (code === 0) {
            resolve({
              stdout,
              stderr,
              exitCode: code || 0,
              durationMs: Date.now() - startTime
            });
          } else {
            const stdoutPreview = stdout
              ? `\nstdout (last 500 chars): ${stdout.slice(-500)}`
              : '';
            reject(
              new Error(
                `Pi Agent CLI exited with code ${code}. stderr: ${stderr || '(empty)'}${stdoutPreview}`
              )
            );
          }
        });

        child.on('error', (err) => {
          clearTimeout(timer);
          if (options.abortController) {
            options.abortController.off('abort', abortHandler);
          }
          reject(
            new Error(
              `Failed to spawn pi CLI: ${err.message}. ` +
                'Ensure Pi Agent is installed (npm install -g @mariozechner/pi-coding-agent)'
            )
          );
        });
      } catch (err) {
        clearTimeout(timer);
        if (options.abortController) {
          options.abortController.off('abort', abortHandler);
        }
        reject(err);
      }
    });
  }

  private extractTextFromStreamOutput(stdout: string): string {
    const lines = stdout.trim().split('\n');
    let accumulatedText = '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        const delta = this.extractTextDelta(parsed);
        if (delta) {
          accumulatedText += delta;
        }
      } catch {
        // Ignore non-JSON lines
      }
    }

    return accumulatedText || stdout.trim();
  }

  private extractTextDelta(event: any): string | undefined {
    // Pi Agent --mode json emits message_update events with text deltas
    if (
      event?.type === 'message_update' &&
      event?.assistantMessageEvent?.type === 'text_delta'
    ) {
      return event.assistantMessageEvent.delta;
    }

    return undefined;
  }

  private extractOutputsFromText(
    textOutput: string,
    outputKeys: string[]
  ): Record<string, unknown> | undefined {
    if (outputKeys.length === 0) return undefined;

    const jsonBlockMatch = textOutput.match(/```json\n([\s\S]*?)\n```/);
    if (jsonBlockMatch) {
      try {
        const parsed = JSON.parse(jsonBlockMatch[1]);
        const extracted: Record<string, unknown> = {};
        let foundAny = false;

        for (const key of outputKeys) {
          if (key in parsed) {
            extracted[key] = parsed[key];
            foundAny = true;
          }
        }

        if (foundAny) return extracted;
      } catch {
        // fall through
      }
    }

    const extracted: Record<string, unknown> = {};

    for (const key of outputKeys) {
      const escapedKey = this.escapeRegex(key);
      const regex = new RegExp(`${escapedKey}:\\s*(.+)`, 'i');
      const match = textOutput.match(regex);
      if (match) {
        extracted[key] = match[1].trim();
      }
    }

    return Object.keys(extracted).length > 0 ? extracted : undefined;
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private extractToolActivities(
    event: any,
    emittedToolCallIds: Set<string>
  ): string[] {
    const activities: string[] = [];

    // Pi Agent tool_execution_start events
    if (event?.type === 'tool_execution_start') {
      const toolName = event.toolName;
      const args = event.args;
      const id = event.id ?? event.toolCallId;

      if (typeof toolName === 'string' && toolName) {
        if (typeof id === 'string' && emittedToolCallIds.has(id)) {
          return activities;
        }
        if (typeof id === 'string') emittedToolCallIds.add(id);
        const activity = this.formatToolActivity(toolName, args);
        if (activity) activities.push(activity);
      }
      return activities;
    }

    // Fallback: scan for generic tool call structures (same as Gemini runtime)
    const addActivity = (name: unknown, input: unknown, id?: unknown) => {
      if (typeof name !== 'string' || !name) return;
      if (typeof id === 'string' && emittedToolCallIds.has(id)) return;
      if (typeof id === 'string') emittedToolCallIds.add(id);
      const activity = this.formatToolActivity(name, input);
      if (activity) activities.push(activity);
    };

    const toolTypes = new Set(['tool_use', 'tool_call', 'function_call', 'command_execution']);

    const addFromObject = (obj: any) => {
      if (!obj || typeof obj !== 'object') return;
      const name = obj.name ?? obj.tool_name ?? obj?.function?.name;
      const input = obj.input ?? obj.arguments ?? obj.args ?? obj.parameters ?? obj.params ?? obj?.function?.arguments;
      const id = obj.id ?? obj.tool_call_id ?? obj.call_id;
      if (name) {
        addActivity(name, input, id);
      }
    };

    const scan = (node: any, depth: number) => {
      if (!node || depth > 6) return;
      if (Array.isArray(node)) {
        for (const entry of node) {
          scan(entry, depth + 1);
        }
        return;
      }
      if (typeof node !== 'object') return;

      if (node.type === 'command_execution') {
        const input = { command: node.command };
        addActivity('command_execution', input, node.id);
      }

      if (node.type && toolTypes.has(node.type)) {
        addFromObject(node);
      }

      if (node.tool_call) {
        addFromObject(node.tool_call);
      }

      if (Array.isArray(node.tool_calls)) {
        for (const call of node.tool_calls) {
          addFromObject(call);
        }
      }

      if (
        node.name &&
        (node.arguments !== undefined || node.input !== undefined) &&
        (String(node.type || '').includes('tool') || String(node.event || '').includes('tool'))
      ) {
        addActivity(node.name, node.arguments ?? node.input, node.id ?? node.tool_call_id);
      }

      for (const value of Object.values(node)) {
        scan(value, depth + 1);
      }
    };

    scan(event, 0);

    return activities;
  }

  private formatToolActivity(toolName: string, input: unknown): string {
    const icons: Record<string, string> = {
      read: '\u{1F4D6}',
      read_file: '\u{1F4D6}',
      write: '\u{1F4DD}',
      write_file: '\u{1F4DD}',
      edit: '\u270F\uFE0F',
      edit_file: '\u270F\uFE0F',
      apply_patch: '\u270F\uFE0F',
      patch: '\u270F\uFE0F',
      shell: '\u{1F527}',
      bash: '\u{1F527}',
      exec: '\u{1F527}',
      command_execution: '\u{1F527}',
      list: '\u{1F4C2}',
      ls: '\u{1F4C2}',
      list_files: '\u{1F4C2}',
      glob: '\u{1F50D}',
      grep: '\u{1F50E}',
      search: '\u{1F50E}',
      ripgrep: '\u{1F50E}',
      find: '\u{1F50D}',
      web_search: '\u{1F50D}',
      websearch: '\u{1F50D}',
      web_fetch: '\u{1F310}',
      fetch: '\u{1F310}',
      http: '\u{1F310}'
    };

    const normalizedName = this.normalizeToolName(toolName);
    const icon = icons[normalizedName] || '\u26A1';
    const normalizedInput = this.normalizeToolInput(input);

    const filePath = this.getFirstString(normalizedInput, [
      'file_path',
      'path',
      'file',
      'filename',
      'target'
    ]);
    const command = this.getFirstString(normalizedInput, [
      'command',
      'cmd',
      'shell',
      'script',
      'bash'
    ]);
    const pattern = this.getFirstString(normalizedInput, [
      'pattern',
      'query',
      'search',
      'glob',
      'regex'
    ]);
    const url = this.getFirstString(normalizedInput, ['url', 'uri', 'href']);

    switch (normalizedName) {
      case 'read':
      case 'read_file':
        return `${icon} Reading ${this.truncatePath(filePath)}`;
      case 'write':
      case 'write_file':
        return `${icon} Writing ${this.truncatePath(filePath)}`;
      case 'edit':
      case 'edit_file':
      case 'apply_patch':
      case 'patch':
        return `${icon} Editing ${this.truncatePath(filePath) || 'patch'}`;
      case 'shell':
      case 'bash':
      case 'exec':
      case 'command_execution': {
        const rawCmd = this.simplifyCommand(
          command || this.getFirstString(normalizedInput, ['_raw']) || ''
        );
        const shortCmd = rawCmd.length > 50 ? rawCmd.substring(0, 47) + '...' : rawCmd;
        return `${icon} Running: ${shortCmd}`;
      }
      case 'glob':
      case 'find':
        return `${icon} Finding ${pattern || filePath || ''}`;
      case 'grep':
      case 'search':
      case 'ripgrep':
        return `${icon} Searching for "${pattern}"`;
      case 'list':
      case 'ls':
      case 'list_files':
        return `${icon} Listing ${this.truncatePath(filePath) || '.'}`;
      case 'web_search':
      case 'websearch':
        return `${icon} Searching: ${pattern}`;
      case 'web_fetch':
      case 'fetch':
      case 'http':
        return `${icon} Fetching ${this.truncateUrl(url)}`;
      default:
        return `${icon} ${toolName}`;
    }
  }

  private normalizeToolName(toolName: string): string {
    const normalized = toolName.toLowerCase();
    const parts = normalized.split(/[./:]/);
    return parts[parts.length - 1] || normalized;
  }

  private normalizeToolInput(input: unknown): Record<string, unknown> {
    if (!input) return {};
    if (typeof input === 'object' && !Array.isArray(input)) {
      return input as Record<string, unknown>;
    }
    if (typeof input === 'string') {
      const trimmed = input.trim();
      if (
        (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))
      ) {
        try {
          const parsed = JSON.parse(trimmed);
          if (typeof parsed === 'object' && parsed !== null) {
            return parsed as Record<string, unknown>;
          }
        } catch {
          // fall through to raw
        }
      }
      return { _raw: input };
    }
    return { _raw: String(input) };
  }

  private getFirstString(
    input: Record<string, unknown>,
    keys: string[]
  ): string | undefined {
    for (const key of keys) {
      const value = input[key];
      if (typeof value === 'string' && value.trim()) {
        return value;
      }
    }
    return undefined;
  }

  private truncatePath(filePath: string | undefined): string {
    if (!filePath) return '';
    const parts = filePath.split('/');
    if (parts.length <= 2) return filePath;
    return '.../' + parts.slice(-2).join('/');
  }

  private truncateUrl(url: string | undefined): string {
    if (!url) return '';
    try {
      const parsed = new URL(url);
      return parsed.hostname + (parsed.pathname.length > 20 ? parsed.pathname.substring(0, 17) + '...' : parsed.pathname);
    } catch {
      return url.substring(0, 40);
    }
  }

  private simplifyCommand(command: string): string {
    const trimmed = command.trim();
    const zshMatch = trimmed.match(/\/bin\/zsh -lc '([\s\S]*)'/);
    if (zshMatch && zshMatch[1]) return zshMatch[1];
    const bashMatch = trimmed.match(/\/bin\/bash -lc '([\s\S]*)'/);
    if (bashMatch && bashMatch[1]) return bashMatch[1];
    return trimmed;
  }
}
