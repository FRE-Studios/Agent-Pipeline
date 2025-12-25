import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { hooksUninstallCommand } from '../../../cli/commands/hooks.js';
import { HookInstaller } from '../../../cli/hooks.js';
import { createTempDir, cleanupTempDir } from '../../setup.js';

// Mock HookInstaller
vi.mock('../../../cli/hooks.js');

// Alias for backwards compatibility
const uninstallCommand = hooksUninstallCommand;

describe('hooksUninstallCommand', () => {
  let tempDir: string;
  let mockInstaller: any;

  beforeEach(async () => {
    tempDir = await createTempDir('uninstall-command-test-');

    // Setup HookInstaller mock
    mockInstaller = {
      uninstall: vi.fn(),
    };
    vi.mocked(HookInstaller).mockImplementation(() => mockInstaller);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
    vi.clearAllMocks();
  });

  describe('Basic Functionality', () => {
    it('should create HookInstaller with correct path', async () => {
      mockInstaller.uninstall.mockResolvedValue(undefined);

      await uninstallCommand(tempDir);

      expect(HookInstaller).toHaveBeenCalledWith(tempDir);
    });

    it('should call uninstall method', async () => {
      mockInstaller.uninstall.mockResolvedValue(undefined);

      await uninstallCommand(tempDir);

      expect(mockInstaller.uninstall).toHaveBeenCalledTimes(1);
    });

    it('should call uninstall without arguments', async () => {
      mockInstaller.uninstall.mockResolvedValue(undefined);

      await uninstallCommand(tempDir);

      expect(mockInstaller.uninstall).toHaveBeenCalledWith({
        pipelineName: undefined,
        removeAll: true,
      });
    });

    it('should successfully complete uninstall operation', async () => {
      mockInstaller.uninstall.mockResolvedValue(undefined);

      await expect(uninstallCommand(tempDir)).resolves.not.toThrow();
    });
  });

  describe('Error Handling', () => {
    it('should propagate errors from HookInstaller', async () => {
      mockInstaller.uninstall.mockRejectedValue(new Error('Failed to read hook file'));

      await expect(uninstallCommand(tempDir)).rejects.toThrow('Failed to read hook file');
    });

    it('should propagate errors when hooks directory missing', async () => {
      mockInstaller.uninstall.mockRejectedValue(new Error('Hooks directory not found'));

      await expect(uninstallCommand(tempDir)).rejects.toThrow('Hooks directory not found');
    });

    it('should propagate permission errors', async () => {
      mockInstaller.uninstall.mockRejectedValue(new Error('Permission denied'));

      await expect(uninstallCommand(tempDir)).rejects.toThrow('Permission denied');
    });

    it('should handle non-Error thrown values', async () => {
      mockInstaller.uninstall.mockRejectedValue('String error');

      await expect(uninstallCommand(tempDir)).rejects.toThrow();
    });
  });

  describe('HookInstaller Integration', () => {
    it('should instantiate HookInstaller once per call', async () => {
      mockInstaller.uninstall.mockResolvedValue(undefined);

      await uninstallCommand(tempDir);

      expect(HookInstaller).toHaveBeenCalledTimes(1);
    });

    it('should use provided repo path for HookInstaller', async () => {
      mockInstaller.uninstall.mockResolvedValue(undefined);
      const customPath = '/custom/repo/path';

      await uninstallCommand(customPath);

      expect(HookInstaller).toHaveBeenCalledWith(customPath);
    });

    it('should not modify console output', async () => {
      mockInstaller.uninstall.mockResolvedValue(undefined);
      vi.clearAllMocks();

      await uninstallCommand(tempDir);

      // Command itself doesn't log, all logging is in HookInstaller
      expect(console.log).not.toHaveBeenCalled();
      expect(console.error).not.toHaveBeenCalled();
    });
  });

  describe('Async Behavior', () => {
    it('should wait for uninstall to complete', async () => {
      let uninstallCompleted = false;
      mockInstaller.uninstall.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        uninstallCompleted = true;
      });

      await uninstallCommand(tempDir);

      expect(uninstallCompleted).toBe(true);
    });

    it('should handle immediate resolution', async () => {
      mockInstaller.uninstall.mockResolvedValue(undefined);

      const startTime = Date.now();
      await uninstallCommand(tempDir);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(100); // Should be very fast
    });

    it('should handle async errors correctly', async () => {
      mockInstaller.uninstall.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
        throw new Error('Async error');
      });

      await expect(uninstallCommand(tempDir)).rejects.toThrow('Async error');
    });
  });

  describe('Edge Cases', () => {
    it('should pass pipeline name when provided', async () => {
      mockInstaller.uninstall.mockResolvedValue(undefined);

      await uninstallCommand(tempDir, { pipelineName: 'post-commit-example' });

      expect(mockInstaller.uninstall).toHaveBeenCalledWith({
        pipelineName: 'post-commit-example',
        removeAll: false,
      });
    });

    it('should allow removeAll override with pipeline name', async () => {
      mockInstaller.uninstall.mockResolvedValue(undefined);

      await uninstallCommand(tempDir, { pipelineName: 'post-commit-example', removeAll: true });

      expect(mockInstaller.uninstall).toHaveBeenCalledWith({
        pipelineName: 'post-commit-example',
        removeAll: true,
      });
    });

    it('should handle empty hooks directory', async () => {
      mockInstaller.uninstall.mockResolvedValue(undefined);

      await expect(uninstallCommand(tempDir)).resolves.not.toThrow();
    });

    it('should handle non-existent git directory', async () => {
      mockInstaller.uninstall.mockRejectedValue(new Error('.git directory not found'));

      await expect(uninstallCommand(tempDir)).rejects.toThrow('.git directory not found');
    });

    it('should handle malformed hook files gracefully', async () => {
      mockInstaller.uninstall.mockRejectedValue(new Error('Invalid hook format'));

      await expect(uninstallCommand(tempDir)).rejects.toThrow('Invalid hook format');
    });

    it('should handle read-only hooks directory', async () => {
      mockInstaller.uninstall.mockRejectedValue(new Error('EACCES: permission denied'));

      await expect(uninstallCommand(tempDir)).rejects.toThrow('EACCES: permission denied');
    });
  });

  describe('Multiple Calls', () => {
    it('should handle multiple sequential calls', async () => {
      mockInstaller.uninstall.mockResolvedValue(undefined);

      await uninstallCommand(tempDir);
      await uninstallCommand(tempDir);
      await uninstallCommand(tempDir);

      expect(HookInstaller).toHaveBeenCalledTimes(3);
      expect(mockInstaller.uninstall).toHaveBeenCalledTimes(3);
    });

    it('should maintain independent state across calls', async () => {
      mockInstaller.uninstall.mockResolvedValue(undefined);

      await uninstallCommand(tempDir);
      vi.clearAllMocks();
      await uninstallCommand(tempDir);

      // Each call should create new instance
      expect(HookInstaller).toHaveBeenCalledTimes(1);
    });
  });

  describe('Integration', () => {
    it('should complete full uninstall workflow', async () => {
      mockInstaller.uninstall.mockResolvedValue(undefined);

      await uninstallCommand(tempDir);

      expect(HookInstaller).toHaveBeenCalledWith(tempDir);
      expect(mockInstaller.uninstall).toHaveBeenCalled();
    });

    it('should work with absolute paths', async () => {
      mockInstaller.uninstall.mockResolvedValue(undefined);
      const absolutePath = '/absolute/path/to/repo';

      await uninstallCommand(absolutePath);

      expect(HookInstaller).toHaveBeenCalledWith(absolutePath);
    });

    it('should work with relative paths', async () => {
      mockInstaller.uninstall.mockResolvedValue(undefined);
      const relativePath = './relative/path';

      await uninstallCommand(relativePath);

      expect(HookInstaller).toHaveBeenCalledWith(relativePath);
    });

    it('should delegate all hook management to HookInstaller', async () => {
      mockInstaller.uninstall.mockResolvedValue(undefined);

      await uninstallCommand(tempDir);

      // Only one method call expected
      expect(mockInstaller.uninstall).toHaveBeenCalledTimes(1);
      expect(Object.keys(mockInstaller).filter(key =>
        typeof mockInstaller[key].mock !== 'undefined' &&
        mockInstaller[key].mock.calls.length > 0
      )).toEqual(['uninstall']);
    });
  });
});
