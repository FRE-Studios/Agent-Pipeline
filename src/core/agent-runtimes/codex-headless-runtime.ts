// src/core/agent-runtimes/codex-headless-runtime.ts

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
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
 * Codex Headless Runtime Implementation
 *
 * Executes agents via the `codex exec` CLI in non-interactive mode.
 * Supports local Codex CLI auth as well as API key auth via CLI config.
 */
export class CodexHeadlessRuntime implements AgentRuntime {
  readonly type = 'codex-headless';
  readonly name = 'Codex Headless Mode';

  async execute(
    request: AgentExecutionRequest,
    abortController?: PipelineAbortController
  ): Promise<AgentExecutionResult> {
    if (abortController?.aborted) {
      throw new PipelineAbortError('Pipeline aborted before agent execution started');
    }

    const { options } = request;

    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-'));
    const outputPath = path.join(outputDir, 'output.txt');

    const prompt = this.buildPrompt(request);
    const args = this.buildCliArgs(request, outputPath);

    const cliResult = await this.executeCodexCLI(args, {
      timeout: options.timeout ? options.timeout * 1000 : 120000,
      onOutputUpdate: options.onOutputUpdate,
      cwd: options.runtimeOptions?.cwd as string | undefined,
      abortController,
      stdinInput: prompt
    });

    const textOutput = await this.readOutputFile(outputPath, cliResult.stdout);

    let extractedData = this.extractOutputsFromText(
      textOutput,
      options.outputKeys || []
    );

    const tokenUsage = cliResult.tokenUsage
      ? this.normalizeTokenUsage(cliResult.tokenUsage)
      : undefined;

    return {
      textOutput,
      extractedData,
      tokenUsage,
      numTurns: cliResult.numTurns,
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
      await this.executeCodexCLI(['--version'], { timeout: 5000 });
      return {
        valid: true,
        errors: [],
        warnings: []
      };
    } catch (err) {
      const error = err as Error;
      return {
        valid: false,
        errors: [`Codex CLI not found or not working: ${error.message}`],
        warnings: [
          'Install Codex CLI with: npm install -g @openai/codex',
          'Authenticate with: codex'
        ]
      };
    }
  }

  private buildPrompt(request: AgentExecutionRequest): string {
    const { systemPrompt, userPrompt } = request;
    return systemPrompt?.trim()
      ? `${systemPrompt.trim()}\n\n${userPrompt}`
      : userPrompt;
  }

  private buildCliArgs(request: AgentExecutionRequest, outputPath: string): string[] {
    const { options } = request;
    const args: string[] = ['exec'];

    const runtimeOpts = options.runtimeOptions || {};

    // Output handling
    args.push('--output-last-message', outputPath);
    args.push('--color', 'never');
    args.push('--json');

    // Working directory (Codex-specific)
    if (runtimeOpts.cwd && typeof runtimeOpts.cwd === 'string') {
      args.push('--cd', runtimeOpts.cwd);
    }

    // Permission modes (unless explicit runtime safety flags provided)
    const hasExplicitSafety = Boolean(
      runtimeOpts.fullAuto ||
      runtimeOpts.sandbox ||
      runtimeOpts.dangerouslyBypassApprovalsAndSandbox ||
      runtimeOpts.yolo
    );

    if (!hasExplicitSafety && options.permissionMode) {
      switch (options.permissionMode) {
        case 'acceptEdits':
          args.push('--full-auto');
          break;
        case 'bypassPermissions':
          args.push('--dangerously-bypass-approvals-and-sandbox');
          break;
        case 'plan':
          args.push('--sandbox', 'read-only');
          break;
        case 'default':
        default:
          break;
      }
    }

    // Explicit safety overrides
    if (runtimeOpts.fullAuto === true) {
      args.push('--full-auto');
    }
    if (runtimeOpts.sandbox && typeof runtimeOpts.sandbox === 'string') {
      args.push('--sandbox', runtimeOpts.sandbox);
    }
    if (runtimeOpts.dangerouslyBypassApprovalsAndSandbox === true || runtimeOpts.yolo === true) {
      args.push('--dangerously-bypass-approvals-and-sandbox');
    }

    // Model selection
    if (options.model) {
      args.push('--model', String(options.model));
    }

    // Output schema (optional)
    const outputSchema = runtimeOpts.outputSchemaPath || runtimeOpts.outputSchema;
    if (outputSchema && typeof outputSchema === 'string') {
      args.push('--output-schema', outputSchema);
    }

    // Profile selection
    if (runtimeOpts.profile && typeof runtimeOpts.profile === 'string') {
      args.push('--profile', runtimeOpts.profile);
    }

    // Config overrides
    if (runtimeOpts.config) {
      const configs = Array.isArray(runtimeOpts.config)
        ? runtimeOpts.config
        : [runtimeOpts.config];
      for (const config of configs) {
        if (typeof config === 'string') {
          args.push('--config', config);
        }
      }
    }

    // Misc flags
    if (runtimeOpts.skipGitRepoCheck === true) {
      args.push('--skip-git-repo-check');
    }
    if (runtimeOpts.oss === true) {
      args.push('--oss');
    }

    // Extra args passthrough (string[])
    if (Array.isArray(runtimeOpts.args)) {
      for (const value of runtimeOpts.args) {
        if (typeof value === 'string') {
          args.push(value);
        }
      }
    }

    // Prompt: provide via stdin to avoid CLI arg parsing issues
    args.push('-');

    return args;
  }

