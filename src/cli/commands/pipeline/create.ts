// src/cli/commands/pipeline/create.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import * as YAML from 'yaml';
import { InteractivePrompts } from '../../utils/interactive-prompts.js';
import { PipelineValidator } from '../../../validators/pipeline-validator.js';

export async function createPipelineCommand(repoPath: string): Promise<void> {
  console.log('\n🎯 Create New Pipeline\n');

  // Check if agents exist
  const agentsDir = path.join(repoPath, '.agent-pipeline', 'agents');
  try {
    const agentFiles = await fs.readdir(agentsDir);
    const mdAgents = agentFiles.filter(f => f.endsWith('.md') && !f.startsWith('.'));

    if (mdAgents.length === 0) {
      console.error('❌ No agents found in .agent-pipeline/agents/');
      console.error('   Please run "agent-pipeline init" or "agent-pipeline agent pull" first.');
      process.exit(1);
    }

    console.log(`✅ Found ${mdAgents.length} agent(s)\n`);

    // Interactive prompts
    const name = await InteractivePrompts.ask('Pipeline name');
    if (!name) {
      console.error('Pipeline name is required');
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
      '\nSelect agents to include:',
      agentOptions
    );

    if (selectedAgents.length === 0) {
      console.error('❌ At least one agent must be selected');
      process.exit(1);
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
      agents: selectedAgents.map(agent => ({
        name: agent.replace('.md', ''),
        agent: `.agent-pipeline/agents/${agent}`,
        timeout: 120
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
    await fs.mkdir(pipelinesDir, { recursive: true });

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

    await fs.writeFile(pipelinePath, YAML.stringify(config), 'utf-8');

    console.log(`\n✅ Pipeline created successfully!`);
    console.log(`   Location: .agent-pipeline/pipelines/${name}.yml`);
    console.log(`\n💡 Next steps:`);
    console.log(`   - Review and customize: agent-pipeline edit ${name}`);
    console.log(`   - Run the pipeline: agent-pipeline run ${name}`);
    if (trigger !== 'manual') {
      console.log(`   - Install git hook: agent-pipeline install ${name}`);
    }
    console.log('');
  } catch (error) {
    console.error(`❌ Failed to create pipeline: ${(error as Error).message}`);
    process.exit(1);
  }
}
