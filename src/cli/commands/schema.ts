// src/cli/commands/schema.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as YAML from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface SchemaCommandOptions {
  format?: 'json' | 'yaml';
  output?: string;
  full?: boolean;
  examples?: boolean;
  field?: string;
}

/**
 * Returns an annotated minimal template showing required fields and common options.
 */
function formatMinimalTemplate(): string {
  return `# Agent Pipeline Configuration
# Run 'agent-pipeline schema --full' for complete JSON schema
# Run 'agent-pipeline schema --examples' for common patterns
# Docs: https://github.com/FRE-Studios/agent-pipeline

name: my-pipeline
trigger: manual  # pre-commit | post-commit | pre-push | post-merge | manual

settings:
  autoCommit: true
  commitPrefix: "[pipeline:{{stage}}]"
  failureStrategy: continue  # stop | continue
  preserveWorkingTree: true

agents:
  - name: analyze
    agent: .agent-pipeline/agents/analyzer.md
    inputs:
      prompt: "Additional context for analyzer.md agent"
    # timeout: 900           # Max seconds (default: 900)
    # onFail: continue       # stop | continue | warn

  - name: implement
    agent: .agent-pipeline/agents/implementer.md
    dependsOn:
      - analyze              # Runs after 'analyze' completes

# Optional sections (add at root level):

# git:
#   baseBranch: main           # Base branch for PRs
#   branchStrategy: reusable   # reusable | unique-per-run | unique-and-delete
#   createPR: true             # Auto-create GitHub PR on completion

# notifications:
#   desktop: true              # Desktop notifications
#   slack:
#     webhookUrl: $SLACK_WEBHOOK_URL
#     events: [started, completed, failed]

# runtime:
#   model: opus                # haiku | sonnet | opus
#   maxTurns: 50               # Max agent turns per stage
#   maxThinkingTokens: 16000   # For extended thinking

# Default settings (when not specified):
#   runtime: claude-code-headless
#   permissionMode: acceptEdits
#   timeout: 900 (15 minutes)
#   failureStrategy: stop
#   autoCommit: true
#   branchStrategy: reusable
#   baseBranch: main
`;
}

/**
 * Returns multiple example configurations for common patterns.
 */
function formatExamples(): string {
  return `# Agent Pipeline Example Configurations
# Copy and adapt these patterns for your use case

# =============================================================================
# Example 1: Simple Sequential Pipeline
# Two agents run one after another
# =============================================================================

name: sequential-review
trigger: manual

agents:
  - name: analyze
    agent: .agent-pipeline/agents/analyzer.md

  - name: report
    agent: .agent-pipeline/agents/reporter.md
    dependsOn: [analyze]

---
# =============================================================================
# Example 2: Parallel Execution
# Independent agents run simultaneously for faster execution
# =============================================================================

name: parallel-checks
trigger: pre-commit

agents:
  - name: lint
    agent: .agent-pipeline/agents/linter.md

  - name: test
    agent: .agent-pipeline/agents/tester.md

  - name: security
    agent: .agent-pipeline/agents/security-scanner.md
  # No dependsOn = all run in parallel

---
# =============================================================================
# Example 3: Conditional Execution
# Agents run based on previous stage outputs
# =============================================================================

name: smart-review
trigger: post-commit

agents:
  - name: detect-changes
    agent: .agent-pipeline/agents/change-detector.md
    outputs:
      - hasTests
      - hasStyles

  - name: test-review
    agent: .agent-pipeline/agents/test-reviewer.md
    dependsOn: [detect-changes]
    condition: "outputs['detect-changes'].hasTests === true"

  - name: style-review
    agent: .agent-pipeline/agents/style-reviewer.md
    dependsOn: [detect-changes]
    condition: "outputs['detect-changes'].hasStyles === true"

---
# =============================================================================
# Example 4: Git Integration with Auto-PR
# Creates a GitHub PR on completion
# =============================================================================

name: feature-pipeline
trigger: manual

settings:
  autoCommit: true
  commitPrefix: "[bot]"

git:
  baseBranch: main
  branchStrategy: unique-per-run
  createPR: true
  prTitle: "Feature: {{pipeline}}"

agents:
  - name: implement
    agent: .agent-pipeline/agents/implementer.md

  - name: test
    agent: .agent-pipeline/agents/tester.md
    dependsOn: [implement]

---
# =============================================================================
# Example 5: Loop Pipeline
# Iterates until a condition is met (max 10 iterations)
# =============================================================================

name: iterative-refactor
trigger: manual

settings:
  loop:
    enabled: true
    maxIterations: 10
    continueCondition: "outputs.checker.needsMoreWork === true"

agents:
  - name: refactor
    agent: .agent-pipeline/agents/refactorer.md

  - name: checker
    agent: .agent-pipeline/agents/quality-checker.md
    dependsOn: [refactor]
    outputs:
      - needsMoreWork

---
# =============================================================================
# Example 6: Mixed Models for Cost Optimization
# Use cheaper models for simple tasks, expensive for complex
# =============================================================================

name: cost-optimized
trigger: manual

agents:
  - name: quick-lint
    agent: .agent-pipeline/agents/linter.md
    model: haiku        # Fast and cheap
    timeout: 60

  - name: deep-review
    agent: .agent-pipeline/agents/reviewer.md
    model: opus         # Thorough analysis
    dependsOn: [quick-lint]
    maxTurns: 100
    maxThinkingTokens: 32000

---
# =============================================================================
# Example 7: Notifications and Monitoring
# Desktop and Slack alerts for pipeline events
# =============================================================================

name: monitored-pipeline
trigger: manual

notifications:
  desktop: true
  slack:
    webhookUrl: \$SLACK_WEBHOOK_URL
    events: [started, completed, failed]
    channel: "#deployments"

agents:
  - name: deploy
    agent: .agent-pipeline/agents/deployer.md
    onFail: stop        # Stop pipeline and notify on failure
`;
}

