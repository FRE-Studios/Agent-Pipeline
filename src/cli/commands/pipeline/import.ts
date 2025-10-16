// src/cli/commands/pipeline/import.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import * as YAML from 'yaml';
import { PipelineValidator } from '../../../validators/pipeline-validator.js';
import { InteractivePrompts } from '../../utils/interactive-prompts.js';

export async function importPipelineCommand(
  repoPath: string,
  source: string
): Promise<void> {
  try {
    console.log('\n📥 Importing pipeline...\n');

    let content: string;

    // Check if source is a URL or file
    if (source.startsWith('http://') || source.startsWith('https://')) {
      // Fetch from URL
      console.log(`   Fetching from: ${source}`);
      const response = await fetch(source);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      content = await response.text();
    } else {
      // Read from local file
      console.log(`   Reading from: ${source}`);
      content = await fs.readFile(source, 'utf-8');
    }

    // Parse YAML
    const config = YAML.parse(content);

    if (!config.name) {
      console.error('❌ Invalid pipeline: missing name field');
      process.exit(1);
    }

    console.log(`   Pipeline name: ${config.name}\n`);

    // Validate
    console.log('📋 Validating pipeline...\n');
    const isValid = await PipelineValidator.validateAndReport(config, repoPath);

    if (!isValid) {
      console.error('❌ Pipeline validation failed');
      process.exit(1);
    }

    // Check for name conflicts
    const pipelinesDir = path.join(repoPath, '.agent-pipeline', 'pipelines');
    const targetPath = path.join(pipelinesDir, `${config.name}.yml`);

    try {
      await fs.access(targetPath);
      const overwrite = await InteractivePrompts.confirm(
        `\n⚠️  Pipeline "${config.name}" already exists. Overwrite?`,
        false
      );

      if (!overwrite) {
        console.log('Cancelled.');
        return;
      }
    } catch {
      // File doesn't exist, good to import
    }

    // Save pipeline
    await fs.mkdir(pipelinesDir, { recursive: true });
    await fs.writeFile(targetPath, YAML.stringify(config), 'utf-8');

    console.log(`\n✅ Pipeline imported successfully!`);
    console.log(`   Location: .agent-pipeline/pipelines/${config.name}.yml`);
    console.log(`\n💡 Next steps:`);
    console.log(`   - Review configuration: agent-pipeline config ${config.name}`);
    console.log(`   - Run the pipeline: agent-pipeline run ${config.name}\n`);
  } catch (error) {
    console.error(`❌ Failed to import pipeline: ${(error as Error).message}`);
    process.exit(1);
  }
}
