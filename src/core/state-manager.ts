// src/core/state-manager.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import { PipelineState } from '../config/schema.js';

export class StateManager {
  private stateDir: string;

  constructor(repoPath: string) {
    this.stateDir = path.join(repoPath, '.agent-pipeline', 'state', 'runs');
  }

  async saveState(state: PipelineState): Promise<void> {
    await fs.mkdir(this.stateDir, { recursive: true });

    const filename = `${state.runId}.json`;
    const filepath = path.join(this.stateDir, filename);

    await fs.writeFile(
      filepath,
      JSON.stringify(state, null, 2),
      'utf-8'
    );
  }

  async loadState(runId: string): Promise<PipelineState | null> {
    const filepath = path.join(this.stateDir, `${runId}.json`);

    try {
      const content = await fs.readFile(filepath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  async getLatestRun(): Promise<PipelineState | null> {
    try {
      const files = await fs.readdir(this.stateDir);
      if (files.length === 0) return null;

      // Sort by modification time, newest first
      const fileStats = await Promise.all(
        files.map(async (file) => ({
          file,
          mtime: (await fs.stat(path.join(this.stateDir, file))).mtime
        }))
      );

      fileStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

      return this.loadState(path.parse(fileStats[0].file).name);
    } catch {
      return null;
    }
  }
}
