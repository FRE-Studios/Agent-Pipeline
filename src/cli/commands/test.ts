// src/cli/commands/test.ts

import { PipelineLoader } from '../../config/pipeline-loader.js';
import { NotificationManager } from '../../notifications/notification-manager.js';

export interface TestOptions {
  notifications?: boolean;
}

export async function testCommand(
  repoPath: string,
  pipelineName: string,
  options: TestOptions = {}
): Promise<void> {
  if (options.notifications) {
    const loader = new PipelineLoader(repoPath);
    const config = await loader.loadPipeline(pipelineName);

    if (!config.notifications) {
      console.log('❌ No notification configuration found in pipeline');
      process.exit(1);
    }

    const manager = new NotificationManager(config.notifications);
    await manager.test();
  } else {
    console.log('Usage: agent-pipeline test <pipeline-name> --notifications');
  }
}
