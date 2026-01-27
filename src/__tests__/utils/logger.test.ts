// src/__tests__/utils/logger.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger, LogLevel } from '../../utils/logger.js';

describe('Logger', () => {
  let consoleDebugSpy: any;
  let consoleLogSpy: any;
  let consoleWarnSpy: any;
  let consoleErrorSpy: any;

  beforeEach(() => {
    consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Reset to default level before each test
    Logger.setLevel(LogLevel.INFO);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('LogLevel enum', () => {
    it('should have correct numeric values', () => {
      expect(LogLevel.DEBUG).toBe(0);
      expect(LogLevel.INFO).toBe(1);
      expect(LogLevel.WARN).toBe(2);
      expect(LogLevel.ERROR).toBe(3);
    });

    it('should maintain correct ordering', () => {
      expect(LogLevel.DEBUG).toBeLessThan(LogLevel.INFO);
      expect(LogLevel.INFO).toBeLessThan(LogLevel.WARN);
      expect(LogLevel.WARN).toBeLessThan(LogLevel.ERROR);
    });
  });

  describe('setLevel()', () => {
    it('should set level to DEBUG', () => {
      Logger.setLevel(LogLevel.DEBUG);
      Logger.debug('test');
      expect(consoleDebugSpy).toHaveBeenCalled();
    });

    it('should set level to INFO', () => {
      Logger.setLevel(LogLevel.INFO);
      Logger.info('test');
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('should set level to WARN', () => {
      Logger.setLevel(LogLevel.WARN);
      Logger.warn('test');
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('should set level to ERROR', () => {
      Logger.setLevel(LogLevel.ERROR);
      Logger.error('test');
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('debug()', () => {
    it('should log with 🔍 emoji when level is DEBUG', () => {
      Logger.setLevel(LogLevel.DEBUG);
      Logger.debug('test message');

      expect(consoleDebugSpy).toHaveBeenCalledTimes(1);
      expect(consoleDebugSpy).toHaveBeenCalledWith('🔍 test message');
    });

    it('should log with additional arguments when level is DEBUG', () => {
      Logger.setLevel(LogLevel.DEBUG);
      const obj = { key: 'value' };
      Logger.debug('test message', obj, 123);

      expect(consoleDebugSpy).toHaveBeenCalledWith('🔍 test message', obj, 123);
    });

    it('should NOT log when level is INFO', () => {
      Logger.setLevel(LogLevel.INFO);
      Logger.debug('test message');

      expect(consoleDebugSpy).not.toHaveBeenCalled();
    });

    it('should NOT log when level is WARN', () => {
      Logger.setLevel(LogLevel.WARN);
      Logger.debug('test message');

      expect(consoleDebugSpy).not.toHaveBeenCalled();
    });

    it('should NOT log when level is ERROR', () => {
      Logger.setLevel(LogLevel.ERROR);
      Logger.debug('test message');

      expect(consoleDebugSpy).not.toHaveBeenCalled();
    });

    it('should call console.debug not console.log', () => {
      Logger.setLevel(LogLevel.DEBUG);
      Logger.debug('test message');

      expect(consoleDebugSpy).toHaveBeenCalled();
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should format message correctly with emoji prefix', () => {
      Logger.setLevel(LogLevel.DEBUG);
      Logger.debug('debugging info');

      const call = consoleDebugSpy.mock.calls[0];
      expect(call[0]).toContain('🔍');
      expect(call[0]).toContain('debugging info');
    });

    it('should handle empty message string', () => {
      Logger.setLevel(LogLevel.DEBUG);
      Logger.debug('');

      expect(consoleDebugSpy).toHaveBeenCalledWith('🔍 ');
    });
  });

  describe('info()', () => {
    it('should log with ℹ️ emoji when level is DEBUG', () => {
      Logger.setLevel(LogLevel.DEBUG);
      Logger.info('test message');

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      expect(consoleLogSpy).toHaveBeenCalledWith('ℹ️  test message');
    });

    it('should log with ℹ️ emoji when level is INFO', () => {
      Logger.setLevel(LogLevel.INFO);
      Logger.info('test message');

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      expect(consoleLogSpy).toHaveBeenCalledWith('ℹ️  test message');
    });

    it('should NOT log when level is WARN', () => {
      Logger.setLevel(LogLevel.WARN);
      Logger.info('test message');

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should NOT log when level is ERROR', () => {
      Logger.setLevel(LogLevel.ERROR);
      Logger.info('test message');

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should call console.log', () => {
      Logger.setLevel(LogLevel.INFO);
      Logger.info('test message');

      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('should format message correctly with emoji prefix', () => {
      Logger.setLevel(LogLevel.INFO);
      Logger.info('information message');

      const call = consoleLogSpy.mock.calls[0];
      expect(call[0]).toContain('ℹ️');
      expect(call[0]).toContain('information message');
    });

    it('should pass through additional arguments', () => {
      Logger.setLevel(LogLevel.INFO);
      const data = { foo: 'bar' };
      Logger.info('test', data, 456);

      expect(consoleLogSpy).toHaveBeenCalledWith('ℹ️  test', data, 456);
    });

    it('should handle complex objects as arguments', () => {
      Logger.setLevel(LogLevel.INFO);
      const complexObj = { nested: { deep: { value: 123 } }, arr: [1, 2, 3] };
      Logger.info('complex data', complexObj);

      expect(consoleLogSpy).toHaveBeenCalledWith('ℹ️  complex data', complexObj);
    });
  });

  describe('warn()', () => {
    it('should log with ⚠️ emoji when level is DEBUG', () => {
      Logger.setLevel(LogLevel.DEBUG);
      Logger.warn('test message');

      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      expect(consoleWarnSpy).toHaveBeenCalledWith('⚠️  test message');
    });

    it('should log with ⚠️ emoji when level is INFO', () => {
      Logger.setLevel(LogLevel.INFO);
      Logger.warn('test message');

      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      expect(consoleWarnSpy).toHaveBeenCalledWith('⚠️  test message');
    });

    it('should log with ⚠️ emoji when level is WARN', () => {
      Logger.setLevel(LogLevel.WARN);
      Logger.warn('test message');

      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      expect(consoleWarnSpy).toHaveBeenCalledWith('⚠️  test message');
    });

    it('should NOT log when level is ERROR', () => {
      Logger.setLevel(LogLevel.ERROR);
      Logger.warn('test message');

      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('should call console.warn', () => {
      Logger.setLevel(LogLevel.WARN);
      Logger.warn('test message');

      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('should format message correctly with emoji prefix', () => {
      Logger.setLevel(LogLevel.WARN);
      Logger.warn('warning message');

      const call = consoleWarnSpy.mock.calls[0];
      expect(call[0]).toContain('⚠️');
      expect(call[0]).toContain('warning message');
    });

    it('should pass through additional arguments', () => {
      Logger.setLevel(LogLevel.WARN);
      const error = new Error('test error');
      Logger.warn('warning', error);

      expect(consoleWarnSpy).toHaveBeenCalledWith('⚠️  warning', error);
    });
  });

  describe('error()', () => {
    it('should log with ❌ emoji when level is DEBUG', () => {
      Logger.setLevel(LogLevel.DEBUG);
      Logger.error('test message');

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith('❌ test message');
    });

    it('should log with ❌ emoji when level is INFO', () => {
      Logger.setLevel(LogLevel.INFO);
      Logger.error('test message');

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith('❌ test message');
    });

    it('should log with ❌ emoji when level is WARN', () => {
      Logger.setLevel(LogLevel.WARN);
      Logger.error('test message');

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith('❌ test message');
    });

    it('should log with ❌ emoji when level is ERROR', () => {
      Logger.setLevel(LogLevel.ERROR);
      Logger.error('test message');

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith('❌ test message');
    });

    it('should always log regardless of log level', () => {
      const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];

      levels.forEach(level => {
        consoleErrorSpy.mockClear();
        Logger.setLevel(level);
        Logger.error('test');
        expect(consoleErrorSpy).toHaveBeenCalled();
      });
    });

    it('should call console.error', () => {
      Logger.setLevel(LogLevel.ERROR);
      Logger.error('test message');

      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should format message correctly with emoji prefix', () => {
      Logger.setLevel(LogLevel.ERROR);
      Logger.error('error message');

      const call = consoleErrorSpy.mock.calls[0];
      expect(call[0]).toContain('❌');
      expect(call[0]).toContain('error message');
    });

    it('should pass through additional arguments', () => {
      Logger.setLevel(LogLevel.ERROR);
      const errorObj = new Error('Something went wrong');
      const context = { userId: 123 };
      Logger.error('critical error', errorObj, context);

      expect(consoleErrorSpy).toHaveBeenCalledWith('❌ critical error', errorObj, context);
    });

    it('should handle Error objects as arguments', () => {
      Logger.setLevel(LogLevel.ERROR);
      const error = new Error('Test error');
      Logger.error('exception occurred', error);

      expect(consoleErrorSpy).toHaveBeenCalledWith('❌ exception occurred', error);
    });
  });

  describe('success()', () => {
    it('should log with ✅ emoji when level is DEBUG', () => {
      Logger.setLevel(LogLevel.DEBUG);
      Logger.success('test message');

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      expect(consoleLogSpy).toHaveBeenCalledWith('✅ test message');
    });

    it('should log with ✅ emoji when level is INFO', () => {
      Logger.setLevel(LogLevel.INFO);
      Logger.success('test message');

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      expect(consoleLogSpy).toHaveBeenCalledWith('✅ test message');
    });

    it('should NOT log when level is WARN', () => {
      Logger.setLevel(LogLevel.WARN);
      Logger.success('test message');

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should NOT log when level is ERROR', () => {
      Logger.setLevel(LogLevel.ERROR);
      Logger.success('test message');

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should call console.log not console.success', () => {
      Logger.setLevel(LogLevel.INFO);
      Logger.success('test message');

      expect(consoleLogSpy).toHaveBeenCalled();
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should format message correctly with emoji prefix', () => {
      Logger.setLevel(LogLevel.INFO);
      Logger.success('success message');

      const call = consoleLogSpy.mock.calls[0];
      expect(call[0]).toContain('✅');
      expect(call[0]).toContain('success message');
    });

    it('should pass through additional arguments', () => {
      Logger.setLevel(LogLevel.INFO);
      const result = { status: 'completed', id: 789 };
      Logger.success('operation successful', result);

      expect(consoleLogSpy).toHaveBeenCalledWith('✅ operation successful', result);
    });
  });

  describe('edge cases', () => {
    it('should handle undefined arguments gracefully', () => {
      Logger.setLevel(LogLevel.INFO);
      Logger.info('test', undefined);

      expect(consoleLogSpy).toHaveBeenCalledWith('ℹ️  test', undefined);
    });

    it('should handle null arguments gracefully', () => {
      Logger.setLevel(LogLevel.INFO);
      Logger.info('test', null);

      expect(consoleLogSpy).toHaveBeenCalledWith('ℹ️  test', null);
    });

    it('should preserve log level between multiple calls', () => {
      Logger.setLevel(LogLevel.WARN);

      Logger.info('should not log');
      expect(consoleLogSpy).not.toHaveBeenCalled();

      Logger.warn('should log');
      expect(consoleWarnSpy).toHaveBeenCalled();

      Logger.info('still should not log');
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should handle rapid level switching', () => {
      Logger.setLevel(LogLevel.DEBUG);
      Logger.debug('debug log');
      expect(consoleDebugSpy).toHaveBeenCalledTimes(1);

      Logger.setLevel(LogLevel.ERROR);
      Logger.debug('should not log');
      expect(consoleDebugSpy).toHaveBeenCalledTimes(1);

      Logger.setLevel(LogLevel.INFO);
      Logger.info('info log');
      expect(consoleLogSpy).toHaveBeenCalledTimes(1);

      Logger.setLevel(LogLevel.WARN);
      Logger.info('should not log');
      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple simultaneous log calls at same level', () => {
      Logger.setLevel(LogLevel.INFO);

      Logger.info('first');
      Logger.info('second');
      Logger.info('third');

      expect(consoleLogSpy).toHaveBeenCalledTimes(3);
      expect(consoleLogSpy).toHaveBeenNthCalledWith(1, 'ℹ️  first');
      expect(consoleLogSpy).toHaveBeenNthCalledWith(2, 'ℹ️  second');
      expect(consoleLogSpy).toHaveBeenNthCalledWith(3, 'ℹ️  third');
    });

    it('should handle mixed log types at same level', () => {
      Logger.setLevel(LogLevel.INFO);

      Logger.info('info message');
      Logger.success('success message');
      Logger.warn('warning message');
      Logger.error('error message');

      expect(consoleLogSpy).toHaveBeenCalledTimes(2); // info + success
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });

    it('should handle array arguments', () => {
      Logger.setLevel(LogLevel.INFO);
      const arr = [1, 2, 3];
      Logger.info('array data', arr);

      expect(consoleLogSpy).toHaveBeenCalledWith('ℹ️  array data', arr);
    });

    it('should handle very long messages', () => {
      Logger.setLevel(LogLevel.INFO);
      const longMessage = 'a'.repeat(1000);
      Logger.info(longMessage);

      expect(consoleLogSpy).toHaveBeenCalledWith(`ℹ️  ${longMessage}`);
    });
  });
});
