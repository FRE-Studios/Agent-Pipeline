// src/cli/commands/init.ts - Refactored to use AgentImporter and templates

import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as YAML from 'yaml';
import { AgentImporter } from '../utils/agent-importer.js';
import { PipelineLoader } from '../../config/pipeline-loader.js';
import { PipelineValidator, ValidationError } from '../../validators/pipeline-validator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function initCommand(repoPath: string): Promise<void> {
  console.log('\n🚀 Initializing Agent Pipeline...\n');

  try {
    // Create directory structure
    const pipelinesDir = path.join(repoPath, '.agent-pipeline', 'pipelines');
    const agentsDir = path.join(repoPath, '.agent-pipeline', 'agents');
    const instructionsDir = path.join(repoPath, '.agent-pipeline', 'instructions');

    await fs.mkdir(pipelinesDir, { recursive: true });
    await fs.mkdir(agentsDir, { recursive: true });
    await fs.mkdir(instructionsDir, { recursive: true });

    // Create default instruction templates
    await createInstructionTemplates(instructionsDir);

    console.log('✅ Created directory structure:');
    console.log(`   - .agent-pipeline/pipelines/`);
    console.log(`   - .agent-pipeline/agents/`);
    console.log(`   - .agent-pipeline/instructions/\n`);

    // Check for available plugin agents (don't auto-import)
    const discoveredAgents = await AgentImporter.discoverPluginAgents();
    if (discoveredAgents.length > 0) {
      console.log(`📦 ${discoveredAgents.length} agent(s) found in Claude Code plugins.`);
      console.log('   Use "agent-pipeline agent pull" to import.\n');
    }

    // Create both example pipelines
    const pipelinesToCreate: string[] = [
      'front-end-parallel-example',
      'post-commit-example'
    ];

    // Copy pipeline templates
    console.log('✅ Creating pipelines:');
    for (const pipelineName of pipelinesToCreate) {
      try {
        await copyPipelineTemplate(pipelineName, pipelinesDir);
        console.log(`   - .agent-pipeline/pipelines/${pipelineName}.yml`);
      } catch (error) {
        console.log(`   ⚠️  Could not create ${pipelineName}.yml: ${(error as Error).message}`);
      }
    }
    console.log('');

    // Determine which agents are required by the selected pipelines
    const requiredAgents = await getRequiredAgents(pipelinesToCreate);

    // Check which agents already exist (from plugin import or previous runs)
    const existingAgents = await fs.readdir(agentsDir);
    const existingMdAgents = new Set(
      existingAgents.filter(f => f.endsWith('.md') && !f.startsWith('.'))
    );

    // Determine which agents need to be created
    const agentsToCreate = requiredAgents.filter(agent => !existingMdAgents.has(agent));

    // Create required agents that don't already exist
    if (agentsToCreate.length > 0) {
      const createdAgents = await createRequiredAgents(agentsDir, agentsToCreate);

      if (createdAgents.length > 0) {
        console.log(`✅ Created ${createdAgents.length} fallback agent(s) required by your pipelines:`);
        for (const agent of createdAgents) {
          console.log(`   - .agent-pipeline/agents/${agent}`);
        }
        console.log('');
      }
    }

    // Update .gitignore
    await updateGitignore(repoPath);

    // Validate created pipelines
    console.log('🔍 Validating pipelines...\n');
    const validationResults = await validateCreatedPipelines(repoPath, pipelinesToCreate);

    if (!validationResults.allValid) {
      console.log(`\n${'='.repeat(60)}`);
      console.log('\n⚠️  Agent Pipeline initialized with validation issues.\n');
      console.log('Fix the errors above before running pipelines.');
      console.log(`\n${'='.repeat(60)}\n`);
      return;
    }

    // Success message
    console.log(`${'='.repeat(60)}`);
    console.log('\n✨ Agent Pipeline initialized successfully!\n');

    // Show what was created
    console.log(`📁 Created ${pipelinesToCreate.length} pipeline(s):`);
    for (const pipeline of pipelinesToCreate) {
      console.log(`   - ${pipeline}.yml`);
    }
    console.log('');

    console.log('Next steps:');
    console.log('  1. Run the parallel design exploration:');
    console.log('     agent-pipeline run front-end-parallel-example');
    console.log('  2. For existing projects, try the post-commit workflow:');
    console.log('     agent-pipeline run post-commit-example');
    console.log('  3. Install git hooks (optional):');
    console.log('     agent-pipeline install post-commit-example');
    console.log('  4. Customize agents in .agent-pipeline/agents/');
    console.log(`\n${'='.repeat(60)}\n`);

  } catch (error) {
    console.error('❌ Failed to initialize Agent Pipeline:');
    console.error((error as Error).message);
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
 * Parse pipeline YAML and extract required agent file names
 */
async function getRequiredAgents(pipelineNames: string[]): Promise<string[]> {
  const templatesDir = path.join(__dirname, '../templates/pipelines');
  const agentSet = new Set<string>();

  for (const pipelineName of pipelineNames) {
    const templatePath = path.join(templatesDir, `${pipelineName}.yml`);

    try {
      const content = await fs.readFile(templatePath, 'utf-8');
      const parsed = YAML.parse(content);

      if (parsed.agents && Array.isArray(parsed.agents)) {
        for (const agent of parsed.agents) {
          if (agent.agent && typeof agent.agent === 'string') {
            // Extract filename from path like ".claude/agents/code-reviewer.md"
            const filename = path.basename(agent.agent);
            agentSet.add(filename);
          }
        }
      }
    } catch (error) {
      console.log(`   ⚠️  Could not parse ${pipelineName}.yml: ${(error as Error).message}`);
    }
  }

  return Array.from(agentSet);
}

/**
 * Find an agent template file, searching root and subdirectories
 */
async function findAgentTemplate(
  templatesDir: string,
  filename: string
): Promise<string | null> {
  // First check root
  const rootPath = path.join(templatesDir, filename);
  try {
    await fs.access(rootPath);
    return rootPath;
  } catch {
    // Not in root, check subdirectories
  }

  // Then check subdirectories
  try {
    const entries = await fs.readdir(templatesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subPath = path.join(templatesDir, entry.name, filename);
        try {
          await fs.access(subPath);
          return subPath;
        } catch {
          // Not in this subdirectory
        }
      }
    }
  } catch {
    // Failed to read directory
  }

  return null;
}

