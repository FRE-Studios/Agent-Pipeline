## Pipeline Handover Context

**Handover Directory:** `{{handoverDir}}`

### Required Reading
Before starting your task, read these files to understand the current state:
1. `{{handoverDir}}/HANDOVER.md` - Current pipeline state and context
2. `{{handoverDir}}/LOG.md` - Execution history

### Previous Stage Outputs
{{previousStagesSection}}

### Your Output Requirements
When you complete your task, save your output to:
`{{handoverDir}}/stages/{{stageName}}/output.md`

Use this format:
```markdown
# Stage: {{stageName}}

## Summary
{1-2 sentences: what you accomplished}

## Key Outputs
{bullet points of important results}

## Files Created/Modified
{list files you changed}

## Notes for Next Stage
{context the next agent needs}
```

The orchestrator will update HANDOVER.md and LOG.md automatically.
