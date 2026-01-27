// src/cli/commands/pipeline/clone.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import * as YAML from 'yaml';
import { PipelineLoader } from '../../../config/pipeline-loader.js';

export async function clonePipelineCommand(
  repoPath: string,
  sourceName: string,
  destName?: string
): Promise<void> {
  try {
    // Load source pipeline
    const loader = new PipelineLoader(repoPath);
    const { config: sourceConfig } = await loader.loadPipeline(sourceName);

    // Determine destination name
    let targetName = destName || `${sourceName}-clone`;
    let targetPath = path.join(
      repoPath,
      '.agent-pipeline',
      'pipelines',
      `${targetName}.yml`
    );

    // If target exists, add suffix
    let suffix = 1;
    let foundUniqueName = false;

    while (!foundUniqueName) {
      try {
        await fs.access(targetPath);
        // File exists, try next suffix
        targetName = destName
          ? `${destName}-${suffix}`
          : `${sourceName}-clone-${suffix}`;
        targetPath = path.join(
          repoPath,
          '.agent-pipeline',
          'pipelines',
          `${targetName}.yml`
        );
        suffix++;
      } catch {
        // File doesn't exist, we can use this name
        foundUniqueName = true;
      }
    }

    // Update the name in the config
    const clonedConfig = { ...sourceConfig, name: targetName };

    // Save cloned pipeline
    await fs.writeFile(targetPath, YAML.stringify(clonedConfig), 'utf-8');

    console.log(`✅ Pipeline cloned successfully!`);
    console.log(`   "${sourceName}" → "${targetName}"`);
    console.log(`\n💡 Use 'agent-pipeline edit ${targetName}' to customize this pipeline\n`);
  } catch (error) {
    if ((error as any).message?.includes('Pipeline not found')) {
      console.error(`❌ Source pipeline "${sourceName}" not found`);
    } else {
      console.error(`❌ Failed to clone pipeline: ${(error as Error).message}`);
    }
    process.exit(1);
  }
}