/**
 * Create only the required agents by copying from template files
 */
async function createRequiredAgents(
  agentsDir: string,
  requiredAgents: string[]
): Promise<string[]> {
  const templatesDir = path.join(__dirname, '../templates/agents');
  const createdAgents: string[] = [];

  for (const agentFilename of requiredAgents) {
    const templatePath = await findAgentTemplate(templatesDir, agentFilename);

    if (templatePath) {
      try {
        const templateContent = await fs.readFile(templatePath, 'utf-8');
        await fs.writeFile(
          path.join(agentsDir, agentFilename),
          templateContent,
          'utf-8'
        );
        createdAgents.push(agentFilename);
      } catch (error) {
        console.log(`   ⚠️  Agent ${agentFilename} failed to copy: ${(error as Error).message}`);
      }
    } else {
      // Agent template doesn't exist - skip it
      console.log(`   ⚠️  Agent ${agentFilename} is required but no template available (import from plugins or create manually)`);
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
        console.log(`❌ ${pipelineName}: ${pipelineErrors.length} error(s)`);
        for (const error of pipelineErrors) {
          console.log(`   • ${error.field}: ${error.message}`);
        }
      } else if (pipelineWarnings.length > 0) {
        console.log(`✅ ${pipelineName}: valid (${pipelineWarnings.length} warning(s))`);
        for (const warning of pipelineWarnings) {
          console.log(`   ⚠️  ${warning.field}: ${warning.message}`);
        }
      } else {
        console.log(`✅ ${pipelineName}: valid`);
      }
    } catch (error) {
      hasErrors = true;
      console.log(`❌ ${pipelineName}: failed to load - ${(error as Error).message}`);
      results.set(pipelineName, [{
        field: 'pipeline',
        message: (error as Error).message,
        severity: 'error'
      }]);
    }
  }

  return { allValid: !hasErrors, results };
}

/**
 * Create default instruction template files
 */
async function createInstructionTemplates(instructionsDir: string): Promise<void> {
  const templatesDir = path.join(__dirname, '../templates/instructions');
  const templates = ['handover.md', 'loop.md'];

  for (const template of templates) {
    const targetPath = path.join(instructionsDir, template);

    // Only create if doesn't exist (don't overwrite user customizations)
    try {
      await fs.access(targetPath);
      // File exists, skip
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
}
