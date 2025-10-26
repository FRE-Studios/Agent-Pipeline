// src/cli/commands/pipeline/validate.ts

import { PipelineLoader } from '../../../config/pipeline-loader.js';
import { PipelineValidator } from '../../../validators/pipeline-validator.js';

export async function validatePipelineCommand(
  repoPath: string,
  pipelineName: string
): Promise<void> {
  try {
    console.log(`\n📋 Validating pipeline: ${pipelineName}\n`);

    const loader = new PipelineLoader(repoPath);
    const { config } = await loader.loadPipeline(pipelineName);

    const isValid = await PipelineValidator.validateAndReport(config, repoPath);

    if (isValid) {
      console.log('\n✅ Pipeline is valid!\n');
      process.exit(0);
    } else {
      console.log('\n❌ Pipeline has validation errors\n');
      process.exit(1);
    }
  } catch (error) {
    if ((error as any).message?.includes('Pipeline not found')) {
      console.error(`❌ Pipeline "${pipelineName}" not found`);
    } else {
      console.error(`❌ Validation failed: ${(error as Error).message}`);
    }
    process.exit(1);
  }
}
