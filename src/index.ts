#!/usr/bin/env node

// src/index.ts - CLI entry point

// Check Node.js version before any imports
const nodeVersion = process.version;
const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
if (majorVersion < 18) {
  console.error(`Node.js 18+ required. Current: ${nodeVersion}`);
  console.error(`   Upgrade: https://nodejs.org/`);
  console.error(`   Or with nvm: nvm install 18`);
  process.exit(1);
}

import { createProgram, CommanderError } from './cli/program.js';
import { Logger } from './utils/logger.js';

async function main() {
  try {
    const program = await createProgram();
    await program.parseAsync(process.argv);
  } catch (error) {
    if (error instanceof CommanderError) {
      // Commander throws for --help and --version with exitOverride(); these are not errors
      if (error.code === 'commander.helpDisplayed' || error.code === 'commander.version') {
        return;
      }
      // Commander error messages (missing arg, unknown command) are already printed
      process.exit(error.exitCode);
    }
    Logger.error((error as Error).message);
    if (process.env.DEBUG) {
      console.error(error);
    }
    process.exit(1);
  }
}

main();
