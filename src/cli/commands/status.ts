// src/cli/commands/status.ts

import { StateManager } from '../../core/state-manager.js';

export async function statusCommand(repoPath: string): Promise<void> {
  const stateManager = new StateManager(repoPath);
  const latestRun = await stateManager.getLatestRun();

  if (!latestRun) {
    console.log('No pipeline runs found');
    return;
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Latest Pipeline Run: ${latestRun.pipelineConfig.name}`);
  console.log(`${'='.repeat(60)}\n`);

  console.log(`Run ID:       ${latestRun.runId}`);
  console.log(`Status:       ${latestRun.status.toUpperCase()}`);
  console.log(`Duration:     ${latestRun.artifacts.totalDuration.toFixed(2)}s`);
  console.log(`Timestamp:    ${latestRun.trigger.timestamp}`);
  console.log(`Trigger:      ${latestRun.trigger.type}`);
  console.log(`Initial Commit: ${latestRun.artifacts.initialCommit?.substring(0, 7) || 'N/A'}`);
  console.log(`Final Commit:   ${latestRun.artifacts.finalCommit?.substring(0, 7) || 'N/A'}`);

  if (latestRun.artifacts.pullRequest) {
    console.log(`Pull Request:   ${latestRun.artifacts.pullRequest.url}`);
    console.log(`PR Branch:      ${latestRun.artifacts.pullRequest.branch}`);
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log('Stages:\n');

  latestRun.stages.forEach(stage => {
    const statusIcon = stage.status === 'success' ? '✅' :
                     stage.status === 'failed' ? '❌' :
                     stage.status === 'skipped' ? '⏭️' : '⏳';
    const duration = stage.duration ? `${stage.duration.toFixed(1)}s` : 'N/A';

    console.log(`${statusIcon} ${stage.stageName}`);
    console.log(`   Status: ${stage.status}`);
    console.log(`   Duration: ${duration}`);

    if (stage.commitSha) {
      console.log(`   Commit: ${stage.commitSha.substring(0, 7)}`);
    }

    if (stage.error) {
      console.log(`   Error: ${stage.error.message}`);
      if (stage.error.suggestion) {
        console.log(`   💡 ${stage.error.suggestion}`);
      }
    }

    console.log('');
  });

  console.log(`${'='.repeat(60)}\n`);
}
