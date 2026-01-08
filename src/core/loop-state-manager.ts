// src/core/loop-state-manager.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { ResolvedLoopingConfig } from '../config/schema.js';

export interface LoopSession {
  sessionId: string;
  startTime: string;
  endTime?: string;
  status: 'running' | 'completed' | 'failed' | 'aborted' | 'limit-reached';
  maxIterations: number;
  totalIterations: number;
  iterations: IterationSummary[];
}

export interface IterationSummary {
  iterationNumber: number;
  pipelineName: string;
  runId?: string;
  status: 'in-progress' | 'completed' | 'failed' | 'aborted';
  duration?: number;
  triggeredNext?: boolean;
}

export class LoopStateManager {
  private loopsDir: string;           // State JSON: .agent-pipeline/state/loops/
  private sessions: Map<string, LoopSession> = new Map();

  constructor(repoPath: string) {
    this.loopsDir = path.join(repoPath, '.agent-pipeline', 'state', 'loops');
  }

  /**
   * Creates a new loop session and returns it
   */
  async startSession(maxIterations: number): Promise<LoopSession> {
    const session: LoopSession = {
      sessionId: randomUUID(),
      startTime: new Date().toISOString(),
      status: 'running',
      maxIterations,
      totalIterations: 0,
      iterations: []
    };

    this.sessions.set(session.sessionId, session);
    await this.saveSession(session);
    return session;
  }

  /**
   * Appends an iteration to the session and saves to disk
   */
  async appendIteration(sessionId: string, summary: IterationSummary): Promise<void> {
    const session = await this.getSessionForUpdate(sessionId);
    if (!session) {
      throw new Error(`Loop session not found: ${sessionId}`);
    }

    session.iterations.push(summary);
    session.totalIterations = session.iterations.length;

    await this.saveSession(session);
  }

  /**
   * Updates an existing iteration entry for a session.
   * Returns false if the iteration is not found.
   */
  async updateIteration(
    sessionId: string,
    iterationNumber: number,
    updates: Partial<IterationSummary>
  ): Promise<boolean> {
    const session = await this.getSessionForUpdate(sessionId);
    if (!session) {
      throw new Error(`Loop session not found: ${sessionId}`);
    }

    const index = session.iterations.findIndex((iteration) => iteration.iterationNumber === iterationNumber);
    if (index === -1) {
      return false;
    }

    session.iterations[index] = { ...session.iterations[index], ...updates };
    await this.saveSession(session);
    return true;
  }

  /**
   * Marks the session as complete and saves final state to disk
   */
  async completeSession(
    sessionId: string,
    status: 'completed' | 'failed' | 'aborted' | 'limit-reached'
  ): Promise<void> {
    const session = await this.getSessionForUpdate(sessionId);
    if (!session) {
      throw new Error(`Loop session not found: ${sessionId}`);
    }

    session.status = status;
    session.endTime = new Date().toISOString();

    await this.saveSession(session);
    this.sessions.delete(sessionId);
  }

  /**
   * Loads a session from disk
   */
  async loadSession(sessionId: string): Promise<LoopSession | null> {
    const filePath = path.join(this.loopsDir, `${sessionId}.json`);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * Loads all loop sessions from disk
   */
  async getAllSessions(): Promise<LoopSession[]> {
    try {
      await fs.mkdir(this.loopsDir, { recursive: true });
      const files = await fs.readdir(this.loopsDir);
      const jsonFiles = files.filter((file) => file.endsWith('.json'));

      const sessions = await Promise.all(
        jsonFiles.map(async (file) => {
          const filePath = path.join(this.loopsDir, file);
          try {
            const content = await fs.readFile(filePath, 'utf-8');
            return JSON.parse(content) as LoopSession;
          } catch {
            return null;
          }
        })
      );

      return sessions.filter((session): session is LoopSession => session !== null);
    } catch {
      return [];
    }
  }

  /**
   * Saves a session to disk
   */
  private async saveSession(session: LoopSession): Promise<void> {
    await fs.mkdir(this.loopsDir, { recursive: true });

    const filePath = path.join(this.loopsDir, `${session.sessionId}.json`);
    await fs.writeFile(filePath, JSON.stringify(session, null, 2), 'utf-8');
  }

  private async getSessionForUpdate(sessionId: string): Promise<LoopSession | null> {
    const cached = this.sessions.get(sessionId);
    if (cached) {
      return cached;
    }

    const loaded = await this.loadSession(sessionId);
    if (loaded) {
      this.sessions.set(sessionId, loaded);
    }
    return loaded;
  }

  /**
   * Creates loop queue directories for a session.
   * Creates pending/, running/, finished/, failed/ subdirectories.
   *
   * @param sessionId - The loop session UUID
   * @param basePath - Base path (repoPath or worktreePath for worktree mode)
   * @returns Resolved directory paths (absolute)
   */
  async createSessionDirectories(
    sessionId: string,
    basePath: string
  ): Promise<ResolvedLoopingConfig['directories']> {
    const sessionDir = path.join(basePath, '.agent-pipeline', 'loops', sessionId);
    const dirs = {
      pending: path.join(sessionDir, 'pending'),
      running: path.join(sessionDir, 'running'),
      finished: path.join(sessionDir, 'finished'),
      failed: path.join(sessionDir, 'failed'),
    };

    // Create all directories in parallel
    await Promise.all(Object.values(dirs).map(d => fs.mkdir(d, { recursive: true })));

    // Add .gitignore to the session directory to exclude queue contents from git
    const gitignorePath = path.join(sessionDir, '.gitignore');
    try {
      await fs.access(gitignorePath);
    } catch {
      await fs.writeFile(gitignorePath, '# Ignore loop queue contents\n*\n!.gitignore\n');
    }

    return dirs;
  }

  /**
   * Get the session queue directory path.
   *
   * @param sessionId - The loop session UUID
   * @param basePath - Base path (repoPath or worktreePath)
   * @returns Absolute path to session queue directory
   */
  getSessionQueueDir(sessionId: string, basePath: string): string {
    return path.join(basePath, '.agent-pipeline', 'loops', sessionId);
  }
}
