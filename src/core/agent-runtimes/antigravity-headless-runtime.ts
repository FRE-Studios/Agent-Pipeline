// src/core/agent-runtimes/antigravity-headless-runtime.ts

import { spawn, ChildProcess } from 'child_process';
import {
  AgentRuntime,
  AgentExecutionRequest,
  AgentExecutionResult,
  AgentRuntimeCapabilities,
  TokenUsage,
  ValidationResult
} from '../types/agent-runtime.js';
import { PipelineAbortController, PipelineAbortError } from '../abort-controller.js';

/** Prompts are passed via argv; warn well before macOS ARG_MAX (~1MB). */
const PROMPT_SIZE_WARNING_BYTES = 500_000;

const DEFAULT_TIMEOUT_MS = 120000;

interface AntigravityUsage {
  input_tokens?: number;
  output_tokens?: number;
  thinking_tokens?: number;
  cache_read_tokens?: number;
  total_tokens?: number;
}

interface AntigravityResult {
  status?: string;
  response?: string;
  error?: string;
  num_turns?: number;
  usage?: AntigravityUsage;
}

/**
 * Antigravity Headless Runtime Implementation
 *
 * Executes agents via the `agy` CLI in non-interactive mode using `-p`.
 * The prompt must be the `-p` flag value — `agy` ignores stdin in print mode.
 * Parses the `stream-json` NDJSON feed (`init`, `step_update`, `result` events)
 * for final text, token usage, and live tool activity.
 */
export class AntigravityHeadlessRuntime implements AgentRuntime {
  readonly type = 'antigravity-headless';
  readonly name = 'Antigravity Headless Mode';

  async execute(
    request: AgentExecutionRequest,
    abortController?: PipelineAbortController
  ): Promise<AgentExecutionResult> {
    if (abortController?.aborted) {
      throw new PipelineAbortError('Pipeline aborted before agent execution started');
    }

    const { options } = request;

    const prompt = this.buildPrompt(request);
    this.warnOnLargePrompt(prompt, options.onOutputUpdate);

    const args = this.buildCliArgs(request, prompt);

    const cliResult = await this.executeAntigravityCLI(args, {
      timeout: options.timeout ? options.timeout * 1000 : DEFAULT_TIMEOUT_MS,
      onOutputUpdate: options.onOutputUpdate,
      cwd: this.resolveCwd(request),
      abortController
    });

    const result = this.parseResultEvent(cliResult.stdout);

    if (!result) {
      throw new Error(
        'Antigravity CLI did not emit a result event. ' +
          this.describeStreams(cliResult.stdout, cliResult.stderr)
      );
    }

    if (result.status && result.status !== 'SUCCESS') {
      throw new Error(
        `Antigravity CLI reported status "${result.status}"` +
          `${result.error ? `: ${result.error}` : ''}. ` +
          this.describeStreams(cliResult.stdout, cliResult.stderr)
      );
    }

    const textOutput = (result.response || '').trim();

    // `agy` exits 0 with an empty response when a tool is auto-denied, since
    // headless mode cannot prompt for permission. Fail loudly so retries engage.
    if (!textOutput) {
      throw new Error(
        'Antigravity CLI produced no response text. This usually means a tool was ' +
          'auto-denied because headless mode cannot prompt for permission — add an ' +
          'allow-rule under permissions.allow in the `agy` settings.json, or use ' +
          'permissionMode: bypassPermissions. ' +
          this.describeStreams(cliResult.stdout, cliResult.stderr)
      );
    }

    const extractedData = this.extractOutputsFromText(
      textOutput,
      options.outputKeys || []
    );

    return {
      textOutput,
      extractedData,
      tokenUsage: this.mapTokenUsage(result.usage),
      numTurns: typeof result.num_turns === 'number' ? result.num_turns : undefined,
      metadata: {
        runtime: this.type,
        durationMs: cliResult.durationMs
      }
    };
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
    try {
      await this.executeAntigravityCLI(['--version'], { timeout: 5000 });
      return {
        valid: true,
        errors: [],
        warnings: []
      };
    } catch (err) {
      const error = err as Error;
      return {
        valid: false,
        errors: [`Antigravity CLI not found or not working: ${error.message}`],
        warnings: [
          'Ensure the Antigravity CLI (`agy`) is installed and on PATH',
          'Verify with: agy --version'
        ]
      };
    }
  }

  private resolveCwd(request: AgentExecutionRequest): string {
    const cwd = request.options.runtimeOptions?.cwd;
    return typeof cwd === 'string' && cwd ? cwd : process.cwd();
  }

  private buildPrompt(request: AgentExecutionRequest): string {
    const { systemPrompt, userPrompt } = request;
    const prompt = systemPrompt?.trim()
      ? `${systemPrompt.trim()}\n\n${userPrompt}`
      : userPrompt;

    return `${this.buildWorkspacePreamble(this.resolveCwd(request))}\n\n${prompt}`;
  }

