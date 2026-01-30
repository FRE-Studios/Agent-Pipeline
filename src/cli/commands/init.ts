// src/cli/commands/init.ts - Refactored to use AgentImporter and templates

import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import { AgentImporter } from '../utils/agent-importer.js';
import { PipelineLoader } from '../../config/pipeline-loader.js';
import { PipelineValidator, ValidationError } from '../../validators/pipeline-validator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Color utilities following established patterns in help/index.ts
const c = {
  title: chalk.bold.cyan,
  header: chalk.bold.white,
  success: chalk.green,
  cmd: chalk.cyan,
  path: chalk.yellow,
  dim: chalk.dim,
  warn: chalk.yellow,
  error: chalk.red,
  highlight: chalk.bold.green,
  divider: chalk.dim,
};

export async function initCommand(repoPath: string): Promise<void> {
  console.log(`\n${c.title('Agent Pipeline')} ${c.dim('— Initializing project...')}\n`);

  try {
    // Create directory structure
    const pipelinesDir = path.join(repoPath, '.agent-pipeline', 'pipelines');
    const agentsDir = path.join(repoPath, '.agent-pipeline', 'agents');
    const instructionsDir = path.join(repoPath, '.agent-pipeline', 'instructions');

    await fs.mkdir(pipelinesDir, { recursive: true });
    await fs.mkdir(agentsDir, { recursive: true });
    await fs.mkdir(instructionsDir, { recursive: true });

    // Create default instruction templates
    const skippedInstructions = await createInstructionTemplates(instructionsDir);

    console.log(`${c.success('✓')} ${c.header('Created directory structure:')}`);
    console.log(`   ${c.dim('•')} ${c.path('.agent-pipeline/pipelines/')}`);
    console.log(`   ${c.dim('•')} ${c.path('.agent-pipeline/agents/')}`);
    console.log(`   ${c.dim('•')} ${c.path('.agent-pipeline/instructions/')}\n`);

    if (skippedInstructions.length > 0) {
      console.log(`${c.warn('⚠')}  ${c.dim('Existing instruction files not overwritten:')} ${c.path(skippedInstructions.join(', '))}`);
      console.log(`   ${c.dim('To get fresh templates, delete these files and run')} ${c.cmd('agent-pipeline init')} ${c.dim('again.')}\n`);
    }

    // Check for available plugin agents (don't auto-import)
    const discoveredAgents = await AgentImporter.discoverPluginAgents();
    if (discoveredAgents.length > 0) {
      console.log(`${c.dim('📦')} ${c.header(`${discoveredAgents.length} agent(s)`)} ${c.dim('found in Claude Code plugins.')}`);
      console.log(`   ${c.dim('Use')} ${c.cmd('agent-pipeline agent pull')} ${c.dim('to import.')}\n`);
    }

    // Create example pipelines
    const pipelinesToCreate: string[] = [
      'front-end-parallel-example',
      'post-commit-example',
      'loop-example'
    ];

    // Copy pipeline templates
    console.log(`${c.success('✓')} ${c.header('Creating pipelines:')}`);
    for (const pipelineName of pipelinesToCreate) {
      try {
        await copyPipelineTemplate(pipelineName, pipelinesDir);
        console.log(`   ${c.dim('•')} ${c.path(`.agent-pipeline/pipelines/${pipelineName}.yml`)}`);
      } catch (error) {
        console.log(`   ${c.warn('⚠')}  ${c.dim('Could not create')} ${c.path(`${pipelineName}.yml`)}: ${c.dim((error as Error).message)}`);
      }
    }
    console.log('');

    // Copy all agent templates (skip existing files to preserve user customizations)
    const createdAgents = await copyAllAgentTemplates(agentsDir);

    if (createdAgents.length > 0) {
      console.log(`${c.success('✓')} ${c.header(`Created ${createdAgents.length} agent(s):`)}`);
      for (const agent of createdAgents) {
        console.log(`   ${c.dim('•')} ${c.path(`.agent-pipeline/agents/${agent}`)}`);
      }
      console.log('');
    }

    // Update .gitignore
    await updateGitignore(repoPath);

    // Validate created pipelines
    console.log(`${c.dim('Validating pipelines...')}\n`);
    const validationResults = await validateCreatedPipelines(repoPath, pipelinesToCreate);

    if (!validationResults.allValid) {
      console.log(`\n${c.divider('─'.repeat(60))}`);
      console.log(`\n${c.warn('⚠')}  ${c.header('Agent Pipeline initialized with validation issues.')}\n`);
      console.log(`${c.dim('Fix the errors above before running pipelines.')}`);
      console.log(`\n${c.divider('─'.repeat(60))}\n`);
      return;
    }

    // Success message
    console.log(`${c.divider('─'.repeat(60))}`);
    console.log(`\n${c.highlight('✓')} ${c.title('Agent Pipeline initialized successfully!')}\n`);

    // Show what was created
    console.log(`${c.header(`Created ${pipelinesToCreate.length} pipeline(s):`)}`);
    for (const pipeline of pipelinesToCreate) {
      console.log(`   ${c.dim('•')} ${c.path(`${pipeline}.yml`)}`);
    }
    console.log('');

    console.log(`${c.header('Next steps:')}\n`);
    console.log(`  ${c.header('1.')} Run the parallel design exploration:\n`);
    console.log(`     ${c.cmd('$ agent-pipeline run front-end-parallel-example')}\n`);
    console.log(`     ${c.dim('Tip: Edit the "prompt" in product-owner stage to design your own website!')}\n`);
    console.log(`  ${c.header('2.')} For existing projects, try the post-commit workflow:\n`);
    console.log(`     ${c.cmd('$ agent-pipeline run post-commit-example')}\n`);
    console.log(`  ${c.header('3.')} Install git hooks ${c.dim('(optional)')}:\n`);
    console.log(`     ${c.cmd('$ agent-pipeline hooks install post-commit-example')}\n`);
    console.log(`  ${c.header('4.')} Customize agents in ${c.path('.agent-pipeline/agents/')}\n`);
    console.log(`  ${c.header('5.')} Try the agent loop example:\n`);
    console.log(`     ${c.cmd('$ agent-pipeline run loop-example')}`);
    console.log(`\n${c.divider('─'.repeat(60))}\n`);

  } catch (error) {
    console.error(`${c.error('✗')} ${c.header('Failed to initialize Agent Pipeline:')}`);
    console.error(c.dim((error as Error).message));
    throw error;
  }
}

