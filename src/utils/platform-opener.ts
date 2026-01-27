// src/utils/platform-opener.ts

import { spawn } from 'child_process';
import * as os from 'os';

export type OpenTarget = 'file' | 'url' | 'directory';

/**
 * Get the platform-specific command for opening files/URLs
 */
function getOpenCommand(): string {
  const platform = os.platform();
  switch (platform) {
    case 'darwin':
      return 'open';
    case 'win32':
      return 'start';
    default: // linux, freebsd, etc.
      return 'xdg-open';
  }
}

/**
 * Opens a file, directory, or URL using the system default handler
 */
export async function openWithSystem(target: string, _type: OpenTarget = 'file'): Promise<void> {
  const command = getOpenCommand();
  const platform = os.platform();

  // Windows 'start' needs special handling
  const args = platform === 'win32'
    ? ['', target] // empty string for title in start command
    : [target];

  const child = spawn(command, args, {
    stdio: 'ignore',
    detached: true,
    shell: platform === 'win32' // Windows needs shell for 'start'
  });

  // Allow the process to run independently
  child.unref();

  // Brief wait to catch immediate errors
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    setTimeout(resolve, 100);
  });
}

/**
 * Opens a file in the system pager (less, more, etc.)
 * Returns a promise that resolves when the pager closes
 */
export async function openInPager(filePath: string): Promise<void> {
  const pager = process.env.PAGER || 'less';
  const { command, args } = parseCommand(pager);

  const child = spawn(command, [...args, filePath], { stdio: 'inherit' });

  return new Promise((resolve) => {
    child.on('exit', () => resolve());
    child.on('error', () => resolve());
  });
}

function parseCommand(input: string): { command: string; args: string[] } {
  const parts: string[] = [];
  const regex = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(input)) !== null) {
    parts.push(match[1] ?? match[2] ?? match[3]);
  }

  if (parts.length === 0) {
    return { command: 'less', args: [] };
  }

  return { command: parts[0], args: parts.slice(1) };
}
