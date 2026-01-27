## Pipeline Handover Context

**Handover Directory:** `{{handoverDir}}`

### Required Reading
Before starting your task, read these files to understand the current state:
1. `{{handoverDir}}/HANDOVER.md` - Current pipeline state and context
2. `{{handoverDir}}/execution-log.md` - Execution history

### Previous Stage Outputs
{{previousStagesSection}}

### Your Output Requirements

**output.md is a summary file only.** Keep it minimal and to the point.

Save your summary to: `{{handoverDir}}/stages/{{stageName}}/output.md`

```markdown
# Stage: {{stageName}}

## Summary
{1-2 sentences max: what you accomplished}

## Files Changed
{list paths only, no descriptions}

## Reference Files
{list any additional files you saved to this stage directory}

## Next Stage Context
{1-2 bullet points only if critical context is needed}
```

**Guidelines:**
- output.md contains ONLY the requested summary—no detailed analysis, logs, or verbose explanations
- For detailed output (analysis reports, data dumps, reference material), write separate files to `{{handoverDir}}/stages/{{stageName}}/` and reference them in output.md
- Be ruthlessly concise—next stages can read your reference files if they need details

The orchestrator will update HANDOVER.md and execution-log.md automatically.
