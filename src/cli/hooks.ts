// src/cli/hooks.ts

import * as fs from 'fs/promises';
import * as path from 'path';

export class HookInstaller {
  constructor(private repoPath: string) {}

  async install(pipelineName: string): Promise<void> {
    const hookPath = path.join(this.repoPath, '.git', 'hooks', 'post-commit');

    // Check if hook already exists
    let existingHook = '';
    try {
      existingHook = await fs.readFile(hookPath, 'utf-8');
    } catch {
      // File doesn't exist, that's fine
    }

    // Generate hook script
    const hookScript = this.generateHookScript(pipelineName);

    if (existingHook) {
      // Check if already installed
      if (existingHook.includes('agent-pipeline')) {
        console.log('⚠️  Agent Pipeline hook already installed');
        return;
      }

      // Append to existing hook
      const combinedHook = `${existingHook}\n\n# Agent Pipeline\n${hookScript}`;
      await fs.writeFile(hookPath, combinedHook, 'utf-8');
    } else {
      // Create new hook
      await fs.writeFile(hookPath, `#!/bin/bash\n\n${hookScript}`, 'utf-8');
    }

    // Make executable
    await fs.chmod(hookPath, 0o755);

    console.log('✅ Post-commit hook installed');
    console.log(`   Pipeline: ${pipelineName}`);
    console.log(`   Hook: .git/hooks/post-commit`);
  }

  async uninstall(): Promise<void> {
    const hookPath = path.join(this.repoPath, '.git', 'hooks', 'post-commit');

    try {
      const content = await fs.readFile(hookPath, 'utf-8');

      // Remove agent-pipeline section
      const lines = content.split('\n');
      const filtered = [];
      let inPipelineSection = false;

      for (const line of lines) {
        if (line.includes('# Agent Pipeline')) {
          inPipelineSection = true;
          continue;
        }
        if (inPipelineSection && line.trim() === '') {
          inPipelineSection = false;
          continue;
        }
        if (inPipelineSection) {
          continue;
        }
        filtered.push(line);
      }

      const newContent = filtered.join('\n').trim();

      if (newContent === '#!/bin/bash' || !newContent) {
        // Hook only had agent-pipeline, remove it
        await fs.unlink(hookPath);
        console.log('✅ Hook removed (was only agent-pipeline)');
      } else {
        // Other hooks exist, just remove our section
        await fs.writeFile(hookPath, newContent, 'utf-8');
        console.log('✅ Agent Pipeline section removed from hook');
      }
    } catch (error) {
      console.log('ℹ️  No hook found to uninstall');
    }
  }

  private generateHookScript(pipelineName: string): string {
    return `# Run Agent Pipeline in background to avoid blocking
nohup npx agent-pipeline run ${pipelineName} > /dev/null 2>&1 &

# Optional: Notify user
echo "🤖 Agent Pipeline running in background (${pipelineName})"`;
  }
}
