#!/usr/bin/env node

// src/index.ts

import { PipelineRunner } from './core/pipeline-runner.js';
import { PipelineLoader } from './config/pipeline-loader.js';
import { StateManager } from './core/state-manager.js';
import { Logger } from './utils/logger.js';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const subCommand = args[1];

  const repoPath = process.cwd();

  try {
    switch (command) {
      case 'run': {
        if (!subCommand) {
          console.error('Usage: agent-pipeline run <pipeline-name>');
          process.exit(1);
        }

        const loader = new PipelineLoader(repoPath);
        const config = await loader.loadPipeline(subCommand);

        const runner = new PipelineRunner(repoPath);
        const result = await runner.runPipeline(config);

        process.exit(result.status === 'completed' ? 0 : 1);
        break;
      }

      case 'list': {
        const loader = new PipelineLoader(repoPath);
        const pipelines = await loader.listPipelines();

        if (pipelines.length === 0) {
          console.log('No pipelines found in .agent-pipeline/pipelines/');
        } else {
          console.log('Available pipelines:');
          pipelines.forEach(p => console.log(`  - ${p}`));
        }
        break;
      }

      case 'status': {
        const stateManager = new StateManager(repoPath);
        const latestRun = await stateManager.getLatestRun();

        if (!latestRun) {
          console.log('No pipeline runs found');
        } else {
          console.log(`\nLatest Pipeline Run:`);
          console.log(`  Name: ${latestRun.pipelineConfig.name}`);
          console.log(`  Run ID: ${latestRun.runId}`);
          console.log(`  Status: ${latestRun.status}`);
          console.log(`  Duration: ${latestRun.artifacts.totalDuration.toFixed(2)}s`);
          console.log(`  Timestamp: ${latestRun.trigger.timestamp}\n`);

          console.log('Stages:');
          latestRun.stages.forEach(stage => {
            const statusIcon = stage.status === 'success' ? '✅' :
                             stage.status === 'failed' ? '❌' :
                             stage.status === 'skipped' ? '⏭️' : '⏳';
            console.log(`  ${statusIcon} ${stage.stageName} (${stage.status})`);
          });
        }
        break;
      }

      case 'init': {
        // TODO: Implement init command
        console.log('Initializing agent-pipeline...');
        Logger.info('Creating .agent-pipeline directory structure');
        // This would create the directory structure and example files
        break;
      }

      default: {
        console.log(`
Agent Pipeline - Sequential agent execution with state management

Usage:
  agent-pipeline run <pipeline-name>    Run a pipeline
  agent-pipeline list                   List available pipelines
  agent-pipeline status                 Show last pipeline run status
  agent-pipeline init                   Initialize agent-pipeline (coming soon)

Examples:
  agent-pipeline run commit-review
  agent-pipeline list
  agent-pipeline status
        `);
      }
    }
  } catch (error) {
    Logger.error((error as Error).message);
    if (process.env.DEBUG) {
      console.error(error);
    }
    process.exit(1);
  }
}

main();
