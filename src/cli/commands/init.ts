// src/cli/commands/init.ts - Refactored to use AgentImporter and templates

import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as YAML from 'yaml';
import { AgentImporter } from '../utils/agent-importer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Available example templates (excluding test-pipeline)
const AVAILABLE_EXAMPLES = ['post-commit'] as const;
type ExampleName = typeof AVAILABLE_EXAMPLES[number];

export async function initCommand(
  repoPath: string,
  options?: {
    exampleName?: string;
    all?: boolean;
  }
): Promise<void> {
  console.log('\n🚀 Initializing Agent Pipeline...\n');

  try {
    // Create directory structure
    const pipelinesDir = path.join(repoPath, '.agent-pipeline', 'pipelines');
    const agentsDir = path.join(repoPath, '.claude', 'agents');

    await fs.mkdir(pipelinesDir, { recursive: true });
    await fs.mkdir(agentsDir, { recursive: true });

    console.log('✅ Created directory structure:');
    console.log(`   - .agent-pipeline/pipelines/`);
    console.log(`   - .claude/agents/\n`);

    // Check for available plugin agents (don't auto-import)
    const discoveredAgents = await AgentImporter.discoverPluginAgents();
    if (discoveredAgents.length > 0) {
      console.log(`📦 ${discoveredAgents.length} agent(s) found in Claude Code plugins.`);
      console.log('   Use "agent-pipeline agent pull" to import.\n');
    }

    // Determine which pipelines to create
    const pipelinesToCreate: string[] = ['test-pipeline'];

    // Validate example name if provided
    if (options?.exampleName) {
      if (!AVAILABLE_EXAMPLES.includes(options.exampleName as ExampleName)) {
        throw new Error(
          `Invalid example name: ${options.exampleName}. Available: ${AVAILABLE_EXAMPLES.join(', ')}`
        );
      }
      pipelinesToCreate.push(`${options.exampleName}-example`);
    }

    // Add all examples if --all flag is set
    if (options?.all) {
      for (const example of AVAILABLE_EXAMPLES) {
        const pipelineName = `${example}-example`;
        if (!pipelinesToCreate.includes(pipelineName)) {
          pipelinesToCreate.push(pipelineName);
        }
      }
    }

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
          console.log(`   - .claude/agents/${agent}`);
        }
        console.log('');
      }
    }

    // Update .gitignore
    await updateGitignore(repoPath);

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
    console.log('  1. Review your pipeline in .agent-pipeline/pipelines/test-pipeline.yml');
    console.log('  2. Customize agents in .claude/agents/');
    console.log('  3. Run your first pipeline: agent-pipeline run test-pipeline');
    if (pipelinesToCreate.includes('post-commit-example')) {
      console.log('  4. Install git hooks (optional): agent-pipeline install post-commit-example');
    }
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
 * Create only the required agents by copying from template files
 */
async function createRequiredAgents(
  agentsDir: string,
  requiredAgents: string[]
): Promise<string[]> {
  const templatesDir = path.join(__dirname, '../templates/agents');
  const createdAgents: string[] = [];

  for (const agentFilename of requiredAgents) {
    const templatePath = path.join(templatesDir, agentFilename);

    try {
      const templateContent = await fs.readFile(templatePath, 'utf-8');
      await fs.writeFile(
        path.join(agentsDir, agentFilename),
        templateContent,
        'utf-8'
      );
      createdAgents.push(agentFilename);
    } catch (error) {
      // Agent template doesn't exist - skip it
      // User will need to import it from plugins or create manually
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
