import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StateManager } from '../../core/state-manager.js';
import {
  completedPipelineState,
  failedPipelineState,
  runningPipelineState,
} from '../fixtures/pipeline-states.js';
import { createTempDir, cleanupTempDir } from '../setup.js';

describe('StateManager', () => {
  let tempDir: string;
  let stateManager: StateManager;

  beforeEach(async () => {
    tempDir = await createTempDir('state-manager-test-');
    stateManager = new StateManager(tempDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('saveState', () => {
    it('should save pipeline state to disk', async () => {
      await stateManager.saveState(completedPipelineState);

      const loaded = await stateManager.loadState(completedPipelineState.runId);
      expect(loaded).toBeDefined();
      expect(loaded?.runId).toBe(completedPipelineState.runId);
      expect(loaded?.status).toBe(completedPipelineState.status);
    });

    it('should create state directory if it does not exist', async () => {
      await stateManager.saveState(completedPipelineState);

      const loaded = await stateManager.loadState(completedPipelineState.runId);
      expect(loaded).toBeDefined();
    });

    it('should save multiple states', async () => {
      await stateManager.saveState(completedPipelineState);
      await stateManager.saveState(failedPipelineState);
      await stateManager.saveState(runningPipelineState);

      const loaded1 = await stateManager.loadState(completedPipelineState.runId);
      const loaded2 = await stateManager.loadState(failedPipelineState.runId);
      const loaded3 = await stateManager.loadState(runningPipelineState.runId);

      expect(loaded1?.status).toBe('completed');
      expect(loaded2?.status).toBe('failed');
      expect(loaded3?.status).toBe('running');
    });

    it('should preserve all state properties', async () => {
      await stateManager.saveState(completedPipelineState);

      const loaded = await stateManager.loadState(completedPipelineState.runId);

      expect(loaded).toEqual(completedPipelineState);
      expect(loaded?.pipelineConfig).toEqual(completedPipelineState.pipelineConfig);
      expect(loaded?.stages).toHaveLength(completedPipelineState.stages.length);
      expect(loaded?.artifacts).toEqual(completedPipelineState.artifacts);
    });

    it('should save stages with extracted data', async () => {
      await stateManager.saveState(completedPipelineState);

      const loaded = await stateManager.loadState(completedPipelineState.runId);

      expect(loaded?.stages[0].extractedData).toEqual({ result: 'success' });
      expect(loaded?.stages[1].extractedData).toEqual({ result: 'success' });
    });

    it('should save error information for failed stages', async () => {
      await stateManager.saveState(failedPipelineState);

      const loaded = await stateManager.loadState(failedPipelineState.runId);

      const failedStage = loaded?.stages.find(s => s.status === 'failed');
      expect(failedStage).toBeDefined();
      expect(failedStage?.error).toBeDefined();
      expect(failedStage?.error?.message).toBe('Agent execution failed');
      expect(failedStage?.error?.suggestion).toBe('Check agent configuration');
    });

    it('should overwrite existing state when saving the same runId', async () => {
      await stateManager.saveState(completedPipelineState);

      const updatedState = {
        ...completedPipelineState,
        status: 'failed' as const,
        artifacts: {
          ...completedPipelineState.artifacts,
          totalDuration: 999,
        },
      };

      await stateManager.saveState(updatedState);

      const loaded = await stateManager.loadState(updatedState.runId);
      expect(loaded?.status).toBe('failed');
      expect(loaded?.artifacts.totalDuration).toBe(999);
    });
  });

  describe('loadState', () => {
    it('should load saved state correctly', async () => {
      await stateManager.saveState(completedPipelineState);

      const loaded = await stateManager.loadState(completedPipelineState.runId);

      expect(loaded).toBeDefined();
      expect(loaded?.runId).toBe(completedPipelineState.runId);
    });

    it('should return null for non-existent state', async () => {
      const loaded = await stateManager.loadState('non-existent-run-id');

      expect(loaded).toBeNull();
    });

    it('should return null if state directory does not exist', async () => {
      const emptyManager = new StateManager('/non/existent/path');
      const loaded = await emptyManager.loadState('some-id');

      expect(loaded).toBeNull();
    });

    it('should handle corrupted JSON gracefully', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');

      // Create state directory
      const stateDir = path.join(tempDir, '.agent-pipeline', 'state', 'runs');
      await fs.mkdir(stateDir, { recursive: true });

      // Write corrupted JSON
      const corruptedFile = path.join(stateDir, 'corrupted.json');
      await fs.writeFile(corruptedFile, '{ invalid json }', 'utf-8');

      const loaded = await stateManager.loadState('corrupted');

      expect(loaded).toBeNull();
    });
  });

  describe('getLatestRun', () => {
    it('should return the most recent run', async () => {
      // Save states with small delays to ensure different timestamps
      await stateManager.saveState(completedPipelineState);
      await new Promise(resolve => setTimeout(resolve, 10));

      await stateManager.saveState(failedPipelineState);
      await new Promise(resolve => setTimeout(resolve, 10));

      await stateManager.saveState(runningPipelineState);

      const latest = await stateManager.getLatestRun();

      expect(latest).toBeDefined();
      // The latest should be the last one we saved (runningPipelineState)
      expect(latest?.runId).toBe(runningPipelineState.runId);
    });

    it('should return null if no runs exist', async () => {
      const latest = await stateManager.getLatestRun();

      expect(latest).toBeNull();
    });

    it('should return null if state directory does not exist', async () => {
      const emptyManager = new StateManager('/non/existent/path');
      const latest = await emptyManager.getLatestRun();

      expect(latest).toBeNull();
    });

    it('should handle single run correctly', async () => {
      await stateManager.saveState(completedPipelineState);

      const latest = await stateManager.getLatestRun();

      expect(latest?.runId).toBe(completedPipelineState.runId);
    });

    it('should ignore non-JSON files when determining the latest run', async () => {
      await stateManager.saveState(completedPipelineState);
      await stateManager.saveState(failedPipelineState);
      await stateManager.saveState(runningPipelineState);

      const fs = await import('fs/promises');
      const path = await import('path');
      const stateDir = path.join(tempDir, '.agent-pipeline', 'state', 'runs');

      // Create a non-JSON file with a newer modification time than the saved states
      await fs.writeFile(path.join(stateDir, 'notes.txt'), 'Not JSON', 'utf-8');

      const latest = await stateManager.getLatestRun();

      expect(latest?.runId).toBe(runningPipelineState.runId);
    });

    it('should skip corrupted JSON files when determining the latest run', async () => {
      await stateManager.saveState(completedPipelineState);
      await stateManager.saveState(failedPipelineState);
      await stateManager.saveState(runningPipelineState);

      const fs = await import('fs/promises');
      const path = await import('path');
      const stateDir = path.join(tempDir, '.agent-pipeline', 'state', 'runs');

      // Write a corrupted JSON file after the valid states so it has the newest timestamp
      await fs.writeFile(path.join(stateDir, 'corrupted.json'), '{ invalid json }', 'utf-8');

      const latest = await stateManager.getLatestRun();

      expect(latest?.runId).toBe(runningPipelineState.runId);
    });
  });

  describe('getAllRuns', () => {
    it('should return all saved runs', async () => {
      await stateManager.saveState(completedPipelineState);
      await stateManager.saveState(failedPipelineState);
      await stateManager.saveState(runningPipelineState);

      const allRuns = await stateManager.getAllRuns();

      expect(allRuns).toHaveLength(3);
      expect(allRuns.map(r => r.runId)).toContain(completedPipelineState.runId);
      expect(allRuns.map(r => r.runId)).toContain(failedPipelineState.runId);
      expect(allRuns.map(r => r.runId)).toContain(runningPipelineState.runId);
    });

    it('should return runs sorted by timestamp (newest first)', async () => {
      // Create states with different timestamps
      const state1 = {
        ...completedPipelineState,
        runId: 'run-1',
        trigger: { ...completedPipelineState.trigger, timestamp: '2024-01-01T00:00:00.000Z' },
      };
      const state2 = {
        ...completedPipelineState,
        runId: 'run-2',
        trigger: { ...completedPipelineState.trigger, timestamp: '2024-01-02T00:00:00.000Z' },
      };
      const state3 = {
        ...completedPipelineState,
        runId: 'run-3',
        trigger: { ...completedPipelineState.trigger, timestamp: '2024-01-03T00:00:00.000Z' },
      };

      await stateManager.saveState(state1);
      await stateManager.saveState(state2);
      await stateManager.saveState(state3);

      const allRuns = await stateManager.getAllRuns();

      expect(allRuns[0].runId).toBe('run-3'); // Newest
      expect(allRuns[1].runId).toBe('run-2');
      expect(allRuns[2].runId).toBe('run-1'); // Oldest
    });

    it('should return empty array if no runs exist', async () => {
      const allRuns = await stateManager.getAllRuns();

      expect(allRuns).toEqual([]);
    });

    it('should return empty array if state directory does not exist', async () => {
      const emptyManager = new StateManager('/non/existent/path');
      const allRuns = await emptyManager.getAllRuns();

      expect(allRuns).toEqual([]);
    });

    it('should filter out corrupted files', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');

      // Save valid state
      await stateManager.saveState(completedPipelineState);

      // Write corrupted JSON
      const stateDir = path.join(tempDir, '.agent-pipeline', 'state', 'runs');
      const corruptedFile = path.join(stateDir, 'corrupted.json');
      await fs.writeFile(corruptedFile, '{ invalid }', 'utf-8');

      const allRuns = await stateManager.getAllRuns();

      // Should only return the valid state
      expect(allRuns).toHaveLength(1);
      expect(allRuns[0].runId).toBe(completedPipelineState.runId);
    });

    it('should ignore non-JSON files', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');

      await stateManager.saveState(completedPipelineState);

      // Create non-JSON file
      const stateDir = path.join(tempDir, '.agent-pipeline', 'state', 'runs');
      await fs.writeFile(path.join(stateDir, 'readme.txt'), 'Not a JSON file', 'utf-8');

      const allRuns = await stateManager.getAllRuns();

      expect(allRuns).toHaveLength(1);
      expect(allRuns[0].runId).toBe(completedPipelineState.runId);
    });
  });

  describe('edge cases', () => {
    it('should handle states with PR information', async () => {
      const stateWithPR = {
        ...completedPipelineState,
        runId: 'run-with-pr',
        artifacts: {
          ...completedPipelineState.artifacts,
          pullRequest: {
            url: 'https://github.com/test/repo/pull/123',
            number: 123,
            branch: 'pipeline/test-branch',
          },
        },
      };

      await stateManager.saveState(stateWithPR);
      const loaded = await stateManager.loadState('run-with-pr');

      expect(loaded?.artifacts.pullRequest).toBeDefined();
      expect(loaded?.artifacts.pullRequest?.url).toBe('https://github.com/test/repo/pull/123');
      expect(loaded?.artifacts.pullRequest?.number).toBe(123);
    });

    it('should handle states with no stages', async () => {
      const emptyState = {
        ...completedPipelineState,
        runId: 'empty-stages',
        stages: [],
      };

      await stateManager.saveState(emptyState);
      const loaded = await stateManager.loadState('empty-stages');

      expect(loaded?.stages).toEqual([]);
    });

    it('should handle very long pipeline names', async () => {
      const longNameState = {
        ...completedPipelineState,
        runId: 'very-long-run-id-' + 'x'.repeat(200),
        pipelineConfig: {
          ...completedPipelineState.pipelineConfig,
          name: 'very-long-pipeline-name-' + 'x'.repeat(200),
        },
      };

      await stateManager.saveState(longNameState);
      const loaded = await stateManager.loadState(longNameState.runId);

      expect(loaded).toBeDefined();
      expect(loaded?.pipelineConfig.name).toContain('very-long-pipeline-name');
    });

    it('should handle concurrent saves', async () => {
      const state1 = { ...completedPipelineState, runId: 'concurrent-1' };
      const state2 = { ...failedPipelineState, runId: 'concurrent-2' };
      const state3 = { ...runningPipelineState, runId: 'concurrent-3' };

      // Save concurrently
      await Promise.all([
        stateManager.saveState(state1),
        stateManager.saveState(state2),
        stateManager.saveState(state3),
      ]);

      const allRuns = await stateManager.getAllRuns();

      expect(allRuns).toHaveLength(3);
      expect(allRuns.map(r => r.runId).sort()).toEqual(['concurrent-1', 'concurrent-2', 'concurrent-3']);
    });
  });
});
