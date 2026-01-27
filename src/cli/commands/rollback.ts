// src/cli/commands/rollback.ts

import * as readline from 'readline';
import { GitManager } from '../../core/git-manager.js';
import { StateManager } from '../../core/state-manager.js';

export interface RollbackOptions {
  runId?: string;
  stages?: number;
}

export async function rollbackCommand(
  repoPath: string,
  options: RollbackOptions
): Promise<void> {
  const gitManager = new GitManager(repoPath);
  const stateManager = new StateManager(repoPath);

  // Get the run to rollback
  const state = options.runId
    ? await stateManager.loadState(options.runId)
    : await stateManager.getLatestRun();

  if (!state) {
    console.error('❌ No pipeline run found to rollback');
    return;
  }

  console.log(`\n🔄 Rolling back pipeline: ${state.pipelineConfig.name}`);
  console.log(`   Run ID: ${state.runId}`);

  // Determine target commit
  let targetCommit: string;

  if (options.stages) {
    // Rollback N stages
    const successfulStages = state.stages.filter(s => s.commitSha);
    if (options.stages > successfulStages.length) {
      console.error(`❌ Cannot rollback ${options.stages} stages, only ${successfulStages.length} commits found`);
      return;
    }

    const targetStage = successfulStages[successfulStages.length - options.stages - 1];
    targetCommit = targetStage?.commitSha || state.trigger.commitSha;

    console.log(`   Rolling back ${options.stages} stage(s)`);
  } else {
    // Rollback entire pipeline
    targetCommit = state.trigger.commitSha;
    console.log(`   Rolling back to initial commit`);
  }

  console.log(`   Target: ${targetCommit.substring(0, 7)}`);

  // Confirm with user
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const answer = await new Promise<string>((resolve) => {
    rl.question('\n⚠️  This will reset your branch. Continue? (y/N): ', resolve);
  });

  rl.close();

  if (answer.toLowerCase() !== 'y') {
    console.log('Cancelled.');
    return;
  }

  // Perform rollback
  await gitManager.revertToCommit(targetCommit);

  console.log(`\n✅ Rolled back successfully`);
  console.log(`   Current HEAD: ${targetCommit.substring(0, 7)}`);
  console.log(`\n💡 Tip: Use 'git reflog' to see all commits if you need to recover\n`);
}