/**
 * Field documentation for --field flag
 */
const fieldDocs: Record<string, string> = {
  name: `name (required)
  Unique identifier for this pipeline.

  Rules:
    - Must start with a letter
    - Can contain letters, numbers, hyphens, underscores
    - Maximum 50 characters

  Example:
    name: my-code-review`,

  trigger: `trigger (required)
  When this pipeline should run.

  Values:
    manual        Run only via 'agent-pipeline run'
    pre-commit    Run before git commits
    post-commit   Run after git commits
    pre-push      Run before git push
    post-merge    Run after git merge

  Example:
    trigger: post-commit`,

  settings: `settings (optional)
  Pipeline behavior configuration.

  Fields:
    autoCommit         Auto-commit after each stage (default: true)
    commitPrefix       Commit message prefix (default: "[pipeline:{{stage}}]")
    failureStrategy    What to do on failure: stop | continue (default: stop)
    preserveWorkingTree Keep working tree clean during run (default: true)
    permissionMode     Agent permissions: acceptEdits | plan | bypassPermissions
    loop               Loop configuration (see 'agent-pipeline schema --field loop')

  Example:
    settings:
      autoCommit: true
      commitPrefix: "[bot]"
      failureStrategy: continue`,

  agents: `agents (required)
  List of agent stages to execute.

  Fields:
    name (required)      Unique stage identifier
    agent (required)     Path to agent markdown file
    dependsOn            Stages that must complete first (array)
    condition            JavaScript expression for conditional execution
    inputs               Key-value pairs passed to agent prompt
    outputs              Values to extract from agent response (array)
    timeout              Max seconds per stage (default: 900)
    onFail               Behavior on failure: stop | continue | warn
    model                Override model: haiku | sonnet | opus
    maxTurns             Max conversation turns (default: 50)
    maxThinkingTokens    Tokens for extended thinking

  Example:
    agents:
      - name: review
        agent: .agent-pipeline/agents/reviewer.md
        timeout: 300
        inputs:
          focus: "security"
        outputs:
          - issues
          - suggestions`,

  git: `git (optional)
  Git workflow configuration.

  Fields:
    baseBranch       Target branch for PRs (default: main)
    branchStrategy   Branch naming: reusable | unique-per-run | unique-and-delete
    createPR         Auto-create GitHub PR on completion (default: false)
    prTitle          PR title template (supports {{pipeline}}, {{runId}})
    prBody           PR body template

  Example:
    git:
      baseBranch: develop
      branchStrategy: unique-per-run
      createPR: true
      prTitle: "[Pipeline] {{pipeline}}"`,

  notifications: `notifications (optional)
  Alert configuration for pipeline events.

  Fields:
    desktop    Enable desktop notifications (default: false)
    slack      Slack webhook configuration
      webhookUrl   Webhook URL (supports $ENV_VAR syntax)
      events       Events to notify: started, completed, failed, stage-completed
      channel      Override default channel

  Example:
    notifications:
      desktop: true
      slack:
        webhookUrl: $SLACK_WEBHOOK_URL
        events: [started, completed, failed]`,

  runtime: `runtime (optional)
  Agent execution configuration.

  Fields:
    model              Default model: haiku | sonnet | opus (default: sonnet)
    maxTurns           Default max turns per stage (default: 50)
    maxThinkingTokens  Default thinking tokens for extended thinking

  Example:
    runtime:
      model: opus
      maxTurns: 100
      maxThinkingTokens: 16000`,

  loop: `settings.loop (optional)
  Pipeline looping configuration.

  Fields:
    enabled             Enable looping (default: false)
    maxIterations       Maximum loop iterations (default: 100)
    continueCondition   JavaScript expression to continue looping

  The continueCondition has access to:
    - outputs: object with stage outputs (outputs.stageName.fieldName)
    - iteration: current iteration number (0-indexed)

  Example:
    settings:
      loop:
        enabled: true
        maxIterations: 10
        continueCondition: "outputs.checker.needsMoreWork === true"`,

  condition: `agents[].condition (optional)
  JavaScript expression to conditionally execute a stage.

  Available variables:
    - outputs: object with previous stage outputs
    - env: environment variables

  Examples:
    condition: "outputs['analyze'].hasIssues === true"
    condition: "outputs.detector.fileCount > 0"
    condition: "env.CI === 'true'"`,

  inputs: `agents[].inputs (optional)
  Key-value pairs passed to agent prompt as context.

  The agent receives these as variables in its prompt template.

  Example:
    inputs:
      focus: "performance"
      maxIssues: 10
      files: "src/**/*.ts"`,

  outputs: `agents[].outputs (optional)
  Values to extract from agent response.

  Agents can report outputs via:
    1. MCP report_outputs tool (structured)
    2. Text format: "Output: key=value" (fallback)

  Outputs are available to subsequent stages via condition expressions.

  Example:
    outputs:
      - issueCount
      - hasBlockers
      - suggestions`,

  dependsOn: `agents[].dependsOn (optional)
  Array of stage names that must complete before this stage runs.

  Stages without dependsOn run in parallel at the start.
  Stages with dependsOn run after all dependencies complete.

  Example:
    agents:
      - name: lint
        agent: linter.md
      - name: test
        agent: tester.md
      - name: deploy
        agent: deployer.md
        dependsOn: [lint, test]   # Runs after both complete`,
};

