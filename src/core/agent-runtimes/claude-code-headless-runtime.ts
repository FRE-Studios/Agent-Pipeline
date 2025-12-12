// src/core/agent-runtimes/claude-code-headless-runtime.ts

import { spawn, ChildProcess } from 'child_process';
import {
  AgentRuntime,
  AgentExecutionRequest,
  AgentExecutionResult,
  AgentRuntimeCapabilities,
  ValidationResult,
  TokenUsage
} from '../types/agent-runtime.js';

/**
 * Claude Code Headless Runtime Implementation
 *
 * Executes agents via the `claude` CLI in headless mode, providing access to
 * the full Claude Code toolkit (Bash, Read, Write, Edit, Git, etc.) while
 * maintaining the AgentRuntime interface.
 *
 * Unlike the SDK runtime which is library-based, this runtime spawns a subprocess
 * and communicates via JSON output. It supports session continuation with --resume
 * and uses the Claude Code subscription billing model instead of direct API billing.
 */
export class ClaudeCodeHeadlessRuntime implements AgentRuntime {
  readonly type = 'claude-code-headless';
  readonly name = 'Claude Code Headless Mode';

  /**
   * Execute an agent using the Claude CLI in headless mode
   *
   * @param request - Normalized execution request
   * @returns Normalized execution result with text, extracted data, and token usage
   */
  async execute(request: AgentExecutionRequest): Promise<AgentExecutionResult> {
    const { options } = request;

    // Build CLI arguments from request
    const args = this.buildCliArgs(request);

    // Execute CLI with timeout and streaming
    const cliResult = await this.executeClaudeCLI(args, {
      timeout: options.timeout ? options.timeout * 1000 : 120000,
      onOutputUpdate: options.onOutputUpdate
    });

    // Parse JSON output
    const parsedOutput = this.parseJsonOutput(cliResult.stdout);

    // Extract structured data if requested
    let extractedData = parsedOutput.extractedData;

    // If we have extracted data but outputKeys specified, filter to only requested keys
    if (extractedData && options.outputKeys && options.outputKeys.length > 0) {
      const filtered: Record<string, unknown> = {};
      let foundAny = false;

      for (const key of options.outputKeys) {
        if (key in extractedData) {
          filtered[key] = extractedData[key];
          foundAny = true;
        }
      }

      extractedData = foundAny ? filtered : undefined;
    }

    // If no extracted data yet and outputKeys specified, try text extraction
    if (!extractedData && options.outputKeys && options.outputKeys.length > 0) {
      extractedData = this.extractOutputsFromText(
        parsedOutput.textOutput,
        options.outputKeys
      );
    }

    // Normalize token usage if available
    const tokenUsage = parsedOutput.tokenUsage
      ? this.normalizeTokenUsage(parsedOutput.tokenUsage)
      : undefined;

    return {
      textOutput: parsedOutput.textOutput,
      extractedData,
      tokenUsage,
      numTurns: parsedOutput.numTurns,
      metadata: {
        runtime: this.type,
        sessionId: parsedOutput.sessionId,
        costUsd: parsedOutput.costUsd,
        durationMs: parsedOutput.durationMs
      }
    };
  }

  /**
   * Get capabilities of the Claude Code Headless runtime
   *
   * @returns Capability information
   */
  getCapabilities(): AgentRuntimeCapabilities {
    return {
      supportsStreaming: true,
      supportsTokenTracking: true,
      supportsMCP: false, // Headless uses built-in tools, not MCP
      supportsContextReduction: false, // Headless uses --resume for session continuation
      availableModels: ['haiku', 'sonnet', 'opus'],
      permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan']
    };
  }

  /**
   * Validate that the Claude CLI is available and properly configured
   *
   * @returns Validation result with errors/warnings
   */
  async validate(): Promise<ValidationResult> {
    try {
      // Check if claude CLI is available
      await this.executeClaudeCLI(['--version'], {
        timeout: 5000
      });

      return {
        valid: true,
        errors: [],
        warnings: []
      };
    } catch (err) {
      const error = err as Error;
      return {
        valid: false,
        errors: [`Claude CLI not found or not working: ${error.message}`],
        warnings: [
          'Install Claude CLI with: npm install -g @anthropic-ai/claude-code',
          'Authenticate with: claude auth login'
        ]
      };
    }
  }

