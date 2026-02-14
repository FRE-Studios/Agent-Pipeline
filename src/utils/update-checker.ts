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

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

function parseSemver(version: string): ParsedSemver | null {
  const cleaned = version.trim().replace(/^v/, '');
  const [coreAndPre] = cleaned.split('+');
  const [core, prerelease = ''] = coreAndPre.split('-', 2);
  const coreParts = core.split('.');

  if (coreParts.length > 3) return null;

  const major = Number(coreParts[0] ?? 0);
  const minor = Number(coreParts[1] ?? 0);
  const patch = Number(coreParts[2] ?? 0);

  if ([major, minor, patch].some((n) => !Number.isInteger(n) || n < 0)) {
    return null;
  }

  return {
    major,
    minor,
    patch,
    prerelease: prerelease ? prerelease.split('.') : [],
  };
}

function comparePrerelease(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;

  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const idA = a[i];
    const idB = b[i];

    if (idA === undefined) return -1;
    if (idB === undefined) return 1;
    if (idA === idB) continue;

    const isNumA = /^\d+$/.test(idA);
    const isNumB = /^\d+$/.test(idB);

    if (isNumA && isNumB) {
      const numA = Number(idA);
      const numB = Number(idB);
      if (numA < numB) return -1;
      if (numA > numB) return 1;
      continue;
    }

    if (isNumA && !isNumB) return -1;
    if (!isNumA && isNumB) return 1;

    if (idA < idB) return -1;
    if (idA > idB) return 1;
  }

  return 0;
}

/** Compare two semver strings. Returns -1 (a<b), 0 (a==b), or 1 (a>b). */
export function compareSemver(a: string, b: string): number {
  const parsedA = parseSemver(a);
  const parsedB = parseSemver(b);

  // Treat invalid versions as equal to avoid false-positive update prompts.
  if (!parsedA || !parsedB) return 0;

  if (parsedA.major < parsedB.major) return -1;
  if (parsedA.major > parsedB.major) return 1;

  if (parsedA.minor < parsedB.minor) return -1;
  if (parsedA.minor > parsedB.minor) return 1;

  if (parsedA.patch < parsedB.patch) return -1;
  if (parsedA.patch > parsedB.patch) return 1;

  return comparePrerelease(parsedA.prerelease, parsedB.prerelease);
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
    timeout.unref?.();

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
  const skipArgs = ['--version', '-v', '--help', '-h', 'help', 'history'];
  return args.some((arg) => skipArgs.includes(arg));
}