  /**
   * `agy` registers the process cwd as its workspace, but the agent still
   * defaults to its own scratch directory unless the prompt names the root
   * (verified against agy v1.1.10). Without this the stage reports success
   * while writing outside the repo, leaving nothing to commit.
   */
  private buildWorkspacePreamble(cwd: string): string {
    return [
      `Your working directory is ${cwd}.`,
      'Treat it as the root for every file operation and use absolute paths under it.',
      'Do not read from or write to any scratch directory outside it.'
    ].join(' ');
  }

  private warnOnLargePrompt(
    prompt: string,
    onOutputUpdate?: (output: string) => void
  ): void {
    const bytes = Buffer.byteLength(prompt, 'utf8');
    if (bytes <= PROMPT_SIZE_WARNING_BYTES) return;
    onOutputUpdate?.(
      `⚠️ Prompt is ${Math.round(bytes / 1024)}KB — ` +
        'close to the OS argument-size limit for `agy -p`'
    );
  }

  buildCliArgs(request: AgentExecutionRequest, prompt: string): string[] {
    const { options } = request;
    const args: string[] = [];

    const runtimeOpts = options.runtimeOptions || {};

    // NDJSON event stream: init / step_update / result
    args.push('--output-format', 'stream-json');

    // Permission modes ('default' adds no flags and leaves `agy` in request-review,
    // which cannot prompt headlessly — acceptEdits is the practical minimum)
    switch (options.permissionMode) {
      case 'acceptEdits':
        args.push('--mode', 'accept-edits');
        break;
      case 'bypassPermissions':
        args.push('--dangerously-skip-permissions');
        break;
      case 'plan':
        args.push('--mode', 'plan');
        break;
      case 'default':
      default:
        break;
    }

    // Model selection
    if (options.model) {
      args.push('--model', String(options.model));
    }

    // Keep `agy`'s internal print wait (default 5m) from undercutting the stage timeout
    const timeoutSeconds = options.timeout || DEFAULT_TIMEOUT_MS / 1000;
    args.push('--print-timeout', `${timeoutSeconds}s`);

    // Reasoning effort: low | medium | high
    if (typeof runtimeOpts.effort === 'string') {
      args.push('--effort', runtimeOpts.effort);
    }

    // Named `agy` agent for the session
    if (typeof runtimeOpts.agent === 'string') {
      args.push('--agent', runtimeOpts.agent);
    }

    // Terminal-restricted sandbox (boolean flag)
    if (runtimeOpts.sandbox === true) {
      args.push('--sandbox');
    }

    // Additional workspace directories (repeatable)
    if (Array.isArray(runtimeOpts.addDirs)) {
      for (const dir of runtimeOpts.addDirs) {
        if (typeof dir === 'string') {
          args.push('--add-dir', dir);
        }
      }
    }

    // Structured output schema (JSON string or path to a schema file)
    if (typeof runtimeOpts.jsonSchema === 'string') {
      args.push('--json-schema', runtimeOpts.jsonSchema);
    }

    // Extra args passthrough (string[])
    if (Array.isArray(runtimeOpts.args)) {
      for (const value of runtimeOpts.args) {
        if (typeof value === 'string') {
          args.push(value);
        }
      }
    }

    // Prompt must be the flag value — `agy` ignores stdin in print mode
    args.push('-p', prompt);

    return args;
  }

