import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installCommand } from '../../../cli/commands/install.js';
import { PipelineLoader } from '../../../config/pipeline-loader.js';
import { HookInstaller } from '../../../cli/hooks.js';
import { createTempDir, cleanupTempDir } from '../../setup.js';

// Mock dependencies
vi.mock('../../../config/pipeline-loader.js');
vi.mock('../../../cli/hooks.js');

describe('installCommand', () => {
  let tempDir: string;
  let mockLoader: any;
  let mockInstaller: any;
  let processExitSpy: any;

  beforeEach(async () => {
    tempDir = await createTempDir('install-command-test-');

    // Setup PipelineLoader mock
    mockLoader = {
      loadPipeline: vi.fn(),
    };
    vi.mocked(PipelineLoader).mockImplementation(() => mockLoader);

    // Setup HookInstaller mock
    mockInstaller = {
      install: vi.fn(),
    };
    vi.mocked(HookInstaller).mockImplementation(() => mockInstaller);

    // Spy on process.exit
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
    vi.clearAllMocks();
    processExitSpy.mockRestore();
  });

  describe('Basic Functionality', () => {
    it('should install hook for post-commit trigger', async () => {
      const config = {
        name: 'test-pipeline',
        trigger: 'post-commit',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockInstaller.install.mockResolvedValue(undefined);

      await installCommand(tempDir, 'test-pipeline');

      expect(PipelineLoader).toHaveBeenCalledWith(tempDir);
      expect(mockLoader.loadPipeline).toHaveBeenCalledWith('test-pipeline');
      expect(HookInstaller).toHaveBeenCalledWith(tempDir);
      expect(mockInstaller.install).toHaveBeenCalledWith('test-pipeline', 'post-commit');
    });

    it('should install hook for pre-commit trigger', async () => {
      const config = {
        name: 'lint-pipeline',
        trigger: 'pre-commit',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockInstaller.install.mockResolvedValue(undefined);

      await installCommand(tempDir, 'lint-pipeline');

      expect(mockInstaller.install).toHaveBeenCalledWith('lint-pipeline', 'pre-commit');
    });

    it('should install hook for pre-push trigger', async () => {
      const config = {
        name: 'test-pipeline',
        trigger: 'pre-push',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockInstaller.install.mockResolvedValue(undefined);

      await installCommand(tempDir, 'test-pipeline');

      expect(mockInstaller.install).toHaveBeenCalledWith('test-pipeline', 'pre-push');
    });

    it('should install hook for post-merge trigger', async () => {
      const config = {
        name: 'cleanup-pipeline',
        trigger: 'post-merge',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockInstaller.install.mockResolvedValue(undefined);

      await installCommand(tempDir, 'cleanup-pipeline');

      expect(mockInstaller.install).toHaveBeenCalledWith('cleanup-pipeline', 'post-merge');
    });
  });

  describe('Manual Trigger Validation', () => {
    it('should reject manual pipelines with error message', async () => {
      const config = {
        name: 'manual-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });

      await expect(
        installCommand(tempDir, 'manual-pipeline')
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('❌ Cannot install git hook for manual pipelines.');
      expect(console.error).toHaveBeenCalledWith('   Pipeline "manual-pipeline" has trigger: manual');
      expect(console.error).toHaveBeenCalledWith('   Use \'agent-pipeline run manual-pipeline\' instead.');
    });

    it('should not call HookInstaller for manual pipelines', async () => {
      const config = {
        name: 'manual-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });

      try {
        await installCommand(tempDir, 'manual-pipeline');
      } catch (error) {
        // Expected to exit
      }

      expect(mockInstaller.install).not.toHaveBeenCalled();
    });

    it('should exit with code 1 for manual pipelines', async () => {
      const config = {
        name: 'manual-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });

      await expect(
        installCommand(tempDir, 'manual-pipeline')
      ).rejects.toThrow('process.exit(1)');

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should show correct pipeline name in error message', async () => {
      const config = {
        name: 'my-manual-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });

      try {
        await installCommand(tempDir, 'my-manual-pipeline');
      } catch (error) {
        // Expected
      }

      expect(console.error).toHaveBeenCalledWith('   Pipeline "my-manual-pipeline" has trigger: manual');
    });

    it('should show usage instruction in error message', async () => {
      const config = {
        name: 'manual-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });

      try {
        await installCommand(tempDir, 'manual-pipeline');
      } catch (error) {
        // Expected
      }

      expect(console.error).toHaveBeenCalledWith('   Use \'agent-pipeline run manual-pipeline\' instead.');
    });
  });

  describe('PipelineLoader Integration', () => {
    it('should load correct pipeline by name', async () => {
      const config = {
        name: 'my-pipeline',
        trigger: 'post-commit',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockInstaller.install.mockResolvedValue(undefined);

      await installCommand(tempDir, 'my-pipeline');

      expect(mockLoader.loadPipeline).toHaveBeenCalledWith('my-pipeline');
    });

    it('should handle pipeline load errors', async () => {
      mockLoader.loadPipeline.mockRejectedValue(new Error('Pipeline not found'));

      await expect(
        installCommand(tempDir, 'nonexistent-pipeline')
      ).rejects.toThrow('Pipeline not found');

      expect(mockInstaller.install).not.toHaveBeenCalled();
    });

    it('should handle YAML parse errors', async () => {
      mockLoader.loadPipeline.mockRejectedValue(new Error('Invalid YAML'));

      await expect(
        installCommand(tempDir, 'bad-pipeline')
      ).rejects.toThrow('Invalid YAML');
    });

    it('should pass correct repo path to loader', async () => {
      const customPath = '/custom/repo/path';
      const config = {
        name: 'test-pipeline',
        trigger: 'post-commit',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockInstaller.install.mockResolvedValue(undefined);

      await installCommand(customPath, 'test-pipeline');

      expect(PipelineLoader).toHaveBeenCalledWith(customPath);
    });
  });

  describe('HookInstaller Integration', () => {
    it('should create HookInstaller with correct path', async () => {
      const config = {
        name: 'test-pipeline',
        trigger: 'post-commit',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockInstaller.install.mockResolvedValue(undefined);

      await installCommand(tempDir, 'test-pipeline');

      expect(HookInstaller).toHaveBeenCalledWith(tempDir);
    });

    it('should pass pipeline name and trigger to install', async () => {
      const config = {
        name: 'review-pipeline',
        trigger: 'pre-push',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockInstaller.install.mockResolvedValue(undefined);

      await installCommand(tempDir, 'review-pipeline');

      expect(mockInstaller.install).toHaveBeenCalledWith('review-pipeline', 'pre-push');
    });

    it('should handle installation errors', async () => {
      const config = {
        name: 'test-pipeline',
        trigger: 'post-commit',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockInstaller.install.mockRejectedValue(new Error('Failed to write hook file'));

      await expect(
        installCommand(tempDir, 'test-pipeline')
      ).rejects.toThrow('Failed to write hook file');
    });

    it('should propagate permission errors from installer', async () => {
      const config = {
        name: 'test-pipeline',
        trigger: 'post-commit',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockInstaller.install.mockRejectedValue(new Error('EACCES: permission denied'));

      await expect(
        installCommand(tempDir, 'test-pipeline')
      ).rejects.toThrow('EACCES: permission denied');
    });
  });

  describe('Trigger Type Support', () => {
    it('should support all valid trigger types', async () => {
      const triggers = ['pre-commit', 'post-commit', 'pre-push', 'post-merge'];

      for (const trigger of triggers) {
        const config = {
          name: 'test-pipeline',
          trigger,
          agents: [],
        };
        mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
        mockInstaller.install.mockResolvedValue(undefined);

        await installCommand(tempDir, 'test-pipeline');

        expect(mockInstaller.install).toHaveBeenCalledWith('test-pipeline', trigger);
        vi.clearAllMocks();
      }
    });

    it('should pass exact trigger string from config', async () => {
      const config = {
        name: 'test-pipeline',
        trigger: 'pre-push',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockInstaller.install.mockResolvedValue(undefined);

      await installCommand(tempDir, 'test-pipeline');

      expect(mockInstaller.install).toHaveBeenCalledWith('test-pipeline', 'pre-push');
    });
  });

  describe('Edge Cases', () => {
    it('should handle pipeline names with special characters', async () => {
      const config = {
        name: 'pipeline_with-special.chars',
        trigger: 'post-commit',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockInstaller.install.mockResolvedValue(undefined);

      await installCommand(tempDir, 'pipeline_with-special.chars');

      expect(mockLoader.loadPipeline).toHaveBeenCalledWith('pipeline_with-special.chars');
      expect(mockInstaller.install).toHaveBeenCalledWith('pipeline_with-special.chars', 'post-commit');
    });

    it('should handle very long pipeline names', async () => {
      const longName = 'very-long-pipeline-name-that-exceeds-normal-length-limits';
      const config = {
        name: longName,
        trigger: 'post-commit',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockInstaller.install.mockResolvedValue(undefined);

      await installCommand(tempDir, longName);

      expect(mockLoader.loadPipeline).toHaveBeenCalledWith(longName);
    });

    it('should handle empty agents array', async () => {
      const config = {
        name: 'test-pipeline',
        trigger: 'post-commit',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockInstaller.install.mockResolvedValue(undefined);

      await expect(installCommand(tempDir, 'test-pipeline')).resolves.not.toThrow();
    });

    it('should handle pipelines with many agents', async () => {
      const config = {
        name: 'test-pipeline',
        trigger: 'post-commit',
        agents: Array.from({ length: 10 }, (_, i) => ({
          name: `agent-${i}`,
          agent: `.claude/agents/agent-${i}.md`,
        })),
      };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockInstaller.install.mockResolvedValue(undefined);

      await installCommand(tempDir, 'test-pipeline');

      expect(mockInstaller.install).toHaveBeenCalledWith('test-pipeline', 'post-commit');
    });

    it('should handle missing .git directory error', async () => {
      const config = {
        name: 'test-pipeline',
        trigger: 'post-commit',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockInstaller.install.mockRejectedValue(new Error('.git directory not found'));

      await expect(
        installCommand(tempDir, 'test-pipeline')
      ).rejects.toThrow('.git directory not found');
    });
  });

  describe('Integration', () => {
    it('should complete full installation workflow', async () => {
      const config = {
        name: 'full-pipeline',
        trigger: 'post-commit',
        agents: [
          { name: 'reviewer', agent: '.claude/agents/reviewer.md' },
        ],
      };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockInstaller.install.mockResolvedValue(undefined);

      await installCommand(tempDir, 'full-pipeline');

      expect(PipelineLoader).toHaveBeenCalledWith(tempDir);
      expect(mockLoader.loadPipeline).toHaveBeenCalledWith('full-pipeline');
      expect(HookInstaller).toHaveBeenCalledWith(tempDir);
      expect(mockInstaller.install).toHaveBeenCalledWith('full-pipeline', 'post-commit');
    });

    it('should reject manual pipelines before calling installer', async () => {
      const config = {
        name: 'manual-pipeline',
        trigger: 'manual',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });

      try {
        await installCommand(tempDir, 'manual-pipeline');
      } catch (error) {
        // Expected
      }

      expect(PipelineLoader).toHaveBeenCalled();
      expect(mockLoader.loadPipeline).toHaveBeenCalled();
      expect(HookInstaller).not.toHaveBeenCalled();
      expect(mockInstaller.install).not.toHaveBeenCalled();
    });

    it('should work with different repository paths', async () => {
      const customPath = '/another/repo/path';
      const config = {
        name: 'test-pipeline',
        trigger: 'pre-commit',
        agents: [],
      };
      mockLoader.loadPipeline.mockResolvedValue({ config, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockInstaller.install.mockResolvedValue(undefined);

      await installCommand(customPath, 'test-pipeline');

      expect(PipelineLoader).toHaveBeenCalledWith(customPath);
      expect(HookInstaller).toHaveBeenCalledWith(customPath);
    });

    it('should handle complete error scenarios', async () => {
      // Scenario 1: Load fails
      mockLoader.loadPipeline.mockRejectedValue(new Error('Load error'));
      await expect(installCommand(tempDir, 'test')).rejects.toThrow('Load error');
      vi.clearAllMocks();

      // Scenario 2: Manual trigger (validation fails)
      const manualConfig = { name: 'test', trigger: 'manual', agents: [] };
      mockLoader.loadPipeline.mockResolvedValue({ config: manualConfig, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      await expect(installCommand(tempDir, 'test')).rejects.toThrow('process.exit(1)');
      vi.clearAllMocks();

      // Scenario 3: Install fails
      const validConfig = { name: 'test', trigger: 'post-commit', agents: [] };
      mockLoader.loadPipeline.mockResolvedValue({ config: validConfig, metadata: { sourcePath: "/test/path.yml", sourceType: "library" as const, loadedAt: new Date().toISOString() } });
      mockInstaller.install.mockRejectedValue(new Error('Install error'));
      await expect(installCommand(tempDir, 'test')).rejects.toThrow('Install error');
    });
  });
});
