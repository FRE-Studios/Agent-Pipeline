// src/utils/pipeline-logger.ts

import * as fs from 'fs';
import * as path from 'path';

/**
 * Pipeline logger that writes to both console (in non-interactive mode) and a log file.
 * Provides the same output as --no-interactive mode for all pipeline runs.
 */
export class PipelineLogger {
  private logStream: fs.WriteStream | null = null;
  private logPath: string;
  private interactive: boolean;

  constructor(repoPath: string, pipelineName: string, interactive: boolean = false) {
    this.interactive = interactive;

    // Create log directory
    const logDir = path.join(repoPath, '.agent-pipeline', 'logs');
    fs.mkdirSync(logDir, { recursive: true });

    // Set log path
    this.logPath = path.join(logDir, `${pipelineName}.log`);

    // Open log file for appending
    this.logStream = fs.createWriteStream(this.logPath, { flags: 'a' });
  }

  getLogPath(): string {
    return this.logPath;
  }

  /**
   * Write a timestamped log entry
   */
  log(message: string): void {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] ${message}`;

    // Always write to log file
    this.logStream?.write(entry + '\n');

    // Only write to console in non-interactive mode
    if (!this.interactive) {
      console.log(message);
    }
  }

  /**
   * Write a raw message without timestamp (for startup banners, etc.)
   */
  logRaw(message: string): void {
    this.logStream?.write(message + '\n');

    if (!this.interactive) {
      console.log(message);
    }
  }

  /**
   * Write an error message
   */
  error(message: string): void {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] ERROR: ${message}`;

    this.logStream?.write(entry + '\n');

    if (!this.interactive) {
      console.error(message);
    }
  }

  /**
   * Write a section header
   */
  section(title: string): void {
    const separator = '─'.repeat(50);
    this.logRaw(`\n${separator}`);
    this.log(title);
    this.logRaw(separator);
  }

  /**
   * Write stage start
   */
  stageStart(stageName: string, attempt?: number): void {
    const attemptInfo = attempt && attempt > 0 ? ` (attempt ${attempt + 1})` : '';
    this.log(`Stage: ${stageName}${attemptInfo} - STARTED`);
  }

  /**
   * Write stage completion
   */
  stageComplete(stageName: string, duration: number, commitSha?: string): void {
    const commitInfo = commitSha ? ` [${commitSha.substring(0, 7)}]` : '';
    this.log(`Stage: ${stageName} - COMPLETED (${duration.toFixed(1)}s)${commitInfo}`);
  }

  /**
   * Write stage failure
   */
  stageFailed(stageName: string, error: string): void {
    this.log(`Stage: ${stageName} - FAILED: ${error}`);
  }

  /**
   * Write stage skip
   */
  stageSkipped(stageName: string, reason: string): void {
    this.log(`Stage: ${stageName} - SKIPPED: ${reason}`);
  }

  /**
   * Write pipeline start
   */
  pipelineStart(pipelineName: string, runId: string, triggerCommit: string): void {
    this.logRaw(`\n${'═'.repeat(60)}`);
    this.log(`Pipeline: ${pipelineName}`);
    this.log(`Run ID: ${runId.substring(0, 8)}`);
    this.log(`Trigger commit: ${triggerCommit.substring(0, 7)}`);
    this.logRaw('═'.repeat(60));
  }

  /**
   * Write pipeline completion
   */
  pipelineComplete(status: string, totalDuration: number, stageCount: number): void {
    this.logRaw(`\n${'═'.repeat(60)}`);
    this.log(`Pipeline ${status.toUpperCase()}`);
    this.log(`Total duration: ${totalDuration.toFixed(1)}s`);
    this.log(`Stages executed: ${stageCount}`);
    this.logRaw('═'.repeat(60) + '\n');
  }

  /**
   * Close the log stream
   */
  close(): void {
    if (this.logStream) {
      this.logStream.end();
      this.logStream = null;
    }
  }
}
