// src/core/instruction-loader.ts

import * as fs from 'fs/promises';
import * as path from 'path';

export interface InstructionContext {
  // Handover context
  handoverDir?: string;
  stageName?: string;
  timestamp?: string;
  previousStagesSection?: string;

  // Loop context
  pendingDir?: string;
  currentIteration?: number;
  maxIterations?: number;
}

export class InstructionLoader {
  private repoPath: string;

  private static readonly DEFAULT_HANDOVER_PATH = '.agent-pipeline/instructions/handover.md';
  private static readonly DEFAULT_LOOP_PATH = '.agent-pipeline/instructions/loop.md';

  constructor(repoPath: string) {
    this.repoPath = repoPath;
  }

  /**
   * Load handover instructions from file or fall back to built-in default
   */
  async loadHandoverInstructions(
    customPath?: string,
    context?: InstructionContext
  ): Promise<string> {
    const content = await this.loadTemplate(
      customPath,
      InstructionLoader.DEFAULT_HANDOVER_PATH,
      this.getBuiltInHandoverTemplate()
    );
    return this.interpolate(content, context || {});
  }

  /**
   * Load loop instructions from file or fall back to built-in default
   */
  async loadLoopInstructions(
    customPath?: string,
    context?: InstructionContext
  ): Promise<string> {
    const content = await this.loadTemplate(
      customPath,
      InstructionLoader.DEFAULT_LOOP_PATH,
      this.getBuiltInLoopTemplate()
    );
    return this.interpolate(content, context || {});
  }

  /**
   * Load template with fallback chain:
   * 1. Custom path (if provided)
   * 2. Default path in repo
   * 3. Built-in template
   */
  private async loadTemplate(
    customPath: string | undefined,
    defaultPath: string,
    builtInTemplate: string
  ): Promise<string> {
    // Try custom path first
    if (customPath) {
      const fullPath = path.isAbsolute(customPath)
        ? customPath
        : path.join(this.repoPath, customPath);
      try {
        return await fs.readFile(fullPath, 'utf-8');
      } catch {
        console.warn(`Custom instruction file not found: ${customPath}, falling back to default`);
      }
    }

    // Try default path in repo
    const defaultFullPath = path.join(this.repoPath, defaultPath);
    try {
      return await fs.readFile(defaultFullPath, 'utf-8');
    } catch {
      // Fall back to built-in template
      return builtInTemplate;
    }
  }

  /**
   * Interpolate template variables using {{variable}} syntax
   */
  private interpolate(template: string, context: InstructionContext): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      const value = context[key as keyof InstructionContext];
      if (value === undefined || value === null) {
        return match; // Keep placeholder if no value
      }
      return String(value);
    });
  }

  /**
   * Built-in handover template (fallback when no file exists)
   */
  private getBuiltInHandoverTemplate(): string {
    return `## Pipeline Handover Context

**Handover Directory:** \`{{handoverDir}}\`

### Required Reading
Before starting your task, read these files to understand the current state:
1. \`{{handoverDir}}/HANDOVER.md\` - Current pipeline state and context
2. \`{{handoverDir}}/LOG.md\` - Execution history

### Previous Stage Outputs
{{previousStagesSection}}

### Your Output Requirements
When you complete your task:

1. **Update HANDOVER.md** - Replace the entire file with your handover:
   \`\`\`markdown
   # Pipeline Handover

   ## Current Status
   - Stage: {{stageName}}
   - Status: success
   - Timestamp: {{timestamp}}

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
   ## [{{timestamp}}] Stage: {{stageName}}
   **Status:** success | **Duration:** (estimated)
   **Summary:** {brief summary}
   \`\`\`

3. **Save detailed output** to \`{{handoverDir}}/stages/{{stageName}}/output.md\`
`;
  }

  /**
   * Built-in loop template (fallback when no file exists)
   */
  private getBuiltInLoopTemplate(): string {
    return `## Pipeline Looping

This pipeline is running in LOOP MODE. After completion, the orchestrator will check for the next pipeline to run.

**To queue the next pipeline:**
- Write a valid pipeline YAML file to: \`{{pendingDir}}\`
- The file will be automatically picked up and executed after this pipeline completes
- Use the same format as regular pipeline definitions in \`.agent-pipeline/pipelines/\`

**Current loop status:**
- Iteration: {{currentIteration}}/{{maxIterations}}
- Pending directory: \`{{pendingDir}}\`

**Note:** Only create a next pipeline if your analysis determines follow-up work is needed.
`;
  }
}
