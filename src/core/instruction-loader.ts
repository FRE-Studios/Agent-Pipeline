// src/core/instruction-loader.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import { interpolateTemplate } from '../utils/template-interpolator.js';

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
  pipelineYaml?: string;  // Current pipeline YAML content for loop agent reference
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
    return interpolateTemplate(template, context as unknown as Record<string, unknown>);
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
2. \`{{handoverDir}}/execution-log.md\` - Execution history

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

The orchestrator will update HANDOVER.md and execution-log.md automatically.
`;
  }

  /**
   * Built-in loop template (fallback when no file exists)
   */
  private getBuiltInLoopTemplate(): string {
    return `## Loop Agent

You are the Loop Agent. Your ONLY task is to decide whether to create a new pipeline YAML file to continue the loop.

**Current Pipeline YAML:**
\`\`\`yaml
{{pipelineYaml}}
\`\`\`

**To queue the next pipeline:**
Write a valid pipeline YAML file to: \`{{pendingDir}}\`

**Default behavior:**
When creating the next pipeline, reproduce the current pipeline YAML above with ALL stage inputs intact. Only modify inputs or structure if you have specific directions to change them.

**When NOT to create a next pipeline:**
- All planned work is complete
- Subsequent work is better handled by a human
- You receive usage limit warnings or errors

**Recommendations:**
1. Keep the pipeline structure identical unless directed otherwise
2. Preserve all stage inputs exactly as shown above
3. The looping config is inherited automatically — do not include it in the new pipeline
4. Only update stage inputs when you have specific directions to change them

**Loop status:** Iteration {{currentIteration}}/{{maxIterations}}

**Your only task is to create a new pipeline YAML file when conditions warrant it. Take no other action if no new pipeline is needed.**
`;
  }
}
