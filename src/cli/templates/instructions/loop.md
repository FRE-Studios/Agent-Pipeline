## Pipeline Looping

This pipeline is running in LOOP MODE. After completion, the orchestrator will check for the next pipeline to run.

**To queue the next pipeline:**
- Write a valid pipeline YAML file to: `{{pendingDir}}`
- The file will be automatically picked up and executed after this pipeline completes
- Use the same format as regular pipeline definitions in `.agent-pipeline/pipelines/`

**Current loop status:**
- Iteration: {{currentIteration}}/{{maxIterations}}
- Pending directory: `{{pendingDir}}`

**Note:** Only create a next pipeline if your analysis determines follow-up work is needed.
