// src/cli/commands/pipeline/create.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import * as YAML from 'yaml';
import { InteractivePrompts } from '../../utils/interactive-prompts.js';
import { PipelineValidator } from '../../../validators/pipeline-validator.js';
import type { PipelineConfig } from '../../../config/schema.js';

/**
 * Represents a selected agent with its dependencies
 */
interface SelectedAgent {
  file: string;        // e.g., 'code-reviewer.md'
  name: string;        // e.g., 'code-reviewer'
  dependsOn: string[]; // dependency stage names
}

type DependencyPattern = 'all-parallel' | 'sequential-chain' | 'fan-out';

/**
 * Select agents one at a time with inline dependency configuration
 */
async function selectAgentsOneByOne(availableAgents: string[]): Promise<SelectedAgent[]> {
  const selected: SelectedAgent[] = [];
  const remaining = [...availableAgents];

  console.log('\n📋 Add agents to your pipeline:\n');

  // Add first agent (required)
  const firstAgentFile = await InteractivePrompts.selectSingle(
    'Select first agent:',
    remaining.map(a => ({ name: a.replace('.md', ''), value: a }))
  );
  selected.push({
    file: firstAgentFile,
    name: firstAgentFile.replace('.md', ''),
    dependsOn: []
  });
  remaining.splice(remaining.indexOf(firstAgentFile), 1);

  // Add subsequent agents
  while (remaining.length > 0) {
    const addMore = await InteractivePrompts.confirm('\nAdd another agent?', true);

    if (!addMore) break;

    const nextAgentFile = await InteractivePrompts.selectSingle(
      '\nSelect agent:',
      remaining.map(a => ({ name: a.replace('.md', ''), value: a }))
    );
    const agentName = nextAgentFile.replace('.md', '');

    // Ask for dependencies from previously added agents
    const priorAgentNames = selected.map(a => a.name);
    let deps: string[] = [];

    if (priorAgentNames.length > 0) {
      deps = await InteractivePrompts.multiSelect(
        `\nWhich agents should "${agentName}" wait for? (Enter to skip for parallel)`,
        priorAgentNames.map(name => ({ name, value: name }))
      );
    }

    selected.push({
      file: nextAgentFile,
      name: agentName,
      dependsOn: deps
    });
    remaining.splice(remaining.indexOf(nextAgentFile), 1);
  }

  // Offer pattern shortcuts if 3+ agents and no manual dependencies set
  const hasManualDeps = selected.some(a => a.dependsOn.length > 0);
  if (selected.length >= 3 && !hasManualDeps) {
    console.log('\n💡 Apply a dependency pattern?');
    const pattern = await InteractivePrompts.choose(
      '',
      ['all-parallel', 'sequential-chain', 'fan-out'] as const,
      'all-parallel'
    );
    applyDependencyPattern(selected, pattern);
  }

  return selected;
}

/**
 * Apply a dependency pattern to selected agents
 */
function applyDependencyPattern(agents: SelectedAgent[], pattern: DependencyPattern): void {
  if (pattern === 'sequential-chain') {
    for (let i = 1; i < agents.length; i++) {
      agents[i].dependsOn = [agents[i - 1].name];
    }
  } else if (pattern === 'fan-out') {
    const firstAgentName = agents[0].name;
    for (let i = 1; i < agents.length; i++) {
      agents[i].dependsOn = [firstAgentName];
    }
  }
  // 'all-parallel' keeps dependsOn empty (already the case)
}

/**
 * Validates pipeline name format
 */
function validatePipelineName(name: string): { valid: boolean; error?: string } {
  if (!name) {
    return { valid: false, error: 'Pipeline name is required' };
  }
  if (name.length > 50) {
    return { valid: false, error: 'Pipeline name must be 50 characters or less' };
  }
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name)) {
    return {
      valid: false,
      error: 'Pipeline name must start with a letter and contain only letters, numbers, hyphens, and underscores'
    };
  }
  return { valid: true };
}

