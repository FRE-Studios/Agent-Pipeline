// src/cli/commands/init.ts - Refactored to use AgentImporter and templates

import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { AgentImporter } from '../utils/agent-importer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function initCommand(
  repoPath: string,
  options?: {
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
    if (options?.importPluginAgents !== false) {
      await AgentImporter.importPluginAgents(agentsDir);
    }

    // Copy example pipeline templates to pipelines directory
    const templatesDir = path.join(__dirname, '../templates/pipelines');
    const templateFiles = [
      'post-commit-example.yml',
      'pre-commit-example.yml',
      'pre-push-example.yml',
      'post-merge-example.yml'
    ];

    console.log('✅ Creating example pipelines:');
    for (const templateFile of templateFiles) {
      const templatePath = path.join(templatesDir, templateFile);
      const targetPath = path.join(pipelinesDir, templateFile);

      try {
        const templateContent = await fs.readFile(templatePath, 'utf-8');
        await fs.writeFile(targetPath, templateContent, 'utf-8');
        console.log(`   - .agent-pipeline/pipelines/${templateFile}`);
      } catch (error) {
        console.log(`   ⚠️  Could not create ${templateFile}: ${(error as Error).message}`);
      }
    }
    console.log('');

    //TODO to do 
    //FIXME:
    //ensure we pacakge agents in the dir and review these fallback agents 

    // Create minimal example agents if no agents were imported
    const existingAgents = await fs.readdir(agentsDir);
    const mdAgents = existingAgents.filter(f => f.endsWith('.md') && !f.startsWith('.'));

    if (mdAgents.length === 0) {
      await createDefaultAgents(agentsDir);
      console.log('✅ Created example agents:');
      console.log(`   - .claude/agents/code-reviewer.md`);
      console.log(`   - .claude/agents/doc-updater.md`);
      console.log(`   - .claude/agents/quality-checker.md`);
      console.log(`   - .claude/agents/security-auditor.md`);
      console.log(`   - .claude/agents/summary.md\n`);
    }

    // Update .gitignore
    await updateGitignore(repoPath);

    // Success message
    console.log(`${'='.repeat(60)}`);
    console.log('\n✨ Agent Pipeline initialized successfully!\n');

    if (mdAgents.length > 0) {
      console.log(`📦 Imported ${mdAgents.length} agent(s) from Claude Code plugins:`);
      mdAgents.slice(0, 5).forEach(agent => {
        console.log(`   - ${agent}`);
      });
      if (mdAgents.length > 5) {
        console.log(`   ... and ${mdAgents.length - 5} more`);
      }
      console.log('');
    }

    console.log('Next steps:');
    console.log('  1. Review the example pipelines in .agent-pipeline/pipelines/');
    console.log('  2. Customize or use imported agents in .claude/agents/');
    console.log('  3. Run your first pipeline: agent-pipeline run post-commit-example');
    console.log('  4. Install git hooks (optional): agent-pipeline install post-commit-example');
    console.log(`\n${'='.repeat(60)}\n`);

  } catch (error) {
    console.error('❌ Failed to initialize Agent Pipeline:');
    console.error((error as Error).message);
    throw error;
  }
}

/**
 * Create minimal default agents for first-time users
 */
async function createDefaultAgents(agentsDir: string): Promise<void> {
  const agents = {
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
`
  };

  for (const [filename, content] of Object.entries(agents)) {
    await fs.writeFile(path.join(agentsDir, filename), content, 'utf-8');
  }
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
