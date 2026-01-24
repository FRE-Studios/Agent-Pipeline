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
    it('should create a new session with UUID and running status', async () => {
      const session = await manager.startSession(100);

      expect(session.sessionId).toBeDefined();
      expect(session.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(session.status).toBe('running');
      expect(session.maxIterations).toBe(100);
      expect(session.totalIterations).toBe(0);
      expect(session.iterations).toEqual([]);
      expect(session.startTime).toBeDefined();
      expect(session.endTime).toBeUndefined();
    });

    it('should create unique session IDs for multiple sessions', async () => {
      const session1 = await manager.startSession(100);
      const session2 = await manager.startSession(50);

      expect(session1.sessionId).not.toBe(session2.sessionId);
    });
  });

  describe('appendIteration', () => {
    it('should append iteration to session and save to disk', async () => {
      const session = await manager.startSession(100);
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
      const session = await manager.startSession(100);
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

  describe('updateIteration', () => {
    it('should update an existing iteration and save to disk', async () => {
      const session = await manager.startSession(100);
      const iteration: IterationSummary = {
        iterationNumber: 1,
        pipelineName: 'test-pipeline',
        runId: 'run-123',
        status: 'in-progress',
        triggeredNext: false
      };

      await manager.appendIteration(session.sessionId, iteration);
      const updated = await manager.updateIteration(session.sessionId, 1, {
        status: 'completed',
        duration: 1500,
        triggeredNext: true
      });

      expect(updated).toBe(true);

      const loaded = await manager.loadSession(session.sessionId);
      expect(loaded!.iterations[0].status).toBe('completed');
      expect(loaded!.iterations[0].duration).toBe(1500);
      expect(loaded!.iterations[0].triggeredNext).toBe(true);
    });

    it('should return false when iteration number not found', async () => {
      const session = await manager.startSession(100);
      const iteration: IterationSummary = {
        iterationNumber: 1,
        pipelineName: 'test-pipeline',
        runId: 'run-123',
        status: 'completed',
        duration: 1000,
        triggeredNext: false
      };

      await manager.appendIteration(session.sessionId, iteration);
      const updated = await manager.updateIteration(session.sessionId, 999, {
        status: 'failed'
      });

      expect(updated).toBe(false);
    });

    it('should throw error for non-existent session', async () => {
      await expect(
        manager.updateIteration('non-existent-id', 1, { status: 'completed' })
      ).rejects.toThrow('Loop session not found');
    });

    it('should load session from disk when not in cache', async () => {
      // Create and save a session
      const session = await manager.startSession(100);
      const iteration: IterationSummary = {
        iterationNumber: 1,
        pipelineName: 'test-pipeline',
        runId: 'run-123',
        status: 'in-progress',
        triggeredNext: false
      };
      await manager.appendIteration(session.sessionId, iteration);
      await manager.completeSession(session.sessionId, 'completed');

      // Create new manager instance (cache miss scenario)
      const newManager = new LoopStateManager(testRepoPath);

      // Update should load from disk and succeed
      const updated = await newManager.updateIteration(session.sessionId, 1, {
        status: 'completed',
        duration: 2000
      });

      expect(updated).toBe(true);

      // Verify the update was saved
      const loaded = await newManager.loadSession(session.sessionId);
      expect(loaded!.iterations[0].status).toBe('completed');
      expect(loaded!.iterations[0].duration).toBe(2000);
    });
  });

  describe('completeSession', () => {
    it('should mark session as completed and set end time', async () => {
      const session = await manager.startSession(100);
      await manager.completeSession(session.sessionId, 'completed');

      const loaded = await manager.loadSession(session.sessionId);
      expect(loaded!.status).toBe('completed');
      expect(loaded!.endTime).toBeDefined();
    });

    it('should mark session as failed', async () => {
      const session = await manager.startSession(100);
      await manager.completeSession(session.sessionId, 'failed');

      const loaded = await manager.loadSession(session.sessionId);
      expect(loaded!.status).toBe('failed');
      expect(loaded!.endTime).toBeDefined();
    });

    it('should mark session as limit-reached', async () => {
      const session = await manager.startSession(100);
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
      const session = await manager.startSession(100);
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
      const session1 = await manager.startSession(100);
      const session2 = await manager.startSession(50);
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
      const session = await manager.startSession(100);
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
      const session = await manager.startSession(100);
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

  describe('createSessionDirectories', () => {
    it('should create all four directories', async () => {
      const session = await manager.startSession(100);
      const dirs = await manager.createSessionDirectories(session.sessionId, testRepoPath);

      expect(dirs.pending).toContain(session.sessionId);
      expect(dirs.running).toContain(session.sessionId);
      expect(dirs.finished).toContain(session.sessionId);
      expect(dirs.failed).toContain(session.sessionId);

      // Verify directories exist
      await expect(fs.access(dirs.pending)).resolves.toBeUndefined();
      await expect(fs.access(dirs.running)).resolves.toBeUndefined();
      await expect(fs.access(dirs.finished)).resolves.toBeUndefined();
      await expect(fs.access(dirs.failed)).resolves.toBeUndefined();
    });

    it('should create directories under .agent-pipeline/loops/{sessionId}/', async () => {
      const session = await manager.startSession(100);
      const dirs = await manager.createSessionDirectories(session.sessionId, testRepoPath);

      const expectedBase = path.join(testRepoPath, '.agent-pipeline', 'loops', session.sessionId);
      expect(dirs.pending).toBe(path.join(expectedBase, 'pending'));
      expect(dirs.running).toBe(path.join(expectedBase, 'running'));
      expect(dirs.finished).toBe(path.join(expectedBase, 'finished'));
      expect(dirs.failed).toBe(path.join(expectedBase, 'failed'));
    });

    it('should create .gitignore in session directory', async () => {
      const session = await manager.startSession(100);
      await manager.createSessionDirectories(session.sessionId, testRepoPath);

      const gitignorePath = path.join(
        testRepoPath,
        '.agent-pipeline',
        'loops',
        session.sessionId,
        '.gitignore'
      );

      const content = await fs.readFile(gitignorePath, 'utf-8');
      expect(content).toContain('*');
      expect(content).toContain('!.gitignore');
    });

    it('should not overwrite existing .gitignore', async () => {
      const session = await manager.startSession(100);
      const sessionDir = path.join(testRepoPath, '.agent-pipeline', 'loops', session.sessionId);
      const gitignorePath = path.join(sessionDir, '.gitignore');

      // Create directory and custom .gitignore first
      await fs.mkdir(sessionDir, { recursive: true });
      await fs.writeFile(gitignorePath, 'custom content');

      await manager.createSessionDirectories(session.sessionId, testRepoPath);

      // Verify custom content is preserved
      const content = await fs.readFile(gitignorePath, 'utf-8');
      expect(content).toBe('custom content');
    });

    it('should work with different base paths (worktree support)', async () => {
      const session = await manager.startSession(100);

      // Create directories in a different base path (simulating worktree)
      const worktreePath = path.join(testRepoPath, 'worktree-test');
      await fs.mkdir(worktreePath, { recursive: true });

      const dirs = await manager.createSessionDirectories(session.sessionId, worktreePath);

      const expectedBase = path.join(worktreePath, '.agent-pipeline', 'loops', session.sessionId);
      expect(dirs.pending).toBe(path.join(expectedBase, 'pending'));

      // Verify directories exist in worktree path
      await expect(fs.access(dirs.pending)).resolves.toBeUndefined();
    });
  });

  describe('getSessionQueueDir', () => {
    it('should return correct session queue directory path', async () => {
      const session = await manager.startSession(100);
      const queueDir = manager.getSessionQueueDir(session.sessionId, testRepoPath);

      const expected = path.join(testRepoPath, '.agent-pipeline', 'loops', session.sessionId);
      expect(queueDir).toBe(expected);
    });

    it('should work with different base paths (worktree support)', async () => {
      const session = await manager.startSession(100);
      const worktreePath = '/some/worktree/path';

      const queueDir = manager.getSessionQueueDir(session.sessionId, worktreePath);

      const expected = path.join(worktreePath, '.agent-pipeline', 'loops', session.sessionId);
      expect(queueDir).toBe(expected);
    });
  });
});
