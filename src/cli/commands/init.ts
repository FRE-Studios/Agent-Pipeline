// src/cli/commands/init.ts - Refactored to use AgentImporter and templates

import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as YAML from 'yaml';
import { AgentImporter } from '../utils/agent-importer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Available example templates (excluding test-pipeline)
const AVAILABLE_EXAMPLES = ['post-commit', 'pre-commit', 'pre-push', 'post-merge'] as const;
type ExampleName = typeof AVAILABLE_EXAMPLES[number];

export async function initCommand(
  repoPath: string,
  options?: {
    exampleName?: string;
    all?: boolean;
    importPluginAgents?: boolean;
    interactive?: boolean;
  }
): Promise<void> {
  console.log('\n🚀 Initializing Agent Pipeline...\n');

  try {
    // Create directory structure
    const pipelinesDir = path.join(repoPath, '.agent-pipeline', 'pipelines');
    const agentsDir = path.join(repoPath, '.claude', 'agents');

    await fs.mkdir(pipelinesDir, { recursive: true });
    await fs.mkdir(agentsDir, { recursive: true });

    console.log('✅ Created directory structure:');
    console.log(`   - .agent-pipeline/pipelines/`);
    console.log(`   - .claude/agents/\n`);

    // Import plugin agents (default to true)
    let importSummary;
    if (options?.importPluginAgents !== false) {
      importSummary = await AgentImporter.importPluginAgents(agentsDir);
    }

    // Determine which pipelines to create
    const pipelinesToCreate: string[] = ['test-pipeline'];

    // Validate example name if provided
    if (options?.exampleName) {
      if (!AVAILABLE_EXAMPLES.includes(options.exampleName as ExampleName)) {
        throw new Error(
          `Invalid example name: ${options.exampleName}. Available: ${AVAILABLE_EXAMPLES.join(', ')}`
        );
      }
      pipelinesToCreate.push(`${options.exampleName}-example`);
    }

    // Add all examples if --all flag is set
    if (options?.all) {
      for (const example of AVAILABLE_EXAMPLES) {
        const pipelineName = `${example}-example`;
        if (!pipelinesToCreate.includes(pipelineName)) {
          pipelinesToCreate.push(pipelineName);
        }
      }
    }

    // Copy pipeline templates
    console.log('✅ Creating pipelines:');
    for (const pipelineName of pipelinesToCreate) {
      try {
        await copyPipelineTemplate(pipelineName, pipelinesDir);
        console.log(`   - .agent-pipeline/pipelines/${pipelineName}.yml`);
      } catch (error) {
        console.log(`   ⚠️  Could not create ${pipelineName}.yml: ${(error as Error).message}`);
      }
    }
    console.log('');

    // Determine which agents are required by the selected pipelines
    const requiredAgents = await getRequiredAgents(pipelinesToCreate);

    // Check which agents already exist (from plugin import or previous runs)
    const existingAgents = await fs.readdir(agentsDir);
    const existingMdAgents = new Set(
      existingAgents.filter(f => f.endsWith('.md') && !f.startsWith('.'))
    );

    // Determine which agents need to be created
    const agentsToCreate = requiredAgents.filter(agent => !existingMdAgents.has(agent));

    // Create required agents that don't already exist
    if (agentsToCreate.length > 0) {
      const createdAgents = await createRequiredAgents(agentsDir, agentsToCreate);

      if (createdAgents.length > 0) {
        console.log(`✅ Created ${createdAgents.length} fallback agent(s) required by your pipelines:`);
        for (const agent of createdAgents) {
          console.log(`   - .claude/agents/${agent}`);
        }
        console.log('');
      }
    }

    // Update .gitignore
    await updateGitignore(repoPath);

    // Success message
    console.log(`${'='.repeat(60)}`);
    console.log('\n✨ Agent Pipeline initialized successfully!\n');

    // Show what was created
    console.log(`📁 Created ${pipelinesToCreate.length} pipeline(s):`);
    for (const pipeline of pipelinesToCreate) {
      console.log(`   - ${pipeline}.yml`);
    }
    console.log('');

    // Show agent import summary
    if (importSummary && importSummary.imported > 0) {
      console.log(`📦 Imported ${importSummary.imported} agent(s) from Claude Code plugins`);
      if (importSummary.skipped > 0) {
        console.log(`   (${importSummary.skipped} skipped - already exist)`);
      }
      console.log('');
    }

    console.log('Next steps:');
    console.log('  1. Review your pipeline in .agent-pipeline/pipelines/test-pipeline.yml');
    console.log('  2. Customize agents in .claude/agents/');
    console.log('  3. Run your first pipeline: agent-pipeline run test-pipeline');
    if (pipelinesToCreate.includes('post-commit-example')) {
      console.log('  4. Install git hooks (optional): agent-pipeline install post-commit-example');
    }
    console.log(`\n${'='.repeat(60)}\n`);

  } catch (error) {
    console.error('❌ Failed to initialize Agent Pipeline:');
    console.error((error as Error).message);
    throw error;
  }
}

