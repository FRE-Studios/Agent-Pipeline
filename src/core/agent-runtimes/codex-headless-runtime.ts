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
            options.onOutputUpdate(chunk);
          }
        });

        child.stderr?.on('data', (data: Buffer) => {
          stderr += data.toString();
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
      return fallback.trim();
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
}
