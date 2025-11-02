#!/usr/bin/env node

import { cp, mkdir, access } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.join(__dirname, '..');
const sourceDir = path.join(projectRoot, 'src', 'cli', 'templates');
const targetDir = path.join(projectRoot, 'dist', 'cli', 'templates');

async function ensureSourceExists() {
  try {
    await access(sourceDir);
  } catch {
    throw new Error(`Template source directory not found: ${sourceDir}`);
  }
}

async function copyTemplates() {
  await ensureSourceExists();
  await mkdir(path.dirname(targetDir), { recursive: true });
  await cp(sourceDir, targetDir, { recursive: true });
}

copyTemplates()
  .then(() => {
    console.log('✅ Copied CLI templates to dist/cli/templates/');
  })
  .catch(error => {
    console.error('❌ Failed to copy CLI templates:', error.message);
    process.exitCode = 1;
  });
