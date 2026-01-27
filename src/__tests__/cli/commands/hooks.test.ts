import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { hooksCommand } from '../../../cli/commands/hooks.js';
import { createTempDir, cleanupTempDir } from '../../setup.js';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('hooksCommand', () => {
  let tempDir: string;
  let hooksDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir('hooks-command-test-');
    hooksDir = path.join(tempDir, '.git', 'hooks');
    await fs.mkdir(hooksDir, { recursive: true });
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
    vi.clearAllMocks();
  });

  async function createHookFile(hookType: string, content: string): Promise<void> {
    await fs.writeFile(path.join(hooksDir, hookType), content, 'utf-8');
  }

  describe('No Hooks Installed', () => {
    it('should show message when no hooks installed', async () => {
      await hooksCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith('No Agent Pipeline hooks installed');
    });

    it('should show message when hooks dir does not exist', async () => {
      await fs.rm(hooksDir, { recursive: true });

      await hooksCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith('No Agent Pipeline hooks installed');
    });

    it('should show message when hook files exist but no agent-pipeline markers', async () => {
      await createHookFile('post-commit', '#!/bin/bash\necho "regular hook"');

      await hooksCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith('No Agent Pipeline hooks installed');
    });
  });

  describe('Single Hook with Single Pipeline', () => {
    it('should list single installed hook', async () => {
      await createHookFile('post-commit', `#!/bin/bash

# Agent Pipeline (post-commit): my-pipeline
# hook script here
`);

      await hooksCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith('post-commit     my-pipeline');
      expect(console.log).toHaveBeenCalledWith('Total: 1 hook(s) installed');
    });

    it('should handle pre-commit hook type', async () => {
      await createHookFile('pre-commit', `#!/bin/bash
# Agent Pipeline (pre-commit): lint-check
`);

      await hooksCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith('pre-commit      lint-check');
    });

    it('should handle pre-push hook type', async () => {
      await createHookFile('pre-push', `#!/bin/bash
# Agent Pipeline (pre-push): security-scan
`);

      await hooksCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith('pre-push        security-scan');
    });

    it('should handle post-merge hook type', async () => {
      await createHookFile('post-merge', `#!/bin/bash
# Agent Pipeline (post-merge): sync-pipeline
`);

      await hooksCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith('post-merge      sync-pipeline');
    });
  });

  describe('Single Hook with Multiple Pipelines', () => {
    it('should list all pipelines in single hook', async () => {
      await createHookFile('post-commit', `#!/bin/bash

# Agent Pipeline (post-commit): pipeline-one
# script one

# Agent Pipeline (post-commit): pipeline-two
# script two
`);

      await hooksCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith('post-commit     pipeline-one');
      expect(console.log).toHaveBeenCalledWith('post-commit     pipeline-two');
      expect(console.log).toHaveBeenCalledWith('Total: 2 hook(s) installed');
    });
  });

  describe('Multiple Hooks with Multiple Pipelines', () => {
    it('should list all hooks and pipelines', async () => {
      await createHookFile('pre-commit', `#!/bin/bash
# Agent Pipeline (pre-commit): lint-check
`);
      await createHookFile('post-commit', `#!/bin/bash
# Agent Pipeline (post-commit): code-review
`);
      await createHookFile('pre-push', `#!/bin/bash
# Agent Pipeline (pre-push): test-runner
`);

      await hooksCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith('pre-commit      lint-check');
      expect(console.log).toHaveBeenCalledWith('post-commit     code-review');
      expect(console.log).toHaveBeenCalledWith('pre-push        test-runner');
      expect(console.log).toHaveBeenCalledWith('Total: 3 hook(s) installed');
    });
  });

  describe('Pipeline Filter Option', () => {
    beforeEach(async () => {
      await createHookFile('pre-commit', `#!/bin/bash
# Agent Pipeline (pre-commit): target-pipeline
`);
      await createHookFile('post-commit', `#!/bin/bash
# Agent Pipeline (post-commit): other-pipeline
`);
    });

    it('should filter by pipeline name', async () => {
      await hooksCommand(tempDir, { pipeline: 'target-pipeline' });

      expect(console.log).toHaveBeenCalledWith('pre-commit      target-pipeline');
      expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('other-pipeline'));
      expect(console.log).toHaveBeenCalledWith('Total: 1 hook(s) installed');
    });

    it('should show message when filtered pipeline not found', async () => {
      await hooksCommand(tempDir, { pipeline: 'nonexistent-pipeline' });

      expect(console.log).toHaveBeenCalledWith('No hooks installed for pipeline: nonexistent-pipeline');
    });

    it('should find pipeline across multiple hooks', async () => {
      await createHookFile('pre-push', `#!/bin/bash
# Agent Pipeline (pre-push): target-pipeline
`);

      await hooksCommand(tempDir, { pipeline: 'target-pipeline' });

      expect(console.log).toHaveBeenCalledWith('pre-commit      target-pipeline');
      expect(console.log).toHaveBeenCalledWith('pre-push        target-pipeline');
      expect(console.log).toHaveBeenCalledWith('Total: 2 hook(s) installed');
    });
  });

  describe('Output Format', () => {
    it('should display header and separators', async () => {
      await createHookFile('post-commit', `#!/bin/bash
# Agent Pipeline (post-commit): test-pipeline
`);

      await hooksCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith('\nInstalled Git Hooks');
      expect(console.log).toHaveBeenCalledWith('='.repeat(55));
      expect(console.log).toHaveBeenCalledWith('');
      expect(console.log).toHaveBeenCalledWith(`${'Hook Type'.padEnd(16)}Pipeline`);
      expect(console.log).toHaveBeenCalledWith('-'.repeat(55));
    });

    it('should pad hook type to 16 characters', async () => {
      await createHookFile('pre-commit', `#!/bin/bash
# Agent Pipeline (pre-commit): short
`);

      await hooksCommand(tempDir);

      // pre-commit is 10 chars, padded to 16 (6 spaces)
      expect(console.log).toHaveBeenCalledWith('pre-commit      short');
    });
  });

  describe('Edge Cases', () => {
    it('should handle pipelines with dashes in name', async () => {
      await createHookFile('post-commit', `#!/bin/bash
# Agent Pipeline (post-commit): my-complex-pipeline-name
`);

      await hooksCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith('post-commit     my-complex-pipeline-name');
    });

    it('should handle pipelines with underscores in name', async () => {
      await createHookFile('post-commit', `#!/bin/bash
# Agent Pipeline (post-commit): my_pipeline_name
`);

      await hooksCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith('post-commit     my_pipeline_name');
    });

    it('should ignore malformed marker lines', async () => {
      await createHookFile('post-commit', `#!/bin/bash
# Agent Pipeline: missing-parens
# Agent Pipeline (post-commit) missing-colon
# Agent Pipeline (post-commit): valid-pipeline
`);

      await hooksCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith('post-commit     valid-pipeline');
      expect(console.log).toHaveBeenCalledWith('Total: 1 hook(s) installed');
    });

    it('should handle hook file with only shebang', async () => {
      await createHookFile('post-commit', '#!/bin/bash\n');

      await hooksCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith('No Agent Pipeline hooks installed');
    });

    it('should skip unsupported hook types', async () => {
      await createHookFile('prepare-commit-msg', `#!/bin/bash
# Agent Pipeline (prepare-commit-msg): unsupported
`);

      await hooksCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith('No Agent Pipeline hooks installed');
    });
  });
});
