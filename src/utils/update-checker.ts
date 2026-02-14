// src/utils/update-checker.ts - Non-blocking npm update checker with 24h cache

import * as fs from 'fs/promises';
import * as path from 'path';
import os from 'os';
import chalk from 'chalk';

export interface UpdateCheckResult {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
}

interface UpdateCache {
  lastCheck: number;
  latestVersion: string;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_TIMEOUT_MS = 5000;
const REGISTRY_URL = 'https://registry.npmjs.org/agent-pipeline/latest';

/** Compare two semver strings. Returns -1 (a<b), 0 (a==b), or 1 (a>b). */
export function compareSemver(a: string, b: string): number {
  const partsA = a.replace(/^v/, '').split('.').map(Number);
  const partsB = b.replace(/^v/, '').split('.').map(Number);
  const len = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < len; i++) {
    const segA = partsA[i] ?? 0;
    const segB = partsB[i] ?? 0;
    if (segA < segB) return -1;
    if (segA > segB) return 1;
  }
  return 0;
}

export function getCacheDir(): string {
  return path.join(os.homedir(), '.agent-pipeline');
}

export function getCacheFile(): string {
  return path.join(getCacheDir(), 'update-check.json');
}

export async function readCache(): Promise<UpdateCache | null> {
  try {
    const data = JSON.parse(await fs.readFile(getCacheFile(), 'utf-8'));
    if (typeof data.lastCheck === 'number' && typeof data.latestVersion === 'string') {
      return data as UpdateCache;
    }
    return null;
  } catch {
    return null;
  }
}

export async function writeCache(cache: UpdateCache): Promise<void> {
  try {
    await fs.mkdir(getCacheDir(), { recursive: true });
    await fs.writeFile(getCacheFile(), JSON.stringify(cache), 'utf-8');
  } catch {
    // Silently ignore write failures
  }
}

export async function fetchLatestVersion(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(REGISTRY_URL, { signal: controller.signal });
      if (!response.ok) return null;
      const data = (await response.json()) as Record<string, unknown>;
      return typeof data.version === 'string' ? data.version : null;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return null;
  }
}

export async function checkForUpdate(currentVersion: string): Promise<UpdateCheckResult | null> {
  try {
    const cache = await readCache();
    const now = Date.now();

    // Use cached version if fresh
    if (cache && (now - cache.lastCheck) < CACHE_TTL_MS) {
      return {
        updateAvailable: compareSemver(currentVersion, cache.latestVersion) < 0,
        currentVersion,
        latestVersion: cache.latestVersion,
      };
    }

    // Fetch from registry
    const latestVersion = await fetchLatestVersion();
    if (!latestVersion) return null;

    await writeCache({ lastCheck: now, latestVersion });

    return {
      updateAvailable: compareSemver(currentVersion, latestVersion) < 0,
      currentVersion,
      latestVersion,
    };
  } catch {
    return null;
  }
}

export function formatUpdateNotification(result: UpdateCheckResult): string {
  const line = '──────────────────────────────────────────────────';
  return [
    '',
    chalk.yellow(line),
    chalk.yellow(`  Update available: ${result.currentVersion} → ${chalk.green(result.latestVersion)}`),
    chalk.yellow(`  Run \`npm install -g agent-pipeline\` to update`),
    chalk.yellow(line),
    '',
  ].join('\n');
}

export function shouldSkipCheck(args: string[]): boolean {
  if (process.env.CI || process.env.NO_UPDATE_CHECK) return true;
  const skipArgs = ['--version', '-v', '--help', '-h', 'help'];
  return args.some((arg) => skipArgs.includes(arg));
}
