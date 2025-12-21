// src/cli/commands/uninstall.ts

import { HookInstaller } from '../hooks.js';

export async function uninstallCommand(
  repoPath: string,
  options?: { pipelineName?: string; removeAll?: boolean }
): Promise<void> {
  const installer = new HookInstaller(repoPath);
  await installer.uninstall({
    pipelineName: options?.pipelineName,
    removeAll: options?.removeAll ?? !options?.pipelineName
  });
}
