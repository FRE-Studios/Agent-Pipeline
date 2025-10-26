// src/config/pipeline-loader.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import * as YAML from 'yaml';
import { PipelineConfig, PipelineMetadata } from './schema.js';

export interface PipelineLoadResult {
  config: PipelineConfig;
  metadata: PipelineMetadata;
}

export class PipelineLoader {
  constructor(private repoPath: string) {}

  async loadPipeline(pipelineName: string): Promise<PipelineLoadResult> {
    const pipelinePath = path.join(
      this.repoPath,
      '.agent-pipeline',
      'pipelines',
      `${pipelineName}.yml`
    );

    try {
      const config = await this.parsePipelineFile(pipelinePath);

      const metadata: PipelineMetadata = {
        sourcePath: pipelinePath,
        sourceType: 'library',
        loadedAt: new Date().toISOString(),
      };

      return { config, metadata };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Pipeline not found: ${pipelineName}`);
      }
      throw error;
    }
  }

  async loadPipelineFromPath(filePath: string): Promise<PipelineLoadResult> {
    try {
      const config = await this.parsePipelineFile(filePath);

      const metadata: PipelineMetadata = {
        sourcePath: path.resolve(filePath),
        sourceType: 'loop-pending',
        loadedAt: new Date().toISOString(),
      };

      return { config, metadata };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Pipeline file not found: ${filePath}`);
      }
      throw error;
    }
  }

  private async parsePipelineFile(filePath: string): Promise<PipelineConfig> {
    const content = await fs.readFile(filePath, 'utf-8');
    const config = YAML.parse(content) as PipelineConfig;

    // Validate required fields
    if (!config.name || !config.agents || config.agents.length === 0) {
      throw new Error('Invalid pipeline configuration: missing required fields');
    }

    return config;
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
