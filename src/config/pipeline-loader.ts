// src/config/pipeline-loader.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import * as YAML from 'yaml';
import { PipelineConfig } from './schema.js';

export class PipelineLoader {
  constructor(private repoPath: string) {}

  async loadPipeline(pipelineName: string): Promise<PipelineConfig> {
    const pipelinePath = path.join(
      this.repoPath,
      '.agent-pipeline',
      'pipelines',
      `${pipelineName}.yml`
    );

    try {
      const content = await fs.readFile(pipelinePath, 'utf-8');
      const config = YAML.parse(content) as PipelineConfig;

      // Validate required fields
      if (!config.name || !config.agents || config.agents.length === 0) {
        throw new Error('Invalid pipeline configuration: missing required fields');
      }

      return config;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Pipeline not found: ${pipelineName}`);
      }
      throw error;
    }
  }

  async listPipelines(): Promise<string[]> {
    const pipelinesDir = path.join(this.repoPath, '.agent-pipeline', 'pipelines');

    try {
      const files = await fs.readdir(pipelinesDir);
      return files
        .filter(f => f.endsWith('.yml') || f.endsWith('.yaml'))
        .map(f => path.parse(f).name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }
}
