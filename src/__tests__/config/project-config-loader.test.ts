import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProjectConfigLoader } from '../../config/project-config-loader.js';
import { createTempDir, cleanupTempDir } from '../setup.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as YAML from 'yaml';

describe('ProjectConfigLoader', () => {
  let tempDir: string;
  let loader: ProjectConfigLoader;
  let configDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir('project-config-test-');
    loader = new ProjectConfigLoader(tempDir);
    configDir = path.join(tempDir, '.agent-pipeline');
    await fs.mkdir(configDir, { recursive: true });

    // Clear cache before each test
    ProjectConfigLoader.clearCache();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
    ProjectConfigLoader.clearCache();
  });

  describe('loadLoopingConfig', () => {
    it('should return defaults when no config file exists', async () => {
      const config = await loader.loadLoopingConfig();

      expect(config.enabled).toBe(false);
      expect(config.maxIterations).toBe(100);
      expect(config.directories).toBeDefined();
      expect(config.directories.pending).toContain('next/pending');
      expect(config.directories.running).toContain('next/running');
      expect(config.directories.finished).toContain('next/finished');
      expect(config.directories.failed).toContain('next/failed');
    });

    it('should load config from .agent-pipeline/config.yml', async () => {
      const configContent = {
        looping: {
          enabled: true,
          maxIterations: 50,
          directories: {
            pending: 'custom/pending',
            running: 'custom/running',
            finished: 'custom/finished',
            failed: 'custom/failed',
          },
        },
      };

      const configPath = path.join(configDir, 'config.yml');
      await fs.writeFile(configPath, YAML.stringify(configContent), 'utf-8');

      const config = await loader.loadLoopingConfig();

      expect(config.enabled).toBe(true);
      expect(config.maxIterations).toBe(50);
      expect(config.directories.pending).toBe(path.join(tempDir, 'custom/pending'));
      expect(config.directories.running).toBe(path.join(tempDir, 'custom/running'));
      expect(config.directories.finished).toBe(path.join(tempDir, 'custom/finished'));
      expect(config.directories.failed).toBe(path.join(tempDir, 'custom/failed'));
    });

    it('should use defaults for missing fields', async () => {
      const configContent = {
        looping: {
          enabled: true,
          // maxIterations not specified
          // directories not specified
        },
      };

      const configPath = path.join(configDir, 'config.yml');
      await fs.writeFile(configPath, YAML.stringify(configContent), 'utf-8');

      const config = await loader.loadLoopingConfig();

      expect(config.enabled).toBe(true);
      expect(config.maxIterations).toBe(100); // default
      expect(config.directories.pending).toContain('next/pending'); // default
    });

    it('should resolve relative paths to absolute', async () => {
      const configContent = {
        looping: {
          enabled: true,
          directories: {
            pending: 'loops/pending',
            running: 'loops/running',
            finished: 'loops/finished',
            failed: 'loops/failed',
          },
        },
      };

      const configPath = path.join(configDir, 'config.yml');
      await fs.writeFile(configPath, YAML.stringify(configContent), 'utf-8');

      const config = await loader.loadLoopingConfig();

      expect(path.isAbsolute(config.directories.pending)).toBe(true);
      expect(path.isAbsolute(config.directories.running)).toBe(true);
      expect(path.isAbsolute(config.directories.finished)).toBe(true);
      expect(path.isAbsolute(config.directories.failed)).toBe(true);

      expect(config.directories.pending).toBe(path.join(tempDir, 'loops/pending'));
      expect(config.directories.running).toBe(path.join(tempDir, 'loops/running'));
    });

    it('should preserve absolute paths', async () => {
      const absolutePending = '/tmp/loops/pending';
      const configContent = {
        looping: {
          enabled: false, // Don't create directories
          directories: {
            pending: absolutePending,
            running: '/tmp/loops/running',
            finished: '/tmp/loops/finished',
            failed: '/tmp/loops/failed',
          },
        },
      };

      const configPath = path.join(configDir, 'config.yml');
      await fs.writeFile(configPath, YAML.stringify(configContent), 'utf-8');

      const config = await loader.loadLoopingConfig();

      expect(config.directories.pending).toBe(absolutePending);
      expect(config.directories.running).toBe('/tmp/loops/running');
    });

    it('should create directories when looping is enabled', async () => {
      const configContent = {
        looping: {
          enabled: true,
          directories: {
            pending: 'test-dirs/pending',
            running: 'test-dirs/running',
            finished: 'test-dirs/finished',
            failed: 'test-dirs/failed',
          },
        },
      };

      const configPath = path.join(configDir, 'config.yml');
      await fs.writeFile(configPath, YAML.stringify(configContent), 'utf-8');

      const config = await loader.loadLoopingConfig();

      // Verify directories were created
      await expect(fs.access(config.directories.pending)).resolves.not.toThrow();
      await expect(fs.access(config.directories.running)).resolves.not.toThrow();
      await expect(fs.access(config.directories.finished)).resolves.not.toThrow();
      await expect(fs.access(config.directories.failed)).resolves.not.toThrow();
    });

    it('should not create directories when looping is disabled', async () => {
      const configContent = {
        looping: {
          enabled: false,
          directories: {
            pending: 'no-create/pending',
            running: 'no-create/running',
            finished: 'no-create/finished',
            failed: 'no-create/failed',
          },
        },
      };

      const configPath = path.join(configDir, 'config.yml');
      await fs.writeFile(configPath, YAML.stringify(configContent), 'utf-8');

      const config = await loader.loadLoopingConfig();

      // Verify directories were NOT created
      await expect(fs.access(config.directories.pending)).rejects.toThrow();
      await expect(fs.access(config.directories.running)).rejects.toThrow();
    });

    it('should handle existing directories gracefully', async () => {
      const configContent = {
        looping: {
          enabled: true,
          directories: {
            pending: 'existing/pending',
            running: 'existing/running',
            finished: 'existing/finished',
            failed: 'existing/failed',
          },
        },
      };

      // Pre-create directories
      const pendingDir = path.join(tempDir, 'existing/pending');
      await fs.mkdir(pendingDir, { recursive: true });

      const configPath = path.join(configDir, 'config.yml');
      await fs.writeFile(configPath, YAML.stringify(configContent), 'utf-8');

      // Should not throw
      const config = await loader.loadLoopingConfig();

      expect(config.enabled).toBe(true);
      await expect(fs.access(config.directories.pending)).resolves.not.toThrow();
    });

    it('should cache configuration per repo path', async () => {
      const configContent = {
        looping: {
          enabled: true,
          maxIterations: 42,
        },
      };

      const configPath = path.join(configDir, 'config.yml');
      await fs.writeFile(configPath, YAML.stringify(configContent), 'utf-8');

      // Load first time
      const config1 = await loader.loadLoopingConfig();
      expect(config1.maxIterations).toBe(42);

      // Modify file
      const modifiedContent = {
        looping: {
          enabled: true,
          maxIterations: 999,
        },
      };
      await fs.writeFile(configPath, YAML.stringify(modifiedContent), 'utf-8');

      // Load second time - should return cached value
      const config2 = await loader.loadLoopingConfig();
      expect(config2.maxIterations).toBe(42); // Still the original cached value
    });

    it('should handle malformed YAML gracefully', async () => {
      const configPath = path.join(configDir, 'config.yml');
      await fs.writeFile(configPath, 'invalid: yaml: content:', 'utf-8');

      // Should fall back to defaults
      const config = await loader.loadLoopingConfig();

      expect(config.enabled).toBe(false);
      expect(config.maxIterations).toBe(100);
    });

    it('should handle empty config file', async () => {
      const configPath = path.join(configDir, 'config.yml');
      await fs.writeFile(configPath, '', 'utf-8');

      // Should fall back to defaults
      const config = await loader.loadLoopingConfig();

      expect(config.enabled).toBe(false);
      expect(config.maxIterations).toBe(100);
    });

    it('should handle config file with no looping section', async () => {
      const configContent = {
        someOtherSection: {
          value: 'test',
        },
      };

      const configPath = path.join(configDir, 'config.yml');
      await fs.writeFile(configPath, YAML.stringify(configContent), 'utf-8');

      // Should fall back to defaults
      const config = await loader.loadLoopingConfig();

      expect(config.enabled).toBe(false);
      expect(config.maxIterations).toBe(100);
    });

    it('should handle partial directory configuration', async () => {
      const configContent = {
        looping: {
          enabled: true,
          directories: {
            pending: 'custom/pending',
            // Other directories not specified
          },
        },
      };

      const configPath = path.join(configDir, 'config.yml');
      await fs.writeFile(configPath, YAML.stringify(configContent), 'utf-8');

      const config = await loader.loadLoopingConfig();

      expect(config.directories.pending).toBe(path.join(tempDir, 'custom/pending'));
      // Should use defaults for unspecified directories
      expect(config.directories.running).toContain('next/running');
      expect(config.directories.finished).toContain('next/finished');
      expect(config.directories.failed).toContain('next/failed');
    });

    it('should handle maxIterations of 0', async () => {
      const configContent = {
        looping: {
          enabled: true,
          maxIterations: 0,
        },
      };

      const configPath = path.join(configDir, 'config.yml');
      await fs.writeFile(configPath, YAML.stringify(configContent), 'utf-8');

      const config = await loader.loadLoopingConfig();

      expect(config.maxIterations).toBe(0);
    });

    it('should clear cache when clearCache is called', async () => {
      const configContent = {
        looping: {
          enabled: true,
          maxIterations: 42,
        },
      };

      const configPath = path.join(configDir, 'config.yml');
      await fs.writeFile(configPath, YAML.stringify(configContent), 'utf-8');

      // Load and cache
      const config1 = await loader.loadLoopingConfig();
      expect(config1.maxIterations).toBe(42);

      // Modify file
      const modifiedContent = {
        looping: {
          enabled: true,
          maxIterations: 999,
        },
      };
      await fs.writeFile(configPath, YAML.stringify(modifiedContent), 'utf-8');

      // Clear cache
      ProjectConfigLoader.clearCache();

      // Load again - should read new value
      const config2 = await loader.loadLoopingConfig();
      expect(config2.maxIterations).toBe(999);
    });

    it('should create nested directory structures', async () => {
      const configContent = {
        looping: {
          enabled: true,
          directories: {
            pending: 'deeply/nested/path/pending',
            running: 'deeply/nested/path/running',
            finished: 'deeply/nested/path/finished',
            failed: 'deeply/nested/path/failed',
          },
        },
      };

      const configPath = path.join(configDir, 'config.yml');
      await fs.writeFile(configPath, YAML.stringify(configContent), 'utf-8');

      const config = await loader.loadLoopingConfig();

      // Verify deeply nested directories were created
      await expect(fs.access(config.directories.pending)).resolves.not.toThrow();
      await expect(fs.access(config.directories.running)).resolves.not.toThrow();
    });
  });

  describe('clearCache', () => {
    it('should be a static method', () => {
      expect(typeof ProjectConfigLoader.clearCache).toBe('function');
    });

    it('should clear both config cache and directories created set', async () => {
      const configContent = {
        looping: {
          enabled: true,
          directories: {
            pending: 'cache-test/pending',
            running: 'cache-test/running',
            finished: 'cache-test/finished',
            failed: 'cache-test/failed',
          },
        },
      };

      const configPath = path.join(configDir, 'config.yml');
      await fs.writeFile(configPath, YAML.stringify(configContent), 'utf-8');

      // Load to populate cache
      await loader.loadLoopingConfig();

      // Clear cache
      ProjectConfigLoader.clearCache();

      // Create a new loader instance
      const newLoader = new ProjectConfigLoader(tempDir);

      // Should reload from disk
      const config = await newLoader.loadLoopingConfig();
      expect(config.enabled).toBe(true);
    });
  });
});
