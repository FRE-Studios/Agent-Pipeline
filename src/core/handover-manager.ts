// src/core/handover-manager.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import { HandoverConfig } from '../config/schema.js';
import { InstructionLoader, InstructionContext } from './instruction-loader.js';

export class HandoverManager {
  private handoverDir: string;
  private pipelineName: string;
  private runId: string;
  private instructionLoader: InstructionLoader;

  constructor(
    repoPath: string,
    pipelineName: string,
    runId: string,
    config?: HandoverConfig
  ) {
    this.pipelineName = pipelineName;
    this.runId = runId;
    this.instructionLoader = new InstructionLoader(repoPath);

    // Build handover directory path
    // Custom directory: append runId for isolation (prevents overwrites across runs)
    // Default: .agent-pipeline/runs/{pipeline-name}-{runId}/
    const runIdSuffix = runId.substring(0, 8);

    if (config?.directory) {
      // Custom directory specified - append runId for run isolation
      const customBase = path.isAbsolute(config.directory)
        ? config.directory
        : path.join(repoPath, config.directory);
      this.handoverDir = path.join(customBase, runIdSuffix);
    } else {
      // Default: .agent-pipeline/runs/{pipeline-name}-{runId}/
      this.handoverDir = path.join(
        repoPath,
        '.agent-pipeline',
        'runs',
        `${pipelineName}-${runIdSuffix}`
      );
    }
  }

  getHandoverDir(): string {
    return this.handoverDir;
  }

  async initialize(): Promise<void> {
    // Create directory structure
    await fs.mkdir(this.handoverDir, { recursive: true });
    await fs.mkdir(path.join(this.handoverDir, 'stages'), { recursive: true });

    // Ensure .agent-pipeline/runs/ is gitignored (prevents committing handover artifacts)
    const runsDir = path.dirname(this.handoverDir);
    const runsGitignore = path.join(runsDir, '.gitignore');
    try {
      await fs.access(runsGitignore);
    } catch {
      // .gitignore doesn't exist, create it
      await fs.writeFile(runsGitignore, '# Ignore all pipeline run artifacts\n*\n!.gitignore\n');
    }

    // Create initial HANDOVER.md
    await fs.writeFile(
      path.join(this.handoverDir, 'HANDOVER.md'),
      this.buildInitialHandover()
    );

    // Create initial LOG.md
    await fs.writeFile(
      path.join(this.handoverDir, 'LOG.md'),
      this.buildInitialLog()
    );
  }

  async createStageDirectory(stageName: string): Promise<string> {
    const stageDir = path.join(this.handoverDir, 'stages', stageName);
    await fs.mkdir(stageDir, { recursive: true });
    return stageDir;
  }

  async saveAgentOutput(stageName: string, output: string): Promise<void> {
    const stageDir = await this.createStageDirectory(stageName);
    await fs.writeFile(path.join(stageDir, 'output.md'), output);
  }

  async appendToLog(
    stageName: string,
    status: 'success' | 'failed' | 'skipped',
    duration: number,
    summary: string
  ): Promise<void> {
    const timestamp = new Date().toISOString();
    const logEntry = `
---
## [${timestamp}] Stage: ${stageName}
**Status:** ${status} | **Duration:** ${duration.toFixed(1)}s
**Summary:** ${summary}
`;

    const logPath = path.join(this.handoverDir, 'LOG.md');
    await fs.appendFile(logPath, logEntry);
  }

  async getPreviousStages(): Promise<string[]> {
    try {
      const stagesDir = path.join(this.handoverDir, 'stages');
      const entries = await fs.readdir(stagesDir, { withFileTypes: true });
      return entries
        .filter(e => e.isDirectory())
        .map(e => e.name);
    } catch {
      return [];
    }
  }