function formatFieldHelp(field: string): string {
  // Handle nested fields like "settings.loop"
  const normalizedField = field.toLowerCase().replace(/\./g, '');

  // Direct match
  if (fieldDocs[field]) {
    return fieldDocs[field];
  }

  // Try normalized match
  for (const key of Object.keys(fieldDocs)) {
    if (key.toLowerCase().replace(/\./g, '') === normalizedField) {
      return fieldDocs[key];
    }
  }

  // List available fields
  const available = Object.keys(fieldDocs).sort().join(', ');
  return `Unknown field: ${field}

Available fields:
  ${available}

Use 'agent-pipeline schema --field <name>' to learn about a specific field.`;
}

export async function schemaCommand(
  _repoPath: string,
  options: SchemaCommandOptions = {}
): Promise<void> {
  // --examples: show example configurations
  if (options.examples) {
    const examples = formatExamples();
    if (options.output) {
      await fs.writeFile(options.output, examples, 'utf-8');
      console.log(`Examples exported to: ${options.output}`);
    } else {
      console.log(examples);
    }
    return;
  }

  // --field: show documentation for a specific field
  if (options.field) {
    console.log(formatFieldHelp(options.field));
    return;
  }

  // Default: show minimal template
  if (!options.full) {
    const template = formatMinimalTemplate();
    if (options.output) {
      await fs.writeFile(options.output, template, 'utf-8');
      console.log(`Template exported to: ${options.output}`);
    } else {
      console.log(template);
    }
    return;
  }

  // --full: show complete JSON schema
  const format = options.format || 'json';
  const templateDir = path.join(__dirname, '..', 'templates', 'schema');
  const schemaPath = path.join(templateDir, 'pipeline-config.schema.json');

  let schemaContent: string;
  try {
    schemaContent = await fs.readFile(schemaPath, 'utf-8');
  } catch (error) {
    console.error('Schema file not found. Run "npm run generate:schema" to generate it.');
    process.exit(1);
  }

  // Convert to requested format
  let output: string;
  if (format === 'yaml') {
    const schema = JSON.parse(schemaContent);
    output = YAML.stringify(schema, { indent: 2 });
  } else {
    output = schemaContent;
  }

  // Write to file or stdout
  if (options.output) {
    await fs.writeFile(options.output, output, 'utf-8');
    console.log(`Schema exported to: ${options.output}`);
  } else {
    console.log(output);
  }
}
