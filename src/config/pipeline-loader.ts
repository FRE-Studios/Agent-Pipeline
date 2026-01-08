// src/config/pipeline-loader.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import * as YAML from 'yaml';
import { PipelineConfig, PipelineMetadata, LoopingConfig, ResolvedLoopingConfig } from './schema.js';

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

    // Set default runtime if not specified
    if (!config.runtime) {
      config.runtime = { type: 'claude-code-headless' };
    }

    // Resolve looping directories to absolute paths if looping is configured
    if (config.looping) {
      (config as any).looping = this.resolveLoopingConfig(config.looping);
    }

    return config;
  }

  /**
   * Resolve looping config paths relative to repo root.
   * Only resolves explicitly provided directories.
   *
   * If directories are not explicitly configured, returns empty strings as placeholders.
   * PipelineRunner will detect empty directories and create session-scoped defaults.
   */
  resolveLoopingConfig(looping: LoopingConfig): ResolvedLoopingConfig {
    const dirs = looping.directories;

    // Only resolve explicitly provided directories.
    // Missing entries are left empty for PipelineRunner to fill with session defaults.
    const resolvedDirs = {
      pending: dirs?.pending ? this.resolvePath(dirs.pending) : '',
      running: dirs?.running ? this.resolvePath(dirs.running) : '',
      finished: dirs?.finished ? this.resolvePath(dirs.finished) : '',
      failed: dirs?.failed ? this.resolvePath(dirs.failed) : '',
    };

    return {
      enabled: looping.enabled,
      maxIterations: looping.maxIterations ?? 100,
      instructions: looping.instructions ? this.resolvePath(looping.instructions) : undefined,
      directories: resolvedDirs,
    };
  }

  /**
   * Resolve a path relative to repo root, or return as-is if already absolute
   */
  private resolvePath(relativePath: string): string {
    if (path.isAbsolute(relativePath)) {
      return relativePath;
    }
    return path.resolve(this.repoPath, relativePath);
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
