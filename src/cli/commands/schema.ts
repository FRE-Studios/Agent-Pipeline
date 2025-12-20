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
}

/**
 * Returns an annotated minimal template showing required fields and common options.
 */
function formatMinimalTemplate(): string {
  return `# Agent Pipeline Configuration
# Run 'agent-pipeline schema --full' for complete JSON schema
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
    # timeout: 900           # Max seconds (default: 900)
    # onFail: continue       # stop | continue | warn

  - name: implement
    agent: .agent-pipeline/agents/implementer.md
    dependsOn:
      - analyze              # Runs after 'analyze' completes

# Optional sections (add at root level):

# git:
#   baseBranch: main           # Base branch for PRs
#   branchStrategy: reusable   # reusable | unique-per-run
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

export async function schemaCommand(
  _repoPath: string,
  options: SchemaCommandOptions = {}
): Promise<void> {
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
