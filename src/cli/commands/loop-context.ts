// src/cli/commands/loop-context.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import { LoopStateManager, LoopSession } from '../../core/loop-state-manager.js';

export async function loopContextCommand(repoPath: string): Promise<void> {
  const loopStateManager = new LoopStateManager(repoPath);

  // Step 1: Find running loop sessions (not just latest run)
  const allSessions = await loopStateManager.getAllSessions();
  const runningSessions = allSessions.filter((s) => s.status === 'running');

  if (runningSessions.length === 0) {
    console.log('No active loop sessions found.');
    console.log('This command is only useful during loop mode execution.');
    return;
  }

  // If multiple running sessions, warn and use the most recent
  let session: LoopSession;
  if (runningSessions.length > 1) {
    console.log(`Warning: ${runningSessions.length} loop sessions are running concurrently.`);
    console.log('Using the most recently started session.\n');
    // Sort by startTime descending
    runningSessions.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
  }
  session = runningSessions[0];

  const sessionId = session.sessionId;

  // Step 2: Find pipeline YAML content from the running directory
  let pipelineContent: string | null = null;
  let pipelineSource = 'running';
  let pipelineName = 'unknown';

  const runningDir = path.join(repoPath, '.agent-pipeline', 'loops', sessionId, 'running');
  try {
    const files = await fs.readdir(runningDir);
    const yamlFiles = files.filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));

    if (yamlFiles.length > 0) {
      const pipelinePath = path.join(runningDir, yamlFiles[0]);
      pipelineContent = await fs.readFile(pipelinePath, 'utf-8');
      pipelineName = path.basename(yamlFiles[0], path.extname(yamlFiles[0]));
    }
  } catch {
    // Running directory doesn't exist or is empty
  }

  // Fallback: Use last iteration's pipeline name to load from library
  const lastIteration = session.iterations[session.iterations.length - 1];
  if (!pipelineContent && lastIteration) {
    pipelineName = lastIteration.pipelineName;
    const pipelinePath = path.join(repoPath, '.agent-pipeline', 'pipelines', `${pipelineName}.yml`);
    try {
      pipelineContent = await fs.readFile(pipelinePath, 'utf-8');
      pipelineSource = 'library';
    } catch {
      // Pipeline file not found in library
    }
  }

  if (!pipelineContent) {
    console.log('Could not find current pipeline file.');
    console.log(`Session ID: ${sessionId}`);
    console.log(`Checked: ${runningDir}`);
    return;
  }

  // Step 3: Get pending directory path
  const pendingDir = path.join(repoPath, '.agent-pipeline', 'loops', sessionId, 'pending');

  // Step 4: Calculate iteration info
  const currentIteration = lastIteration?.iterationNumber ?? 1;
  const maxIterations = session.maxIterations;

  // Step 5: Output the context
  console.log('='.repeat(60));
  console.log('LOOP CONTEXT - Information for Creating Next Pipeline');
  console.log('='.repeat(60));
  console.log('');
  console.log(`Loop Status: Iteration ${currentIteration}/${maxIterations}`);
  console.log(`Session ID: ${sessionId}`);
  console.log(`Pipeline Source: ${pipelineSource}`);
  console.log(`Pipeline Name: ${pipelineName}`);
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
