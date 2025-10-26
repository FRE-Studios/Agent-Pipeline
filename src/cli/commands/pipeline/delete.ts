// src/cli/commands/pipeline/delete.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import { PipelineLoader } from '../../../config/pipeline-loader.js';
import { InteractivePrompts } from '../../utils/interactive-prompts.js';

export interface DeletePipelineOptions {
  force?: boolean;
  deleteLogs?: boolean;
}

export async function deletePipelineCommand(
  repoPath: string,
  pipelineName: string,
  options: DeletePipelineOptions = {}
): Promise<void> {
  try {
    // Load pipeline to verify it exists and show details
    const loader = new PipelineLoader(repoPath);
    const { config } = await loader.loadPipeline(pipelineName);

    console.log(`\n🗑️  Delete Pipeline: ${pipelineName}\n`);
    console.log(`   Trigger: ${config.trigger}`);
    console.log(`   Agents: ${config.agents.length}`);
    console.log('');

    // Confirm deletion
    if (!options.force) {
      const confirmed = await InteractivePrompts.confirm(
        `Are you sure you want to delete "${pipelineName}" pipeline?`,
        false
      );

      if (!confirmed) {
        console.log('Cancelled.');
        return;
      }
    }

    // Delete pipeline file
    const pipelinePath = path.join(
      repoPath,
      '.agent-pipeline',
      'pipelines',
      `${pipelineName}.yml`
    );

    await fs.unlink(pipelinePath);
    console.log(`✅ Deleted pipeline: ${pipelineName}`);

    // Ask about deleting associated logs
    const deleteLogs = options.deleteLogs ?? await InteractivePrompts.confirm(
      '\nDelete associated history files?',
      false
    );

    if (deleteLogs) {
      // Delete state files for this pipeline
      const stateDir = path.join(repoPath, '.agent-pipeline', 'state', 'runs');
      try {
        const stateFiles = await fs.readdir(stateDir);
        let deletedCount = 0;

        for (const file of stateFiles) {
          if (!file.endsWith('.json')) continue;

          const statePath = path.join(stateDir, file);
          const content = await fs.readFile(statePath, 'utf-8');
          const state = JSON.parse(content);

          if (state.pipelineConfig?.name === pipelineName) {
            await fs.unlink(statePath);
            deletedCount++;
          }
        }

        if (deletedCount > 0) {
          console.log(`✅ Deleted ${deletedCount} history file(s)`);
        }
      } catch (error) {
        console.log(`⚠️  Could not delete history files: ${(error as Error).message}`);
      }
    }

    console.log('');
  } catch (error) {
    if ((error as any).message?.includes('Pipeline not found')) {
      console.error(`❌ Pipeline "${pipelineName}" not found`);
    } else {
      console.error(`❌ Failed to delete pipeline: ${(error as Error).message}`);
    }
    process.exit(1);
  }
}
