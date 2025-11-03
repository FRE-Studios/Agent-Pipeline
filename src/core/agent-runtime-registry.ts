// src/core/agent-runtime-registry.ts

import type { AgentRuntime } from './types/agent-runtime.js';

/**
 * Registry for managing agent runtime implementations.
 *
 * This singleton provides a centralized location for registering and retrieving
 * agent runtimes. Runtimes are registered on application startup (in src/index.ts)
 * and can be looked up by type during pipeline execution.
 *
 * @example
 * ```typescript
 * // Register runtimes on startup
 * AgentRuntimeRegistry.register(new ClaudeSDKRuntime());
 * AgentRuntimeRegistry.register(new ClaudeCodeHeadlessRuntime());
 *
 * // Retrieve runtime during execution
 * const runtime = AgentRuntimeRegistry.getRuntime('claude-sdk');
 * const result = await runtime.execute(request);
 * ```
 */
export class AgentRuntimeRegistry {
  private static runtimes = new Map<string, AgentRuntime>();

  /**
   * Register a runtime implementation.
   *
   * @param runtime - The runtime to register
   * @throws Error if a runtime with the same type is already registered
   */
  static register(runtime: AgentRuntime): void {
    if (this.runtimes.has(runtime.type)) {
      throw new Error(
        `Agent runtime '${runtime.type}' is already registered. ` +
        `Cannot register duplicate runtime types.`
      );
    }

    this.runtimes.set(runtime.type, runtime);
  }

  /**
   * Get a registered runtime by type.
   *
   * @param type - The runtime type identifier (e.g., 'claude-sdk', 'claude-code-headless')
   * @returns The runtime instance
   * @throws Error if no runtime is registered with the given type
   */
  static getRuntime(type: string): AgentRuntime {
    const runtime = this.runtimes.get(type);

    if (!runtime) {
      const available = this.getAvailableTypes();
      throw new Error(
        `Agent runtime '${type}' not found. ` +
        `Available runtimes: ${available.length > 0 ? available.join(', ') : 'none'}`
      );
    }

    return runtime;
  }

  /**
   * Get all registered runtimes.
   *
   * @returns Array of all registered runtime instances
   */
  static getAllRuntimes(): AgentRuntime[] {
    return Array.from(this.runtimes.values());
  }

  /**
   * Get all available runtime type identifiers.
   *
   * @returns Array of runtime type strings
   */
  static getAvailableTypes(): string[] {
    return Array.from(this.runtimes.keys());
  }

  /**
   * Check if a runtime type is registered.
   *
   * @param type - The runtime type to check
   * @returns True if the runtime is registered, false otherwise
   */
  static hasRuntime(type: string): boolean {
    return this.runtimes.has(type);
  }

  /**
   * Clear all registered runtimes.
   * Primarily used for testing - should not be called in production code.
   *
   * @internal
   */
  static clear(): void {
    this.runtimes.clear();
  }
}