/**
 * Copy a pipeline template to the target directory
 */
async function copyPipelineTemplate(
  templateName: string,
  targetDir: string
): Promise<void> {
  const templatesDir = path.join(__dirname, '../templates/pipelines');
  const templatePath = path.join(templatesDir, `${templateName}.yml`);
  const targetPath = path.join(targetDir, `${templateName}.yml`);

  const templateContent = await fs.readFile(templatePath, 'utf-8');
  await fs.writeFile(targetPath, templateContent, 'utf-8');
}

/**
 * Parse pipeline YAML and extract required agent file names
 */
async function getRequiredAgents(pipelineNames: string[]): Promise<string[]> {
  const templatesDir = path.join(__dirname, '../templates/pipelines');
  const agentSet = new Set<string>();

  for (const pipelineName of pipelineNames) {
    const templatePath = path.join(templatesDir, `${pipelineName}.yml`);

    try {
      const content = await fs.readFile(templatePath, 'utf-8');
      const parsed = YAML.parse(content);

      if (parsed.agents && Array.isArray(parsed.agents)) {
        for (const agent of parsed.agents) {
          if (agent.agent && typeof agent.agent === 'string') {
            // Extract filename from path like ".claude/agents/code-reviewer.md"
            const filename = path.basename(agent.agent);
            agentSet.add(filename);
          }
        }
      }
    } catch (error) {
      console.log(`   ⚠️  Could not parse ${pipelineName}.yml: ${(error as Error).message}`);
    }
  }

  return Array.from(agentSet);
}

/**
 * Default agent templates
 */