  private async executeCodexCLI(
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
    tokenUsage?: {
      input_tokens: number;
      output_tokens: number;
    };
    numTurns?: number;
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
      let jsonErrBuffer = '';
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
        child = spawn('codex', args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: false,
          cwd: options.cwd || process.cwd()
        });

        if (options.abortController) {
          options.abortController.registerProcess(child);
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
                  options.onOutputUpdate(activity);
                }
              } catch {
                // Ignore non-JSON lines
              }
            }
          }
        });

        child.stderr?.on('data', (data: Buffer) => {
          const chunk = data.toString();
          stderr += chunk;
          if (options.onOutputUpdate) {
            jsonErrBuffer += chunk;
            const lines = jsonErrBuffer.split('\n');
            jsonErrBuffer = lines.pop() ?? '';
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              try {
                const parsed = JSON.parse(trimmed);
                const activities = this.extractToolActivities(parsed, emittedToolCallIds);
                for (const activity of activities) {
                  options.onOutputUpdate(activity);
                }
              } catch {
                // Ignore non-JSON stderr
              }
            }
          }
        });

        if (options.stdinInput && child.stdin) {
          child.stdin.write(options.stdinInput);
          child.stdin.end();
        }

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
            reject(new Error(`Codex CLI execution timed out after ${timeout}ms. Process was terminated.`));
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
                `Codex CLI exited with code ${code}. stderr: ${stderr || '(empty)'}${stdoutPreview}`
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
              `Failed to spawn codex CLI: ${err.message}. ` +
                'Ensure Codex CLI is installed (npm install -g @openai/codex)'
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

  private async readOutputFile(outputPath: string, fallback: string): Promise<string> {
    try {
      const content = await fs.readFile(outputPath, 'utf-8');
      return content.trim() || fallback.trim();
    } catch {
      const parsed = this.extractTextFromJsonOutput(fallback);
      return parsed || fallback.trim();
    }
  }

  private normalizeTokenUsage(cliUsage: {
    input_tokens: number;
    output_tokens: number;
  }): TokenUsage {
    return {
      inputTokens: cliUsage.input_tokens,
      outputTokens: cliUsage.output_tokens,
      totalTokens: cliUsage.input_tokens + cliUsage.output_tokens
    };
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
      read: '📖',
      read_file: '📖',
      write: '📝',
      write_file: '📝',
      edit: '✏️',
      edit_file: '✏️',
      apply_patch: '✏️',
      patch: '✏️',
      shell: '🔧',
      bash: '🔧',
      exec: '🔧',
      command_execution: '🔧',
      list: '📂',
      ls: '📂',
      list_files: '📂',
      glob: '🔍',
      grep: '🔎',
      search: '🔎',
      ripgrep: '🔎',
      web_search: '🔍',
      websearch: '🔍',
      web_fetch: '🌐',
      fetch: '🌐',
      http: '🌐'
    };

    const normalizedName = this.normalizeToolName(toolName);
    const icon = icons[normalizedName] || '⚡';
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
        return `${icon} Finding ${pattern}`;
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

  private extractTextFromJsonOutput(stdout: string): string | undefined {
    const lines = stdout.trim().split('\n');
    let lastText: string | undefined;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        const text = this.extractTextFromEvent(parsed);
        if (text) {
          lastText = text;
        }
      } catch {
        // Ignore
      }
    }

    return lastText;
  }

  private extractTextFromEvent(event: any): string | undefined {
    if (typeof event?.result === 'string') return event.result;
    if (typeof event?.output === 'string') return event.output;
    if (typeof event?.text === 'string') return event.text;
    if (typeof event?.output_text === 'string') return event.output_text;

    const messageContent = event?.message?.content;
    if (Array.isArray(messageContent)) {
      const textBlocks = messageContent
        .map((block: any) => {
          if (typeof block?.text === 'string') return block.text;
          if (block?.type === 'output_text' && typeof block?.text === 'string') return block.text;
          if (block?.type === 'text' && typeof block?.text === 'string') return block.text;
          return '';
        })
        .filter(Boolean);
      if (textBlocks.length > 0) return textBlocks.join('');
    }

    const item = event?.item;
    if (item?.type === 'message' && Array.isArray(item?.content)) {
      const textBlocks = item.content
        .map((block: any) => (typeof block?.text === 'string' ? block.text : ''))
        .filter(Boolean);
      if (textBlocks.length > 0) return textBlocks.join('');
    }

    return undefined;
  }
}
