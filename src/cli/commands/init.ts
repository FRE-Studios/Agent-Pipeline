// src/cli/commands/init.ts - Enhanced with plugin agent import

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';


// @claude should we put the agent file import code in a different place 

interface ImportedAgent {
  originalPath: string;
  marketplace: string;
  plugin: string;
  agentName: string;
  targetName: string;
}

function getClaudePluginsBasePath(): string {
  const platform = os.platform();
  const homeDir = os.homedir();
  
  switch (platform) {
    case 'darwin': // macOS
      return path.join(homeDir, '.claude', 'plugins', 'marketplaces');
    
    case 'win32': // Windows
      return path.join(homeDir, 'AppData', 'Roaming', 'Claude', 'plugins', 'marketplaces');
    
    case 'linux':
    default:
      return path.join(homeDir, '.claude', 'plugins', 'marketplaces');
  }
}

async function discoverPluginAgents(): Promise<ImportedAgent[]> {
  const basePath = getClaudePluginsBasePath();
  const discoveredAgents: ImportedAgent[] = [];

  try {
    // Check if plugins directory exists
    await fs.access(basePath);
  } catch {
    console.log(`ℹ️  No Claude Code plugins found at: ${basePath}`);
    return [];
  }

  try {
    // Iterate through marketplaces
    const marketplaces = await fs.readdir(basePath);
    
    for (const marketplace of marketplaces) {
      const marketplacePath = path.join(basePath, marketplace, 'plugins');
      
      try {
        // Iterate through plugins in this marketplace
        const plugins = await fs.readdir(marketplacePath);
        
        for (const plugin of plugins) {
          const agentsPath = path.join(marketplacePath, plugin, 'agents');
          
          try {
            // Check if agents directory exists
            const agentFiles = await fs.readdir(agentsPath);
            const mdFiles = agentFiles.filter(f => f.endsWith('.md'));
            
            for (const agentFile of mdFiles) {
              const agentName = path.basename(agentFile, '.md');
              discoveredAgents.push({
                originalPath: path.join(agentsPath, agentFile),
                marketplace,
                plugin,
                agentName,
                // Create a unique name to avoid conflicts
                targetName: `${plugin}-${agentName}.md`
              });
            }
          } catch {
            // No agents directory in this plugin
          }
        }
      } catch {
        // Could not read plugins directory for this marketplace
      }
    }
  } catch (error) {
    console.log(`⚠️  Error scanning for plugins: ${(error as Error).message}`);
  }

  return discoveredAgents;
}

async function importPluginAgents(targetAgentsDir: string): Promise<void> {
  console.log('\n📦 Searching for Claude Code plugin agents...');
  
  const agents = await discoverPluginAgents();
  
  if (agents.length === 0) {
    console.log('   No plugin agents found to import.\n');
    return;
  }

  console.log(`   Found ${agents.length} agent(s) across installed plugins\n`);
  
  // Group agents by marketplace and plugin for better display
  const grouped = agents.reduce((acc, agent) => {
    const key = `${agent.marketplace}/${agent.plugin}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(agent);
    return acc;
  }, {} as Record<string, ImportedAgent[]>);

  // Import agents and show progress
  let imported = 0;
  let skipped = 0;
  
  for (const [key, pluginAgents] of Object.entries(grouped)) {
    console.log(`   📂 ${key}:`);
    
    for (const agent of pluginAgents) {
      const targetPath = path.join(targetAgentsDir, agent.targetName);
      
      try {
        // Check if target already exists
        try {
          await fs.access(targetPath);
          console.log(`      ⏭️  ${agent.agentName} (already exists, skipping)`);
          skipped++;
          continue;
        } catch {
          // File doesn't exist, good to import
        }
        
        // Read the original agent file
        const content = await fs.readFile(agent.originalPath, 'utf-8');
        
        // Add metadata header to imported agent
        const enhancedContent = `<!-- 
Imported from Claude Code Plugin
Marketplace: ${agent.marketplace}
Plugin: ${agent.plugin}
Original: ${agent.agentName}.md
Imported: ${new Date().toISOString()}
-->

${content}`;
        
        await fs.writeFile(targetPath, enhancedContent, 'utf-8');
        console.log(`      ✅ ${agent.agentName}`);
        imported++;
      } catch (error) {
        console.log(`      ❌ ${agent.agentName} (${(error as Error).message})`);
      }
    }
  }
  
  // Create import manifest for tracking
  const manifestPath = path.join(targetAgentsDir, '.import-manifest.json');
  const manifest = {
    importedAt: new Date().toISOString(),
    pluginsPath: getClaudePluginsBasePath(),
    summary: {
      total: agents.length,
      imported,
      skipped
    },
    agents: agents.map(a => ({
      marketplace: a.marketplace,
      plugin: a.plugin,
      original: a.agentName,
      target: a.targetName
    }))
  };
  
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  
  console.log(`\n   📊 Import complete: ${imported} imported, ${skipped} skipped\n`);
}

// @claude instead of using the auto imported agents we'll build a standard on init pipeline
// we'll use our packaged agents and init pipeline instead of creating in line 

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
      await importPluginAgents(agentsDir);
    }

    // Create example pipeline with imported agents if any exist
    const existingAgents = await fs.readdir(agentsDir);
    const mdAgents = existingAgents.filter(f => f.endsWith('.md') && !f.startsWith('.'));
    
    let examplePipeline: string;
    
    if (mdAgents.length > 0) {
      // Create pipeline using imported agents
      const firstAgent = mdAgents[0];
      const secondAgent = mdAgents[1] || mdAgents[0];
      
      examplePipeline = `name: example-pipeline
trigger: manual

settings:
  autoCommit: true
  commitPrefix: "[pipeline:{{stage}}]"
  failureStrategy: stop
  executionMode: parallel

# This pipeline uses agents imported from your Claude Code plugins
agents:
  - name: stage-1
    agent: .claude/agents/${firstAgent}
    timeout: 120
    outputs:
      - result
      - status

  - name: stage-2
    agent: .claude/agents/${secondAgent}
    dependsOn:
      - stage-1
    condition: "{{ stages.stage-1.outputs.status == 'success' }}"
`;
    } else {
      // Use default example pipeline
      examplePipeline = `name: example-pipeline
trigger: manual

settings:
  autoCommit: true
  commitPrefix: "[pipeline:{{stage}}]"
  failureStrategy: stop

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
    }

    const pipelinePath = path.join(pipelinesDir, 'example-pipeline.yml');
    await fs.writeFile(pipelinePath, examplePipeline, 'utf-8');

    console.log('✅ Created example pipeline:');
    console.log(`   - .agent-pipeline/pipelines/example-pipeline.yml\n`);

    // Only create default agents if no agents were imported
    if (mdAgents.length === 0) {
      // ... existing code to create default agents ...
      console.log('✅ Created example agents:');
      console.log(`   - .claude/agents/code-reviewer.md`);
      console.log(`   - .claude/agents/doc-updater.md\n`);
    }

    // ... rest of existing code (gitignore, success message, etc.) ...

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
    console.log('  1. Review the example pipeline: .agent-pipeline/pipelines/example-pipeline.yml');
    console.log('  2. Customize or use imported agents in .claude/agents/');
    console.log('  3. Run your first pipeline: agent-pipeline run example-pipeline');
    console.log('  4. Install git hooks (optional): agent-pipeline install example-pipeline');
    console.log(`\n${'='.repeat(60)}\n`);

  } catch (error) {
    console.error('❌ Failed to initialize Agent Pipeline:');
    console.error((error as Error).message);
    throw error;
  }
}