const DEFAULT_AGENTS: Record<string, string> = {
    'code-reviewer.md': `# Code Review Agent

You are a code review agent in an automated pipeline.

## Your Task

1. Review the git diff provided in the pipeline context
2. Check for:
   - Code style issues
   - Potential logic errors
   - Best practice violations
   - Code complexity concerns

## Output Format

Use the report_outputs tool with this structure:

\`\`\`javascript
report_outputs({
  outputs: {
    summary: "Reviewed 12 files. Found 5 issues (2 critical, 3 warnings). Main concerns: security in auth.ts, performance in query.ts.",
    issues_found: 5,
    severity_level: "high",
    files_reviewed: 12
  }
})
\`\`\`

**IMPORTANT:** The summary should be up to a few sentences or around 500 words or less, covering:
- What you did (files reviewed, code analyzed)
- Key findings (issue count, severity breakdown)
- Main concerns or critical issues requiring attention

Then provide a detailed summary of your review findings.
`,

    'doc-updater.md': `# Documentation Updater Agent

You are a documentation maintenance agent.

## Your Task

1. Review recent code changes
2. Update relevant documentation files
3. Ensure README.md reflects current state
4. Add inline documentation where missing

## Output Format

Use the report_outputs tool to report your work:

\`\`\`javascript
report_outputs({
  outputs: {
    summary: "Updated documentation across 5 files. Added 3 new API sections to README.md, updated 2 inline code comments, and created CHANGELOG entry for new features.",
    files_updated: 5,
    sections_added: 3,
    inline_docs_added: 2
  }
})
\`\`\`

**IMPORTANT:** The summary should be up to a few sentences or around 500 words or less, covering:
- What you updated (documentation files, sections modified)
- Changes made (new sections, inline docs, examples)
- Areas improved (API docs, README, changelogs)
`,

    'quality-checker.md': `# Quality Checker Agent

You are a code quality analysis agent.

## Your Task

1. Analyze code complexity
2. Check for code smells
3. Identify refactoring opportunities
4. Assess maintainability

## Output Format

Use the report_outputs tool:

\`\`\`javascript
report_outputs({
  outputs: {
    summary: "Analyzed code quality across 8 files. Applied 12 refactoring improvements including 4 error handling additions, 3 variable renames, and 5 code simplifications. Overall quality score improved from 72 to 86.",
    quality_score: 86,
    improvements_made: 12,
    files_analyzed: 8,
    recommendations: 3
  }
})
\`\`\`

**IMPORTANT:** The summary should be up to a few sentences or around 500 words or less, covering:
- What you analyzed (file count, code areas reviewed)
- Quality improvements applied (refactorings, fixes, enhancements)
- Quality score change (before/after)
- Remaining recommendations
`,

    'security-auditor.md': `# Security Auditor Agent

You are a security analysis agent.

## Your Task

1. Scan for common security vulnerabilities
2. Check for exposed secrets or API keys
3. Review authentication and authorization
4. Identify potential injection points

## Output Format

Use the report_outputs tool:

\`\`\`javascript
report_outputs({
  outputs: {
    summary: "Scanned 15 files for security vulnerabilities. Found 2 issues (1 high-severity SQL injection risk in user.ts, 1 medium XSS vulnerability in template.tsx). No exposed secrets detected.",
    vulnerabilities: 2,
    severity: "high",
    files_scanned: 15,
    critical_count: 0
  }
})
\`\`\`

**IMPORTANT:** The summary should be up to a few sentences or around 500 words or less, covering:
- What you scanned (file count, areas analyzed)
- Security issues found (count, severity breakdown)
- Critical vulnerabilities or exposed secrets
- Overall security posture
`,

    'summary.md': `# Summary Agent

You are a pipeline summary agent.

## Your Task

1. Review outputs from previous pipeline stages
2. Create a comprehensive summary
3. Highlight key findings and actions taken

## Output Format

Use the report_outputs tool:

\`\`\`javascript
report_outputs({
  outputs: {
    summary: "Pipeline completed with 4 stages. Code review found 5 issues (2 high-severity), security scan found 0 vulnerabilities, quality checker improved score from 72 to 86. All tests passing. Ready for review.",
    total_stages: 4,
    total_issues: 5,
    overall_status: "success"
  }
})
\`\`\`

**IMPORTANT:** The summary should be up to a few sentences or around 500 words or less, covering:
- What stages completed (count, names)
- Key findings from each stage
- Overall pipeline status
- Next steps or action items

Provide a clear, concise summary of the pipeline execution.
`,

    'context-reducer.md': `# Context Reduction Agent

You are a context summarization agent in an automated Agent Pipeline execution.

## Your Role

Your job is to analyze verbose outputs from previous pipeline stages and create intelligent, concise summaries that preserve all critical information while dramatically reducing token count. You have access to the upcoming agent's definition, so you know exactly what information to preserve.

## Context You Receive

1. **Pipeline Configuration** - Overall pipeline goals and structure
2. **Previous Stages (Full Verbose)** - Complete outputs from all completed stages
3. **Upcoming Agent Definition** - The next agent's prompt and requirements

## Your Task

Create a highly optimized summary that:

### 1. Preserves Critical Information for Next Agent
- Read the upcoming agent's definition carefully
- Identify what information it will need from previous stages
- Ensure ALL relevant data points are preserved in your summary
- Think: "What does the next agent need to succeed?"

### 2. Keeps Numeric Metrics and Measurements
- Counts (files_reviewed, issues_found, tests_passed, etc.)
- Severity levels (critical, high, medium, low)
- Scores and percentages (coverage, quality_score, performance)
- Durations and timestamps (when relevant)

### 3. Preserves Important Decisions and Actions
- What was done in each stage
- What was found or discovered
- What was changed or fixed
- Critical issues or blockers

### 4. Removes Redundant and Verbose Information
- Detailed implementation specifics (unless upcoming agent needs them)
- Repeated information across stages
- Verbose agent reasoning (keep conclusions only)
- File-level details (unless critical to next stage)

### 5. Achieves 70-80% Token Reduction
- Target: Reduce from ~50k tokens → ~10-15k tokens
- Use concise language
- Group similar findings
- Reference file paths instead of inline content when possible

## Output Format

Use the \`report_outputs\` tool with the following structure:

\`\`\`javascript
report_outputs({
  outputs: {
    summary: "High-level overview of entire pipeline execution so far. 2-3 sentences covering: what stages ran, key findings, overall status, and what's important for the next agent to know.",

    critical_findings: [
      "Finding 1: [Stage name] - Brief description of critical issue or important discovery",
      "Finding 2: [Stage name] - Another important item the next agent must know"
    ],

    metrics: {
      "stage-name": {
        "key_metric": 42,
        "severity": "high"
      }
    },

    stage_summaries: {
      "stage-1": "One sentence summary of what this stage did and found.",
      "stage-2": "Focus on information relevant to upcoming agent."
    }
  }
})
\`\`\`

## Best Practices

### DO:
✅ Read the upcoming agent's definition first to understand its needs
✅ Preserve ALL metrics and numbers (they're compact and valuable)
✅ Keep critical findings that could affect downstream stages
✅ Use concise language
✅ Think: "What would I want to know if I were the next agent?"

### DON'T:
❌ Remove information the upcoming agent explicitly needs
❌ Lose numeric data or metrics
❌ Include verbose agent reasoning or thought processes
❌ Repeat the same information across multiple sections
❌ Include implementation details unless upcoming agent needs them

After analyzing all previous stages and the upcoming agent's requirements, provide your optimized summary using the \`report_outputs\` tool.
`
};

