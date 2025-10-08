// src/core/retry-handler.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RetryHandler, RetryContext } from '../../core/retry-handler.js';
import { RetryConfig } from '../../config/schema.js';

describe('RetryHandler', () => {
  let handler: RetryHandler;

  beforeEach(() => {
    handler = new RetryHandler();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('executeWithRetry', () => {
    describe('success scenarios', () => {
      it('should return result immediately on first success', async () => {
        const mockFn = vi.fn().mockResolvedValue('success');
        const config: RetryConfig = { maxAttempts: 3, backoff: 'fixed', initialDelay: 1000 };

        const promise = handler.executeWithRetry(mockFn, config);
        const result = await promise;

        expect(result).toBe('success');
        expect(mockFn).toHaveBeenCalledTimes(1);
      });

      it('should succeed on second attempt after one failure', async () => {
        const mockFn = vi.fn()
          .mockRejectedValueOnce(new Error('temporary failure'))
          .mockResolvedValueOnce('success');

        const config: RetryConfig = { maxAttempts: 3, backoff: 'fixed', initialDelay: 100 };

        const promise = handler.executeWithRetry(mockFn, config);

        // Fast-forward past the delay
        await vi.advanceTimersByTimeAsync(100);
        const result = await promise;

        expect(result).toBe('success');
        expect(mockFn).toHaveBeenCalledTimes(2);
      });

      it('should succeed on third attempt after two failures', async () => {
        const mockFn = vi.fn()
          .mockRejectedValueOnce(new Error('failure 1'))
          .mockRejectedValueOnce(new Error('failure 2'))
          .mockResolvedValueOnce('success');

        const config: RetryConfig = { maxAttempts: 3, backoff: 'fixed', initialDelay: 100 };

        const promise = handler.executeWithRetry(mockFn, config);

        // Fast-forward past both delays
        await vi.advanceTimersByTimeAsync(100); // First retry
        await vi.advanceTimersByTimeAsync(100); // Second retry
        const result = await promise;

        expect(result).toBe('success');
        expect(mockFn).toHaveBeenCalledTimes(3);
      });

      it('should succeed on last possible attempt', async () => {
        const mockFn = vi.fn()
          .mockRejectedValueOnce(new Error('fail'))
          .mockRejectedValueOnce(new Error('fail'))
          .mockRejectedValueOnce(new Error('fail'))
          .mockRejectedValueOnce(new Error('fail'))
          .mockResolvedValueOnce('success');

        const config: RetryConfig = { maxAttempts: 5, backoff: 'fixed', initialDelay: 50 };

        const promise = handler.executeWithRetry(mockFn, config);

        // Fast-forward through all retries
        for (let i = 0; i < 4; i++) {
          await vi.advanceTimersByTimeAsync(50);
        }
        const result = await promise;

        expect(result).toBe('success');
        expect(mockFn).toHaveBeenCalledTimes(5);
      });
    });

    describe('failure scenarios', () => {
      it('should throw error after exhausting all retries', async () => {
        const mockFn = vi.fn().mockRejectedValue(new Error('persistent failure'));
        const config: RetryConfig = { maxAttempts: 3, backoff: 'fixed', initialDelay: 100 };

        const promise = handler.executeWithRetry(mockFn, config);
        promise.catch(() => {}); // Suppress unhandled rejection warning

        // Fast-forward through all retries
        await vi.advanceTimersByTimeAsync(100);
        await vi.advanceTimersByTimeAsync(100);

        await expect(promise).rejects.toThrow('persistent failure');
        expect(mockFn).toHaveBeenCalledTimes(3);
      });

      it('should not retry non-retryable errors (auth)', async () => {
        const mockFn = vi.fn().mockRejectedValue(new Error('401 Unauthorized'));
        const config: RetryConfig = { maxAttempts: 3, backoff: 'fixed', initialDelay: 100 };

        await expect(handler.executeWithRetry(mockFn, config)).rejects.toThrow('401 Unauthorized');
        expect(mockFn).toHaveBeenCalledTimes(1); // No retries
      });

      it('should not retry non-retryable errors (ENOENT)', async () => {
        const mockFn = vi.fn().mockRejectedValue(new Error('ENOENT: no such file'));
        const config: RetryConfig = { maxAttempts: 3, backoff: 'fixed', initialDelay: 100 };

        await expect(handler.executeWithRetry(mockFn, config)).rejects.toThrow('ENOENT');
        expect(mockFn).toHaveBeenCalledTimes(1); // No retries
      });

      it('should not retry YAML parse errors', async () => {
        const mockFn = vi.fn().mockRejectedValue(new Error('YAML parse error'));
        const config: RetryConfig = { maxAttempts: 3, backoff: 'fixed', initialDelay: 100 };

        await expect(handler.executeWithRetry(mockFn, config)).rejects.toThrow('YAML parse error');
        expect(mockFn).toHaveBeenCalledTimes(1); // No retries
      });

      it('should not retry invalid config errors', async () => {
        const mockFn = vi.fn().mockRejectedValue(new Error('Invalid config provided'));
        const config: RetryConfig = { maxAttempts: 3, backoff: 'fixed', initialDelay: 100 };

        await expect(handler.executeWithRetry(mockFn, config)).rejects.toThrow('Invalid config');
        expect(mockFn).toHaveBeenCalledTimes(1); // No retries
      });

      it('should handle non-Error exceptions', async () => {
        const mockFn = vi.fn().mockRejectedValue('string error');
        const config: RetryConfig = { maxAttempts: 2, backoff: 'fixed', initialDelay: 50 };

        const promise = handler.executeWithRetry(mockFn, config);
        promise.catch(() => {}); // Suppress unhandled rejection warning
        await vi.advanceTimersByTimeAsync(50);

        await expect(promise).rejects.toThrow('string error');
        expect(mockFn).toHaveBeenCalledTimes(2);
      });
    });

    describe('retry callback', () => {
      it('should call onRetry callback with correct context on first retry', async () => {
        const mockFn = vi.fn()
          .mockRejectedValueOnce(new Error('fail'))
          .mockResolvedValueOnce('success');

        const config: RetryConfig = { maxAttempts: 3, backoff: 'fixed', initialDelay: 100 };
        const capturedContexts: RetryContext[] = [];
        const onRetry = vi.fn((ctx) => {
          // Deep clone to capture state at callback time
          capturedContexts.push({
            attemptNumber: ctx.attemptNumber,
            maxAttempts: ctx.maxAttempts,
            lastError: ctx.lastError,
            delays: [...ctx.delays]
          });
        });

        const promise = handler.executeWithRetry(mockFn, config, onRetry);
        await vi.advanceTimersByTimeAsync(100);
        await promise;

        expect(onRetry).toHaveBeenCalledTimes(1);
        expect(capturedContexts[0]).toMatchObject({
          attemptNumber: 0,
          maxAttempts: 3,
          delays: [100]
        });
        expect(capturedContexts[0].lastError).toBeInstanceOf(Error);
      });

      it('should call onRetry callback multiple times with updated context', async () => {
        const mockFn = vi.fn()
          .mockRejectedValueOnce(new Error('fail 1'))
          .mockRejectedValueOnce(new Error('fail 2'))
          .mockResolvedValueOnce('success');

        const config: RetryConfig = { maxAttempts: 4, backoff: 'fixed', initialDelay: 50 };
        const capturedContexts: RetryContext[] = [];
        const onRetry = vi.fn((ctx) => {
          capturedContexts.push({
            attemptNumber: ctx.attemptNumber,
            maxAttempts: ctx.maxAttempts,
            lastError: ctx.lastError,
            delays: [...ctx.delays]
          });
        });

        const promise = handler.executeWithRetry(mockFn, config, onRetry);
        await vi.advanceTimersByTimeAsync(50);
        await vi.advanceTimersByTimeAsync(50);
        await promise;

        expect(onRetry).toHaveBeenCalledTimes(2);

        // First retry
        expect(capturedContexts[0]).toMatchObject({
          attemptNumber: 0,
          delays: [50]
        });

        // Second retry
        expect(capturedContexts[1]).toMatchObject({
          attemptNumber: 1,
          delays: [50, 50]
        });
      });

      it('should not call onRetry on first attempt success', async () => {
        const mockFn = vi.fn().mockResolvedValue('success');
        const config: RetryConfig = { maxAttempts: 3, backoff: 'fixed', initialDelay: 100 };
        const onRetry = vi.fn();

        await handler.executeWithRetry(mockFn, config, onRetry);

        expect(onRetry).not.toHaveBeenCalled();
      });

      it('should include last error in retry context', async () => {
        const error1 = new Error('network timeout');
        const mockFn = vi.fn()
          .mockRejectedValueOnce(error1)
          .mockResolvedValueOnce('success');

        const config: RetryConfig = { maxAttempts: 3, backoff: 'fixed', initialDelay: 50 };
        const onRetry = vi.fn();

        const promise = handler.executeWithRetry(mockFn, config, onRetry);
        await vi.advanceTimersByTimeAsync(50);
        await promise;

        expect(onRetry).toHaveBeenCalledWith(
          expect.objectContaining({
            lastError: error1
          })
        );
      });
    });

    describe('default configuration', () => {
      it('should use default maxAttempts of 3 when not specified', async () => {
        const mockFn = vi.fn().mockRejectedValue(new Error('fail'));
        const config: RetryConfig = { backoff: 'fixed', initialDelay: 50 };

        const promise = handler.executeWithRetry(mockFn, config);
        promise.catch(() => {}); // Suppress unhandled rejection warning
        await vi.advanceTimersByTimeAsync(50);
        await vi.advanceTimersByTimeAsync(50);

        await expect(promise).rejects.toThrow('fail');
        expect(mockFn).toHaveBeenCalledTimes(3); // Default maxAttempts
      });

      it('should handle maxAttempts of 1 (no retries)', async () => {
        const mockFn = vi.fn().mockRejectedValue(new Error('fail'));
        const config: RetryConfig = { maxAttempts: 1, backoff: 'fixed', initialDelay: 100 };

        await expect(handler.executeWithRetry(mockFn, config)).rejects.toThrow('fail');
        expect(mockFn).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('calculateDelay (via backoff strategies)', () => {
    describe('fixed backoff', () => {
      it('should use same delay for all attempts', async () => {
        const mockFn = vi.fn()
          .mockRejectedValueOnce(new Error('fail'))
          .mockRejectedValueOnce(new Error('fail'))
          .mockResolvedValueOnce('success');

        const config: RetryConfig = { maxAttempts: 4, backoff: 'fixed', initialDelay: 1000 };
        const onRetry = vi.fn();

        const promise = handler.executeWithRetry(mockFn, config, onRetry);
        await vi.advanceTimersByTimeAsync(1000);
        await vi.advanceTimersByTimeAsync(1000);
        await promise;

        const delays = onRetry.mock.calls.map(call => call[0].delays[call[0].delays.length - 1]);
        expect(delays).toEqual([1000, 1000]);
      });

      it('should default to fixed backoff when not specified', async () => {
        const mockFn = vi.fn()
          .mockRejectedValueOnce(new Error('fail'))
          .mockResolvedValueOnce('success');

        const config: RetryConfig = { maxAttempts: 3, initialDelay: 500 };
        const onRetry = vi.fn();

        const promise = handler.executeWithRetry(mockFn, config, onRetry);
        await vi.advanceTimersByTimeAsync(500);
        await promise;

        expect(onRetry.mock.calls[0][0].delays).toEqual([500]);
      });

      it('should use default initialDelay of 1000ms when not specified', async () => {
        const mockFn = vi.fn()
          .mockRejectedValueOnce(new Error('fail'))
          .mockResolvedValueOnce('success');

        const config: RetryConfig = { maxAttempts: 3, backoff: 'fixed' };
        const onRetry = vi.fn();

        const promise = handler.executeWithRetry(mockFn, config, onRetry);
        await vi.advanceTimersByTimeAsync(1000);
        await promise;

        expect(onRetry.mock.calls[0][0].delays).toEqual([1000]);
      });
    });

    describe('linear backoff', () => {
      it('should increase delay linearly', async () => {
        const mockFn = vi.fn()
          .mockRejectedValueOnce(new Error('fail'))
          .mockRejectedValueOnce(new Error('fail'))
          .mockRejectedValueOnce(new Error('fail'))
          .mockResolvedValueOnce('success');

        const config: RetryConfig = {
          maxAttempts: 5,
          backoff: 'linear',
          initialDelay: 1000
        };
        const capturedDelays: number[] = [];
        const onRetry = vi.fn((ctx) => {
          // Capture the latest delay added (last element in delays array)
          capturedDelays.push(ctx.delays[ctx.delays.length - 1]);
        });

        const promise = handler.executeWithRetry(mockFn, config, onRetry);

        // Linear: attempt 0 = 1000ms, attempt 1 = 2000ms, attempt 2 = 3000ms
        await vi.advanceTimersByTimeAsync(1000); // First retry
        await vi.advanceTimersByTimeAsync(2000); // Second retry
        await vi.advanceTimersByTimeAsync(3000); // Third retry
        await promise;

        expect(capturedDelays).toEqual([1000, 2000, 3000]);
      });

      it('should cap linear delay at maxDelay', async () => {
        const mockFn = vi.fn()
          .mockRejectedValueOnce(new Error('fail'))
          .mockRejectedValueOnce(new Error('fail'))
          .mockResolvedValueOnce('success');

        const config: RetryConfig = {
          maxAttempts: 4,
          backoff: 'linear',
          initialDelay: 1000,
          maxDelay: 1500
        };
        const capturedDelays: number[] = [];
        const onRetry = vi.fn((ctx) => {
          capturedDelays.push(ctx.delays[ctx.delays.length - 1]);
        });

        const promise = handler.executeWithRetry(mockFn, config, onRetry);

        // Linear would be: 1000, 2000 but capped at 1500
        await vi.advanceTimersByTimeAsync(1000);
        await vi.advanceTimersByTimeAsync(1500); // Capped
        await promise;

        expect(capturedDelays).toEqual([1000, 1500]); // Second delay capped
      });
    });

    describe('exponential backoff', () => {
      it('should increase delay exponentially', async () => {
        const mockFn = vi.fn()
          .mockRejectedValueOnce(new Error('fail'))
          .mockRejectedValueOnce(new Error('fail'))
          .mockRejectedValueOnce(new Error('fail'))
          .mockResolvedValueOnce('success');

        const config: RetryConfig = {
          maxAttempts: 5,
          backoff: 'exponential',
          initialDelay: 1000
        };
        const capturedDelays: number[] = [];
        const onRetry = vi.fn((ctx) => {
          capturedDelays.push(ctx.delays[ctx.delays.length - 1]);
        });

        const promise = handler.executeWithRetry(mockFn, config, onRetry);

        // Exponential: 2^0 * 1000 = 1000, 2^1 * 1000 = 2000, 2^2 * 1000 = 4000
        await vi.advanceTimersByTimeAsync(1000);
        await vi.advanceTimersByTimeAsync(2000);
        await vi.advanceTimersByTimeAsync(4000);
        await promise;

        expect(capturedDelays).toEqual([1000, 2000, 4000]);
      });

      it('should cap exponential delay at maxDelay', async () => {
        const mockFn = vi.fn()
          .mockRejectedValueOnce(new Error('fail'))
          .mockRejectedValueOnce(new Error('fail'))
          .mockRejectedValueOnce(new Error('fail'))
          .mockResolvedValueOnce('success');

        const config: RetryConfig = {
          maxAttempts: 5,
          backoff: 'exponential',
          initialDelay: 1000,
          maxDelay: 3000
        };
        const capturedDelays: number[] = [];
        const onRetry = vi.fn((ctx) => {
          capturedDelays.push(ctx.delays[ctx.delays.length - 1]);
        });

        const promise = handler.executeWithRetry(mockFn, config, onRetry);

        // Exponential: 1000, 2000, 4000 (capped at 3000)
        await vi.advanceTimersByTimeAsync(1000);
        await vi.advanceTimersByTimeAsync(2000);
        await vi.advanceTimersByTimeAsync(3000); // Capped
        await promise;

        expect(capturedDelays).toEqual([1000, 2000, 3000]);
      });

      it('should use default maxDelay of 30000ms when not specified', async () => {
        const mockFn = vi.fn()
          .mockRejectedValueOnce(new Error('fail'))
          .mockResolvedValueOnce('success');

        // With initialDelay of 20000, exponential would give 20000 * 2^0 = 20000
        // But without maxDelay specified, it should default to 30000
        const config: RetryConfig = {
          maxAttempts: 3,
          backoff: 'exponential',
          initialDelay: 20000
        };
        const onRetry = vi.fn();

        const promise = handler.executeWithRetry(mockFn, config, onRetry);
        await vi.advanceTimersByTimeAsync(20000);
        await promise;

        expect(onRetry.mock.calls[0][0].delays[0]).toBe(20000);
      });

      it('should handle very large exponential values', async () => {
        const mockFn = vi.fn()
          .mockRejectedValueOnce(new Error('fail'))
          .mockRejectedValueOnce(new Error('fail'))
          .mockRejectedValueOnce(new Error('fail'))
          .mockRejectedValueOnce(new Error('fail'))
          .mockResolvedValueOnce('success');

        const config: RetryConfig = {
          maxAttempts: 6,
          backoff: 'exponential',
          initialDelay: 1000,
          maxDelay: 5000
        };
        const capturedDelays: number[] = [];
        const onRetry = vi.fn((ctx) => {
          capturedDelays.push(ctx.delays[ctx.delays.length - 1]);
        });

        const promise = handler.executeWithRetry(mockFn, config, onRetry);

        // Exponential: 1000, 2000, 4000, 8000 (capped at 5000)
        await vi.advanceTimersByTimeAsync(1000);
        await vi.advanceTimersByTimeAsync(2000);
        await vi.advanceTimersByTimeAsync(4000);
        await vi.advanceTimersByTimeAsync(5000); // Capped
        await promise;

        expect(capturedDelays).toEqual([1000, 2000, 4000, 5000]);
      });
    });
  });

  describe('shouldRetry (error classification)', () => {
    describe('non-retryable errors', () => {
      it('should not retry 401 errors', async () => {
        const mockFn = vi.fn().mockRejectedValue(new Error('401 Unauthorized'));
        const config: RetryConfig = { maxAttempts: 3, backoff: 'fixed', initialDelay: 100 };

        await expect(handler.executeWithRetry(mockFn, config)).rejects.toThrow();
        expect(mockFn).toHaveBeenCalledTimes(1);
      });

      it('should not retry 403 errors', async () => {
        const mockFn = vi.fn().mockRejectedValue(new Error('403 Forbidden'));
        const config: RetryConfig = { maxAttempts: 3, backoff: 'fixed', initialDelay: 100 };

        await expect(handler.executeWithRetry(mockFn, config)).rejects.toThrow();
        expect(mockFn).toHaveBeenCalledTimes(1);
      });

      it('should not retry unauthorized errors', async () => {
        const mockFn = vi.fn().mockRejectedValue(new Error('Request unauthorized'));
        const config: RetryConfig = { maxAttempts: 3, backoff: 'fixed', initialDelay: 100 };

        await expect(handler.executeWithRetry(mockFn, config)).rejects.toThrow();
        expect(mockFn).toHaveBeenCalledTimes(1);
      });

      it('should not retry ENOENT errors', async () => {
        const mockFn = vi.fn().mockRejectedValue(new Error('ENOENT: file not found'));
        const config: RetryConfig = { maxAttempts: 3, backoff: 'fixed', initialDelay: 100 };

        await expect(handler.executeWithRetry(mockFn, config)).rejects.toThrow();
        expect(mockFn).toHaveBeenCalledTimes(1);
      });

      it('should not retry "no such file" errors', async () => {
        const mockFn = vi.fn().mockRejectedValue(new Error('Error: no such file or directory'));
        const config: RetryConfig = { maxAttempts: 3, backoff: 'fixed', initialDelay: 100 };

        await expect(handler.executeWithRetry(mockFn, config)).rejects.toThrow();
        expect(mockFn).toHaveBeenCalledTimes(1);
      });

      it('should not retry YAML errors', async () => {
        const mockFn = vi.fn().mockRejectedValue(new Error('YAML syntax error at line 5'));
        const config: RetryConfig = { maxAttempts: 3, backoff: 'fixed', initialDelay: 100 };

        await expect(handler.executeWithRetry(mockFn, config)).rejects.toThrow();
        expect(mockFn).toHaveBeenCalledTimes(1);
      });

      it('should not retry parse errors', async () => {
        const mockFn = vi.fn().mockRejectedValue(new Error('Parse error: unexpected token'));
        const config: RetryConfig = { maxAttempts: 3, backoff: 'fixed', initialDelay: 100 };

        await expect(handler.executeWithRetry(mockFn, config)).rejects.toThrow();
        expect(mockFn).toHaveBeenCalledTimes(1);
      });

      it('should not retry invalid config errors', async () => {
        const mockFn = vi.fn().mockRejectedValue(new Error('Invalid config: missing required field'));
        const config: RetryConfig = { maxAttempts: 3, backoff: 'fixed', initialDelay: 100 };

        await expect(handler.executeWithRetry(mockFn, config)).rejects.toThrow();
        expect(mockFn).toHaveBeenCalledTimes(1);
      });
    });

    describe('retryable errors', () => {
      it('should retry timeout errors', async () => {
        const mockFn = vi.fn()
          .mockRejectedValueOnce(new Error('Request timeout'))
          .mockResolvedValueOnce('success');

        const config: RetryConfig = { maxAttempts: 3, backoff: 'fixed', initialDelay: 50 };

        const promise = handler.executeWithRetry(mockFn, config);
        await vi.advanceTimersByTimeAsync(50);
        await promise;

        expect(mockFn).toHaveBeenCalledTimes(2);
      });

      it('should retry network errors', async () => {
        const mockFn = vi.fn()
          .mockRejectedValueOnce(new Error('Network error occurred'))
          .mockResolvedValueOnce('success');

        const config: RetryConfig = { maxAttempts: 3, backoff: 'fixed', initialDelay: 50 };

        const promise = handler.executeWithRetry(mockFn, config);
        await vi.advanceTimersByTimeAsync(50);
        await promise;

        expect(mockFn).toHaveBeenCalledTimes(2);
      });

      it('should retry ECONNREFUSED errors', async () => {
        const mockFn = vi.fn()
          .mockRejectedValueOnce(new Error('ECONNREFUSED: connection refused'))
          .mockResolvedValueOnce('success');

        const config: RetryConfig = { maxAttempts: 3, backoff: 'fixed', initialDelay: 50 };

        const promise = handler.executeWithRetry(mockFn, config);
        await vi.advanceTimersByTimeAsync(50);
        await promise;

        expect(mockFn).toHaveBeenCalledTimes(2);
      });

      it('should retry ECONNRESET errors', async () => {
        const mockFn = vi.fn()
          .mockRejectedValueOnce(new Error('ECONNRESET: connection reset'))
          .mockResolvedValueOnce('success');

        const config: RetryConfig = { maxAttempts: 3, backoff: 'fixed', initialDelay: 50 };

        const promise = handler.executeWithRetry(mockFn, config);
        await vi.advanceTimersByTimeAsync(50);
        await promise;

        expect(mockFn).toHaveBeenCalledTimes(2);
      });

      it('should retry ETIMEDOUT errors', async () => {
        const mockFn = vi.fn()
          .mockRejectedValueOnce(new Error('ETIMEDOUT: operation timed out'))
          .mockResolvedValueOnce('success');

        const config: RetryConfig = { maxAttempts: 3, backoff: 'fixed', initialDelay: 50 };

        const promise = handler.executeWithRetry(mockFn, config);
        await vi.advanceTimersByTimeAsync(50);
        await promise;

        expect(mockFn).toHaveBeenCalledTimes(2);
      });

      it('should retry 429 rate limit errors', async () => {
        const mockFn = vi.fn()
          .mockRejectedValueOnce(new Error('429 Too Many Requests'))
          .mockResolvedValueOnce('success');

        const config: RetryConfig = { maxAttempts: 3, backoff: 'fixed', initialDelay: 50 };

        const promise = handler.executeWithRetry(mockFn, config);
        await vi.advanceTimersByTimeAsync(50);
        await promise;

        expect(mockFn).toHaveBeenCalledTimes(2);
      });

      it('should retry 500 server errors', async () => {
        const mockFn = vi.fn()
          .mockRejectedValueOnce(new Error('500 Internal Server Error'))
          .mockResolvedValueOnce('success');

        const config: RetryConfig = { maxAttempts: 3, backoff: 'fixed', initialDelay: 50 };

        const promise = handler.executeWithRetry(mockFn, config);
        await vi.advanceTimersByTimeAsync(50);
        await promise;

        expect(mockFn).toHaveBeenCalledTimes(2);
      });

      it('should retry 502 bad gateway errors', async () => {
        const mockFn = vi.fn()
          .mockRejectedValueOnce(new Error('502 Bad Gateway'))
          .mockResolvedValueOnce('success');

        const config: RetryConfig = { maxAttempts: 3, backoff: 'fixed', initialDelay: 50 };

        const promise = handler.executeWithRetry(mockFn, config);
        await vi.advanceTimersByTimeAsync(50);
        await promise;

        expect(mockFn).toHaveBeenCalledTimes(2);
      });

      it('should retry 503 service unavailable errors', async () => {
        const mockFn = vi.fn()
          .mockRejectedValueOnce(new Error('503 Service Unavailable'))
          .mockResolvedValueOnce('success');

        const config: RetryConfig = { maxAttempts: 3, backoff: 'fixed', initialDelay: 50 };

        const promise = handler.executeWithRetry(mockFn, config);
        await vi.advanceTimersByTimeAsync(50);
        await promise;

        expect(mockFn).toHaveBeenCalledTimes(2);
      });

      it('should retry 504 gateway timeout errors', async () => {
        const mockFn = vi.fn()
          .mockRejectedValueOnce(new Error('504 Gateway Timeout'))
          .mockResolvedValueOnce('success');

        const config: RetryConfig = { maxAttempts: 3, backoff: 'fixed', initialDelay: 50 };

        const promise = handler.executeWithRetry(mockFn, config);
        await vi.advanceTimersByTimeAsync(50);
        await promise;

        expect(mockFn).toHaveBeenCalledTimes(2);
      });

      it('should retry unknown errors by default', async () => {
        const mockFn = vi.fn()
          .mockRejectedValueOnce(new Error('Some random error'))
          .mockResolvedValueOnce('success');

        const config: RetryConfig = { maxAttempts: 3, backoff: 'fixed', initialDelay: 50 };

        const promise = handler.executeWithRetry(mockFn, config);
        await vi.advanceTimersByTimeAsync(50);
        await promise;

        expect(mockFn).toHaveBeenCalledTimes(2);
      });
    });

    describe('case insensitive error matching', () => {
      it('should match errors case-insensitively (UNAUTHORIZED)', async () => {
        const mockFn = vi.fn().mockRejectedValue(new Error('UNAUTHORIZED access'));
        const config: RetryConfig = { maxAttempts: 3, backoff: 'fixed', initialDelay: 100 };

        await expect(handler.executeWithRetry(mockFn, config)).rejects.toThrow();
        expect(mockFn).toHaveBeenCalledTimes(1);
      });

      it('should match errors case-insensitively (Timeout)', async () => {
        const mockFn = vi.fn()
          .mockRejectedValueOnce(new Error('Request TIMEOUT occurred'))
          .mockResolvedValueOnce('success');

        const config: RetryConfig = { maxAttempts: 3, backoff: 'fixed', initialDelay: 50 };

        const promise = handler.executeWithRetry(mockFn, config);
        await vi.advanceTimersByTimeAsync(50);
        await promise;

        expect(mockFn).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('formatDelay', () => {
    it('should format delays under 1 second as milliseconds', () => {
      expect(RetryHandler.formatDelay(0)).toBe('0ms');
      expect(RetryHandler.formatDelay(100)).toBe('100ms');
      expect(RetryHandler.formatDelay(500)).toBe('500ms');
      expect(RetryHandler.formatDelay(999)).toBe('999ms');
    });

    it('should format delays under 1 minute as seconds', () => {
      expect(RetryHandler.formatDelay(1000)).toBe('1.0s');
      expect(RetryHandler.formatDelay(1500)).toBe('1.5s');
      expect(RetryHandler.formatDelay(5000)).toBe('5.0s');
      expect(RetryHandler.formatDelay(30000)).toBe('30.0s');
      expect(RetryHandler.formatDelay(59999)).toBe('60.0s');
    });

    it('should format delays over 1 minute as minutes', () => {
      expect(RetryHandler.formatDelay(60000)).toBe('1.0m');
      expect(RetryHandler.formatDelay(90000)).toBe('1.5m');
      expect(RetryHandler.formatDelay(120000)).toBe('2.0m');
      expect(RetryHandler.formatDelay(300000)).toBe('5.0m');
    });

    it('should handle edge cases', () => {
      expect(RetryHandler.formatDelay(1)).toBe('1ms');
      expect(RetryHandler.formatDelay(1001)).toBe('1.0s');
      expect(RetryHandler.formatDelay(60001)).toBe('1.0m');
    });
  });
});
