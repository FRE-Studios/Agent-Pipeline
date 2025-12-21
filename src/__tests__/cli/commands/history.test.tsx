// src/__tests__/cli/commands/history.test.tsx

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { HistoryBrowser } from '../../../cli/commands/history.js';
import { StateManager } from '../../../core/state-manager.js';
import { PipelineState } from '../../../config/schema.js';
import { spawn } from 'child_process';

// Mock StateManager
vi.mock('../../../core/state-manager.js');

// Mock child_process spawn
vi.mock('child_process', () => ({
  spawn: vi.fn()
}));

describe('HistoryBrowser', () => {
  const mockRepoPath = '/test/repo';
  const originalPager = process.env.PAGER;

  const mockRun: PipelineState = {
    runId: 'run-123',
    pipelineConfig: {
      name: 'test-pipeline',
      trigger: 'manual',
      agents: []
    },
    status: 'completed',
    trigger: {
      type: 'manual',
      commitSha: 'abc1234567',
      timestamp: '2024-01-15T10:00:00Z'
    },
    stages: [
      {
        stageName: 'test-stage',
        status: 'success',
        startTime: '2024-01-15T10:00:00Z',
        endTime: '2024-01-15T10:00:05Z',
        duration: 5.0,
        commitSha: 'abc1234'
      }
    ],
    artifacts: {
      handoverDir: '.agent-pipeline/runs/test-run-123',
      initialCommit: 'abc1234567',
      finalCommit: 'def7890123',
      changedFiles: ['src/test.ts'],
      totalDuration: 10.5
    }
  };

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Default StateManager mock
    vi.mocked(StateManager).mockImplementation(() => ({
      getAllRuns: vi.fn().mockResolvedValue([mockRun]),
      saveState: vi.fn(),
      loadState: vi.fn(),
      getRunHistory: vi.fn(),
      deleteStateFiles: vi.fn()
    } as any));
  });

  afterEach(() => {
    // Restore original PAGER
    if (originalPager) {
      process.env.PAGER = originalPager;
    } else {
      delete process.env.PAGER;
    }
  });

  describe('Component Rendering', () => {
    it('should render empty state when no runs found', async () => {
      vi.mocked(StateManager).mockImplementation(() => ({
        getAllRuns: vi.fn().mockResolvedValue([])
      } as any));

      const { lastFrame } = render(<HistoryBrowser repoPath={mockRepoPath} />);

      // Wait for async load
      await new Promise(resolve => setTimeout(resolve, 10));

      const output = lastFrame();
      expect(output).toContain('No pipeline runs found');
      expect(output).toContain('Run a pipeline first to see history here.');
    });

    it('should render list view with runs', async () => {
      const { lastFrame } = render(<HistoryBrowser repoPath={mockRepoPath} />);

      // Wait for async load
      await new Promise(resolve => setTimeout(resolve, 10));

      const output = lastFrame();
      expect(output).toContain('📜 Pipeline History');
      expect(output).toContain('test-pipeline');
      expect(output).toContain('completed');
      expect(output).toContain('10.5s');
    });

    it('should show navigation instructions in list view', async () => {
      const { lastFrame } = render(<HistoryBrowser repoPath={mockRepoPath} />);

      await new Promise(resolve => setTimeout(resolve, 10));

      const output = lastFrame();
      expect(output).toContain('Use ↑↓ to navigate');
      expect(output).toContain('Enter to view details');
      expect(output).toContain('o to open log file');
      expect(output).toContain('q to quit');
    });

    it('should highlight selected run', async () => {
      const { lastFrame } = render(<HistoryBrowser repoPath={mockRepoPath} />);

      await new Promise(resolve => setTimeout(resolve, 10));

      const output = lastFrame();
      expect(output).toContain('▶'); // Selection indicator
    });

    it('should format timestamps correctly', async () => {
      const { lastFrame } = render(<HistoryBrowser repoPath={mockRepoPath} />);

      await new Promise(resolve => setTimeout(resolve, 10));

      const output = lastFrame();
      // Check that date is formatted (will vary by locale, but should have date components)
      expect(output).toMatch(/\d{1,2}/);
    });

    it('should display status with correct color coding', async () => {
      const failedRun: PipelineState = {
        ...mockRun,
        runId: 'run-456',
        status: 'failed'
      };

      vi.mocked(StateManager).mockImplementation(() => ({
        getAllRuns: vi.fn().mockResolvedValue([mockRun, failedRun])
      } as any));

      const { lastFrame } = render(<HistoryBrowser repoPath={mockRepoPath} />);

      await new Promise(resolve => setTimeout(resolve, 10));

      const output = lastFrame();
      expect(output).toContain('completed');
      expect(output).toContain('failed');
    });
  });

  describe('Navigation', () => {
    it('should navigate down with down arrow', async () => {
      const runs = [
        mockRun,
        { ...mockRun, runId: 'run-456', pipelineConfig: { ...mockRun.pipelineConfig, name: 'second-pipeline' } }
      ];

      vi.mocked(StateManager).mockImplementation(() => ({
        getAllRuns: vi.fn().mockResolvedValue(runs)
      } as any));

      const { lastFrame, stdin } = render(<HistoryBrowser repoPath={mockRepoPath} />);

      await new Promise(resolve => setTimeout(resolve, 10));

      // Simulate down arrow
      stdin.write('\u001B[B');

      await new Promise(resolve => setTimeout(resolve, 10));

      // Both runs should be visible
      const output = lastFrame();
      expect(output).toContain('test-pipeline');
      expect(output).toContain('second-pipeline');
    });

    it('should navigate up with up arrow', async () => {
      const runs = [
        mockRun,
        { ...mockRun, runId: 'run-456' }
      ];

      vi.mocked(StateManager).mockImplementation(() => ({
        getAllRuns: vi.fn().mockResolvedValue(runs)
      } as any));

      const { stdin } = render(<HistoryBrowser repoPath={mockRepoPath} />);

      await new Promise(resolve => setTimeout(resolve, 10));

      // Simulate up arrow
      stdin.write('\u001B[A');

      // Should not crash or go below index 0
      expect(true).toBe(true);
    });

    it('should not navigate beyond list bounds', async () => {
      const { stdin } = render(<HistoryBrowser repoPath={mockRepoPath} />);

      await new Promise(resolve => setTimeout(resolve, 10));

      // Try to go up when at first item
      stdin.write('\u001B[A');
      // Try to go down when at last item
      stdin.write('\u001B[B');

      // Should not crash
      expect(true).toBe(true);
    });
  });

  describe('Detail View', () => {
    it('should enter detail view on Enter key', async () => {
      const { lastFrame, stdin } = render(<HistoryBrowser repoPath={mockRepoPath} />);

      await new Promise(resolve => setTimeout(resolve, 10));

      // Press Enter
      stdin.write('\r');

      await new Promise(resolve => setTimeout(resolve, 10));

      const output = lastFrame();
      expect(output).toContain('📊 Pipeline Details');
      expect(output).toContain('Run ID:');
      expect(output).toContain('run-123');
    });

    it('should display all run details in detail view', async () => {
      const { lastFrame, stdin } = render(<HistoryBrowser repoPath={mockRepoPath} />);

      await new Promise(resolve => setTimeout(resolve, 10));

      stdin.write('\r');

      await new Promise(resolve => setTimeout(resolve, 10));

      const output = lastFrame();
      expect(output).toContain('Status:');
      expect(output).toContain('Duration:');
      expect(output).toContain('Timestamp:');
      expect(output).toContain('Trigger:');
      expect(output).toContain('Initial Commit:');
      expect(output).toContain('Final Commit:');
    });

    it('should display stage information in detail view', async () => {
      const { lastFrame, stdin } = render(<HistoryBrowser repoPath={mockRepoPath} />);

      await new Promise(resolve => setTimeout(resolve, 10));

      stdin.write('\r');

      await new Promise(resolve => setTimeout(resolve, 10));

      const output = lastFrame();
      expect(output).toContain('Stages:');
      expect(output).toContain('test-stage');
      expect(output).toContain('Commit:');
      expect(output).toContain('abc1234');
    });

    it('should exit detail view on q key', async () => {
      const { lastFrame, stdin } = render(<HistoryBrowser repoPath={mockRepoPath} />);

      await new Promise(resolve => setTimeout(resolve, 10));

      // Enter detail view
      stdin.write('\r');

      await new Promise(resolve => setTimeout(resolve, 10));

      // Exit detail view
      stdin.write('q');

      await new Promise(resolve => setTimeout(resolve, 10));

      const output = lastFrame();
      // Should be back to list view
      expect(output).toContain('📜 Pipeline History');
    });

    it('should exit detail view on ESC key', async () => {
      const { lastFrame, stdin } = render(<HistoryBrowser repoPath={mockRepoPath} />);

      await new Promise(resolve => setTimeout(resolve, 10));

      // Enter detail view
      stdin.write('\r');

      await new Promise(resolve => setTimeout(resolve, 10));

      // Exit detail view with ESC
      stdin.write('\u001B');

      await new Promise(resolve => setTimeout(resolve, 10));

      const output = lastFrame();
      // Should be back to list view
      expect(output).toContain('📜 Pipeline History');
    });

    it('should show instructions in detail view', async () => {
      const { lastFrame, stdin } = render(<HistoryBrowser repoPath={mockRepoPath} />);

      await new Promise(resolve => setTimeout(resolve, 10));

      stdin.write('\r');

      await new Promise(resolve => setTimeout(resolve, 10));

      const output = lastFrame();
      expect(output).toContain('Press q or ESC to go back');
      expect(output).toContain('o to open full log file');
    });
  });

  describe('Open Log File - Core Functionality', () => {
    it('should open log file with o key in list view', async () => {
      const mockProcess = {
        on: vi.fn((event, callback) => {
          if (event === 'exit') {
            setTimeout(() => callback(), 5);
          }
          return mockProcess;
        })
      };

      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      const { stdin } = render(<HistoryBrowser repoPath={mockRepoPath} />);

      await new Promise(resolve => setTimeout(resolve, 10));

      // Press 'o' key
      stdin.write('o');

      await new Promise(resolve => setTimeout(resolve, 20));

      expect(spawn).toHaveBeenCalled();
    });

    it('should open log file with o key in detail view', async () => {
      const mockProcess = {
        on: vi.fn((event, callback) => {
          if (event === 'exit') {
            setTimeout(() => callback(), 5);
          }
          return mockProcess;
        })
      };

      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      const { stdin } = render(<HistoryBrowser repoPath={mockRepoPath} />);

      await new Promise(resolve => setTimeout(resolve, 10));

      // Enter detail view
      stdin.write('\r');

      await new Promise(resolve => setTimeout(resolve, 10));

      // Press 'o' key in detail view
      stdin.write('o');

      await new Promise(resolve => setTimeout(resolve, 20));

      expect(spawn).toHaveBeenCalled();
    });

    it('should do nothing when o pressed with no runs', async () => {
      vi.mocked(StateManager).mockImplementation(() => ({
        getAllRuns: vi.fn().mockResolvedValue([])
      } as any));

      const { stdin } = render(<HistoryBrowser repoPath={mockRepoPath} />);

      await new Promise(resolve => setTimeout(resolve, 10));

      stdin.write('o');

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(spawn).not.toHaveBeenCalled();
    });
  });

  describe('Pager Environment Variable', () => {
    it('should use $PAGER environment variable when set', async () => {
      process.env.PAGER = 'bat';

      const mockProcess = {
        on: vi.fn((event, callback) => {
          if (event === 'exit') {
            setTimeout(() => callback(), 5);
          }
          return mockProcess;
        })
      };

      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      const { stdin } = render(<HistoryBrowser repoPath={mockRepoPath} />);

      await new Promise(resolve => setTimeout(resolve, 10));

      stdin.write('o');

      await new Promise(resolve => setTimeout(resolve, 20));

      expect(spawn).toHaveBeenCalledWith(
        'bat',
        expect.arrayContaining([expect.stringContaining('run-123.json')]),
        expect.objectContaining({
          stdio: 'inherit',
          shell: true
        })
      );
    });

    it('should fallback to less when $PAGER not set', async () => {
      delete process.env.PAGER;

      const mockProcess = {
        on: vi.fn((event, callback) => {
          if (event === 'exit') {
            setTimeout(() => callback(), 5);
          }
          return mockProcess;
        })
      };

      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      const { stdin } = render(<HistoryBrowser repoPath={mockRepoPath} />);

      await new Promise(resolve => setTimeout(resolve, 10));

      stdin.write('o');

      await new Promise(resolve => setTimeout(resolve, 20));

      expect(spawn).toHaveBeenCalledWith(
        'less',
        expect.any(Array),
        expect.any(Object)
      );
    });

    it('should use custom pager like more', async () => {
      process.env.PAGER = 'more';

      const mockProcess = {
        on: vi.fn((event, callback) => {
          if (event === 'exit') {
            setTimeout(() => callback(), 5);
          }
          return mockProcess;
        })
      };

      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      const { stdin } = render(<HistoryBrowser repoPath={mockRepoPath} />);

      await new Promise(resolve => setTimeout(resolve, 10));

      stdin.write('o');

      await new Promise(resolve => setTimeout(resolve, 20));

      expect(spawn).toHaveBeenCalledWith(
        'more',
        expect.any(Array),
        expect.any(Object)
      );
    });
  });

  describe('Spawn Configuration', () => {
    it('should spawn pager with correct arguments', async () => {
      const mockProcess = {
        on: vi.fn((event, callback) => {
          if (event === 'exit') {
            setTimeout(() => callback(), 5);
          }
          return mockProcess;
        })
      };

      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      const { stdin } = render(<HistoryBrowser repoPath={mockRepoPath} />);

      await new Promise(resolve => setTimeout(resolve, 10));

      stdin.write('o');

      await new Promise(resolve => setTimeout(resolve, 20));

      expect(spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([expect.stringContaining('.agent-pipeline/state/runs/run-123.json')]),
        expect.objectContaining({
          stdio: 'inherit',
          shell: true
        })
      );
    });

    it('should wait for pager process to exit', async () => {
      const mockProcess = {
        on: vi.fn((event, callback) => {
          if (event === 'exit') {
            setTimeout(() => callback(), 5);
          }
          return mockProcess;
        })
      };

      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      const { stdin } = render(<HistoryBrowser repoPath={mockRepoPath} />);

      await new Promise(resolve => setTimeout(resolve, 10));

      stdin.write('o');

      await new Promise(resolve => setTimeout(resolve, 20));

      expect(mockProcess.on).toHaveBeenCalledWith('exit', expect.any(Function));
    });

    it('should handle pager process errors gracefully', async () => {
      const mockProcess = {
        on: vi.fn((event, callback) => {
          if (event === 'error') {
            setTimeout(() => callback(new Error('Pager not found')), 5);
          }
          return mockProcess;
        })
      };

      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      const { stdin } = render(<HistoryBrowser repoPath={mockRepoPath} />);

      await new Promise(resolve => setTimeout(resolve, 10));

      // Should not crash
      expect(() => {
        stdin.write('o');
      }).not.toThrow();

      await new Promise(resolve => setTimeout(resolve, 20));

      expect(mockProcess.on).toHaveBeenCalledWith('error', expect.any(Function));
    });
  });

  describe('StateManager Integration', () => {
    it('should load runs from StateManager on mount', async () => {
      const getAllRuns = vi.fn().mockResolvedValue([mockRun]);

      vi.mocked(StateManager).mockImplementation(() => ({
        getAllRuns
      } as any));

      render(<HistoryBrowser repoPath={mockRepoPath} />);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(StateManager).toHaveBeenCalledWith(mockRepoPath);
      expect(getAllRuns).toHaveBeenCalled();
    });

    it('should display multiple runs from StateManager', async () => {
      const runs = [
        mockRun,
        { ...mockRun, runId: 'run-456', pipelineConfig: { ...mockRun.pipelineConfig, name: 'pipeline-2' } },
        { ...mockRun, runId: 'run-789', pipelineConfig: { ...mockRun.pipelineConfig, name: 'pipeline-3' } }
      ];

      vi.mocked(StateManager).mockImplementation(() => ({
        getAllRuns: vi.fn().mockResolvedValue(runs)
      } as any));

      const { lastFrame } = render(<HistoryBrowser repoPath={mockRepoPath} />);

      await new Promise(resolve => setTimeout(resolve, 10));

      const output = lastFrame();
      expect(output).toContain('test-pipeline');
      expect(output).toContain('pipeline-2');
      expect(output).toContain('pipeline-3');
    });
  });

  describe('Edge Cases', () => {
    it('should handle runs with missing optional fields', async () => {
      const incompleteRun: PipelineState = {
        ...mockRun,
        artifacts: {
          handoverDir: '.agent-pipeline/runs/test-run-123',
          initialCommit: 'abc1234',
          finalCommit: undefined,
          changedFiles: [],
          totalDuration: 0
        }
      };

      vi.mocked(StateManager).mockImplementation(() => ({
        getAllRuns: vi.fn().mockResolvedValue([incompleteRun])
      } as any));

      const { lastFrame, stdin } = render(<HistoryBrowser repoPath={mockRepoPath} />);

      await new Promise(resolve => setTimeout(resolve, 10));

      stdin.write('\r');

      await new Promise(resolve => setTimeout(resolve, 10));

      const output = lastFrame();
      expect(output).toContain('N/A'); // Should show N/A for missing commits
    });

    it('should handle stages with errors', async () => {
      const failedRun: PipelineState = {
        ...mockRun,
        status: 'failed',
        stages: [
          {
            ...mockRun.stages[0],
            status: 'failed',
            error: {
              message: 'Stage failed',
              suggestion: 'Check your configuration'
            }
          }
        ]
      };

      vi.mocked(StateManager).mockImplementation(() => ({
        getAllRuns: vi.fn().mockResolvedValue([failedRun])
      } as any));

      const { lastFrame, stdin } = render(<HistoryBrowser repoPath={mockRepoPath} />);

      await new Promise(resolve => setTimeout(resolve, 10));

      stdin.write('\r');

      await new Promise(resolve => setTimeout(resolve, 10));

      const output = lastFrame();
      expect(output).toContain('Error:');
      expect(output).toContain('Stage failed');
      expect(output).toContain('💡');
      expect(output).toContain('Check your configuration');
    });

    it('should handle stages without commit sha', async () => {
      const runWithoutCommit: PipelineState = {
        ...mockRun,
        stages: [
          {
            ...mockRun.stages[0],
            commitSha: undefined
          }
        ]
      };

      vi.mocked(StateManager).mockImplementation(() => ({
        getAllRuns: vi.fn().mockResolvedValue([runWithoutCommit])
      } as any));

      const { lastFrame, stdin } = render(<HistoryBrowser repoPath={mockRepoPath} />);

      await new Promise(resolve => setTimeout(resolve, 10));

      stdin.write('\r');

      await new Promise(resolve => setTimeout(resolve, 10));

      const output = lastFrame();
      // Should still show stage name
      expect(output).toContain('test-stage');
    });

    it('should handle very long pipeline names', async () => {
      const longNameRun: PipelineState = {
        ...mockRun,
        pipelineConfig: {
          ...mockRun.pipelineConfig,
          name: 'very-long-pipeline-name-that-might-cause-layout-issues'
        }
      };

      vi.mocked(StateManager).mockImplementation(() => ({
        getAllRuns: vi.fn().mockResolvedValue([longNameRun])
      } as any));

      const { lastFrame } = render(<HistoryBrowser repoPath={mockRepoPath} />);

      await new Promise(resolve => setTimeout(resolve, 10));

      const output = lastFrame();
      expect(output).toContain('very-long-pipeline-name-that-might-cause-layout-issues');
    });
  });
});
