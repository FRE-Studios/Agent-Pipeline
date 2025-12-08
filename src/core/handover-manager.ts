// src/core/handover-manager.ts

import * as fs from 'fs/promises';
import * as path from 'path';

export interface HandoverConfig {
  directory?: string;  // Base directory for handover files
}

export class HandoverManager {
  private handoverDir: string;
  private pipelineName: string;
  private runId: string;

  constructor(
    repoPath: string,
    pipelineName: string,
    runId: string,
    config?: HandoverConfig
  ) {
    this.pipelineName = pipelineName;
    this.runId = runId;

    // Default: {pipeline-name}-{runId}/ in repo root
    const defaultDir = `${pipelineName}-${runId.substring(0, 8)}`;
    const baseDir = config?.directory || defaultDir;

    this.handoverDir = path.isAbsolute(baseDir)
      ? baseDir
      : path.join(repoPath, baseDir);
  }

  getHandoverDir(): string {
    return this.handoverDir;
  }

  async initialize(): Promise<void> {
    // Create directory structure
    await fs.mkdir(this.handoverDir, { recursive: true });
    await fs.mkdir(path.join(this.handoverDir, 'stages'), { recursive: true });

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
When you complete your task:

1. **Update HANDOVER.md** - Replace the entire file with your handover:
   \`\`\`markdown
   # Pipeline Handover

   ## Current Status
   - Stage: ${stageName}
   - Status: success
   - Timestamp: ${new Date().toISOString()}

   ## Summary
   {1-2 sentences: what you accomplished}

   ## Key Outputs
   {bullet points of important results}

   ## Files Created/Modified
   {list files you changed}

   ## Notes for Next Stage
   {context the next agent needs}
   \`\`\`

2. **Append to LOG.md** - Add your entry at the end:
   \`\`\`markdown
   ---
   ## [${new Date().toISOString()}] Stage: ${stageName}
   **Status:** success | **Duration:** (estimated)
   **Summary:** {brief summary}
   \`\`\`

3. **Save detailed output** to \`${this.handoverDir}/stages/${stageName}/output.md\`
`;
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
