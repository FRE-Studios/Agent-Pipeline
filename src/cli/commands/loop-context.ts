// src/cli/commands/loop-context.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import { StateManager } from '../../core/state-manager.js';

export async function loopContextCommand(repoPath: string): Promise<void> {
  const stateManager = new StateManager(repoPath);

  // Step 1: Find the latest run with loop context
  const latestRun = await stateManager.getLatestRun();

  if (!latestRun) {
    console.log('No pipeline runs found.');
    return;
  }

  if (!latestRun.loopContext?.enabled) {
    console.log('The latest pipeline run is not in loop mode.');
    console.log('This command is only useful during loop mode execution.');
    return;
  }

  // Step 2: Find pipeline YAML content
  let pipelineContent: string | null = null;
  let pipelineSource = 'library';

  // Try to find in running directory first
  const sessionId = latestRun.loopContext.loopSessionId;
  if (sessionId) {
    const runningDir = path.join(repoPath, '.agent-pipeline', 'loops', sessionId, 'running');
    try {
      const files = await fs.readdir(runningDir);
      const yamlFiles = files.filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));

      if (yamlFiles.length > 0) {
        // Get the first running pipeline
        const pipelinePath = path.join(runningDir, yamlFiles[0]);
        pipelineContent = await fs.readFile(pipelinePath, 'utf-8');
        pipelineSource = 'running';
      }
    } catch {
      // Running directory doesn't exist or is empty - fall through to library
    }
  }

  // Fallback: Load from library if not in running directory
  if (!pipelineContent) {
    const pipelineName = latestRun.pipelineConfig.name;
    const pipelinePath = path.join(repoPath, '.agent-pipeline', 'pipelines', `${pipelineName}.yml`);
    try {
      pipelineContent = await fs.readFile(pipelinePath, 'utf-8');
    } catch {
      console.log(`Could not find pipeline file for: ${pipelineName}`);
      return;
    }
  }

  // Step 3: Get pending directory path
  const pendingDir = sessionId
    ? path.join(repoPath, '.agent-pipeline', 'loops', sessionId, 'pending')
    : path.join(repoPath, '.agent-pipeline', 'loops', 'default', 'pending');

  // Step 4: Output the context
  const currentIteration = latestRun.loopContext.currentIteration ?? 1;
  const maxIterations = latestRun.loopContext.maxIterations ?? 100;

  console.log('='.repeat(60));
  console.log('LOOP CONTEXT - Information for Creating Next Pipeline');
  console.log('='.repeat(60));
  console.log('');
  console.log(`Loop Status: Iteration ${currentIteration}/${maxIterations}`);
  console.log(`Session ID: ${sessionId || 'default'}`);
  console.log(`Pipeline Source: ${pipelineSource}`);
  console.log('');
  console.log('-'.repeat(60));
  console.log('CURRENT PIPELINE YAML');
  console.log('-'.repeat(60));
  console.log('');
  console.log(pipelineContent);
  console.log('');
  console.log('-'.repeat(60));
  console.log('RECOMMENDATIONS FOR NEXT PIPELINE');
  console.log('-'.repeat(60));
  console.log('');
  console.log('1. Keep structure identical unless another structure or file is given');
  console.log('2. Looping config is saved from first pipeline - leave unchanged');
  console.log('3. Only update customizations as needed (leave unchanged if no directions)');
  console.log('');
  console.log('-'.repeat(60));
  console.log('PENDING DIRECTORY');
  console.log('-'.repeat(60));
  console.log('');
  console.log('Write your next pipeline YAML to:');
  console.log(`  ${pendingDir}/`);
  console.log('');
  console.log('='.repeat(60));
}
