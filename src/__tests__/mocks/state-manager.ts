import { vi } from 'vitest';
import { StateManager } from '../../core/state-manager.js';
import { PipelineState } from '../../config/schema.js';

export interface MockStateManagerConfig {
  savedStates?: PipelineState[];
  latestRun?: PipelineState | null;
  shouldFailSave?: boolean;
  shouldFailLoad?: boolean;
}

export function createMockStateManager(config: MockStateManagerConfig = {}): StateManager {
  const {
    savedStates = [],
    latestRun = null,
    shouldFailSave = false,
    shouldFailLoad = false,
  } = config;

  const states: PipelineState[] = [...savedStates];

  return {
    saveState: vi.fn().mockImplementation(async (state: PipelineState) => {
      if (shouldFailSave) {
        throw new Error('Failed to save state');
      }
      // Add or update state in the mock storage
      const existingIndex = states.findIndex(s => s.runId === state.runId);
      if (existingIndex >= 0) {
        states[existingIndex] = state;
      } else {
        states.push(state);
      }
    }),
    loadState: vi.fn().mockImplementation(async (runId: string) => {
      if (shouldFailLoad) {
        return null;
      }
      return states.find(s => s.runId === runId) || null;
    }),
    getLatestRun: vi.fn().mockResolvedValue(latestRun),
    getAllRuns: vi.fn().mockResolvedValue(states),
  } as unknown as StateManager;
}