/**
 * Create only the required agents that are in the DEFAULT_AGENTS map
 */
async function createRequiredAgents(
  agentsDir: string,
  requiredAgents: string[]
): Promise<string[]> {
  const createdAgents: string[] = [];

  for (const agentFilename of requiredAgents) {
    // Check if we have a template for this agent
    if (DEFAULT_AGENTS[agentFilename]) {
      await fs.writeFile(
        path.join(agentsDir, agentFilename),
        DEFAULT_AGENTS[agentFilename],
        'utf-8'
      );
      createdAgents.push(agentFilename);
    } else {
      // Agent is required but we don't have a template - skip it
      // User will need to import it from plugins or create manually
      console.log(`   ⚠️  Agent ${agentFilename} is required but no template available (import from plugins or create manually)`);
    }
  }

  return createdAgents;
}

/**
 * Update .gitignore to exclude agent-pipeline artifacts
 */
async function updateGitignore(repoPath: string): Promise<void> {
  const gitignorePath = path.join(repoPath, '.gitignore');
  const agentPipelineEntry = `
# Agent Pipeline
.agent-pipeline/state/
`;

  try {
    let gitignoreContent = '';
    try {
      gitignoreContent = await fs.readFile(gitignorePath, 'utf-8');
    } catch {
      // .gitignore doesn't exist, will create new one
    }

    if (!gitignoreContent.includes('.agent-pipeline/state/')) {
      await fs.appendFile(gitignorePath, agentPipelineEntry, 'utf-8');
    }
  } catch (error) {
    // Silently fail if can't update .gitignore
  }
}
