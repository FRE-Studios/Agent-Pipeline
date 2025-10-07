// src/core/pipeline-runner.ts

import { v4 as uuidv4 } from 'uuid';
import { GitManager } from './git-manager.js';
import { StageExecutor } from './stage-executor.js';
import { StateManager } from './state-manager.js';
import { PipelineConfig, PipelineState } from '../config/schema.js';

export class PipelineRunner {
  private gitManager: GitManager;
  private stageExecutor: StageExecutor;
  private stateManager: StateManager;
  private dryRun: boolean;
  private stateUpdateCallbacks: Array<(state: PipelineState) => void> = [];

  constructor(repoPath: string, dryRun: boolean = false) {
    this.gitManager = new GitManager(repoPath);
    this.stageExecutor = new StageExecutor(this.gitManager, dryRun);
    this.stateManager = new StateManager(repoPath);
    this.dryRun = dryRun;
  }

  async runPipeline(
    config: PipelineConfig,
    options: { interactive?: boolean } = {}
  ): Promise<PipelineState> {
    const triggerCommit = await this.gitManager.getCurrentCommit();
    const changedFiles = await this.gitManager.getChangedFiles(triggerCommit);

    const state: PipelineState = {
      runId: uuidv4(),
      pipelineConfig: config,
      trigger: {
        type: config.trigger,
        commitSha: triggerCommit,
        timestamp: new Date().toISOString()
      },
      stages: [],
      status: 'running',
      artifacts: {
        initialCommit: triggerCommit,
        changedFiles,
        totalDuration: 0
      }
    };

    if (this.dryRun) {
      console.log(`\n🧪 DRY RUN MODE - No commits will be created\n`);
    }

    // Show simple console output if not interactive
    if (!options.interactive) {
      console.log(`\n🚀 Starting pipeline: ${config.name}`);
      console.log(`📦 Run ID: ${state.runId}`);
      console.log(`📝 Trigger commit: ${triggerCommit.substring(0, 7)}\n`);
    }

    // Notify initial state
    this.notifyStateChange(state);

    const startTime = Date.now();

    try {
      for (const agentConfig of config.agents) {
        if (agentConfig.enabled === false) {
          if (!options.interactive) {
            console.log(`⏭️  Skipping disabled stage: ${agentConfig.name}\n`);
          }
          state.stages.push({
            stageName: agentConfig.name,
            status: 'skipped',
            startTime: new Date().toISOString()
          });
          this.notifyStateChange(state);
          continue;
        }

        if (!options.interactive) {
          console.log(`🤖 Running stage: ${agentConfig.name}...`);
        }

        const stageResult = await this.stageExecutor.executeStage(
          agentConfig,
          state,
          (output) => {
            // Stream output to UI in real-time
            const currentStage = state.stages[state.stages.length - 1];
            if (currentStage) {
              currentStage.agentOutput = output;
              this.notifyStateChange(state);
            }
          }
        );

        state.stages.push(stageResult);
        await this.stateManager.saveState(state);
        this.notifyStateChange(state);

        // Handle stage failure
        if (stageResult.status === 'failed') {
          const failureStrategy = agentConfig.onFail || config.settings?.failureStrategy || 'stop';

          if (failureStrategy === 'stop') {
            if (!options.interactive) {
              console.log(`\n🛑 Pipeline stopped due to stage failure\n`);
            }
            state.status = 'failed';
            break;
          } else if (failureStrategy === 'warn') {
            if (!options.interactive) {
              console.log(`\n⚠️  Stage failed but continuing (warn mode)\n`);
            }
          }
        }

        if (!options.interactive) {
          console.log(''); // Empty line between stages
        }
      }

      if (state.status === 'running') {
        state.status = 'completed';
      }

    } catch (error) {
      state.status = 'failed';
      if (!options.interactive) {
        console.error(`\n❌ Pipeline failed: ${error}\n`);
      }
    }

    const endTime = Date.now();
    state.artifacts.totalDuration = (endTime - startTime) / 1000;
    state.artifacts.finalCommit = await this.gitManager.getCurrentCommit();

    await this.stateManager.saveState(state);
    this.notifyStateChange(state);

    // Only print summary if not in interactive mode
    if (!options.interactive) {
      this.printSummary(state);
    }

    return state;
  }

  private printSummary(state: PipelineState): void {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Pipeline Summary: ${state.pipelineConfig.name}`);
    console.log(`${'='.repeat(60)}\n`);

    console.log(`Status: ${this.getStatusEmoji(state.status)} ${state.status.toUpperCase()}`);
    console.log(`Duration: ${state.artifacts.totalDuration.toFixed(2)}s`);
    console.log(`Commits: ${state.trigger.commitSha.substring(0, 7)} → ${state.artifacts.finalCommit?.substring(0, 7)}\n`);

    console.log('Stages:');
    for (const stage of state.stages) {
      const emoji = this.getStatusEmoji(stage.status);
      const duration = stage.duration ? `(${stage.duration.toFixed(1)}s)` : '';
      console.log(`  ${emoji} ${stage.stageName} ${duration}`);
      if (stage.commitSha) {
        console.log(`     └─ Commit: ${stage.commitSha.substring(0, 7)}`);
      }
      if (stage.error) {
        console.log(`     └─ Error: ${stage.error.message}`);
      }
    }

    console.log(`\n${'='.repeat(60)}\n`);
  }

  private getStatusEmoji(status: string): string {
    const emojiMap: Record<string, string> = {
      'running': '⏳',
      'success': '✅',
      'completed': '✅',
      'failed': '❌',
      'skipped': '⏭️',
      'pending': '⏸️',
      'partial': '⚠️'
    };
    return emojiMap[status] || '❓';
  }

  private notifyStateChange(state: PipelineState): void {
    for (const callback of this.stateUpdateCallbacks) {
      callback(state);
    }
  }

  onStateChange(callback: (state: PipelineState) => void): void {
    this.stateUpdateCallbacks.push(callback);
  }
}
