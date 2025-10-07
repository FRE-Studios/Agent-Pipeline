// src/cli/commands/init.ts

import * as fs from 'fs/promises';
import * as path from 'path';

export async function initCommand(repoPath: string): Promise<void> {
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

    // Create example pipeline
    const examplePipeline = `name: example-pipeline
trigger: manual

settings:
  autoCommit: true
  commitPrefix: "[pipeline:{{stage}}]"
  failureStrategy: stop
  preserveWorkingTree: false

agents:
  - name: code-review
    agent: .claude/agents/code-reviewer.md
    timeout: 120
    outputs:
      - issues_found
      - severity_level

  - name: doc-updater
    agent: .claude/agents/doc-updater.md
    onFail: continue
`;

    const pipelinePath = path.join(pipelinesDir, 'example-pipeline.yml');
    await fs.writeFile(pipelinePath, examplePipeline, 'utf-8');

    console.log('✅ Created example pipeline:');
    console.log(`   - .agent-pipeline/pipelines/example-pipeline.yml\n`);

    // Create example agents
    const codeReviewerAgent = `# Code Review Agent

You are a code review agent in an automated pipeline.

## Your Task

Review the code changes in the current git repository and provide feedback on:

1. **Code Quality**: Check for code style, readability, and best practices
2. **Potential Bugs**: Identify any logic errors or potential issues
3. **Security**: Look for security vulnerabilities or concerns
4. **Performance**: Suggest optimizations if applicable

## Output Format

Please provide your findings in the following format:

\`\`\`
issues_found: <number>
severity_level: <high|medium|low>

### Findings:
- [Issue description]
- [Issue description]

### Recommendations:
- [Recommendation]
- [Recommendation]
\`\`\`

## Context

You have access to the git repository and can see all changes.
Focus on providing actionable, constructive feedback.
`;

    const docUpdaterAgent = `# Documentation Updater Agent

You are a documentation management agent in an automated pipeline.

## Your Task

Review the code changes and update relevant documentation:

1. **README Updates**: Check if README.md needs updates based on changes
2. **Code Comments**: Ensure code has appropriate inline documentation
3. **API Documentation**: Update API docs if public interfaces changed
4. **Changelog**: Note significant changes

## Output Format

Provide a summary of documentation updates made:

\`\`\`
Documentation Updates:
- [File updated]: [Description of changes]
- [File updated]: [Description of changes]
\`\`\`

## Guidelines

- Be concise but comprehensive
- Follow existing documentation style
- Focus on user-facing changes
- Update examples if needed
`;

    const codeReviewerPath = path.join(agentsDir, 'code-reviewer.md');
    const docUpdaterPath = path.join(agentsDir, 'doc-updater.md');

    await fs.writeFile(codeReviewerPath, codeReviewerAgent, 'utf-8');
    await fs.writeFile(docUpdaterPath, docUpdaterAgent, 'utf-8');

    console.log('✅ Created example agents:');
    console.log(`   - .claude/agents/code-reviewer.md`);
    console.log(`   - .claude/agents/doc-updater.md\n`);

    // Create .gitignore if it doesn't exist
    const gitignorePath = path.join(repoPath, '.gitignore');
    let gitignoreContent = '';

    try {
      gitignoreContent = await fs.readFile(gitignorePath, 'utf-8');
    } catch {
      // File doesn't exist, that's ok
    }

    if (!gitignoreContent.includes('.agent-pipeline/state/')) {
      const agentPipelineIgnore = `
# Agent Pipeline
.agent-pipeline/state/
`;
      await fs.writeFile(
        gitignorePath,
        gitignoreContent + agentPipelineIgnore,
        'utf-8'
      );
      console.log('✅ Updated .gitignore\n');
    }

    console.log(`${'='.repeat(60)}`);
    console.log('\n✨ Agent Pipeline initialized successfully!\n');
    console.log('Next steps:');
    console.log('  1. Review the example pipeline: .agent-pipeline/pipelines/example-pipeline.yml');
    console.log('  2. Customize the example agents in .claude/agents/');
    console.log('  3. Run your first pipeline: agent-pipeline run example-pipeline');
    console.log('  4. Install git hooks (optional): agent-pipeline install example-pipeline');
    console.log(`\n${'='.repeat(60)}\n`);

  } catch (error) {
    console.error('❌ Failed to initialize Agent Pipeline:');
    console.error((error as Error).message);
    throw error;
  }
}
