import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock os.homedir before importing the module
vi.mock('os', () => ({
  default: { homedir: () => '/mock-home' },
  homedir: () => '/mock-home',
}));

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

import * as fs from 'fs/promises';
import {
  compareSemver,
  shouldSkipCheck,
  readCache,
  writeCache,
  fetchLatestVersion,
  checkForUpdate,
  formatUpdateNotification,
  getCacheDir,
  getCacheFile,
} from '../../utils/update-checker.js';

const mockReadFile = vi.mocked(fs.readFile);
const mockWriteFile = vi.mocked(fs.writeFile);
const mockMkdir = vi.mocked(fs.mkdir);

describe('update-checker', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.CI;
    delete process.env.NO_UPDATE_CHECK;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('compareSemver', () => {
    it('should return 0 for equal versions', () => {
      expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
    });

    it('should return -1 when a < b', () => {
      expect(compareSemver('1.0.0', '2.0.0')).toBe(-1);
      expect(compareSemver('1.0.0', '1.1.0')).toBe(-1);
      expect(compareSemver('1.0.0', '1.0.1')).toBe(-1);
    });

    it('should return 1 when a > b', () => {
      expect(compareSemver('2.0.0', '1.0.0')).toBe(1);
      expect(compareSemver('1.1.0', '1.0.0')).toBe(1);
      expect(compareSemver('1.0.1', '1.0.0')).toBe(1);
    });

    it('should handle v-prefix', () => {
      expect(compareSemver('v1.0.0', '1.0.0')).toBe(0);
      expect(compareSemver('1.0.0', 'v1.0.0')).toBe(0);
      expect(compareSemver('v1.0.0', 'v2.0.0')).toBe(-1);
    });

    it('should handle different segment counts', () => {
      expect(compareSemver('1.0', '1.0.0')).toBe(0);
      expect(compareSemver('1.0', '1.0.1')).toBe(-1);
      expect(compareSemver('1.0.1', '1.0')).toBe(1);
    });

    it('should handle prerelease precedence', () => {
      expect(compareSemver('1.0.0-alpha', '1.0.0')).toBe(-1);
      expect(compareSemver('1.0.0', '1.0.0-alpha')).toBe(1);
      expect(compareSemver('1.0.0-alpha.1', '1.0.0-alpha.2')).toBe(-1);
      expect(compareSemver('1.0.0-beta', '1.0.0-alpha')).toBe(1);
    });

    it('should ignore build metadata', () => {
      expect(compareSemver('1.0.0+build.1', '1.0.0+build.2')).toBe(0);
    });

    it('should treat invalid versions as equal', () => {
      expect(compareSemver('not-a-version', '1.0.0')).toBe(0);
      expect(compareSemver('1.0.0', 'also-bad')).toBe(0);
    });
  });

  describe('shouldSkipCheck', () => {
    it('should skip when CI env is set', () => {
      process.env.CI = 'true';
      expect(shouldSkipCheck(['run', 'my-pipeline'])).toBe(true);
    });

    it('should skip when NO_UPDATE_CHECK env is set', () => {
      process.env.NO_UPDATE_CHECK = '1';
      expect(shouldSkipCheck(['run', 'my-pipeline'])).toBe(true);
    });

    it('should skip for --version', () => {
      expect(shouldSkipCheck(['--version'])).toBe(true);
    });

    it('should skip for -v', () => {
      expect(shouldSkipCheck(['-v'])).toBe(true);
    });

    it('should skip for --help', () => {
      expect(shouldSkipCheck(['--help'])).toBe(true);
    });

    it('should skip for -h', () => {
      expect(shouldSkipCheck(['-h'])).toBe(true);
    });

    it('should skip for help command', () => {
      expect(shouldSkipCheck(['help'])).toBe(true);
    });

    it('should skip for history command', () => {
      expect(shouldSkipCheck(['history'])).toBe(true);
    });

    it('should not skip for normal commands', () => {
      expect(shouldSkipCheck(['run', 'my-pipeline'])).toBe(false);
      expect(shouldSkipCheck(['list'])).toBe(false);
      expect(shouldSkipCheck(['analytics'])).toBe(false);
    });
  });

  describe('getCacheDir / getCacheFile', () => {
    it('should return paths under homedir', () => {
      expect(getCacheDir()).toBe('/mock-home/.agent-pipeline');
      expect(getCacheFile()).toBe('/mock-home/.agent-pipeline/update-check.json');
    });
  });

  describe('readCache', () => {
    it('should return parsed cache when valid', async () => {
      const cache = { lastCheck: 1000, latestVersion: '1.0.0' };
      mockReadFile.mockResolvedValue(JSON.stringify(cache));
      expect(await readCache()).toEqual(cache);
    });

    it('should return null on missing file', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      expect(await readCache()).toBeNull();
    });

    it('should return null on invalid JSON', async () => {
      mockReadFile.mockResolvedValue('not json' as any);
      expect(await readCache()).toBeNull();
    });

    it('should return null when fields are missing', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ foo: 'bar' }) as any);
      expect(await readCache()).toBeNull();
    });

    it('should return null when lastCheck is not a number', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ lastCheck: 'abc', latestVersion: '1.0.0' }) as any);
      expect(await readCache()).toBeNull();
    });
  });

  describe('writeCache', () => {
    it('should create dir and write file', async () => {
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);

      await writeCache({ lastCheck: 1000, latestVersion: '1.0.0' });

      expect(mockMkdir).toHaveBeenCalledWith('/mock-home/.agent-pipeline', { recursive: true });
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/mock-home/.agent-pipeline/update-check.json',
        JSON.stringify({ lastCheck: 1000, latestVersion: '1.0.0' }),
        'utf-8'
      );
    });

    it('should silently ignore write failures', async () => {
      mockMkdir.mockRejectedValue(new Error('permission denied'));
      await expect(writeCache({ lastCheck: 1000, latestVersion: '1.0.0' })).resolves.toBeUndefined();
    });
  });

  describe('fetchLatestVersion', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('should return version on success', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ version: '2.0.0' }),
      });

      expect(await fetchLatestVersion()).toBe('2.0.0');
    });

    it('should return null on non-ok response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({}),
      });

      expect(await fetchLatestVersion()).toBeNull();
    });

    it('should return null on network error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('network error'));
      expect(await fetchLatestVersion()).toBeNull();
    });

    it('should return null on timeout (abort)', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError'));
      expect(await fetchLatestVersion()).toBeNull();
    });

    it('should return null when version field is missing', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ name: 'agent-pipeline' }),
      });

      expect(await fetchLatestVersion()).toBeNull();
    });
  });

  describe('checkForUpdate', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
      globalThis.fetch = originalFetch;
    });

    it('should return no update from fresh cache when versions match', async () => {
      const now = Date.now();
      mockReadFile.mockResolvedValue(
        JSON.stringify({ lastCheck: now - 1000, latestVersion: '1.0.0' }) as any
      );

      const result = await checkForUpdate('1.0.0');
      expect(result).toEqual({
        updateAvailable: false,
        currentVersion: '1.0.0',
        latestVersion: '1.0.0',
      });
    });

    it('should return update available from fresh cache', async () => {
      const now = Date.now();
      mockReadFile.mockResolvedValue(
        JSON.stringify({ lastCheck: now - 1000, latestVersion: '2.0.0' }) as any
      );

      const result = await checkForUpdate('1.0.0');
      expect(result).toEqual({
        updateAvailable: true,
        currentVersion: '1.0.0',
        latestVersion: '2.0.0',
      });
    });

    it('should fetch when cache is stale', async () => {
      const now = Date.now();
      const staleTime = now - 25 * 60 * 60 * 1000; // 25 hours ago
      mockReadFile.mockResolvedValue(
        JSON.stringify({ lastCheck: staleTime, latestVersion: '1.0.0' }) as any
      );

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ version: '2.0.0' }),
      });
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);

      const result = await checkForUpdate('1.0.0');
      expect(result).toEqual({
        updateAvailable: true,
        currentVersion: '1.0.0',
        latestVersion: '2.0.0',
      });
      expect(globalThis.fetch).toHaveBeenCalled();
    });

    it('should fetch when no cache exists', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ version: '1.0.0' }),
      });
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);

      const result = await checkForUpdate('1.0.0');
      expect(result).toEqual({
        updateAvailable: false,
        currentVersion: '1.0.0',
        latestVersion: '1.0.0',
      });
      expect(globalThis.fetch).toHaveBeenCalled();
    });

    it('should return null when fetch fails', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('network error'));

      const result = await checkForUpdate('1.0.0');
      expect(result).toBeNull();
    });

    it('should write cache on successful fetch', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ version: '2.0.0' }),
      });
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);

      await checkForUpdate('1.0.0');

      expect(mockWriteFile).toHaveBeenCalledWith(
        '/mock-home/.agent-pipeline/update-check.json',
        expect.stringContaining('"latestVersion":"2.0.0"'),
        'utf-8'
      );
    });

    it('should never throw', async () => {
      mockReadFile.mockImplementation(() => { throw new Error('unexpected'); });
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('fail'));

      const result = await checkForUpdate('1.0.0');
      expect(result).toBeNull();
    });
  });

  describe('formatUpdateNotification', () => {
    it('should include current and latest versions', () => {
      const output = formatUpdateNotification({
        updateAvailable: true,
        currentVersion: '0.1.2',
        latestVersion: '0.2.0',
      });

      expect(output).toContain('0.1.2');
      expect(output).toContain('0.2.0');
    });

    it('should include install command', () => {
      const output = formatUpdateNotification({
        updateAvailable: true,
        currentVersion: '0.1.2',
        latestVersion: '0.2.0',
      });

      expect(output).toContain('npm install -g agent-pipeline');
    });
  });
});
