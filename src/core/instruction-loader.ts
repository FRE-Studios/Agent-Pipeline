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
  pipelineName?: string;  // Current pipeline name for reference
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

**Handover Directory:** \`{{handoverDir}}\` *(absolute path - use exactly as shown)*

### Required Reading
Before starting your task, read these files to understand the current state:
1. \`{{handoverDir}}/HANDOVER.md\` - Current pipeline state and context
2. \`{{handoverDir}}/LOG.md\` - Execution history

### Previous Stage Outputs
{{previousStagesSection}}

### Your Output Requirements
When you complete your task, save your output to:
\`{{handoverDir}}/stages/{{stageName}}/output.md\`

> **Note:** This is an absolute path. You have permission to write here regardless of your current working directory.

Use this format:
\`\`\`markdown
# Stage: {{stageName}}

## Summary
{1-2 sentences: what you accomplished}

## Key Outputs
{bullet points of important results}

## Files Created/Modified
{list files you changed}

## Notes for Next Stage
{context the next agent needs}
\`\`\`

The orchestrator will update HANDOVER.md and LOG.md automatically.
`;
  }

  /**
   * Built-in loop template (fallback when no file exists)
   */
  private getBuiltInLoopTemplate(): string {
    return `## Pipeline Looping

This pipeline is running in LOOP MODE. You are in the FINAL stage group.

**When to Create a Next Pipeline:**
Create a pipeline in the pending directory ONLY when:
1. You discovered unexpected new work outside your current scope
2. You are finishing a phase in a multi-phase plan and more phases remain
   - Create a pipeline for the NEXT PHASE ONLY (not all remaining phases)

**When NOT to Create a Next Pipeline:**
- Your task is complete with no follow-up needed
- The work is a simple fix that doesn't warrant a new pipeline
- Subsequent work is better handled by a human

**To queue the next pipeline:**
- Write a valid pipeline YAML to: \`{{pendingDir}}\`
- Automatically picked up after this pipeline completes
- Reference: \`.agent-pipeline/pipelines/{{pipelineName}}.yml\`

**Loop status:** Iteration {{currentIteration}}/{{maxIterations}}
`;
  }
}
