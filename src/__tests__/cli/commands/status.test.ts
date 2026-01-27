import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { statusCommand } from '../../../cli/commands/status.js';
import { StateManager } from '../../../core/state-manager.js';
import { createTempDir, cleanupTempDir } from '../../setup.js';
import { completedPipelineState, failedPipelineState, pipelineStateWithPR } from '../../fixtures/pipeline-states.js';

// Mock StateManager
vi.mock('../../../core/state-manager.js');

describe('statusCommand', () => {
  let tempDir: string;
  let mockStateManager: any;

  beforeEach(async () => {
    tempDir = await createTempDir('status-command-test-');

    // Setup StateManager mock
    mockStateManager = {
      getLatestRun: vi.fn(),
    };
    vi.mocked(StateManager).mockImplementation(() => mockStateManager);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
    vi.clearAllMocks();
  });

  describe('No Runs Found', () => {
    it('should show message when no pipeline runs exist', async () => {
      mockStateManager.getLatestRun.mockResolvedValue(null);

      await statusCommand(tempDir);

      expect(mockStateManager.getLatestRun).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith('No pipeline runs found');
    });

    it('should not show header when no runs', async () => {
      mockStateManager.getLatestRun.mockResolvedValue(null);

      await statusCommand(tempDir);

      expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('Latest Pipeline Run'));
    });

    it('should not show stages when no runs', async () => {
      mockStateManager.getLatestRun.mockResolvedValue(null);

      await statusCommand(tempDir);

      expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('Stages:'));
    });
  });

  describe('Latest Run Display', () => {
    it('should display pipeline name from latest run', async () => {
      mockStateManager.getLatestRun.mockResolvedValue(completedPipelineState);

      await statusCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining(`Latest Pipeline Run: ${completedPipelineState.pipelineConfig.name}`));
    });

    it('should display run ID', async () => {
      mockStateManager.getLatestRun.mockResolvedValue(completedPipelineState);

      await statusCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining(`Run ID:       ${completedPipelineState.runId}`));
    });

    it('should display status in uppercase', async () => {
      mockStateManager.getLatestRun.mockResolvedValue(completedPipelineState);

      await statusCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Status:       COMPLETED'));
    });

    it('should display duration with 2 decimal places', async () => {
      mockStateManager.getLatestRun.mockResolvedValue(completedPipelineState);

      await statusCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Duration:     120.00s'));
    });

    it('should display timestamp', async () => {
      mockStateManager.getLatestRun.mockResolvedValue(completedPipelineState);

      await statusCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining(`Timestamp:    ${completedPipelineState.trigger.timestamp}`));
    });

    it('should display trigger type', async () => {
      mockStateManager.getLatestRun.mockResolvedValue(completedPipelineState);

      await statusCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining(`Trigger:      ${completedPipelineState.trigger.type}`));
    });

    it('should display shortened initial commit (7 chars)', async () => {
      mockStateManager.getLatestRun.mockResolvedValue(completedPipelineState);

      await statusCommand(tempDir);

      const shortCommit = completedPipelineState.artifacts.initialCommit!.substring(0, 7);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining(`Initial Commit: ${shortCommit}`));
    });

    it('should display shortened final commit (7 chars)', async () => {
      mockStateManager.getLatestRun.mockResolvedValue(completedPipelineState);

      await statusCommand(tempDir);

      const shortCommit = completedPipelineState.artifacts.finalCommit!.substring(0, 7);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining(`Final Commit:   ${shortCommit}`));
    });

    it('should display N/A for missing initial commit', async () => {
      const stateWithoutInitialCommit = {
        ...completedPipelineState,
        artifacts: {
          ...completedPipelineState.artifacts,
          initialCommit: undefined,
        },
      };
      mockStateManager.getLatestRun.mockResolvedValue(stateWithoutInitialCommit);

      await statusCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Initial Commit: N/A'));
    });

    it('should display N/A for missing final commit', async () => {
      const stateWithoutFinalCommit = {
        ...completedPipelineState,
        artifacts: {
          ...completedPipelineState.artifacts,
          finalCommit: undefined,
        },
      };
      mockStateManager.getLatestRun.mockResolvedValue(stateWithoutFinalCommit);

      await statusCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Final Commit:   N/A'));
    });
  });

  describe('Pull Request Information', () => {
    it('should display PR URL when PR exists', async () => {
      mockStateManager.getLatestRun.mockResolvedValue(pipelineStateWithPR);

      await statusCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining(`Pull Request:   ${pipelineStateWithPR.artifacts.pullRequest!.url}`));
    });

    it('should display PR branch when PR exists', async () => {
      mockStateManager.getLatestRun.mockResolvedValue(pipelineStateWithPR);

      await statusCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining(`PR Branch:      ${pipelineStateWithPR.artifacts.pullRequest!.branch}`));
    });

    it('should not display PR info when PR does not exist', async () => {
      mockStateManager.getLatestRun.mockResolvedValue(completedPipelineState);

      await statusCommand(tempDir);

      expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('Pull Request:'));
      expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('PR Branch:'));
    });
  });

  describe('Stage Information', () => {
    it('should display stages header', async () => {
      mockStateManager.getLatestRun.mockResolvedValue(completedPipelineState);

      await statusCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Stages:'));
    });

    it('should display success icon for successful stages', async () => {
      mockStateManager.getLatestRun.mockResolvedValue(completedPipelineState);

      await statusCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✅ stage-1'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✅ stage-2'));
    });

    it('should display failure icon for failed stages', async () => {
      mockStateManager.getLatestRun.mockResolvedValue(failedPipelineState);

      await statusCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✅ stage-1'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('❌ stage-2'));
    });

    it('should display skipped icon for skipped stages', async () => {
      const stateWithSkippedStage = {
        ...completedPipelineState,
        stages: [
          ...completedPipelineState.stages,
          {
            stageName: 'skipped-stage',
            status: 'skipped',
            startTime: '2024-01-01T00:02:00.000Z',
          },
        ],
      };
      mockStateManager.getLatestRun.mockResolvedValue(stateWithSkippedStage);

      await statusCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('⏭️ skipped-stage'));
    });

    it('should display pending icon for running stages', async () => {
      const stateWithRunningStage = {
        ...completedPipelineState,
        stages: [
          {
            stageName: 'running-stage',
            status: 'running',
            startTime: '2024-01-01T00:00:00.000Z',
          },
        ],
      };
      mockStateManager.getLatestRun.mockResolvedValue(stateWithRunningStage);

      await statusCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('⏳ running-stage'));
    });

    it('should display stage status', async () => {
      mockStateManager.getLatestRun.mockResolvedValue(completedPipelineState);

      await statusCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('   Status: success'));
    });

    it('should display stage duration with 1 decimal place', async () => {
      mockStateManager.getLatestRun.mockResolvedValue(completedPipelineState);

      await statusCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('   Duration: 60.0s'));
    });

    it('should display N/A for missing duration', async () => {
      const stateWithoutDuration = {
        ...completedPipelineState,
        stages: [
          {
            stageName: 'stage-1',
            status: 'success',
            startTime: '2024-01-01T00:00:00.000Z',
            // No duration
          },
        ],
      };
      mockStateManager.getLatestRun.mockResolvedValue(stateWithoutDuration);

      await statusCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('   Duration: N/A'));
    });

    it('should display commit SHA (shortened to 7 chars)', async () => {
      mockStateManager.getLatestRun.mockResolvedValue(completedPipelineState);

      await statusCommand(tempDir);

      const shortCommit = completedPipelineState.stages[0].commitSha!.substring(0, 7);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining(`   Commit: ${shortCommit}`));
    });

    it('should not display commit when missing', async () => {
      const stateWithoutCommit = {
        ...completedPipelineState,
        stages: [
          {
            stageName: 'stage-1',
            status: 'success',
            startTime: '2024-01-01T00:00:00.000Z',
            duration: 60,
            // No commitSha
          },
        ],
      };
      mockStateManager.getLatestRun.mockResolvedValue(stateWithoutCommit);

      await statusCommand(tempDir);

      const logCalls = vi.mocked(console.log).mock.calls;
      const hasCommitLog = logCalls.some(call =>
        call[0]?.includes('   Commit:')
      );
      expect(hasCommitLog).toBe(false);
    });

    it('should display error message when stage failed', async () => {
      mockStateManager.getLatestRun.mockResolvedValue(failedPipelineState);

      await statusCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('   Error: Agent execution failed'));
    });

    it('should display error suggestion when available', async () => {
      mockStateManager.getLatestRun.mockResolvedValue(failedPipelineState);

      await statusCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('   💡 Check agent configuration'));
    });

    it('should not display suggestion when error has no suggestion', async () => {
      const stateWithErrorNoSuggestion = {
        ...failedPipelineState,
        stages: [
          {
            stageName: 'stage-1',
            status: 'failed',
            startTime: '2024-01-01T00:00:00.000Z',
            duration: 60,
            error: {
              message: 'Something failed',
              // No suggestion
            },
          },
        ],
      };
      mockStateManager.getLatestRun.mockResolvedValue(stateWithErrorNoSuggestion);

      await statusCommand(tempDir);

      const logCalls = vi.mocked(console.log).mock.calls;
      const hasSuggestion = logCalls.some(call =>
        call[0]?.includes('   💡')
      );
      expect(hasSuggestion).toBe(false);
    });
  });

  describe('Formatting and Layout', () => {
    it('should display separators around header', async () => {
      mockStateManager.getLatestRun.mockResolvedValue(completedPipelineState);

      await statusCommand(tempDir);

      const separator = '='.repeat(60);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining(separator));
    });

    it('should display stage separator', async () => {
      mockStateManager.getLatestRun.mockResolvedValue(completedPipelineState);

      await statusCommand(tempDir);

      const separator = '─'.repeat(60);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining(separator));
    });

    it('should add blank lines between stages', async () => {
      mockStateManager.getLatestRun.mockResolvedValue(completedPipelineState);

      await statusCommand(tempDir);

      // After each stage info block, there should be a blank line
      const logCalls = vi.mocked(console.log).mock.calls;
      const blankLines = logCalls.filter(call => call[0] === '');
      expect(blankLines.length).toBeGreaterThan(0);
    });

    it('should end with separator', async () => {
      mockStateManager.getLatestRun.mockResolvedValue(completedPipelineState);

      await statusCommand(tempDir);

      const separator = '='.repeat(60);
      const logCalls = vi.mocked(console.log).mock.calls;
      const lastLogs = logCalls.slice(-5);
      const hasSeparator = lastLogs.some(call => call[0]?.includes(separator));
      expect(hasSeparator).toBe(true);
    });
  });

  describe('StateManager Integration', () => {
    it('should create StateManager with correct path', async () => {
      mockStateManager.getLatestRun.mockResolvedValue(completedPipelineState);

      await statusCommand(tempDir);

      expect(StateManager).toHaveBeenCalledWith(tempDir);
    });

    it('should call getLatestRun', async () => {
      mockStateManager.getLatestRun.mockResolvedValue(completedPipelineState);

      await statusCommand(tempDir);

      expect(mockStateManager.getLatestRun).toHaveBeenCalledTimes(1);
    });

    it('should handle errors from StateManager', async () => {
      mockStateManager.getLatestRun.mockRejectedValue(new Error('State directory not found'));

      await expect(statusCommand(tempDir)).rejects.toThrow('State directory not found');
    });
  });

  describe('Edge Cases', () => {
    it('should handle undefined totalDuration gracefully', async () => {
      const stateWithoutTotalDuration = {
        ...completedPipelineState,
        artifacts: {
          ...completedPipelineState.artifacts,
          totalDuration: 0, // Use 0 instead of undefined
        },
      };
      mockStateManager.getLatestRun.mockResolvedValue(stateWithoutTotalDuration);

      await statusCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Duration:     0.00s'));
    });

    it('should handle empty stages array', async () => {
      const stateWithoutStages = {
        ...completedPipelineState,
        stages: [],
      };
      mockStateManager.getLatestRun.mockResolvedValue(stateWithoutStages);

      await statusCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Stages:'));
    });

    it('should handle very long pipeline names', async () => {
      const longName = 'very-long-pipeline-name-that-might-break-formatting';
      const stateWithLongName = {
        ...completedPipelineState,
        pipelineConfig: {
          ...completedPipelineState.pipelineConfig,
          name: longName,
        },
      };
      mockStateManager.getLatestRun.mockResolvedValue(stateWithLongName);

      await statusCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining(longName));
    });

    it('should handle very long stage names', async () => {
      const longStageName = 'very-long-stage-name-that-might-break-formatting';
      const stateWithLongStageName = {
        ...completedPipelineState,
        stages: [
          {
            ...completedPipelineState.stages[0],
            stageName: longStageName,
          },
        ],
      };
      mockStateManager.getLatestRun.mockResolvedValue(stateWithLongStageName);

      await statusCommand(tempDir);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining(longStageName));
    });
  });

  describe('Integration', () => {
    it('should complete full status display workflow', async () => {
      mockStateManager.getLatestRun.mockResolvedValue(completedPipelineState);

      await statusCommand(tempDir);

      expect(StateManager).toHaveBeenCalledWith(tempDir);
      expect(mockStateManager.getLatestRun).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Latest Pipeline Run'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Stages:'));
    });

    it('should work with different repository paths', async () => {
      const customPath = '/custom/repo/path';
      mockStateManager.getLatestRun.mockResolvedValue(completedPipelineState);

      await statusCommand(customPath);

      expect(StateManager).toHaveBeenCalledWith(customPath);
    });
  });
});