export async function createPipelineCommand(repoPath: string): Promise<void> {
  // Check for interactive terminal
  if (!process.stdin.isTTY) {
    console.error('❌ The create command requires an interactive terminal.');
    console.error('   Use "agent-pipeline init" for non-interactive setup, or run in a terminal.');
    process.exit(1);
  }

  console.log('\n🎯 Create New Pipeline\n');

  // Check if agents exist
  const agentsDir = path.join(repoPath, '.agent-pipeline', 'agents');

  // First check if directory exists
  let agentFiles: string[];
  try {
    await fs.access(agentsDir);
    agentFiles = await fs.readdir(agentsDir);
  } catch {
    console.error('❌ No agents directory found at .agent-pipeline/agents/');
    console.error('   To set up agents, you can:');
    console.error('   • Run "agent-pipeline init" to scaffold the project with example agents');
    console.error('   • Run "agent-pipeline agent pull" to import agents from Claude Code plugins');
    console.error('   • Manually copy agent .md files to .agent-pipeline/agents/');
    process.exit(1);
  }

  const mdAgents = agentFiles.filter(f => f.endsWith('.md') && !f.startsWith('.'));

  if (mdAgents.length === 0) {
    console.error('❌ No agents found in .agent-pipeline/agents/');
    console.error('   To set up agents, you can:');
    console.error('   • Run "agent-pipeline init" to scaffold the project with example agents');
    console.error('   • Run "agent-pipeline agent pull" to import agents from Claude Code plugins');
    console.error('   • Manually copy agent .md files to .agent-pipeline/agents/');
    process.exit(1);
  }

  console.log(`✅ Found ${mdAgents.length} agent(s)\n`);

  // Interactive prompts
  const name = await InteractivePrompts.ask('Pipeline name');
  const nameValidation = validatePipelineName(name);
  if (!nameValidation.valid) {
    console.error(`❌ ${nameValidation.error}`);
    process.exit(1);
  }

  const trigger = await InteractivePrompts.choose(
    '\nTrigger type:',
    ['manual', 'pre-commit', 'post-commit', 'pre-push', 'post-merge'] as const,
    'manual'
  );

  const autoCommit = await InteractivePrompts.confirm(
    '\nAuto-commit changes?',
    trigger !== 'pre-commit' && trigger !== 'pre-push'
  );

  // Select agents one at a time with dependency configuration
  const selectedAgents = await selectAgentsOneByOne(mdAgents);

  if (selectedAgents.length === 0) {
    console.error('❌ At least one agent must be selected');
    process.exit(1);
  }

  // Build minimal pipeline config - only include non-default values
  const config: PipelineConfig = {
    name,
    trigger,
    // Only include git settings when autoCommit is enabled
    ...(autoCommit && {
      git: {
        autoCommit: true,
        commitPrefix: '[pipeline:{{stage}}]',
      }
    }),
    agents: selectedAgents.map(agent => ({
      name: agent.name,
      agent: `.agent-pipeline/agents/${agent.file}`,
      ...(agent.dependsOn.length > 0 && { dependsOn: agent.dependsOn })
    }))
  };

  // Validate config
  console.log('\n📋 Validating pipeline configuration...\n');
  const isValid = await PipelineValidator.validateAndReport(config, repoPath);

  if (!isValid) {
    console.error('❌ Pipeline configuration is invalid');
    process.exit(1);
  }

  // Save pipeline
  const pipelinesDir = path.join(repoPath, '.agent-pipeline', 'pipelines');
  try {
    await fs.mkdir(pipelinesDir, { recursive: true });
  } catch (error) {
    console.error(`❌ Failed to create pipelines directory: ${(error as Error).message}`);
    process.exit(1);
  }

  const pipelinePath = path.join(pipelinesDir, `${name}.yml`);

  // Check if pipeline already exists
  try {
    await fs.access(pipelinePath);
    const overwrite = await InteractivePrompts.confirm(
      `\n⚠️  Pipeline "${name}" already exists. Overwrite?`,
      false
    );
    if (!overwrite) {
      console.log('Cancelled.');
      return;
    }
  } catch {
    // File doesn't exist, good to create
  }

  try {
    await fs.writeFile(pipelinePath, YAML.stringify(config), 'utf-8');
  } catch (error) {
    console.error(`❌ Failed to write pipeline file: ${(error as Error).message}`);
    process.exit(1);
  }

  console.log(`\n✅ Pipeline created successfully!`);
  console.log(`   Location: .agent-pipeline/pipelines/${name}.yml`);
  console.log(`\n   Agents use default timeout (15 min). Customize in YAML if needed.`);
  console.log(`\n💡 Next steps:`);
  console.log(`   - Preview config: agent-pipeline config ${name}`);
  console.log(`   - Run the pipeline: agent-pipeline run ${name}`);
  if (trigger !== 'manual') {
    console.log(`   - Install git hook: agent-pipeline install ${name}`);
  }
  console.log(`   - Edit if needed: agent-pipeline edit ${name}`);
  console.log('');
}