/**
 * Copy a pipeline template to the target directory
 */
async function copyPipelineTemplate(
  templateName: string,
  targetDir: string
): Promise<void> {
  const templatesDir = path.join(__dirname, '../templates/pipelines');
  const templatePath = path.join(templatesDir, `${templateName}.yml`);
  const targetPath = path.join(targetDir, `${templateName}.yml`);

  const templateContent = await fs.readFile(templatePath, 'utf-8');
  await fs.writeFile(targetPath, templateContent, 'utf-8');
}

/**
 * Discover all .md agent templates from root and subdirectories, copy to target.
 * Skips files that already exist to preserve user customizations.
 */
async function copyAllAgentTemplates(agentsDir: string): Promise<string[]> {
  const templatesDir = path.join(__dirname, '../templates/agents');
  const createdAgents: string[] = [];

  // Collect all .md template files from root and subdirectories
  const templates: { filename: string; sourcePath: string }[] = [];

  try {
    const entries = await fs.readdir(templatesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        templates.push({ filename: entry.name, sourcePath: path.join(templatesDir, entry.name) });
      } else if (entry.isDirectory()) {
        const subEntries = await fs.readdir(path.join(templatesDir, entry.name), { withFileTypes: true });
        for (const subEntry of subEntries) {
          if (subEntry.isFile() && subEntry.name.endsWith('.md')) {
            templates.push({ filename: subEntry.name, sourcePath: path.join(templatesDir, entry.name, subEntry.name) });
          }
        }
      }
    }
  } catch (error) {
    console.log(`   ${c.warn('⚠')}  ${c.dim('Could not read agent templates:')} ${c.dim((error as Error).message)}`);
    return createdAgents;
  }

  for (const { filename, sourcePath } of templates) {
    const targetPath = path.join(agentsDir, filename);

    // Skip if file already exists
    try {
      await fs.access(targetPath);
      continue;
    } catch {
      // File doesn't exist, proceed to copy
    }

    try {
      const content = await fs.readFile(sourcePath, 'utf-8');
      await fs.writeFile(targetPath, content, 'utf-8');
      createdAgents.push(filename);
    } catch (error) {
      console.log(`   ${c.warn('⚠')}  ${c.dim('Agent')} ${c.path(filename)} ${c.dim('failed to copy:')} ${c.dim((error as Error).message)}`);
    }
  }

  return createdAgents;
}

