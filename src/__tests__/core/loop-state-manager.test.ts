// src/__tests__/core/loop-state-manager.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LoopStateManager, LoopSession, IterationSummary } from '../../core/loop-state-manager.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { tmpdir } from 'os';

describe('LoopStateManager', () => {
  let testRepoPath: string;
  let manager: LoopStateManager;

  beforeEach(async () => {
    // Create temporary test directory
    testRepoPath = path.join(tmpdir(), `loop-state-test-${Date.now()}`);
    await fs.mkdir(testRepoPath, { recursive: true });
    manager = new LoopStateManager(testRepoPath);
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testRepoPath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('startSession', () => {
    it('should create a new session with UUID and running status', () => {
      const session = manager.startSession(100);

      expect(session.sessionId).toBeDefined();
      expect(session.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(session.status).toBe('running');
      expect(session.maxIterations).toBe(100);
      expect(session.totalIterations).toBe(0);
      expect(session.iterations).toEqual([]);
      expect(session.startTime).toBeDefined();
      expect(session.endTime).toBeUndefined();
    });

    it('should create unique session IDs for multiple sessions', () => {
      const session1 = manager.startSession(100);
      const session2 = manager.startSession(50);

      expect(session1.sessionId).not.toBe(session2.sessionId);
    });
  });

  describe('appendIteration', () => {
    it('should append iteration to session and save to disk', async () => {
      const session = manager.startSession(100);
      const iteration: IterationSummary = {
        iterationNumber: 1,
        pipelineName: 'test-pipeline',
        runId: 'run-123',
        status: 'completed',
        duration: 1500,
        triggeredNext: true
      };

      await manager.appendIteration(session.sessionId, iteration);

      // Load from disk to verify
      const loaded = await manager.loadSession(session.sessionId);
      expect(loaded).toBeDefined();
      expect(loaded!.iterations).toHaveLength(1);
      expect(loaded!.iterations[0]).toEqual(iteration);
      expect(loaded!.totalIterations).toBe(1);
    });

    it('should append multiple iterations in order', async () => {
      const session = manager.startSession(100);
      const iteration1: IterationSummary = {
        iterationNumber: 1,
        pipelineName: 'pipeline-1',
        runId: 'run-1',
        status: 'completed',
        duration: 1000,
        triggeredNext: true
      };
      const iteration2: IterationSummary = {
        iterationNumber: 2,
        pipelineName: 'pipeline-2',
        runId: 'run-2',
        status: 'completed',
        duration: 2000,
        triggeredNext: false
      };

      await manager.appendIteration(session.sessionId, iteration1);
      await manager.appendIteration(session.sessionId, iteration2);

      const loaded = await manager.loadSession(session.sessionId);
      expect(loaded!.iterations).toHaveLength(2);
      expect(loaded!.iterations[0]).toEqual(iteration1);
      expect(loaded!.iterations[1]).toEqual(iteration2);
      expect(loaded!.totalIterations).toBe(2);
    });

    it('should throw error for non-existent session', async () => {
      const iteration: IterationSummary = {
        iterationNumber: 1,
        pipelineName: 'test',
        runId: 'run-123',
        status: 'completed',
        duration: 1000,
        triggeredNext: false
      };

      await expect(
        manager.appendIteration('non-existent-id', iteration)
      ).rejects.toThrow('Loop session not found');
    });
  });

  describe('completeSession', () => {
    it('should mark session as completed and set end time', async () => {
      const session = manager.startSession(100);
      await manager.completeSession(session.sessionId, 'completed');

      const loaded = await manager.loadSession(session.sessionId);
      expect(loaded!.status).toBe('completed');
      expect(loaded!.endTime).toBeDefined();
    });

    it('should mark session as failed', async () => {
      const session = manager.startSession(100);
      await manager.completeSession(session.sessionId, 'failed');

      const loaded = await manager.loadSession(session.sessionId);
      expect(loaded!.status).toBe('failed');
      expect(loaded!.endTime).toBeDefined();
    });

    it('should mark session as limit-reached', async () => {
      const session = manager.startSession(100);
      await manager.completeSession(session.sessionId, 'limit-reached');

      const loaded = await manager.loadSession(session.sessionId);
      expect(loaded!.status).toBe('limit-reached');
      expect(loaded!.endTime).toBeDefined();
    });

    it('should throw error for non-existent session', async () => {
      await expect(
        manager.completeSession('non-existent-id', 'completed')
      ).rejects.toThrow('Loop session not found');
    });
  });

  describe('loadSession', () => {
    it('should load session from disk', async () => {
      const session = manager.startSession(100);
      const iteration: IterationSummary = {
        iterationNumber: 1,
        pipelineName: 'test-pipeline',
        runId: 'run-123',
        status: 'completed',
        duration: 1500,
        triggeredNext: false
      };
      await manager.appendIteration(session.sessionId, iteration);
      await manager.completeSession(session.sessionId, 'completed');

      // Create new manager instance to force loading from disk
      const newManager = new LoopStateManager(testRepoPath);
      const loaded = await newManager.loadSession(session.sessionId);

      expect(loaded).toBeDefined();
      expect(loaded!.sessionId).toBe(session.sessionId);
      expect(loaded!.status).toBe('completed');
      expect(loaded!.iterations).toHaveLength(1);
      expect(loaded!.totalIterations).toBe(1);
    });

    it('should return null for non-existent session', async () => {
      const loaded = await manager.loadSession('non-existent-id');
      expect(loaded).toBeNull();
    });
  });

  describe('getAllSessions', () => {
    it('should return empty array when no sessions exist', async () => {
      const sessions = await manager.getAllSessions();
      expect(sessions).toEqual([]);
    });

    it('should load all sessions from disk', async () => {
      const session1 = manager.startSession(100);
      const session2 = manager.startSession(50);
      await manager.completeSession(session1.sessionId, 'completed');
      await manager.completeSession(session2.sessionId, 'failed');

      // Create new manager to force loading from disk
      const newManager = new LoopStateManager(testRepoPath);
      const sessions = await newManager.getAllSessions();

      expect(sessions).toHaveLength(2);
      expect(sessions.map(s => s.sessionId).sort()).toEqual(
        [session1.sessionId, session2.sessionId].sort()
      );
    });

    it('should handle corrupted session files gracefully', async () => {
      const session = manager.startSession(100);
      await manager.completeSession(session.sessionId, 'completed');

      // Write corrupted file
      const loopsDir = path.join(testRepoPath, '.agent-pipeline', 'state', 'loops');
      await fs.writeFile(path.join(loopsDir, 'corrupted.json'), 'invalid json', 'utf-8');

      const sessions = await manager.getAllSessions();
      expect(sessions).toHaveLength(1); // Should only load valid session
      expect(sessions[0].sessionId).toBe(session.sessionId);
    });

    it('should create loops directory if it does not exist', async () => {
      const loopsDir = path.join(testRepoPath, '.agent-pipeline', 'state', 'loops');

      // Verify directory doesn't exist yet
      await expect(fs.access(loopsDir)).rejects.toThrow();

      // getAllSessions should create it
      const sessions = await manager.getAllSessions();
      expect(sessions).toEqual([]);

      // Verify directory now exists
      await expect(fs.access(loopsDir)).resolves.toBeUndefined();
    });
  });

  describe('session persistence', () => {
    it('should persist session data across manager instances', async () => {
      const session = manager.startSession(100);
      const iteration: IterationSummary = {
        iterationNumber: 1,
        pipelineName: 'test-pipeline',
        runId: 'run-123',
        status: 'completed',
        duration: 1500,
        triggeredNext: true
      };
      await manager.appendIteration(session.sessionId, iteration);

      // Create new manager and verify data persists
      const newManager = new LoopStateManager(testRepoPath);
      const loaded = await newManager.loadSession(session.sessionId);

      expect(loaded).toBeDefined();
      expect(loaded!.sessionId).toBe(session.sessionId);
      expect(loaded!.iterations).toHaveLength(1);
      expect(loaded!.iterations[0]).toEqual(iteration);
    });
  });
});