  buildContextMessage(stageName: string, previousStages: string[]): string {
    const previousStagesSection = previousStages.length > 0
      ? previousStages.map(s => `- \`${this.handoverDir}/stages/${s}/output.md\``).join('\n')
      : '(none - this is the first stage)';

    return `## Pipeline Handover Context

**Handover Directory:** \`${this.handoverDir}\`

### Required Reading
Before starting your task, read these files to understand the current state:
1. \`${this.handoverDir}/HANDOVER.md\` - Current pipeline state and context
2. \`${this.handoverDir}/LOG.md\` - Execution history

### Previous Stage Outputs
${previousStagesSection}

### Your Output Requirements

**output.md is a summary file only.** Keep it minimal and to the point.

Save your summary to: \`${this.handoverDir}/stages/${stageName}/output.md\`

\`\`\`markdown
# Stage: ${stageName}

## Summary
{1-2 sentences max: what you accomplished}

## Files Changed
{list paths only, no descriptions}

## Reference Files
{list any additional files you saved to this stage directory}

## Next Stage Context
{1-2 bullet points only if critical context is needed}
\`\`\`

**Guidelines:**
- output.md contains ONLY the requested summary—no detailed analysis, logs, or verbose explanations
- For detailed output (analysis reports, data dumps, reference material), write separate files to \`${this.handoverDir}/stages/${stageName}/\` and reference them in output.md
- Be ruthlessly concise—next stages can read your reference files if they need details

The orchestrator will update HANDOVER.md and LOG.md automatically.
`;
  }

  /**
   * Read the output file for a specific stage
   */
  async readStageOutput(stageName: string): Promise<string> {
    const outputPath = path.join(this.handoverDir, 'stages', stageName, 'output.md');
    try {
      return await fs.readFile(outputPath, 'utf-8');
    } catch {
      return `(No output found for stage: ${stageName})`;
    }
  }

  /**
   * Copy a single stage's output to HANDOVER.md (for sequential execution)
   */
  async copyStageToHandover(stageName: string): Promise<void> {
    const stageOutput = await this.readStageOutput(stageName);
    const handoverContent = this.formatAsHandover(stageName, stageOutput);
    await fs.writeFile(path.join(this.handoverDir, 'HANDOVER.md'), handoverContent);
  }

  /**
   * Merge multiple parallel stage outputs into HANDOVER.md
   */
  async mergeParallelOutputs(stageNames: string[]): Promise<void> {
    const outputs = await Promise.all(
      stageNames.map(async (name) => ({
        name,
        content: await this.readStageOutput(name)
      }))
    );
    const mergedContent = this.formatMergedHandover(outputs);
    await fs.writeFile(path.join(this.handoverDir, 'HANDOVER.md'), mergedContent);
  }

  /**
   * Format a single stage output as HANDOVER.md content
   */
  private formatAsHandover(stageName: string, stageOutput: string): string {
    return `# Pipeline Handover

## Current Status
- Stage: ${stageName}
- Status: success
- Timestamp: ${new Date().toISOString()}

## Stage Output

${stageOutput}
`;
  }

  /**
   * Format merged parallel outputs as HANDOVER.md content
   */
  private formatMergedHandover(outputs: Array<{ name: string; content: string }>): string {
    const stageNames = outputs.map(o => o.name).join(', ');
    const stageSections = outputs
      .map(o => `### ${o.name}\n\n${o.content}`)
      .join('\n\n---\n\n');

    return `# Pipeline Handover

## Current Status
- Stages: ${stageNames} (parallel group completed)
- Status: success
- Timestamp: ${new Date().toISOString()}

## Parallel Stage Outputs

${stageSections}
`;
  }

  /**
   * Build context message from instruction file (async version)
   * @param stageName Current stage name
   * @param previousStages List of previous stage names
   * @param instructionPath Optional custom instruction file path
   */
  async buildContextMessageAsync(
    stageName: string,
    previousStages: string[],
    instructionPath?: string
  ): Promise<string> {
    const previousStagesSection = previousStages.length > 0
      ? previousStages.map(s => `- \`${this.handoverDir}/stages/${s}/output.md\``).join('\n')
      : '(none - this is the first stage)';

    const context: InstructionContext = {
      handoverDir: this.handoverDir,
      stageName,
      timestamp: new Date().toISOString(),
      previousStagesSection
    };

    return this.instructionLoader.loadHandoverInstructions(instructionPath, context);
  }

  private buildInitialHandover(): string {
    return `# Pipeline Handover

## Current Status
- Stage: (none - pipeline starting)
- Status: initializing
- Timestamp: ${new Date().toISOString()}

## Summary
Pipeline "${this.pipelineName}" is starting. No stages have executed yet.

## Key Outputs
(none yet)

## Files Created/Modified
(none yet)

## Notes for Next Stage
This is the first stage. Read your task instructions carefully.
`;
  }

  private buildInitialLog(): string {
    return `# Pipeline Execution Log

**Pipeline:** ${this.pipelineName}
**Run ID:** ${this.runId}
**Started:** ${new Date().toISOString()}

`;
  }
}
