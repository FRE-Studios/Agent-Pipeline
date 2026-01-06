// src/core/abort-controller.ts

import { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

/**
 * Controls pipeline abortion and manages cleanup of running processes.
 *
 * Usage:
 * 1. Create instance before pipeline execution
 * 2. Pass to stage executors which register child processes
 * 3. Call abort() on SIGINT to gracefully terminate
 *
 * Events:
 * - 'abort': Emitted when abort() is called
 */
export class PipelineAbortController extends EventEmitter {
  private _aborted = false;
  private childProcesses: Set<ChildProcess> = new Set();
  private killTimers: Map<ChildProcess, NodeJS.Timeout> = new Map();

  /**
   * Whether abort has been requested
   */
  get aborted(): boolean {
    return this._aborted;
  }

  /**
   * Register a child process for cleanup on abort.
   * Process is automatically unregistered when it exits.
   */
  registerProcess(process: ChildProcess): void {
    this.childProcesses.add(process);
    process.on('exit', () => {
      this.childProcesses.delete(process);
      // Clear any pending SIGKILL timer for this process
      const timer = this.killTimers.get(process);
      if (timer) {
        clearTimeout(timer);
        this.killTimers.delete(process);
      }
    });
  }

  /**
   * Abort the pipeline execution.
   * - Sets aborted flag
   * - Emits 'abort' event
   * - Kills all registered child processes (SIGTERM, then SIGKILL after 5s)
   */
  abort(): void {
    if (this._aborted) {
      return; // Already aborting
    }

    this._aborted = true;
    this.emit('abort');

    // Kill all registered child processes
    for (const proc of this.childProcesses) {
      if (!proc.killed) {
        proc.kill('SIGTERM');

        // Force kill after 5 seconds if still running
        const timer = setTimeout(() => {
          if (!proc.killed) {
            proc.kill('SIGKILL');
          }
          this.killTimers.delete(proc);
        }, 5000);
        this.killTimers.set(proc, timer);
      }
    }
  }

  /**
   * Check if aborted and throw if so.
   * Useful for checking at stage boundaries.
   */
  throwIfAborted(): void {
    if (this._aborted) {
      throw new PipelineAbortError('Pipeline execution aborted');
    }
  }
}

/**
 * Error thrown when pipeline is aborted.
 * Can be caught to distinguish abort from other errors.
 */
export class PipelineAbortError extends Error {
  readonly isAbortError = true;

  constructor(message: string = 'Pipeline aborted') {
    super(message);
    this.name = 'PipelineAbortError';
  }
}
