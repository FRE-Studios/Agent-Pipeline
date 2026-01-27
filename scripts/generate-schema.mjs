#!/usr/bin/env node

import { createGenerator } from 'ts-json-schema-generator';
import { writeFile, mkdir } from 'fs/promises';
import * as YAML from 'yaml';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');

const config = {
  path: path.join(projectRoot, 'src/config/schema.ts'),
  tsconfig: path.join(projectRoot, 'tsconfig.json'),
  type: 'PipelineConfig',
  skipTypeCheck: true,
};

async function generateSchema() {
  const generator = createGenerator(config);
  const schema = generator.createSchema(config.type);

  // Add metadata
  schema.$schema = 'http://json-schema.org/draft-07/schema#';
  schema.title = 'Agent Pipeline Configuration';
  schema.description = 'Schema for .agent-pipeline/pipelines/*.yml configuration files';

  const schemaDir = path.join(projectRoot, 'src/cli/templates/schema');
  await mkdir(schemaDir, { recursive: true });

  // Write JSON
  const jsonPath = path.join(schemaDir, 'pipeline-config.schema.json');
  await writeFile(jsonPath, JSON.stringify(schema, null, 2), 'utf-8');

  // Write YAML
  const yamlPath = path.join(schemaDir, 'pipeline-config.schema.yaml');
  await writeFile(yamlPath, YAML.stringify(schema, { indent: 2 }), 'utf-8');

  console.log('✅ Generated pipeline config schema (JSON + YAML)');
}

generateSchema().catch((error) => {
  console.error('Failed to generate schema:', error.message);
  process.exitCode = 1;
});
