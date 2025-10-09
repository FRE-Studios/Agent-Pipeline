// src/core/retry-handler.ts

import { RetryConfig } from '../config/schema.js';

export interface RetryContext {
  attemptNumber: number;              // Current attempt (0-indexed)
  maxAttempts: number;                // Total max attempts
  lastError?: unknown;                // Last error encountered
  delays: number[];                   // Delay history in ms
}

export class RetryHandler {
  /**
   * Execute a function with retry logic
   * @param fn - Function to execute
   * @param retryConfig - Retry configuration
   * @param onRetry - Callback called before each retry attempt
   * @returns Result of successful execution
   */
  async executeWithRetry<T>(
    fn: () => Promise<T>,
    retryConfig: RetryConfig | undefined,
    onRetry?: (context: RetryContext) => void
  ): Promise<T> {
    // If no retry config, default to 1 attempt (no retries)
    // If retry config provided but maxAttempts not specified, default to 3
    const maxAttempts = retryConfig ? (retryConfig.maxAttempts ?? 3) : 1;
    const context: RetryContext = {
      attemptNumber: 0,
      maxAttempts,
      delays: []
    };

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      context.attemptNumber = attempt;

      try {
        // Execute the function
        const result = await fn();
        return result;

      } catch (error) {
        context.lastError = error;

        // Check if we should retry
        const isLastAttempt = attempt === maxAttempts - 1;

        if (isLastAttempt) {
          // No more retries, throw the error
          throw error;
        }

        // Check if error is retryable
        if (!this.shouldRetry(error)) {
          throw error;
        }

        // Calculate delay before next retry
        const delay = this.calculateDelay(attempt, retryConfig);
        context.delays.push(delay);

        // Call onRetry callback
        if (onRetry) {
          onRetry(context);
        }

        // Wait before retrying
        await this.sleep(delay);
      }
    }

    // Should never reach here, but TypeScript needs it
    throw new Error('Retry logic error: exceeded max attempts without throwing');
  }

  /**
   * Calculate delay before next retry based on backoff strategy
   * @param attempt - Current attempt number (0-indexed)
   * @param config - Retry configuration (optional)
   * @returns Delay in milliseconds
   */
  private calculateDelay(attempt: number, config?: RetryConfig): number {
    const initialDelay = config?.initialDelay || 1000;
    const maxDelay = config?.maxDelay || 30000;

    let delay: number;

    switch (config?.backoff) {
      case 'exponential':
        // Exponential: delay = initialDelay * 2^attempt
        delay = initialDelay * Math.pow(2, attempt);
        break;

      case 'linear':
        // Linear: delay = initialDelay * (attempt + 1)
        delay = initialDelay * (attempt + 1);
        break;

      case 'fixed':
      default:
        // Fixed: always use initial delay
        delay = initialDelay;
        break;
    }

    // Cap at max delay
    return Math.min(delay, maxDelay);
  }

  /**
   * Determine if an error is retryable
   * Some errors should not be retried (e.g., authentication errors, invalid config)
   */
  private shouldRetry(error: unknown): boolean {
    const message = (error instanceof Error ? error.message : String(error)).toLowerCase();

    // Don't retry auth errors
    if (message.includes('401') || message.includes('403') || message.includes('unauthorized')) {
      return false;
    }

    // Don't retry file not found (agent definition missing)
    if (message.includes('enoent') || message.includes('no such file')) {
      return false;
    }

    // Don't retry YAML parse errors
    if (message.includes('yaml') || message.includes('parse error')) {
      return false;
    }

    // Don't retry invalid configuration
    if (message.includes('invalid') && message.includes('config')) {
      return false;
    }

    // Retry network errors, timeouts, temporary failures
    if (
      message.includes('timeout') ||
      message.includes('network') ||
      message.includes('econnrefused') ||
      message.includes('econnreset') ||
      message.includes('etimedout') ||
      message.includes('429') || // Rate limit
      message.includes('500') || // Server error
      message.includes('502') || // Bad gateway
      message.includes('503') || // Service unavailable
      message.includes('504')    // Gateway timeout
    ) {
      return true;
    }

    // Default: retry unless explicitly known to be non-retryable
    return true;
  }

  /**
   * Sleep for specified duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get human-readable delay string
   */
  static formatDelay(ms: number): string {
    if (ms < 1000) {
      return `${ms}ms`;
    } else if (ms < 60000) {
      return `${(ms / 1000).toFixed(1)}s`;
    } else {
      return `${(ms / 60000).toFixed(1)}m`;
    }
  }
}
