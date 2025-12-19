## Pipeline Handover Context

**Handover Directory:** `{{handoverDir}}`

### Required Reading
Before starting your task, read these files to understand the current state:
1. `{{handoverDir}}/HANDOVER.md` - Current pipeline state and context
2. `{{handoverDir}}/LOG.md` - Execution history

### Previous Stage Outputs
{{previousStagesSection}}

### Your Output Requirements
When you complete your task:

1. **Update HANDOVER.md** - Replace the entire file with your handover:
   ```markdown
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
   ```

2. **Append to LOG.md** - Add your entry at the end:
   ```markdown
   ---
   ## [{{timestamp}}] Stage: {{stageName}}
   **Status:** success | **Duration:** (estimated)
   **Summary:** {brief summary}
   ```

3. **Save detailed output** to `{{handoverDir}}/stages/{{stageName}}/output.md`