  private async executeAntigravityCLI(
    args: string[],
    options: {
      timeout?: number;
      onOutputUpdate?: (output: string) => void;
      cwd?: string;
      abortController?: PipelineAbortController;
    }
  ): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
    durationMs?: number;
  }> {
    return new Promise((resolve, reject) => {
      const timeout = options.timeout || DEFAULT_TIMEOUT_MS;
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let aborted = false;
      let child: ChildProcess | null = null;
      const startTime = Date.now();
      let jsonBuffer = '';
      const emittedSteps = new Set<string>();

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
        child = spawn('agy', args, {
          stdio: ['ignore', 'pipe', 'pipe'],
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
                const activities = this.extractToolActivities(parsed, emittedSteps);
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
            reject(
              new Error(
                `Antigravity CLI execution timed out after ${timeout}ms. Process was terminated.`
              )
            );
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
            // A print-timeout exits non-zero but still emits a result event
            // carrying the reason — surface it instead of a bare exit code.
            const failure = this.parseResultEvent(stdout)?.error;
            reject(
              new Error(
                `Antigravity CLI exited with code ${code}` +
                  `${failure ? `: ${failure}` : ''}. ` +
                  this.describeStreams(stdout, stderr)
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
              `Failed to spawn agy CLI: ${err.message}. ` +
                'Ensure the Antigravity CLI (`agy`) is installed and on PATH'
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

  private describeStreams(stdout: string, stderr: string): string {
    const stderrPreview = stderr.trim()
      ? `stderr: ${stderr.trim().slice(-500)}`
      : 'stderr: (empty)';
    const stdoutPreview = stdout.trim()
      ? `\nstdout (last 500 chars): ${stdout.trim().slice(-500)}`
      : '';
    return `${stderrPreview}${stdoutPreview}`;
  }

  private parseResultEvent(stdout: string): AntigravityResult | undefined {
    const lines = stdout.trim().split('\n');

    // The result event is the final line of a healthy run; scan backwards
    for (let i = lines.length - 1; i >= 0; i--) {
      const trimmed = lines[i].trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed?.event === 'result' && parsed.result) {
          return parsed.result as AntigravityResult;
        }
      } catch {
        // Ignore non-JSON lines
      }
    }

    return undefined;
  }

  private mapTokenUsage(usage: AntigravityUsage | undefined): TokenUsage | undefined {
    if (!usage) return undefined;

    const inputTokens = usage.input_tokens ?? 0;
    const outputTokens = usage.output_tokens ?? 0;

    return {
      inputTokens,
      outputTokens,
      cacheReadTokens: usage.cache_read_tokens,
      thinkingTokens: usage.thinking_tokens,
      totalTokens: usage.total_tokens ?? inputTokens + outputTokens
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

  /**
   * Tool activity lives on `step_update` events with `step_type: 'tool'`.
   * Each tool step emits ACTIVE first, then DONE or ERROR — announce only the
   * ACTIVE edge, keyed by conversation and step index.
   */
  private extractToolActivities(event: any, emittedSteps: Set<string>): string[] {
    if (event?.event !== 'step_update') return [];

    const step = event.step_update;
    if (!step || step.step_type !== 'tool') return [];
    if (step.state && step.state !== 'ACTIVE') return [];

    const toolName = step.tool_name ?? step.tool_info?.name;
    if (typeof toolName !== 'string' || !toolName) return [];

    const key = `${step.conversation_id ?? ''}:${step.step_index}:${toolName}`;
    if (emittedSteps.has(key)) return [];
    emittedSteps.add(key);

    return [this.formatToolActivity(toolName, step.tool_info?.parameters)];
  }

  private formatToolActivity(toolName: string, parameters: unknown): string {
    const icons: Record<string, string> = {
      view_file: '\u{1F4D6}',
      sed_file: '\u{1F4D6}',
      notebook_edit: '✏️',
      write_to_file: '\u{1F4DD}',
      replace_file_content: '✏️',
      multi_replace_file_content: '✏️',
      run_command: '\u{1F527}',
      command_status: '\u{1F527}',
      send_command_input: '\u{1F527}',
      list_dir: '\u{1F4C2}',
      find_by_name: '\u{1F50D}',
      grep_search: '\u{1F50E}',
      search_web: '\u{1F50D}',
      read_url_content: '\u{1F310}'
    };

    const name = toolName.toLowerCase();
    const icon = icons[name] || '⚡';
    const input = this.normalizeToolInput(parameters);

    const filePath = this.getFirstString(input, [
      'TargetFile',
      'AbsolutePath',
      'FilePath',
      'NotebookPath',
      'File',
      'Path',
      'file_path',
      'path'
    ]);
    const dirPath = this.getFirstString(input, [
      'DirectoryPath',
      'SearchPath',
      'SearchDirectory',
      'Path',
      'directory'
    ]);
    const command = this.getFirstString(input, ['CommandLine', 'Command', 'command']);
    const pattern = this.getFirstString(input, [
      'Query',
      'SearchTerm',
      'Pattern',
      'search_term',
      'query',
      'pattern'
    ]);
    const url = this.getFirstString(input, ['Url', 'URL', 'url']);

    switch (name) {
      case 'view_file':
      case 'sed_file':
        return `${icon} Reading ${this.truncatePath(filePath)}`;
      case 'write_to_file':
        return `${icon} Writing ${this.truncatePath(filePath)}`;
      case 'replace_file_content':
      case 'multi_replace_file_content':
      case 'notebook_edit':
        return `${icon} Editing ${this.truncatePath(filePath) || 'file'}`;
      case 'run_command':
      case 'command_status':
      case 'send_command_input': {
        const raw = command || '';
        const shortCmd = raw.length > 50 ? raw.substring(0, 47) + '...' : raw;
        return `${icon} Running: ${shortCmd}`;
      }
      case 'list_dir':
        return `${icon} Listing ${this.truncatePath(dirPath) || '.'}`;
      case 'find_by_name':
        return `${icon} Finding ${pattern || this.truncatePath(dirPath)}`;
      case 'grep_search':
        return `${icon} Searching for "${pattern}"`;
      case 'search_web':
        return `${icon} Searching: ${pattern}`;
      case 'read_url_content':
        return `${icon} Fetching ${this.truncateUrl(url)}`;
      default:
        return `${icon} ${toolName}`;
    }
  }

  private normalizeToolInput(input: unknown): Record<string, unknown> {
    if (!input) return {};
    if (typeof input === 'object' && !Array.isArray(input)) {
      return input as Record<string, unknown>;
    }
    if (typeof input === 'string') {
      const trimmed = input.trim();
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (typeof parsed === 'object' && parsed !== null) {
            return parsed as Record<string, unknown>;
          }
        } catch {
          // fall through to raw
        }
      }
    }
    return {};
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
      return (
        parsed.hostname +
        (parsed.pathname.length > 20
          ? parsed.pathname.substring(0, 17) + '...'
          : parsed.pathname)
      );
    } catch {
      return url.substring(0, 40);
    }
  }
}
