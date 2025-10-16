// src/cli/commands/run.ts

import React from 'react';
import { render } from 'ink';
import { PipelineRunner } from '../../core/pipeline-runner.js';
import { PipelineLoader } from '../../config/pipeline-loader.js';
import { PipelineValidator } from '../../validators/pipeline-validator.js';
import { PipelineUI } from '../../ui/pipeline-ui.js';

export interface RunOptions {
  dryRun?: boolean;
  interactive?: boolean;
  noPr?: boolean;
  baseBranch?: string;
  prDraft?: boolean;
  prWeb?: boolean;
  noNotifications?: boolean;
}

export async function runCommand(
  repoPath: string,
  pipelineName: string,
  options: RunOptions = {}
): Promise<void> {
  const loader = new PipelineLoader(repoPath);
  const config = await loader.loadPipeline(pipelineName);

  // Apply CLI flag overrides
  if (options.noNotifications) {
    config.notifications = { enabled: false };
  }

  if (options.noPr && config.git?.pullRequest) {
    config.git.pullRequest.autoCreate = false;
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
}
