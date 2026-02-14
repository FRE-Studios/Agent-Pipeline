// src/cli/program.ts - Commander program factory

import { Command, CommanderError } from 'commander';
import * as fs from 'fs/promises';

import { Logger } from '../utils/logger.js';

// Runtime registration
import { AgentRuntimeRegistry } from '../core/agent-runtime-registry.js';
import { ClaudeSDKRuntime } from '../core/agent-runtimes/claude-sdk-runtime.js';
import { ClaudeCodeHeadlessRuntime } from '../core/agent-runtimes/claude-code-headless-runtime.js';
import { CodexHeadlessRuntime } from '../core/agent-runtimes/codex-headless-runtime.js';
import { GeminiHeadlessRuntime } from '../core/agent-runtimes/gemini-headless-runtime.js';
import { PiAgentHeadlessRuntime } from '../core/agent-runtimes/pi-agent-headless-runtime.js';

// Update checker
import { checkForUpdate, formatUpdateNotification, shouldSkipCheck, type UpdateCheckResult } from '../utils/update-checker.js';

// Command registration
import { registerCoreCommands } from './commands/register-core.js';
import { registerPipelineCommands } from './commands/register-pipeline.js';
import { registerAgentCommands } from './commands/register-agent.js';
import { registerHooksCommands } from './commands/register-hooks.js';

// Help topics
import { showQuickstart, showExamples, showCheatsheet } from './help/index.js';

const UPDATE_NOTIFICATION_MAX_WAIT_MS = 150;

async function waitForUpdateResult(
  promise: Promise<UpdateCheckResult | null>,
  maxWaitMs: number
): Promise<UpdateCheckResult | null> {
  const timeoutPromise = new Promise<null>((resolve) => {
    const timeout = setTimeout(() => resolve(null), maxWaitMs);
    timeout.unref?.();
  });

  return Promise.race([promise.catch(() => null), timeoutPromise]);
}

async function printUpdateNotification(promise: Promise<UpdateCheckResult | null> | null): Promise<void> {
  if (!promise) return;
  try {
    const result = await waitForUpdateResult(promise, UPDATE_NOTIFICATION_MAX_WAIT_MS);
    if (result?.updateAvailable) {
      process.stderr.write(formatUpdateNotification(result));
    }
  } catch {
    // Silently ignore
  }
}

async function registerRuntimes(): Promise<void> {
  const runtimes = [
    { name: 'Claude SDK', create: () => new ClaudeSDKRuntime(), validate: false },
    { name: 'Claude Code Headless', create: () => new ClaudeCodeHeadlessRuntime(), validate: true },
    { name: 'Codex Headless', create: () => new CodexHeadlessRuntime(), validate: true },
    { name: 'Gemini Headless', create: () => new GeminiHeadlessRuntime(), validate: true },
    { name: 'Pi Agent Headless', create: () => new PiAgentHeadlessRuntime(), validate: true },
  ];

  for (const rt of runtimes) {
    try {
      const runtime = rt.create();
      AgentRuntimeRegistry.register(runtime);

      if (rt.validate) {
        const validation = await (runtime as { validate(): Promise<{ valid: boolean; warnings: string[] }> }).validate();
        if (!validation.valid && process.env.DEBUG) {
          Logger.warn(`${rt.name} runtime registered but CLI not available`);
          validation.warnings.forEach((warning: string) => Logger.warn(`  ${warning}`));
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Logger.error(`Failed to register ${rt.name} runtime: ${message}`);
      if (process.env.DEBUG) {
        console.error(err);
      }
    }
  }
}

export async function createProgram(): Promise<Command> {
  const pkgPath = new URL('../../package.json', import.meta.url);
  const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));

  const program = new Command();

  program
    .name('agent-pipeline')
    .version(`agent-pipeline v${pkg.version}`, '-v, --version')
    .description('Intelligent multi-runtime agent orchestration with DAG-planned parallelism')
    .exitOverride();

  // Fire non-blocking update check before command execution
  let updateCheckPromise: Promise<UpdateCheckResult | null> | null = null;

  program.hook('preAction', async () => {
    if (!shouldSkipCheck(process.argv.slice(2))) {
      updateCheckPromise = checkForUpdate(pkg.version);
    }
    await registerRuntimes();
  });

  program.hook('postAction', async () => {
    await printUpdateNotification(updateCheckPromise);
  });

  // Register all command groups
  registerCoreCommands(program);
  registerPipelineCommands(program);
  registerAgentCommands(program);
  registerHooksCommands(program);

  // Help topics subcommand
  program
    .command('help [topic]')
    .description('Show help for a topic (quickstart, examples, cheatsheet)')
    .action((topic?: string) => {
      if (topic === 'quickstart') {
        showQuickstart();
      } else if (topic === 'examples') {
        showExamples();
      } else if (topic === 'cheatsheet') {
        showCheatsheet();
      } else {
        program.help();
      }
    });

  // Disable the default help command that commander adds (we have our own)
  program.addHelpCommand(false);

  return program;
}

export { CommanderError };
