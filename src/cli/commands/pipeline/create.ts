// src/cli/commands/pipeline/create.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import * as YAML from 'yaml';
import { InteractivePrompts } from '../../utils/interactive-prompts.js';
import { PipelineValidator } from '../../../validators/pipeline-validator.js';

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

  const executionMode = await InteractivePrompts.choose(
    '\nExecution mode:',
    ['parallel', 'sequential'] as const,
    'parallel'
  );

  const autoCommit = await InteractivePrompts.confirm(
    '\nAuto-commit changes?',
    trigger !== 'pre-commit' && trigger !== 'pre-push'
  );

  // Select agents
  const agentOptions = mdAgents.map(agent => ({
    name: agent.replace('.md', ''),
    value: agent
  }));

  const selectedAgents = await InteractivePrompts.multiSelect(
    '\nSelect agents in execution order:',
    agentOptions
  );

  if (selectedAgents.length === 0) {
    console.error('❌ At least one agent must be selected');
    process.exit(1);
  }

  // Configure dependencies for parallel mode
  const dependencies: Map<string, string[]> = new Map();

  if (executionMode === 'parallel' && selectedAgents.length > 1) {
    console.log('\nDependency pattern:');
    console.log('  1. All parallel (no dependencies, all run simultaneously)');
    console.log('  2. Sequential chain (each waits for previous)');
    console.log('  3. Fan-out (all depend on first agent)');
    console.log('  4. Custom (configure each agent)');

    const dependencyPattern = await InteractivePrompts.choose(
      '',
      ['all-parallel', 'sequential-chain', 'fan-out', 'custom'] as const,
      'all-parallel'
    );

    const agentNames = selectedAgents.map(a => a.replace('.md', ''));

    if (dependencyPattern === 'sequential-chain') {
      // Each agent depends on the previous one
      for (let i = 1; i < agentNames.length; i++) {
        dependencies.set(agentNames[i], [agentNames[i - 1]]);
      }
    } else if (dependencyPattern === 'fan-out') {
      // All agents depend on the first one
      const firstAgent = agentNames[0];
      for (let i = 1; i < agentNames.length; i++) {
        dependencies.set(agentNames[i], [firstAgent]);
      }
    } else if (dependencyPattern === 'custom') {
      // Ask for each agent's dependencies
      for (let i = 1; i < agentNames.length; i++) {
        const currentAgent = agentNames[i];
        const priorAgents = agentNames.slice(0, i);

        const deps = await InteractivePrompts.multiSelect(
          `\nWhich agents should "${currentAgent}" wait for? (Enter to skip)`,
          priorAgents.map(a => ({ name: a, value: a }))
        );

        if (deps.length > 0) {
          dependencies.set(currentAgent, deps);
        }
      }
    }
    // 'all-parallel' needs no dependencies
  }

  // Build pipeline config
  const config: any = {
    name,
    trigger,
    settings: {
      autoCommit,
      commitPrefix: `[pipeline:{{stage}}]`,
      failureStrategy: 'continue',
      preserveWorkingTree: trigger === 'pre-commit' || trigger === 'pre-push',
      executionMode
    },
    agents: selectedAgents.map(agent => {
      const agentName = agent.replace('.md', '');
      const deps = dependencies.get(agentName);
      return {
        name: agentName,
        agent: `.agent-pipeline/agents/${agent}`,
        timeout: 120,
        ...(deps && deps.length > 0 && { dependsOn: deps })
      };
    })
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
  console.log(`\n💡 Next steps:`);
  console.log(`   - Review and customize: agent-pipeline edit ${name}`);
  console.log(`   - Run the pipeline: agent-pipeline run ${name}`);
  if (trigger !== 'manual') {
    console.log(`   - Install git hook: agent-pipeline install ${name}`);
  }
  console.log('');
}
