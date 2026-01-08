// src/cli/commands/schema.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as YAML from 'yaml';
import chalk from 'chalk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Color utilities
const c = {
  title: chalk.bold.cyan,
  header: chalk.bold.white,
  field: chalk.green,
  value: chalk.yellow,
  dim: chalk.dim,
  code: chalk.cyan,
  key: chalk.green,
  string: chalk.yellow,
  number: chalk.magenta,
  boolean: chalk.cyan,
  comment: chalk.dim,
  separator: chalk.dim,
};

/**
 * Colorize YAML content for terminal display
 */
function colorizeYaml(yaml: string): string {
  const lines = yaml.split('\n');
  const result: string[] = [];

  for (const line of lines) {
    // Document separator
    if (line === '---') {
      result.push(c.separator(line));
      continue;
    }

    // Section header comments (with ===)
    if (line.includes('====')) {
      result.push(c.header(line));
      continue;
    }

    // Title comments (Example N: ...)
    if (/^#\s*Example \d+:/.test(line)) {
      result.push(c.title(line));
      continue;
    }

    // Regular comments
    if (/^\s*#/.test(line)) {
      result.push(c.comment(line));
      continue;
    }

    // Key-value pairs
    const kvMatch = line.match(/^(\s*)([\w-]+)(:)(.*)$/);
    if (kvMatch) {
      const [, indent, key, colon, rest] = kvMatch;

      // Check if there's an inline comment
      const commentMatch = rest.match(/^(\s*)(\S.*?)(\s+#.*)$/);
      if (commentMatch) {
        const [, space, val, comment] = commentMatch;
        result.push(`${indent}${c.key(key)}${colon}${space}${colorizeValue(val)}${c.comment(comment)}`);
      } else if (rest.trim()) {
        result.push(`${indent}${c.key(key)}${colon}${colorizeValue(rest)}`);
      } else {
        result.push(`${indent}${c.key(key)}${colon}`);
      }
      continue;
    }

    // List items
    const listMatch = line.match(/^(\s*)(-)(\s*)(.*)$/);
    if (listMatch) {
      const [, indent, dash, space, val] = listMatch;

      // Check for key-value in list item
      const listKvMatch = val.match(/^([\w-]+)(:)(.*)$/);
      if (listKvMatch) {
        const [, k, col, v] = listKvMatch;
        result.push(`${indent}${c.dim(dash)}${space}${c.key(k)}${col}${colorizeValue(v)}`);
      } else {
        result.push(`${indent}${c.dim(dash)}${space}${colorizeValue(val)}`);
      }
      continue;
    }

    result.push(line);
  }

  return result.join('\n');
}

/**
 * Colorize a YAML value
 */
function colorizeValue(val: string): string {
  const trimmed = val.trim();

  // Empty
  if (!trimmed) return val;

  // Preserve leading whitespace
  const leadingSpace = val.match(/^\s*/)?.[0] || '';

  // Boolean
  if (/^(true|false)$/i.test(trimmed)) {
    return leadingSpace + c.boolean(trimmed);
  }

  // Number
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return leadingSpace + c.number(trimmed);
  }

  // Quoted string
  if (/^["'].*["']$/.test(trimmed)) {
    return leadingSpace + c.string(trimmed);
  }

  // Array notation
  if (/^\[.*\]$/.test(trimmed)) {
    return leadingSpace + c.string(trimmed);
  }

  // Environment variable
  if (/^\$\w+/.test(trimmed)) {
    return leadingSpace + c.value(trimmed);
  }

  // Path or identifier
  return leadingSpace + c.string(trimmed);
}

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

# Git settings (optional)
git:
  autoCommit: true
  commitPrefix: "[pipeline:{{stage}}]"

# Execution settings (optional)
execution:
  mode: parallel             # parallel | sequential
  failureStrategy: continue  # stop | continue

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

# Optional sections:

# git:
#   baseBranch: main           # Base branch for PRs
#   branchStrategy: reusable   # reusable | unique-per-run | unique-and-delete
#   mergeStrategy: pull-request  # pull-request | local-merge | none
#   worktree:
#     directory: .agent-pipeline/worktrees

# execution:
#   permissionMode: acceptEdits  # default | acceptEdits | bypassPermissions | plan

# handover:
#   directory: .agent-pipeline/runs/my-pipeline
#   instructions: .agent-pipeline/instructions/handover.md

# runtime:
#   type: claude-code-headless   # claude-code-headless | claude-sdk
#   options:
#     model: sonnet              # haiku | sonnet | opus

# notifications:
#   enabled: true
#   channels:
#     local: { enabled: true }
#     slack: { webhookUrl: $SLACK_WEBHOOK_URL }

# Default settings (when not specified):
#   runtime: claude-code-headless
#   permissionMode: acceptEdits
#   timeout: 900 (15 minutes)
#   failureStrategy: continue
#   autoCommit: true
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

git:
  autoCommit: true
  commitPrefix: "[bot]"
  baseBranch: main
  branchStrategy: unique-per-run
  mergeStrategy: pull-request
  pullRequest:
    title: "Feature: {{pipelineName}}"

agents:
  - name: implement
    agent: .agent-pipeline/agents/implementer.md

  - name: test
    agent: .agent-pipeline/agents/tester.md
    dependsOn: [implement]

---
# =============================================================================
# Example 5: Loop Pipeline
# Iterates until completion condition is met
# =============================================================================

name: iterative-refactor
trigger: manual

looping:
  enabled: true
  maxIterations: 10
  instructions: .agent-pipeline/instructions/loop.md

agents:
  - name: refactor
    agent: .agent-pipeline/agents/refactorer.md

  - name: checker
    agent: .agent-pipeline/agents/quality-checker.md
    dependsOn: [refactor]

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

  execution: `execution (optional)
  Runtime behavior configuration.

  Fields:
    mode               Execution mode: parallel | sequential (default: parallel)
    failureStrategy    What to do on failure: stop | continue (default: continue)
    permissionMode     Agent permissions: default | acceptEdits | bypassPermissions | plan

  Example:
    execution:
      mode: parallel
      failureStrategy: continue
      permissionMode: acceptEdits`,

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

  looping: `looping (optional)
  Pipeline looping configuration for continuous execution.

  Fields:
    enabled             Enable looping (default: false)
    maxIterations       Maximum loop iterations (default: 100)
    instructions        Path to loop instructions template
    directories         Custom directory paths for pending/running/finished/failed

  Agents in the final stage group receive loop instructions automatically.

  Example:
    looping:
      enabled: true
      maxIterations: 10
      instructions: .agent-pipeline/instructions/loop.md`,

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

function colorizeFieldDoc(doc: string): string {
  // Colorize the field documentation
  const lines = doc.split('\n');
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // First line is the field name and requirement
    if (i === 0) {
      const match = line.match(/^(\S+)\s+\((\w+)\)$/);
      if (match) {
        result.push(`${c.title(match[1])} ${c.dim(`(${match[2]})`)}`);
        continue;
      }
    }

    // Section headers like "Fields:", "Rules:", "Example:", "Values:", "Examples:"
    if (/^\s*(Fields|Rules|Example|Values|Examples|Available variables|The \w+):/.test(line)) {
      result.push(line.replace(/^(\s*)(\S[^:]+):/, (_, indent, header) => `${indent}${c.header(header + ':')}`));
      continue;
    }

    // Field definitions (indented field names with descriptions)
    if (/^\s{4}\w+\s+/.test(line) && !line.trim().startsWith('-')) {
      const match = line.match(/^(\s{4})(\w+)(\s+)(.+)$/);
      if (match) {
        const defaultMatch = match[4].match(/^(.+?)(\(default: .+\))$/);
        if (defaultMatch) {
          result.push(`${match[1]}${c.field(match[2])}${match[3]}${defaultMatch[1]}${c.dim(defaultMatch[2])}`);
        } else {
          result.push(`${match[1]}${c.field(match[2])}${match[3]}${match[4]}`);
        }
        continue;
      }
    }

    // Values like "manual", "pre-commit" etc with descriptions
    if (/^\s{4}\S+\s{2,}/.test(line) && !line.includes(':')) {
      const match = line.match(/^(\s{4})(\S+)(\s{2,})(.+)$/);
      if (match) {
        result.push(`${match[1]}${c.value(match[2])}${match[3]}${c.dim(match[4])}`);
        continue;
      }
    }

    // YAML code blocks (indented with 4+ spaces after Example:)
    if (/^\s{4}[\w-]+:/.test(line) || /^\s{6}-\s/.test(line) || /^\s{6}\w+:/.test(line) || /^\s{8}\w+:/.test(line)) {
      result.push(c.code(line));
      continue;
    }

    // Bullet points
    if (/^\s+-\s/.test(line)) {
      result.push(line.replace(/^(\s+-)(\s.+)$/, (_, bullet, text) => `${c.dim(bullet)}${text}`));
      continue;
    }

    result.push(line);
  }

  return result.join('\n');
}

function formatFieldHelp(field: string): string {
  // Handle nested fields like "settings.loop"
  const normalizedField = field.toLowerCase().replace(/\./g, '');

  // Direct match
  if (fieldDocs[field]) {
    return colorizeFieldDoc(fieldDocs[field]);
  }

  // Try normalized match
  for (const key of Object.keys(fieldDocs)) {
    if (key.toLowerCase().replace(/\./g, '') === normalizedField) {
      return colorizeFieldDoc(fieldDocs[key]);
    }
  }

  // List available fields
  const available = Object.keys(fieldDocs).sort().map(f => c.field(f)).join(', ');
  return `${c.value(`Unknown field: ${field}`)}

${c.header('Available fields:')}
  ${available}

${c.dim("Use 'agent-pipeline schema --field <name>' to learn about a specific field.")}`;
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
      console.log(`${c.field('Examples exported to:')} ${options.output}`);
    } else {
      // Colorize for terminal display
      console.log(colorizeYaml(examples));
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
      console.log(`${c.field('Template exported to:')} ${options.output}`);
    } else {
      // Colorize for terminal display
      console.log(colorizeYaml(template));
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
    console.error(c.value('Schema file not found.') + ' Run "npm run generate:schema" to generate it.');
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
    console.log(`${c.field('Schema exported to:')} ${options.output}`);
  } else {
    console.log(output);
  }
}
