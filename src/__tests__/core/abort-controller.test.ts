// src/__tests__/core/abort-controller.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PipelineAbortController, PipelineAbortError } from '../../core/abort-controller.js';
import { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

// Create a mock child process
function createMockProcess(): ChildProcess {
  const mockProcess = new EventEmitter() as ChildProcess & { killed: boolean; kill: ReturnType<typeof vi.fn> };
  mockProcess.killed = false;
  mockProcess.kill = vi.fn((signal?: NodeJS.Signals | number) => {
    if (signal === 'SIGKILL' || signal === 'SIGTERM') {
      mockProcess.killed = true;
    }
    return true;
  });
  return mockProcess;
}

describe('PipelineAbortController', () => {
  let controller: PipelineAbortController;

  beforeEach(() => {
    vi.useFakeTimers();
    controller = new PipelineAbortController();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with aborted = false', () => {
      expect(controller.aborted).toBe(false);
    });

    it('should be an instance of EventEmitter', () => {
      expect(controller).toBeInstanceOf(EventEmitter);
    });
  });

  describe('aborted getter', () => {
    it('should return false before abort is called', () => {
      expect(controller.aborted).toBe(false);
    });

    it('should return true after abort is called', () => {
      controller.abort();
      expect(controller.aborted).toBe(true);
    });
  });

  describe('registerProcess()', () => {
    it('should register a child process', () => {
      const mockProcess = createMockProcess();
      controller.registerProcess(mockProcess);

      // Process should be killed when abort is called
      controller.abort();
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('should auto-unregister process on exit', () => {
      const mockProcess = createMockProcess();
      controller.registerProcess(mockProcess);

      // Simulate process exit
      mockProcess.emit('exit', 0);

      // Now abort - process should NOT be killed since it already exited
      controller.abort();
      expect(mockProcess.kill).not.toHaveBeenCalled();
    });

    it('should handle multiple process registrations', () => {
      const process1 = createMockProcess();
      const process2 = createMockProcess();
      const process3 = createMockProcess();

      controller.registerProcess(process1);
      controller.registerProcess(process2);
      controller.registerProcess(process3);

      controller.abort();

      expect(process1.kill).toHaveBeenCalledWith('SIGTERM');
      expect(process2.kill).toHaveBeenCalledWith('SIGTERM');
      expect(process3.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('should clear pending SIGKILL timer when process exits', () => {
      const mockProcess = createMockProcess();
      controller.registerProcess(mockProcess);

      // Start abort (sends SIGTERM)
      controller.abort();
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');

      // Process exits before SIGKILL timer fires
      mockProcess.emit('exit', 0);

      // Advance past the 5s timeout
      vi.advanceTimersByTime(6000);

      // SIGKILL should not have been called since process exited
      expect(mockProcess.kill).not.toHaveBeenCalledWith('SIGKILL');
    });
  });

  describe('abort()', () => {
    it('should set aborted flag to true', () => {
      controller.abort();
      expect(controller.aborted).toBe(true);
    });

    it('should emit abort event', () => {
      const abortHandler = vi.fn();
      controller.on('abort', abortHandler);

      controller.abort();

      expect(abortHandler).toHaveBeenCalledTimes(1);
    });

    it('should be idempotent - calling twice has no additional effect', () => {
      const abortHandler = vi.fn();
      controller.on('abort', abortHandler);

      controller.abort();
      controller.abort();
      controller.abort();

      // Should only emit once
      expect(abortHandler).toHaveBeenCalledTimes(1);
    });

    it('should send SIGTERM to all registered processes', () => {
      const process1 = createMockProcess();
      const process2 = createMockProcess();

      controller.registerProcess(process1);
      controller.registerProcess(process2);

      controller.abort();

      expect(process1.kill).toHaveBeenCalledWith('SIGTERM');
      expect(process2.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('should not try to kill already killed processes', () => {
      const mockProcess = createMockProcess();
      mockProcess.killed = true;

      controller.registerProcess(mockProcess);
      controller.abort();

      expect(mockProcess.kill).not.toHaveBeenCalled();
    });

    it('should send SIGKILL after 5 seconds if process is still running', () => {
      const mockProcess = createMockProcess();
      // Override kill to not set killed = true for SIGTERM
      mockProcess.kill = vi.fn(() => true);

      controller.registerProcess(mockProcess);
      controller.abort();

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
      expect(mockProcess.kill).not.toHaveBeenCalledWith('SIGKILL');

      // Advance time by 5 seconds
      vi.advanceTimersByTime(5000);

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL');
    });

    it('should not send SIGKILL if process dies before timeout', () => {
      const mockProcess = createMockProcess();

      controller.registerProcess(mockProcess);
      controller.abort();

      // Process handles SIGTERM and exits
      mockProcess.killed = true;
      mockProcess.emit('exit', 0);

      // Advance time by 5 seconds
      vi.advanceTimersByTime(5000);

      // Should only have called kill once with SIGTERM
      expect(mockProcess.kill).toHaveBeenCalledTimes(1);
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('should handle abort with no registered processes', () => {
      // Should not throw
      expect(() => controller.abort()).not.toThrow();
      expect(controller.aborted).toBe(true);
    });
  });

  describe('throwIfAborted()', () => {
    it('should not throw if not aborted', () => {
      expect(() => controller.throwIfAborted()).not.toThrow();
    });

    it('should throw PipelineAbortError if aborted', () => {
      controller.abort();

      expect(() => controller.throwIfAborted()).toThrow(PipelineAbortError);
    });

    it('should throw with correct message', () => {
      controller.abort();

      expect(() => controller.throwIfAborted()).toThrow('Pipeline execution aborted');
    });
  });
});

describe('PipelineAbortError', () => {
  it('should create an error with default message', () => {
    const error = new PipelineAbortError();
    expect(error.message).toBe('Pipeline aborted');
  });

  it('should create an error with custom message', () => {
    const error = new PipelineAbortError('Custom abort message');
    expect(error.message).toBe('Custom abort message');
  });

  it('should have name set to "PipelineAbortError"', () => {
    const error = new PipelineAbortError();
    expect(error.name).toBe('PipelineAbortError');
  });

  it('should have isAbortError flag set to true', () => {
    const error = new PipelineAbortError();
    expect(error.isAbortError).toBe(true);
  });

  it('should be an instance of Error', () => {
    const error = new PipelineAbortError();
    expect(error).toBeInstanceOf(Error);
  });

  it('should be an instance of PipelineAbortError', () => {
    const error = new PipelineAbortError();
    expect(error).toBeInstanceOf(PipelineAbortError);
  });

  it('should have a stack trace', () => {
    const error = new PipelineAbortError();
    expect(error.stack).toBeDefined();
    expect(error.stack).toContain('PipelineAbortError');
  });

  it('should be distinguishable from other errors via isAbortError', () => {
    const abortError = new PipelineAbortError();
    const genericError = new Error('test');

    expect('isAbortError' in abortError && abortError.isAbortError).toBe(true);
    expect('isAbortError' in genericError).toBe(false);
  });

  it('should preserve properties through throw/catch', () => {
    try {
      throw new PipelineAbortError('User cancelled');
    } catch (e) {
      expect((e as PipelineAbortError).isAbortError).toBe(true);
      expect((e as PipelineAbortError).name).toBe('PipelineAbortError');
      expect((e as PipelineAbortError).message).toBe('User cancelled');
    }
  });
});
