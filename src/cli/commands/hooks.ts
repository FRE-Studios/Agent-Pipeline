// src/cli/commands/hooks.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import { PipelineLoader } from '../../config/pipeline-loader.js';
import { HookInstaller } from '../hooks.js';

interface InstalledHook {
  hookType: string;
  pipelineName: string;
}

/**
 * List installed git hooks
 */
export async function hooksListCommand(
  repoPath: string,
  options?: { pipeline?: string }
): Promise<void> {
  const hookTypes = ['pre-commit', 'post-commit', 'pre-push', 'post-merge'];
  const hooksDir = path.join(repoPath, '.git', 'hooks');
  const installedHooks: InstalledHook[] = [];

  // Pattern: # Agent Pipeline (hookType): pipelineName
  const markerPattern = /^# Agent Pipeline \([^)]+\): (.+)$/;

  for (const hookType of hookTypes) {
    const hookPath = path.join(hooksDir, hookType);

    try {
      const content = await fs.readFile(hookPath, 'utf-8');
      const lines = content.split('\n');

      for (const line of lines) {
        const match = line.match(markerPattern);
        if (match) {
          installedHooks.push({
            hookType,
            pipelineName: match[1]
          });
        }
      }
    } catch {
      // Hook file doesn't exist, skip
      continue;
    }
  }

  // Apply filter if --pipeline option provided
  const filtered = options?.pipeline
    ? installedHooks.filter(h => h.pipelineName === options.pipeline)
    : installedHooks;

  if (filtered.length === 0) {
    if (options?.pipeline) {
      console.log(`No hooks installed for pipeline: ${options.pipeline}`);
    } else {
      console.log('No Agent Pipeline hooks installed');
    }
    return;
  }

  // Display formatted output
  console.log(`\nInstalled Git Hooks`);
  console.log('='.repeat(55));
  console.log('');
  console.log(`${'Hook Type'.padEnd(16)}Pipeline`);
  console.log('-'.repeat(55));

  for (const hook of filtered) {
    console.log(`${hook.hookType.padEnd(16)}${hook.pipelineName}`);
  }

  console.log('');
  console.log(`Total: ${filtered.length} hook(s) installed`);
  console.log('');
}

/**
 * Install a git hook for a pipeline
 */
export async function hooksInstallCommand(
  repoPath: string,
  pipelineName: string
): Promise<void> {
  // Load pipeline config to get trigger type
  const loader = new PipelineLoader(repoPath);
  const { config } = await loader.loadPipeline(pipelineName);

  // Validate that the trigger is not 'manual'
  if (config.trigger === 'manual') {
    console.error('❌ Cannot install git hook for manual pipelines.');
    console.error(`   Pipeline "${pipelineName}" has trigger: manual`);
    console.error(`   Use 'agent-pipeline run ${pipelineName}' instead.`);
    process.exit(1);
  }

  // Require branch strategy for hook installs to prevent commit loops
  if (!config.git?.branchStrategy) {
    console.error('❌ Cannot install git hook without git.branchStrategy configured.');
    console.error(`   Pipeline "${pipelineName}" is missing git.branchStrategy`);
    console.error(`   Add git.branchStrategy (reusable, unique-per-run, or unique-and-delete), then re-run install.`);
    console.error(`   Use 'agent-pipeline run ${pipelineName}' to run on the current branch.`);
    process.exit(1);
  }

  if (config.git.branchStrategy === 'reusable') {
    console.warn('⚠️  git.branchStrategy is set to reusable.');
    console.warn('   For hook-triggered pipelines, unique-per-run or unique-and-delete is safer to avoid branch contention.');
  }

  if (config.settings?.autoCommit) {
    console.warn('⚠️  autoCommit is enabled for this hook-triggered pipeline.');
    console.warn('   This will create commits on the pipeline branch; disable autoCommit for read-only hooks.');
  }

  const installer = new HookInstaller(repoPath);
  await installer.install(pipelineName, config.trigger);
}

/**
 * Uninstall git hooks
 */
export async function hooksUninstallCommand(
  repoPath: string,
  options?: { pipelineName?: string; removeAll?: boolean }
): Promise<void> {
  const installer = new HookInstaller(repoPath);
  await installer.uninstall({
    pipelineName: options?.pipelineName,
    removeAll: options?.removeAll ?? !options?.pipelineName
  });
}

// Keep the old function name as an alias for backwards compatibility in tests
export const hooksCommand = hooksListCommand;
