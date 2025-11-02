// src/utils/gh-cli-checker.ts

import { spawn } from 'child_process';

/**
 * Result of checking GitHub CLI installation and authentication status.
 */
export interface GHCLIStatus {
  installed: boolean;
  authenticated: boolean;
}

/**
 * Executes a gh CLI command using spawn and returns the output.
 * @param args An array of string arguments for the gh command.
 * @returns A promise that resolves with the command's stdout.
 */
function executeGhCommand(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const process = spawn('gh', args);
    let stdout = '';
    let stderr = '';

    process.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    process.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        // Use stderr for the error message if available
        const errorMessage = stderr || stdout || 'Unknown error';
        reject(new Error(`gh command failed with exit code ${code}: ${errorMessage}`));
      }
    });

    process.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Check if GitHub CLI is installed and authenticated.
 *
 * This function performs two checks:
 * 1. Checks if `gh` CLI is installed by running `gh --version`
 * 2. If installed, checks if authenticated by running `gh auth status`
 *
 * @returns Promise resolving to installation and authentication status
 *
 * @example
 * ```typescript
 * const status = await checkGHCLI();
 * if (!status.installed) {
 *   console.log('Install gh from https://cli.github.com/');
 * } else if (!status.authenticated) {
 *   console.log('Run: gh auth login');
 * }
 * ```
 */
export async function checkGHCLI(): Promise<GHCLIStatus> {
  try {
    // Check if gh is installed
    await executeGhCommand(['--version']);

    // Check if authenticated
    try {
      await executeGhCommand(['auth', 'status']);
      return { installed: true, authenticated: true };
    } catch {
      return { installed: true, authenticated: false };
    }
  } catch {
    return { installed: false, authenticated: false };
  }
}