  /**
   * Default tools to disallow in headless mode.
   * WebSearch is disabled by default as it can slow down pipelines and may not be needed.
   * Users can override via runtimeOptions.allowedTools or runtimeOptions.disallowedTools.
   */
  private static readonly DEFAULT_DISALLOWED_TOOLS = ['WebSearch'];

  /**
   * Build CLI arguments from execution request
   *
   * @param request - Execution request
   * @returns Array of CLI arguments
   */
  private buildCliArgs(request: AgentExecutionRequest): string[] {
    const { systemPrompt, userPrompt, options } = request;
    const args: string[] = [];

    // Core command arguments
    // -p/--print takes the prompt as its argument value
    args.push('-p', userPrompt);
    args.push('--output-format', 'stream-json'); // Request streaming NDJSON for real-time tool activity
    args.push('--verbose'); // Required for stream-json with -p mode

    // Permission mode
    if (options.permissionMode) {
      args.push('--permission-mode', options.permissionMode);
    }

    // Model selection
    if (options.model) {
      args.push('--model', options.model);
    }

    // Max turns
    if (options.maxTurns) {
      args.push('--max-turns', options.maxTurns.toString());
    }

    // Max thinking tokens
    if (options.maxThinkingTokens) {
      args.push('--max-thinking-tokens', options.maxThinkingTokens.toString());
    }

    // System prompt (if provided)
    if (systemPrompt && systemPrompt.trim()) {
      args.push('--append-system-prompt', systemPrompt);
    }

    // Tool access control
    // If user provides explicit allowedTools, use that (whitelist takes precedence)
    // Otherwise, apply default disallowedTools (can be extended by user)
    const runtimeOpts = options.runtimeOptions || {};

    if (runtimeOpts.allowedTools) {
      // User provided explicit whitelist - use it directly
      const allowedTools = runtimeOpts.allowedTools;
      const tools = Array.isArray(allowedTools)
        ? allowedTools.join(',')
        : String(allowedTools);
      args.push('--allowedTools', tools);
    } else {
      // No whitelist - apply disallowed tools (default + user additions)
      const disallowed = new Set(ClaudeCodeHeadlessRuntime.DEFAULT_DISALLOWED_TOOLS);

      // Add user-specified disallowed tools
      if (runtimeOpts.disallowedTools) {
        const disallowedTools = runtimeOpts.disallowedTools;
        const userDisallowed = Array.isArray(disallowedTools)
          ? disallowedTools
          : String(disallowedTools).split(',').map((t: string) => t.trim());
        userDisallowed.forEach((tool: string) => disallowed.add(tool));
      }

      if (disallowed.size > 0) {
        args.push('--disallowedTools', Array.from(disallowed).join(','));
      }
    }

    // Runtime-specific options (excluding tool options we already handled)
    if (options.runtimeOptions) {
      for (const [key, value] of Object.entries(options.runtimeOptions)) {
        // Skip tool options - already handled above
        if (key === 'allowedTools' || key === 'disallowedTools') {
          continue;
        }

        if (typeof value === 'string') {
          args.push(`--${key}`, value);
        } else if (typeof value === 'boolean' && value) {
          args.push(`--${key}`);
        } else if (typeof value === 'number') {
          args.push(`--${key}`, value.toString());
        }
      }
    }

    return args;
  }

