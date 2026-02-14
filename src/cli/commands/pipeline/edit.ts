// src/cli/commands/pipeline/edit.ts

import * as path from 'path';
import * as fs from 'fs/promises';
import { spawn } from 'child_process';
import { PipelineValidator } from '../../../validators/pipeline-validator.js';
import { PipelineLoader } from '../../../config/pipeline-loader.js';

function parseCommand(input: string): { command: string; args: string[] } {
  const parts: string[] = [];
  const regex = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(input)) !== null) {
    parts.push(match[1] ?? match[2] ?? match[3]);
  }

  if (parts.length === 0) {
    return { command: 'vi', args: [] };
  }

  return { command: parts[0], args: parts.slice(1) };
}

export async function editPipelineCommand(
  repoPath: string,
  pipelineName: string
): Promise<void> {
  try {
    // Verify pipeline exists
    const loader = new PipelineLoader(repoPath);
    await loader.loadPipeline(pipelineName); // Will throw if not found

    const pipelinePath = path.join(
      repoPath,
      '.agent-pipeline',
      'pipelines',
      `${pipelineName}.yml`
    );

    // Determine editor - parse to handle editors with args (e.g. "code --wait")
    const editorEnv = process.env.EDITOR || process.env.VISUAL || 'vi';
    const { command: editor, args: editorArgs } = parseCommand(editorEnv);

    console.log(`📝 Opening ${pipelineName} in ${editorEnv}...\n`);

    // Open editor without shell: true to avoid DEP0190 deprecation warning
    const child = spawn(editor, [...editorArgs, pipelinePath], {
      stdio: 'inherit'
    });

    await new Promise<void>((resolve, reject) => {
      child.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Editor exited with code ${code}`));
        }
      });
      child.on('error', reject);
    });

    // Validate after edit
    console.log('\n📋 Validating pipeline...');

    const content = await fs.readFile(pipelinePath, 'utf-8');
    const YAML = (await import('yaml')).default;
    const config = YAML.parse(content);

    const isValid = await PipelineValidator.validateAndReport(config, repoPath);

    if (!isValid) {
      console.error('\n⚠️  Pipeline has validation errors');
      console.error('   Please fix the errors and run validation again');
      process.exit(1);
    }

    console.log('\n✅ Pipeline is valid!\n');
  } catch (error) {
    if ((error as any).message?.includes('Pipeline not found')) {
      console.error(`❌ Pipeline "${pipelineName}" not found`);
    } else {
      console.error(`❌ Failed to edit pipeline: ${(error as Error).message}`);
    }
    process.exit(1);
  }
}
