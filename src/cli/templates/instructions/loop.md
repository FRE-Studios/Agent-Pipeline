## Pipeline Looping

This pipeline is running in LOOP MODE. You are in the FINAL stage group.

**To get current pipeline context:**
Run: `agent-pipeline loop-context`

This command shows:
- The current pipeline YAML (for reference/copying)
- Recommendations for creating the next pipeline
- The pending directory path

**When to Create a Next Pipeline:**
Create a pipeline in the pending directory ONLY when:
1. You discovered unexpected new work outside your current scope
2. You have a task that explicitly calls for the next agent (like "Pass to the next agent")
3. You are finishing a phase in a multi-phase plan and more phases remain
   - Create a pipeline for the NEXT PHASE ONLY (not all remaining phases)

**When NOT to Create a Next Pipeline:**
- Your task is complete with no follow-up needed
- The work is a simple fix that doesn't warrant a new pipeline
- Subsequent work is better handled by a human

**To queue the next pipeline:**
- Write a valid pipeline YAML to: `{{pendingDir}}`
- Automatically picked up after this pipeline completes
- Run `agent-pipeline loop-context` to see the current pipeline structure

**Recommendations for next pipeline:**
1. Keep structure identical unless another structure or file is given
2. Looping config is saved from first pipeline - leave unchanged
3. Only update customizations as needed (leave unchanged if no directions)

**Loop status:** Iteration {{currentIteration}}/{{maxIterations}}
