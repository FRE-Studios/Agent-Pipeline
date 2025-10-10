#!/usr/bin/env node

// src/index.ts

import React from 'react';
import { render } from 'ink';
import { PipelineRunner } from './core/pipeline-runner.js';
import { PipelineLoader } from './config/pipeline-loader.js';
import { StateManager } from './core/state-manager.js';
import { Logger } from './utils/logger.js';
import { HookInstaller } from './cli/hooks.js';
import { rollbackCommand } from './cli/commands/rollback.js';
import { PipelineValidator } from './validators/pipeline-validator.js';
import { initCommand } from './cli/commands/init.js';
import { PipelineUI } from './ui/pipeline-ui.js';
import { HistoryBrowser } from './cli/commands/history.js';
import { analyticsCommand } from './cli/commands/analytics.js';
import { cleanupCommand } from './cli/commands/cleanup.js';
import { NotificationManager } from './notifications/notification-manager.js';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const subCommand = args[1];

  const repoPath = process.cwd();

  try {
    switch (command) {
      case 'run': {
        if (!subCommand) {
          console.error('Usage: agent-pipeline run <pipeline-name> [--dry-run] [--no-interactive] [--no-pr] [--base-branch <branch>] [--pr-draft] [--pr-web] [--no-notifications]');
          process.exit(1);
        }

        // Check for flags
        const dryRun = args.includes('--dry-run');
        const noInteractive = args.includes('--no-interactive');
        const interactive = !noInteractive;
        const noPr = args.includes('--no-pr');
        const prDraft = args.includes('--pr-draft');
        const prWeb = args.includes('--pr-web');
        const noNotifications = args.includes('--no-notifications');

        // Parse base-branch option
        let baseBranch: string | undefined;
        const baseBranchIndex = args.indexOf('--base-branch');
        if (baseBranchIndex !== -1 && args[baseBranchIndex + 1]) {
          baseBranch = args[baseBranchIndex + 1];
        }

        const loader = new PipelineLoader(repoPath);
        const config = await loader.loadPipeline(subCommand);

        // Apply CLI flag overrides
        if (noNotifications) {
          config.notifications = { enabled: false };
        }

        if (noPr && config.git?.pullRequest) {
          config.git.pullRequest.autoCreate = false;
        }

        if (baseBranch && config.git) {
          config.git.baseBranch = baseBranch;
        }

        if (prDraft && config.git?.pullRequest) {
          config.git.pullRequest.draft = true;
        }

        if (prWeb && config.git?.pullRequest) {
          config.git.pullRequest.web = true;
        }

        // Validate pipeline configuration
        const isValid = await PipelineValidator.validateAndReport(config, repoPath);
        if (!isValid) {
          process.exit(1);
        }

        const runner = new PipelineRunner(repoPath, dryRun);

        // Render UI if interactive
        let uiInstance;
        if (interactive) {
          uiInstance = render(
            React.createElement(PipelineUI, {
              onStateChange: (callback) => {
                runner.onStateChange(callback);
              }
            })
          );
        }

        try {
          const result = await runner.runPipeline(config, { interactive });

          if (uiInstance) {
            uiInstance.unmount();
          }

          process.exit(result.status === 'completed' ? 0 : 1);
        } catch (error) {
          if (uiInstance) {
            uiInstance.unmount();
          }
          throw error;
        }
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

            if (stage.extractedData && Object.keys(stage.extractedData).length > 0) {
              console.log(`   Extracted Data:`);
              for (const [key, value] of Object.entries(stage.extractedData)) {
                console.log(`     - ${key}: ${value}`);
              }
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
        break;
      }

      case 'install': {
        if (!subCommand) {
          console.error('Usage: agent-pipeline install <pipeline-name>');
          process.exit(1);
        }

        // Load pipeline config to get trigger type
        const loader = new PipelineLoader(repoPath);
        const config = await loader.loadPipeline(subCommand);

        // Validate that the trigger is not 'manual'
        if (config.trigger === 'manual') {
          console.error('❌ Cannot install git hook for manual pipelines.');
          console.error(`   Pipeline "${subCommand}" has trigger: manual`);
          console.error(`   Use 'agent-pipeline run ${subCommand}' instead.`);
          process.exit(1);
        }

        const installer = new HookInstaller(repoPath);
        await installer.install(subCommand, config.trigger);
        break;
      }

      case 'uninstall': {
        const installer = new HookInstaller(repoPath);
        await installer.uninstall();
        break;
      }

      case 'rollback': {
        // Parse options
        const options: { runId?: string; stages?: number } = {};

        // Simple argument parsing
        for (let i = 1; i < args.length; i++) {
          if (args[i] === '--run-id' || args[i] === '-r') {
            options.runId = args[++i];
          } else if (args[i] === '--stages' || args[i] === '-s') {
            options.stages = parseInt(args[++i], 10);
          }
        }

        await rollbackCommand(repoPath, options);
        break;
      }

      case 'init': {
        await initCommand(repoPath);
        break;
      }

      case 'history': {
        render(React.createElement(HistoryBrowser, { repoPath }));
        break;
      }

      case 'analytics': {
        // Parse options
        const options: { pipeline?: string; days?: number } = {};

        for (let i = 1; i < args.length; i++) {
          if (args[i] === '--pipeline' || args[i] === '-p') {
            options.pipeline = args[++i];
          } else if (args[i] === '--days' || args[i] === '-d') {
            options.days = parseInt(args[++i], 10);
          }
        }

        await analyticsCommand(repoPath, options);
        break;
      }

      case 'cleanup': {
        // Parse options
        const options: { pipeline?: string; force?: boolean } = {};

        for (let i = 1; i < args.length; i++) {
          if (args[i] === '--pipeline' || args[i] === '-p') {
            options.pipeline = args[++i];
          } else if (args[i] === '--force' || args[i] === '-f') {
            options.force = true;
          }
        }

        await cleanupCommand(repoPath, options);
        break;
      }

      case 'test': {
        if (!subCommand) {
          console.error('Usage: agent-pipeline test <pipeline-name> --notifications');
          process.exit(1);
        }

        const testNotifications = args.includes('--notifications');

        if (testNotifications) {
          const loader = new PipelineLoader(repoPath);
          const config = await loader.loadPipeline(subCommand);

          if (!config.notifications) {
            console.log('❌ No notification configuration found in pipeline');
            process.exit(1);
          }

          const manager = new NotificationManager(config.notifications);
          await manager.test();
        } else {
          console.log('Usage: agent-pipeline test <pipeline-name> --notifications');
        }
        break;
      }

      default: {
        console.log(`
Agent Pipeline - Sequential agent execution with state management

Usage:
  agent-pipeline run <pipeline-name> [options]    Run a pipeline
  agent-pipeline list                              List available pipelines
  agent-pipeline status                            Show last pipeline run status
  agent-pipeline history                           Browse pipeline history (interactive)
  agent-pipeline analytics [options]               Show pipeline analytics
  agent-pipeline test <pipeline-name> [options]    Test pipeline configuration
  agent-pipeline install <pipeline-name>           Install git hook (respects pipeline trigger)
  agent-pipeline uninstall                         Remove all agent-pipeline git hooks
  agent-pipeline rollback [options]                Rollback pipeline commits
  agent-pipeline cleanup [options]                 Clean up pipeline branches
  agent-pipeline init                              Initialize agent-pipeline project

Run Options:
  --dry-run                  Test without creating commits
  --no-interactive           Disable live UI (use simple console output)
  --no-notifications         Disable all notifications
  --no-pr                    Skip PR creation even if configured
  --base-branch <branch>     Override base branch for PR
  --pr-draft                 Create PR as draft
  --pr-web                   Open PR in browser for editing

Test Options:
  --notifications            Test notification channels

Analytics Options:
  -p, --pipeline <name>      Filter by pipeline name
  -d, --days <n>             Filter by last N days

Rollback Options:
  -r, --run-id <id>          Rollback specific run ID
  -s, --stages <n>           Rollback last N stages

Cleanup Options:
  -p, --pipeline <name>      Clean up specific pipeline branches
  -f, --force                Delete without confirmation

Examples:
  agent-pipeline run commit-review
  agent-pipeline run commit-review --dry-run
  agent-pipeline run commit-review --no-interactive
  agent-pipeline run commit-review --no-notifications
  agent-pipeline run commit-review --no-pr
  agent-pipeline run commit-review --pr-draft --pr-web
  agent-pipeline test commit-review --notifications
  agent-pipeline list
  agent-pipeline status
  agent-pipeline history
  agent-pipeline analytics --pipeline commit-review --days 30
  agent-pipeline cleanup --pipeline commit-review --force
  agent-pipeline install commit-review
  agent-pipeline uninstall
  agent-pipeline rollback
  agent-pipeline rollback --stages 2
  agent-pipeline rollback --run-id <uuid>
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