/**
 * Update .gitignore to exclude agent-pipeline artifacts
 */
async function updateGitignore(repoPath: string): Promise<void> {
  const gitignorePath = path.join(repoPath, '.gitignore');
  const agentPipelineEntry = `
# Agent Pipeline
.agent-pipeline/state/
.agent-pipeline/runs/
.agent-pipeline/worktrees/
`;

  try {
    let gitignoreContent = '';
    try {
      gitignoreContent = await fs.readFile(gitignorePath, 'utf-8');
    } catch {
      // .gitignore doesn't exist, will create new one
    }

    if (!gitignoreContent.includes('.agent-pipeline/state/')) {
      await fs.appendFile(gitignorePath, agentPipelineEntry, 'utf-8');
    }
  } catch (error) {
    // Silently fail if can't update .gitignore
  }
}

/**
 * Validate all created pipelines and report results
 */
async function validateCreatedPipelines(
  repoPath: string,
  pipelineNames: string[]
): Promise<{ allValid: boolean; results: Map<string, ValidationError[]> }> {
  const loader = new PipelineLoader(repoPath);
  const validator = new PipelineValidator();
  const results = new Map<string, ValidationError[]>();
  let hasErrors = false;

  for (const pipelineName of pipelineNames) {
    try {
      const { config } = await loader.loadPipeline(pipelineName);
      const errors = await validator.validate(config, repoPath);
      results.set(pipelineName, errors);

      // Check for actual errors (not just warnings)
      const pipelineErrors = errors.filter(e => e.severity === 'error');
      const pipelineWarnings = errors.filter(e => e.severity === 'warning');

      if (pipelineErrors.length > 0) {
        hasErrors = true;
        console.log(`${c.error('✗')} ${c.path(pipelineName)}: ${c.error(`${pipelineErrors.length} error(s)`)}`);
        for (const err of pipelineErrors) {
          console.log(`   ${c.dim('•')} ${c.dim(err.field)}: ${c.dim(err.message)}`);
        }
      } else if (pipelineWarnings.length > 0) {
        console.log(`${c.success('✓')} ${c.path(pipelineName)}: ${c.dim(`valid (${pipelineWarnings.length} warning(s))`)}`);
        for (const warning of pipelineWarnings) {
          console.log(`   ${c.warn('⚠')}  ${c.dim(warning.field)}: ${c.dim(warning.message)}`);
        }
      } else {
        console.log(`${c.success('✓')} ${c.path(pipelineName)}: ${c.dim('valid')}`);
      }
    } catch (err) {
      hasErrors = true;
      console.log(`${c.error('✗')} ${c.path(pipelineName)}: ${c.dim('failed to load')} - ${c.dim((err as Error).message)}`);
      results.set(pipelineName, [{
        field: 'pipeline',
        message: (err as Error).message,
        severity: 'error'
      }]);
    }
  }

  return { allValid: !hasErrors, results };
}

/**
 * Create default instruction template files
 */
async function createInstructionTemplates(instructionsDir: string): Promise<string[]> {
  const templatesDir = path.join(__dirname, '../templates/instructions');
  const templates = ['handover.md', 'loop.md'];
  const skippedFiles: string[] = [];

  for (const template of templates) {
    const targetPath = path.join(instructionsDir, template);

    // Only create if doesn't exist (don't overwrite user customizations)
    try {
      await fs.access(targetPath);
      // File exists, track as skipped
      skippedFiles.push(template);
    } catch {
      // File doesn't exist, try to copy from template
      try {
        const sourcePath = path.join(templatesDir, template);
        const content = await fs.readFile(sourcePath, 'utf-8');
        await fs.writeFile(targetPath, content, 'utf-8');
      } catch {
        // Template doesn't exist in package, skip silently
      }
    }
  }

  return skippedFiles;
}
