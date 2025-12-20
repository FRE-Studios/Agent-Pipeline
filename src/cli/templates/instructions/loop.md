## Pipeline Looping

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
- Write a valid pipeline YAML to: `{{pendingDir}}`
- Automatically picked up after this pipeline completes
- Use same format as `.agent-pipeline/pipelines/`

**Loop status:** Iteration {{currentIteration}}/{{maxIterations}}
