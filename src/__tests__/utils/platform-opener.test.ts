// src/__tests__/utils/platform-opener.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import { openWithSystem, openInPager } from '../../utils/platform-opener.js';
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

// Mock os
vi.mock('os', () => ({
  platform: vi.fn(),
}));

// Create a mock child process
function createMockChildProcess(): ChildProcess {
  const mockProcess = new EventEmitter() as ChildProcess & {
    unref: ReturnType<typeof vi.fn>;
  };
  mockProcess.unref = vi.fn();
  return mockProcess;
}

describe('platform-opener', () => {
  let mockProcess: ChildProcess;

  beforeEach(() => {
    mockProcess = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(mockProcess);
    vi.mocked(os.platform).mockReturnValue('darwin');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('openWithSystem()', () => {
    describe('platform-specific commands', () => {
      it('should use "open" on macOS (darwin)', async () => {
        vi.mocked(os.platform).mockReturnValue('darwin');

        const promise = openWithSystem('/path/to/file');

        // Resolve the 100ms timeout
        vi.useFakeTimers();
        vi.advanceTimersByTime(100);
        vi.useRealTimers();

        await promise;

        expect(spawn).toHaveBeenCalledWith(
          'open',
          ['/path/to/file'],
          expect.objectContaining({
            stdio: 'ignore',
            detached: true,
            shell: false,
          })
        );
      });

      it('should use "start" on Windows with special handling', async () => {
        vi.mocked(os.platform).mockReturnValue('win32');

        const promise = openWithSystem('/path/to/file');

        vi.useFakeTimers();
        vi.advanceTimersByTime(100);
        vi.useRealTimers();

        await promise;

        expect(spawn).toHaveBeenCalledWith(
          'start',
          ['', '/path/to/file'], // Empty title argument
          expect.objectContaining({
            stdio: 'ignore',
            detached: true,
            shell: true, // Windows needs shell
          })
        );
      });

      it('should use "xdg-open" on Linux', async () => {
        vi.mocked(os.platform).mockReturnValue('linux');

        const promise = openWithSystem('/path/to/file');

        vi.useFakeTimers();
        vi.advanceTimersByTime(100);
        vi.useRealTimers();

        await promise;

        expect(spawn).toHaveBeenCalledWith(
          'xdg-open',
          ['/path/to/file'],
          expect.objectContaining({
            stdio: 'ignore',
            detached: true,
            shell: false,
          })
        );
      });

      it('should use "xdg-open" on FreeBSD', async () => {
        vi.mocked(os.platform).mockReturnValue('freebsd');

        const promise = openWithSystem('/path/to/file');

        vi.useFakeTimers();
        vi.advanceTimersByTime(100);
        vi.useRealTimers();

        await promise;

        expect(spawn).toHaveBeenCalledWith(
          'xdg-open',
          ['/path/to/file'],
          expect.objectContaining({
            shell: false,
          })
        );
      });
    });

    describe('process handling', () => {
      it('should call unref() to detach process', async () => {
        const promise = openWithSystem('/path/to/file');

        vi.useFakeTimers();
        vi.advanceTimersByTime(100);
        vi.useRealTimers();

        await promise;

        expect(mockProcess.unref).toHaveBeenCalled();
      });

      it('should resolve after 100ms timeout', async () => {
        vi.useFakeTimers();

        const promise = openWithSystem('/path/to/file');

        // Should still be pending before timeout
        vi.advanceTimersByTime(50);

        // Advance past timeout
        vi.advanceTimersByTime(50);

        vi.useRealTimers();

        await expect(promise).resolves.toBeUndefined();
      });

      it('should reject on immediate error', async () => {
        vi.useFakeTimers();

        const promise = openWithSystem('/path/to/file');

        // Emit error before timeout
        const error = new Error('spawn error');
        mockProcess.emit('error', error);

        vi.useRealTimers();

        await expect(promise).rejects.toThrow('spawn error');
      });
    });

    describe('target types', () => {
      it('should handle file targets', async () => {
        const promise = openWithSystem('/path/to/file.txt', 'file');

        vi.useFakeTimers();
        vi.advanceTimersByTime(100);
        vi.useRealTimers();

        await promise;

        expect(spawn).toHaveBeenCalledWith(
          'open',
          ['/path/to/file.txt'],
          expect.any(Object)
        );
      });

      it('should handle URL targets', async () => {
        const promise = openWithSystem('https://example.com', 'url');

        vi.useFakeTimers();
        vi.advanceTimersByTime(100);
        vi.useRealTimers();

        await promise;

        expect(spawn).toHaveBeenCalledWith(
          'open',
          ['https://example.com'],
          expect.any(Object)
        );
      });

      it('should handle directory targets', async () => {
        const promise = openWithSystem('/path/to/dir', 'directory');

        vi.useFakeTimers();
        vi.advanceTimersByTime(100);
        vi.useRealTimers();

        await promise;

        expect(spawn).toHaveBeenCalledWith(
          'open',
          ['/path/to/dir'],
          expect.any(Object)
        );
      });

      it('should default to "file" type', async () => {
        const promise = openWithSystem('/path/to/file');

        vi.useFakeTimers();
        vi.advanceTimersByTime(100);
        vi.useRealTimers();

        await promise;

        // Should work the same as explicit file type
        expect(spawn).toHaveBeenCalled();
      });
    });
  });

  describe('openInPager()', () => {
    describe('pager selection', () => {
      it('should use $PAGER environment variable when set', async () => {
        const originalPager = process.env.PAGER;
        process.env.PAGER = 'more';

        const promise = openInPager('/path/to/file.txt');

        // Simulate immediate exit
        mockProcess.emit('exit', 0);

        await promise;

        expect(spawn).toHaveBeenCalledWith(
          'more',
          ['/path/to/file.txt'],
          expect.objectContaining({ stdio: 'inherit' })
        );

        process.env.PAGER = originalPager;
      });

      it('should default to "less" when PAGER is not set', async () => {
        const originalPager = process.env.PAGER;
        delete process.env.PAGER;

        const promise = openInPager('/path/to/file.txt');

        mockProcess.emit('exit', 0);

        await promise;

        expect(spawn).toHaveBeenCalledWith(
          'less',
          ['/path/to/file.txt'],
          expect.objectContaining({ stdio: 'inherit' })
        );

        process.env.PAGER = originalPager;
      });

      it('should parse pager command with flags', async () => {
        const originalPager = process.env.PAGER;
        process.env.PAGER = 'less -R -S';

        const promise = openInPager('/path/to/file.txt');

        mockProcess.emit('exit', 0);

        await promise;

        expect(spawn).toHaveBeenCalledWith(
          'less',
          ['-R', '-S', '/path/to/file.txt'],
          expect.any(Object)
        );

        process.env.PAGER = originalPager;
      });

      it('should handle quoted arguments in PAGER', async () => {
        const originalPager = process.env.PAGER;
        process.env.PAGER = 'vim -c "set readonly"';

        const promise = openInPager('/path/to/file.txt');

        mockProcess.emit('exit', 0);

        await promise;

        expect(spawn).toHaveBeenCalledWith(
          'vim',
          ['-c', 'set readonly', '/path/to/file.txt'],
          expect.any(Object)
        );

        process.env.PAGER = originalPager;
      });
    });

    describe('process lifecycle', () => {
      it('should inherit stdio for interactive use', async () => {
        const promise = openInPager('/path/to/file.txt');

        mockProcess.emit('exit', 0);

        await promise;

        expect(spawn).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(Array),
          expect.objectContaining({ stdio: 'inherit' })
        );
      });

      it('should resolve on process exit', async () => {
        const promise = openInPager('/path/to/file.txt');

        mockProcess.emit('exit', 0);

        await expect(promise).resolves.toBeUndefined();
      });

      it('should resolve on process error', async () => {
        const promise = openInPager('/path/to/file.txt');

        mockProcess.emit('error', new Error('pager not found'));

        // Should still resolve, not reject
        await expect(promise).resolves.toBeUndefined();
      });
    });
  });

  describe('parseCommand (internal)', () => {
    // Testing through openInPager since parseCommand is not exported
    it('should handle empty PAGER', async () => {
      const originalPager = process.env.PAGER;
      process.env.PAGER = '';

      const promise = openInPager('/file.txt');
      mockProcess.emit('exit', 0);
      await promise;

      // Should fall back to 'less'
      expect(spawn).toHaveBeenCalledWith(
        'less',
        ['/file.txt'],
        expect.any(Object)
      );

      process.env.PAGER = originalPager;
    });

    it('should handle PAGER with only whitespace', async () => {
      const originalPager = process.env.PAGER;
      process.env.PAGER = '   ';

      const promise = openInPager('/file.txt');
      mockProcess.emit('exit', 0);
      await promise;

      // Should fall back to 'less'
      expect(spawn).toHaveBeenCalledWith(
        'less',
        ['/file.txt'],
        expect.any(Object)
      );

      process.env.PAGER = originalPager;
    });

    it('should handle single-quoted arguments', async () => {
      const originalPager = process.env.PAGER;
      process.env.PAGER = "less -c 'syntax on'";

      const promise = openInPager('/file.txt');
      mockProcess.emit('exit', 0);
      await promise;

      expect(spawn).toHaveBeenCalledWith(
        'less',
        ['-c', 'syntax on', '/file.txt'],
        expect.any(Object)
      );

      process.env.PAGER = originalPager;
    });

    it('should handle mixed quote styles', async () => {
      const originalPager = process.env.PAGER;
      process.env.PAGER = `less -c "set ft" -d 'no wrap'`;

      const promise = openInPager('/file.txt');
      mockProcess.emit('exit', 0);
      await promise;

      expect(spawn).toHaveBeenCalledWith(
        'less',
        ['-c', 'set ft', '-d', 'no wrap', '/file.txt'],
        expect.any(Object)
      );

      process.env.PAGER = originalPager;
    });

    it('should handle complex command with multiple flags', async () => {
      const originalPager = process.env.PAGER;
      process.env.PAGER = 'bat --style=plain --paging=always';

      const promise = openInPager('/file.txt');
      mockProcess.emit('exit', 0);
      await promise;

      expect(spawn).toHaveBeenCalledWith(
        'bat',
        ['--style=plain', '--paging=always', '/file.txt'],
        expect.any(Object)
      );

      process.env.PAGER = originalPager;
    });
  });
});
