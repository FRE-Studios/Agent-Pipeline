// src/cli/commands/register-pipeline.ts - Pipeline management command registrations

import type { Command } from 'commander';

import { createPipelineCommand } from './pipeline/create.js';
import { deletePipelineCommand } from './pipeline/delete.js';
import { clonePipelineCommand } from './pipeline/clone.js';
import { editPipelineCommand } from './pipeline/edit.js';
import { validatePipelineCommand } from './pipeline/validate.js';
import { configPipelineCommand } from './pipeline/config.js';
import { exportPipelineCommand } from './pipeline/export.js';
import { importPipelineCommand } from './pipeline/import.js';

export function registerPipelineCommands(program: Command): void {
  const repoPath = process.cwd();

  program
    .command('create')
    .description('Create new pipeline (interactive wizard)')
    .action(async () => {
      await createPipelineCommand(repoPath);
    });

  program
    .command('delete')
    .description('Remove a pipeline')
    .argument('<pipeline>', 'Pipeline name to delete')
    .option('--force', 'Delete without confirmation')
    .option('--delete-logs', 'Also delete run history')
    .action(async (pipeline: string, opts: { force?: boolean; deleteLogs?: boolean }) => {
      await deletePipelineCommand(repoPath, pipeline, opts);
    });

  program
    .command('clone')
    .description('Duplicate a pipeline')
    .argument('<source>', 'Source pipeline name')
    .argument('[destination]', 'Destination pipeline name')
    .action(async (source: string, destination?: string) => {
      await clonePipelineCommand(repoPath, source, destination);
    });

  program
    .command('edit')
    .description('Edit pipeline config in your default editor')
    .argument('<pipeline>', 'Pipeline name to edit')
    .action(async (pipeline: string) => {
      await editPipelineCommand(repoPath, pipeline);
    });

  program
    .command('validate')
    .description('Check pipeline syntax and dependency graph')
    .argument('<pipeline>', 'Pipeline name to validate')
    .action(async (pipeline: string) => {
      await validatePipelineCommand(repoPath, pipeline);
    });

  program
    .command('config')
    .description('View pipeline configuration')
    .argument('<pipeline>', 'Pipeline name to inspect')
    .action(async (pipeline: string) => {
      await configPipelineCommand(repoPath, pipeline);
    });

  program
    .command('export')
    .description('Export pipeline to file')
    .argument('<pipeline>', 'Pipeline name to export')
    .option('-o, --output <file>', 'Write to file instead of stdout')
    .option('--include-agents', 'Include agent markdown in export')
    .action(async (pipeline: string, opts: { output?: string; includeAgents?: boolean }) => {
      await exportPipelineCommand(repoPath, pipeline, opts);
    });

  program
    .command('import')
    .description('Import pipeline from file or URL')
    .argument('<file-or-url>', 'File path or URL to import from')
    .action(async (fileOrUrl: string) => {
      await importPipelineCommand(repoPath, fileOrUrl);
    });
}
