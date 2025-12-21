// src/cli/hooks.ts

import * as fs from 'fs/promises';
import * as path from 'path';

export class HookInstaller {
  constructor(private repoPath: string) {}

  async install(pipelineName: string, hookType: string): Promise<void> {
    const hookPath = path.join(this.repoPath, '.git', 'hooks', hookType);

    // Check if hook already exists
    let existingHook = '';
    try {
      existingHook = await fs.readFile(hookPath, 'utf-8');
    } catch {
      // File doesn't exist, that's fine
    }

    // Generate hook script
    const hookScript = this.generateHookScript(pipelineName);

    // Check if this specific pipeline is already installed in this hook
    const hookMarker = `# Agent Pipeline (${hookType}): ${pipelineName}`;

    if (existingHook) {
      // Check if already installed
      if (existingHook.includes(hookMarker)) {
        console.log(`⚠️  Agent Pipeline already installed for ${pipelineName} on ${hookType}`);
        return;
      }

      // Append to existing hook
      const combinedHook = `${existingHook}\n\n${hookMarker}\n${hookScript}`;
      await fs.writeFile(hookPath, combinedHook, 'utf-8');
    } else {
      // Create new hook
      await fs.writeFile(hookPath, `#!/bin/bash\n\n${hookMarker}\n${hookScript}`, 'utf-8');
    }

    // Make executable
    await fs.chmod(hookPath, 0o755);

    console.log(`✅ ${hookType} hook installed`);
    console.log(`   Pipeline: ${pipelineName}`);
    console.log(`   Hook: .git/hooks/${hookType}`);
  }

  async uninstall(hookType?: string): Promise<void> {
    // If hookType specified, only uninstall from that hook
    // Otherwise, check all common hook types
    const hookTypes = hookType
      ? [hookType]
      : ['pre-commit', 'post-commit', 'pre-push', 'post-merge'];

    let uninstalledCount = 0;

    for (const type of hookTypes) {
      const hookPath = path.join(this.repoPath, '.git', 'hooks', type);

      try {
        const content = await fs.readFile(hookPath, 'utf-8');

        // Remove agent-pipeline sections
        const lines = content.split('\n');
        const filtered = [];
        let inPipelineSection = false;
        let blankLineCount = 0;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];

          if (line.includes('# Agent Pipeline')) {
            inPipelineSection = true;
            blankLineCount = 0;
            continue;
          }

          if (inPipelineSection) {
            if (line.trim() === '') {
              blankLineCount++;
              // End section after 2 consecutive blank lines or if at end of file
              if (blankLineCount >= 2 || i === lines.length - 1) {
                inPipelineSection = false;
                blankLineCount = 0;
              }
              continue;
            } else {
              // Non-blank line, reset blank counter and skip
              blankLineCount = 0;
              continue;
            }
          }

          filtered.push(line);
        }

        const newContent = filtered.join('\n').trim();

        if (newContent === '#!/bin/bash' || !newContent) {
          // Hook only had agent-pipeline, remove it
          await fs.unlink(hookPath);
          console.log(`✅ ${type} hook removed (was only agent-pipeline)`);
          uninstalledCount++;
        } else {
          // Other hooks exist, just remove our section
          await fs.writeFile(hookPath, newContent, 'utf-8');
          console.log(`✅ Agent Pipeline section removed from ${type} hook`);
          uninstalledCount++;
        }
      } catch (error) {
        // Hook doesn't exist or can't be read, skip silently
        continue;
      }
    }

    if (uninstalledCount === 0) {
      console.log('ℹ️  No Agent Pipeline hooks found to uninstall');
    }
  }

  private generateHookScript(pipelineName: string): string {
    return `# Skip if last commit was created by Agent Pipeline
if git log -1 --pretty=%B | grep -Eq "^(\\[pipeline:|Pipeline-Run-ID:)"; then
  exit 0
fi

# Prevent overlapping runs for the same pipeline
lockDir=".agent-pipeline/locks"
lockPath="$lockDir/${pipelineName}.lock"

mkdir -p "$lockDir"

if [ -f "$lockPath/pid" ]; then
  oldPid=$(cat "$lockPath/pid")
  if ! kill -0 "$oldPid" 2>/dev/null; then
    rm -rf "$lockPath"
  fi
fi

if ! mkdir "$lockPath" 2>/dev/null; then
  exit 0
fi

# Run Agent Pipeline in background to avoid blocking
nohup npx agent-pipeline run ${pipelineName} > /dev/null 2>&1 &
pipelinePid=$!
echo "$pipelinePid" > "$lockPath/pid"

( wait "$pipelinePid"; rm -rf "$lockPath" ) >/dev/null 2>&1 &

# Optional: Notify user
echo "🤖 Agent Pipeline running in background (${pipelineName})"`;
  }
}
