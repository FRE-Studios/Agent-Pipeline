// src/core/loop-state-manager.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';

export interface LoopSession {
  sessionId: string;
  startTime: string;
  endTime?: string;
  status: 'running' | 'completed' | 'failed' | 'limit-reached';
  maxIterations: number;
  totalIterations: number;
  iterations: IterationSummary[];
}

export interface IterationSummary {
  iterationNumber: number;
  pipelineName: string;
  runId: string;
  status: 'completed' | 'failed';
  duration: number;
  triggeredNext: boolean;
}

export class LoopStateManager {
  private loopsDir: string;
  private sessions: Map<string, LoopSession> = new Map();

  constructor(repoPath: string) {
    this.loopsDir = path.join(repoPath, '.agent-pipeline', 'state', 'loops');
  }

  /**
   * Creates a new loop session and returns it
   */
  startSession(maxIterations: number): LoopSession {
    const session: LoopSession = {
      sessionId: randomUUID(),
      startTime: new Date().toISOString(),
      status: 'running',
      maxIterations,
      totalIterations: 0,
      iterations: []
    };

    this.sessions.set(session.sessionId, session);
    return session;
  }

  /**
   * Appends an iteration to the session and saves to disk
   */
  async appendIteration(sessionId: string, summary: IterationSummary): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Loop session not found: ${sessionId}`);
    }

    session.iterations.push(summary);
    session.totalIterations = session.iterations.length;

    await this.saveSession(session);
  }

  /**
   * Marks the session as complete and saves final state to disk
   */
  async completeSession(
    sessionId: string,
    status: 'completed' | 'failed' | 'limit-reached'
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
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
}
