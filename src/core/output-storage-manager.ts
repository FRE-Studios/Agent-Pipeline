// src/core/output-storage-manager.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import { StageExecution } from '../config/schema.js';

/**
 * Manages file-based storage of agent outputs and pipeline data.
 * Enables summary-based context reduction by saving verbose outputs to disk.
 */
export class OutputStorageManager {
  private outputDir: string;

  constructor(
    private repoPath: string,
    private runId: string
  ) {
    this.outputDir = path.join(repoPath, '.agent-pipeline', 'outputs', runId);
  }

  /**
   * Save stage outputs to files (both structured and raw)
   * @param stageName - Name of the stage
   * @param structuredData - Extracted structured output data
   * @param rawText - Raw agent response text
   * @returns Object with paths to structured and raw output files
   */
  async saveStageOutputs(
    stageName: string,
    structuredData: Record<string, unknown> | undefined,
    rawText: string
  ): Promise<{ structured: string; raw: string }> {
    await fs.mkdir(this.outputDir, { recursive: true });

    const structuredPath = path.join(this.outputDir, `${stageName}-output.json`);
    const rawPath = path.join(this.outputDir, `${stageName}-raw.md`);

    // Save structured output (if exists)
    if (structuredData) {
      await fs.writeFile(
        structuredPath,
        JSON.stringify(structuredData, null, 2),
        'utf-8'
      );
    }

    // Save raw agent text
    await fs.writeFile(rawPath, rawText, 'utf-8');

    return {
      structured: structuredPath,
      raw: rawPath
    };
  }

  /**
   * Save changed files list to disk
   * @param files - Array of changed file paths
   * @returns Path to the saved file
   */
  async saveChangedFiles(files: string[]): Promise<string> {
    await fs.mkdir(this.outputDir, { recursive: true });

    const filepath = path.join(this.outputDir, 'changed-files.txt');
    await fs.writeFile(filepath, files.join('\n'), 'utf-8');

    return filepath;
  }

  /**
   * Save pipeline summary (all stages metadata)
   * @param stages - Array of stage execution objects
   * @returns Path to the saved summary file
   */
  async savePipelineSummary(stages: StageExecution[]): Promise<string> {
    await fs.mkdir(this.outputDir, { recursive: true });

    const summary = stages.map(s => ({
      name: s.stageName,
      status: s.status,
      duration: s.duration,
      commitSha: s.commitSha,
      extractedData: s.extractedData
    }));

    const filepath = path.join(this.outputDir, 'pipeline-summary.json');
    await fs.writeFile(
      filepath,
      JSON.stringify(summary, null, 2),
      'utf-8'
    );

    return filepath;
  }

  /**
   * Read stage output (for agents to access)
   * @param stageName - Name of the stage to read
   * @returns Structured output data or null if not found
   */
  async readStageOutput(stageName: string): Promise<Record<string, unknown> | null> {
    const filepath = path.join(this.outputDir, `${stageName}-output.json`);

    try {
      const content = await fs.readFile(filepath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * Compress file list to directory summary
   * @param files - Array of file paths
   * @returns Compressed summary string
   */
  compressFileList(files: string[]): string {
    if (files.length === 0) return 'No files changed';
    if (files.length <= 5) return files.join('\n');

    // Group by directory
    const dirCounts = new Map<string, number>();

    for (const file of files) {
      const dir = path.dirname(file);
      dirCounts.set(dir, (dirCounts.get(dir) || 0) + 1);
    }

    // Sort by count (descending)
    const sorted = Array.from(dirCounts.entries())
      .sort((a, b) => b[1] - a[1]);

    const topDirs = sorted.slice(0, 5)
      .map(([dir, count]) => `${dir}/ (${count})`)
      .join(', ');

    return `Changed ${files.length} files in: ${topDirs}${sorted.length > 5 ? '...' : ''}`;
  }
}
