// src/config/project-config-loader.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import * as YAML from 'yaml';
import { LoopingConfig } from './schema.js';
import { Logger } from '../utils/logger.js';

// Cache to avoid repeated disk IO per run
const configCache = new Map<string, LoopingConfig>();
const directoriesCreated = new Set<string>();

/**
 * Loads project-level configuration for pipeline looping feature.
 * Handles defaults, path resolution, and automatic directory creation.
 */
export class ProjectConfigLoader {
  constructor(private repoPath: string) {}

  /**
   * Loads looping configuration from .agent-pipeline/config.yml
   * Returns configuration with resolved absolute paths and sensible defaults.
   */
  async loadLoopingConfig(): Promise<LoopingConfig> {
    // Check cache first
    const cacheKey = this.repoPath;
    if (configCache.has(cacheKey)) {
      return configCache.get(cacheKey)!;
    }

    const configPath = path.join(this.repoPath, '.agent-pipeline', 'config.yml');

    let rawConfig: Partial<LoopingConfig> | undefined;

    try {
      const content = await fs.readFile(configPath, 'utf-8');
      const parsed = YAML.parse(content);
      rawConfig = parsed?.looping;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // Config file doesn't exist - use defaults
        Logger.debug('No config.yml found, using defaults');
      } else {
        // Parsing error or other issue
        Logger.warn(`Failed to parse config.yml: ${(error as Error).message}`);
      }
    }

    // Apply defaults and resolve paths
    const config = this.buildConfigWithDefaults(rawConfig);

    // Create directories if looping is enabled
    if (config.enabled) {
      await this.ensureDirectoriesExist(config);
    }

    // Cache the result
    configCache.set(cacheKey, config);

    return config;
  }

  /**
   * Builds configuration with defaults and resolved absolute paths
   */
  private buildConfigWithDefaults(rawConfig?: Partial<LoopingConfig>): LoopingConfig {
    const enabled = rawConfig?.enabled ?? false;
    const maxIterations = rawConfig?.maxIterations ?? 100;

    // Default directory paths (relative to repo)
    const defaultDirs = {
      pending: 'next/pending',
      running: 'next/running',
      finished: 'next/finished',
      failed: 'next/failed',
    };

    // Use provided directories or defaults
    const relativeDirs = rawConfig?.directories ?? defaultDirs;

    // Resolve to absolute paths
    const directories = {
      pending: this.resolvePath(relativeDirs.pending ?? defaultDirs.pending),
      running: this.resolvePath(relativeDirs.running ?? defaultDirs.running),
      finished: this.resolvePath(relativeDirs.finished ?? defaultDirs.finished),
      failed: this.resolvePath(relativeDirs.failed ?? defaultDirs.failed),
    };

    return {
      enabled,
      maxIterations,
      directories,
    };
  }

  /**
   * Resolves a path relative to the repository root
   */
  private resolvePath(relativePath: string): string {
    if (path.isAbsolute(relativePath)) {
      return relativePath;
    }
    return path.resolve(this.repoPath, relativePath);
  }

  /**
   * Creates looping directories if they don't exist
   * Logs directory creation for user visibility
   */
  private async ensureDirectoriesExist(config: LoopingConfig): Promise<void> {
    const dirs = [
      config.directories.pending,
      config.directories.running,
      config.directories.finished,
      config.directories.failed,
    ];

    for (const dir of dirs) {
      // Check if we've already created this directory in this session
      if (directoriesCreated.has(dir)) {
        continue;
      }

      try {
        // Check if directory exists
        await fs.access(dir);
        // Directory exists, mark as created
        directoriesCreated.add(dir);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          // Directory doesn't exist - create it
          await fs.mkdir(dir, { recursive: true });

          // Log to user
          const relativePath = path.relative(this.repoPath, dir);
          Logger.info(`Created looping directory: ${relativePath}`);

          // Mark as created
          directoriesCreated.add(dir);
        } else {
          throw error;
        }
      }
    }
  }

  /**
   * Clears the configuration cache (useful for testing)
   */
  static clearCache(): void {
    configCache.clear();
    directoriesCreated.clear();
  }
}