  /**
   * Execute the Claude CLI with given arguments
   *
   * @param args - CLI arguments
   * @param options - Execution options (timeout, streaming callback)
   * @returns Process output (stdout, stderr, exit code)
   */
  private async executeClaudeCLI(
    args: string[],
    options: { timeout?: number; onOutputUpdate?: (output: string) => void }
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const timeout = options.timeout || 120000;
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let child: ChildProcess | null = null;

      // Set up timeout
      const timer = setTimeout(() => {
        timedOut = true;
        if (child) {
          child.kill('SIGTERM');
          // Force kill after 5 seconds if still running
          setTimeout(() => {
            if (child && !child.killed) {
              child.kill('SIGKILL');
            }
          }, 5000);
        }
      }, timeout);

      try {
        // Spawn claude CLI
        child = spawn('claude', args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: false
        });

        // Collect stdout
        child.stdout?.on('data', (data: Buffer) => {
          const chunk = data.toString();
          stdout += chunk;

          // Call streaming callback if provided
          if (options.onOutputUpdate) {
            // Parse NDJSON streaming events to extract tool activity
            const lines = chunk.split('\n');
            for (const line of lines) {
              if (line.trim()) {
                try {
                  const parsed = JSON.parse(line);

                  // Parse assistant messages which contain tool_use blocks
                  if (parsed.type === 'assistant' && parsed.message?.content) {
                    for (const block of parsed.message.content) {
                      if (block.type === 'tool_use') {
                        const activity = this.formatToolActivity(block.name, block.input);
                        if (activity) {
                          options.onOutputUpdate(activity);
                        }
                      }
                    }
                  }
                } catch {
                  // Not JSON, ignore
                }
              }
            }
          }
        });

        // Collect stderr
        child.stderr?.on('data', (data: Buffer) => {
          stderr += data.toString();
        });

        // Handle process exit
        child.on('exit', (code) => {
          clearTimeout(timer);

          if (timedOut) {
            reject(
              new Error(
                `Claude CLI execution timed out after ${timeout}ms. Process was terminated.`
              )
            );
            return;
          }

          if (code === 0) {
            resolve({ stdout, stderr, exitCode: code || 0 });
          } else {
            reject(
              new Error(
                `Claude CLI exited with code ${code}. stderr: ${stderr || '(empty)'}`
              )
            );
          }
        });

        // Handle spawn errors
        child.on('error', (err) => {
          clearTimeout(timer);
          reject(
            new Error(
              `Failed to spawn claude CLI: ${err.message}. ` +
                'Ensure Claude CLI is installed (npm install -g @anthropic-ai/claude-code)'
            )
          );
        });
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  /**
   * Parse JSON output from Claude CLI
   *
   * @param stdout - Raw stdout from CLI
   * @returns Parsed output with text, extracted data, and metadata
   */
  private parseJsonOutput(stdout: string): {
    textOutput: string;
    extractedData?: Record<string, unknown>;
    tokenUsage?: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
      thinking_tokens?: number;
    };
    numTurns?: number;
    sessionId?: string;
    costUsd?: number;
    durationMs?: number;
  } {
    try {
      // stdout may contain multiple JSON objects (streaming + final result)
      // We need to find the final complete JSON result
      const lines = stdout.trim().split('\n');
      let finalJson: any = null;

      // Try to parse the last non-empty line as the final result
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (line) {
          try {
            const parsed = JSON.parse(line);
            // stream-json format: look for type='result' event
            // json format: look for 'result' or 'output' field directly
            if (parsed.type === 'result' || parsed.result !== undefined || parsed.output !== undefined) {
              finalJson = parsed;
              break;
            }
          } catch {
            // Not JSON or malformed, try previous line
            continue;
          }
        }
      }

      if (!finalJson) {
        // Fallback: try parsing the entire stdout
        finalJson = JSON.parse(stdout.trim());
      }

      // Extract text output (the main result)
      const textOutput = finalJson.result || finalJson.output || '';

      // Extract structured data if present (from JSON code blocks)
      // Note: This is NOT filtered by outputKeys - that happens in extractOutputsFromText
      let extractedData: Record<string, unknown> | undefined;
      const jsonBlockMatch = textOutput.match(/```json\n([\s\S]*?)\n```/);
      if (jsonBlockMatch) {
        try {
          extractedData = JSON.parse(jsonBlockMatch[1]);
        } catch {
          // JSON parsing failed, ignore
        }
      }

      return {
        textOutput,
        extractedData,
        tokenUsage: finalJson.usage,
        numTurns: finalJson.num_turns,
        sessionId: finalJson.session_id,
        costUsd: finalJson.total_cost_usd,
        durationMs: finalJson.duration_ms
      };
    } catch (err) {
      throw new Error(
        `Failed to parse JSON output from Claude CLI: ${(err as Error).message}. ` +
          `Output: ${stdout.substring(0, 200)}...`
      );
    }
  }

  /**
   * Normalize CLI token usage to standard TokenUsage format
   *
   * @param cliUsage - Token usage from CLI
   * @returns Normalized token usage
   */
  private normalizeTokenUsage(cliUsage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    thinking_tokens?: number;
  }): TokenUsage {
    return {
      inputTokens: cliUsage.input_tokens,
      outputTokens: cliUsage.output_tokens,
      cacheCreationTokens: cliUsage.cache_creation_input_tokens,
      cacheReadTokens: cliUsage.cache_read_input_tokens,
      thinkingTokens: cliUsage.thinking_tokens,
      totalTokens: cliUsage.input_tokens + cliUsage.output_tokens
    };
  }

  /**
   * Extract outputs using regex pattern matching and JSON blocks
   *
   * @param textOutput - Text output from agent
   * @param outputKeys - Expected output keys to extract
   * @returns Extracted key-value pairs or undefined if none found
   */
  private extractOutputsFromText(
    textOutput: string,
    outputKeys: string[]
  ): Record<string, unknown> | undefined {
    if (outputKeys.length === 0) return undefined;

    // First, try to extract from JSON blocks
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
        // JSON parsing failed, fall through to regex
      }
    }

    // Fallback to regex extraction
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

  /**
   * Escape special regex characters
   *
   * @param string - String to escape
   * @returns Escaped string safe for regex
   */
  private escapeRegex(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Format tool activity into a human-readable string
   *
   * @param toolName - Name of the tool being used
   * @param input - Tool input parameters
   * @returns Formatted activity string
   */
  private formatToolActivity(toolName: string, input: Record<string, unknown>): string {
    const icons: Record<string, string> = {
      Read: '📖',
      Write: '📝',
      Edit: '✏️',
      Bash: '🔧',
      Glob: '🔍',
      Grep: '🔎',
      LS: '📂',
      WebFetch: '🌐',
      WebSearch: '🔍',
      Task: '🤖',
      TodoWrite: '📋',
      NotebookEdit: '📓'
    };

    const icon = icons[toolName] || '⚡';

    switch (toolName) {
      case 'Read':
        return `${icon} Reading ${this.truncatePath(input.file_path as string)}`;
      case 'Write':
        return `${icon} Writing ${this.truncatePath(input.file_path as string)}`;
      case 'Edit':
        return `${icon} Editing ${this.truncatePath(input.file_path as string)}`;
      case 'Bash': {
        const cmd = (input.command as string) || '';
        const shortCmd = cmd.length > 50 ? cmd.substring(0, 47) + '...' : cmd;
        return `${icon} Running: ${shortCmd}`;
      }
      case 'Glob':
        return `${icon} Finding ${input.pattern}`;
      case 'Grep':
        return `${icon} Searching for "${input.pattern}"`;
      case 'LS':
        return `${icon} Listing ${this.truncatePath(input.path as string) || '.'}`;
      case 'WebFetch':
        return `${icon} Fetching ${this.truncateUrl(input.url as string)}`;
      case 'WebSearch':
        return `${icon} Searching: ${input.query}`;
      case 'Task':
        return `${icon} Spawning agent: ${input.description || input.subagent_type}`;
      case 'TodoWrite':
        return `${icon} Updating task list`;
      case 'NotebookEdit':
        return `${icon} Editing notebook ${this.truncatePath(input.notebook_path as string)}`;
      default:
        return `${icon} ${toolName}`;
    }
  }

  /**
   * Truncate a file path for display
   */
  private truncatePath(filePath: string | undefined): string {
    if (!filePath) return '';
    // Show just the filename or last part of path
    const parts = filePath.split('/');
    if (parts.length <= 2) return filePath;
    return '.../' + parts.slice(-2).join('/');
  }

  /**
   * Truncate a URL for display
   */
  private truncateUrl(url: string | undefined): string {
    if (!url) return '';
    try {
      const parsed = new URL(url);
      return parsed.hostname + (parsed.pathname.length > 20 ? parsed.pathname.substring(0, 17) + '...' : parsed.pathname);
    } catch {
      return url.substring(0, 40);
    }
  }
}
