// src/cli/commands/run.ts

import React from 'react';
import { render } from 'ink';
import { PipelineRunner } from '../../core/pipeline-runner.js';
import { PipelineLoader } from '../../config/pipeline-loader.js';
import { PipelineValidator } from '../../validators/pipeline-validator.js';
import { PipelineUI } from '../../ui/pipeline-ui.js';
import { PipelineMetadata } from '../../config/schema.js';
import { openInPager } from '../../utils/platform-opener.js';
import { PipelineAbortController } from '../../core/abort-controller.js';

export interface RunOptions {
  dryRun?: boolean;
  interactive?: boolean;
  verbose?: boolean;
  baseBranch?: string;
  prDraft?: boolean;
  prWeb?: boolean;
  noNotifications?: boolean;
  loop?: boolean;
  loopMetadata?: PipelineMetadata;
  maxLoopIterations?: number;
}

export async function runCommand(
  repoPath: string,
  pipelineName: string,
  options: RunOptions = {}
): Promise<void> {
  const loader = new PipelineLoader(repoPath);
  const { config, metadata } = await loader.loadPipeline(pipelineName);

  // Apply CLI flag overrides
  if (options.noNotifications) {
    config.notifications = { enabled: false };
  }

  if (options.baseBranch && config.git) {
    config.git.baseBranch = options.baseBranch;
  }

  if (options.prDraft && config.git?.pullRequest) {
    config.git.pullRequest.draft = true;
  }

  if (options.prWeb && config.git?.pullRequest) {
    config.git.pullRequest.web = true;
  }

  // Validate pipeline configuration
  const isValid = await PipelineValidator.validateAndReport(config, repoPath);
  if (!isValid) {
    process.exit(1);
  }

  const runner = new PipelineRunner(repoPath, options.dryRun);
  const interactive = options.interactive ?? true;

  // Create abort controller for graceful pipeline cancellation
  const abortController = new PipelineAbortController();

  // Handle SIGINT (Ctrl+C) for graceful abort
  let sigintHandled = false;
  const handleSigint = () => {
    if (sigintHandled) {
      // Second Ctrl+C - force exit
      console.log('\n⚠️  Force exiting...');
      process.exit(1);
    }
    sigintHandled = true;
    console.log('\n⚠️  Aborting pipeline... (Press Ctrl+C again to force exit)');
    abortController.abort();
  };
  process.on('SIGINT', handleSigint);

  // Compute loop metadata (use explicit metadata or default from loader)
  const loopMetadata = options.loopMetadata ?? metadata;

  // Track if user requested to open logs (set by callback before Ink exits)
  let pendingLogPath: string | null = null;

  // Render UI if interactive
  let uiInstance;
  if (interactive) {
    uiInstance = render(
      React.createElement(PipelineUI, {
        onStateChange: (callback) => {
          runner.onStateChange(callback);
        },
        onOpenLogs: (logPath) => {
          pendingLogPath = logPath;
        }
      })
    );
  }

  try {
    const result = await runner.runPipeline(config, {
      interactive,
      verbose: options.verbose ?? false,
      loop: options.loop,
      loopMetadata,
      maxLoopIterations: options.maxLoopIterations,
      abortController
    });

    // Determine exit code based on status and termination reason
    const exitCode = result.status === 'completed'
      ? (result.loopContext?.terminationReason === 'limit-reached' ? 1 : 0)
      : (result.status === 'aborted' ? 130 : 1); // 130 is standard for SIGINT

    // In interactive mode, wait for user to dismiss the summary before exiting
    if (uiInstance) {
      await uiInstance.waitUntilExit();
    }

    // If user requested to view logs, open pager before exiting
    if (pendingLogPath) {
      await openInPager(pendingLogPath);
    }

    process.exit(exitCode);
  } catch (error) {
    throw error;
  } finally {
    // Clean up SIGINT handler
    process.off('SIGINT', handleSigint);
    // Only unmount UI on error (normal exit is handled by InteractiveSummary)
    if (uiInstance) {
      uiInstance.unmount();
    }
  }
}
