// src/cli/commands/history.tsx

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import * as path from 'path';
import { StateManager } from '../../core/state-manager.js';
import { PipelineState } from '../../config/schema.js';
import { openInPager } from '../../utils/platform-opener.js';

interface HistoryBrowserProps {
  repoPath: string;
}

export const HistoryBrowser: React.FC<HistoryBrowserProps> = ({ repoPath }) => {
  const [runs, setRuns] = useState<PipelineState[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [detailView, setDetailView] = useState(false);
  const { exit } = useApp();

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    const stateManager = new StateManager(repoPath);
    const allRuns = await stateManager.getAllRuns();
    setRuns(allRuns);
  };

  const openLogFile = async () => {
    if (runs.length === 0) return;

    const selectedRun = runs[selectedIndex];
    const logPath = path.join(
      repoPath,
      '.agent-pipeline',
      'state',
      'runs',
      `${selectedRun.runId}.json`
    );

    // Exit the Ink app temporarily
    exit();

    await new Promise(resolve => setImmediate(resolve));
    await openInPager(logPath);

    // Restart the history browser (this won't work as intended, but we've exited)
    // User will need to run the command again
  };

  useInput((input: string, key: any) => {
    if (detailView) {
      if (key.escape || input === 'q') {
        setDetailView(false);
      } else if (input === 'o') {
        openLogFile();
      }
      return;
    }

    if (key.upArrow) {
      setSelectedIndex(Math.max(0, selectedIndex - 1));
    } else if (key.downArrow) {
      setSelectedIndex(Math.min(runs.length - 1, selectedIndex + 1));
    } else if (key.return) {
      setDetailView(true);
    } else if (input === 'o') {
      openLogFile();
    } else if (input === 'q') {
      exit();
    }
  });

  if (runs.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="yellow">No pipeline runs found</Text>
        <Text dimColor>Run a pipeline first to see history here.</Text>
      </Box>
    );
  }

  if (detailView && runs[selectedIndex]) {
    return <PipelineDetailView state={runs[selectedIndex]} />;
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">📜 Pipeline History</Text>
      <Text dimColor>Use ↑↓ to navigate, Enter to view details, o to open log file, q to quit</Text>
      <Box height={1} />

      {runs.map((run, index) => (
        <RunRow key={run.runId} run={run} isSelected={index === selectedIndex} />
      ))}
    </Box>
  );
};

interface RunRowProps {
  run: PipelineState;
  isSelected: boolean;
}

const RunRow: React.FC<RunRowProps> = ({ run, isSelected }) => {
  const statusColor =
    run.status === 'completed' ? 'green' : run.status === 'failed' ? 'red' : 'yellow';

  const formatDate = (iso: string) => {
    const date = new Date(iso);
    return date.toLocaleString();
  };

  return (
    <Box>
      <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
        {isSelected ? '▶ ' : '  '}
        {formatDate(run.trigger.timestamp)} |{' '}
        <Text color={statusColor}>{run.status}</Text> | {run.pipelineConfig.name} |{' '}
        {run.artifacts.totalDuration.toFixed(1)}s
      </Text>
    </Box>
  );
};

interface PipelineDetailViewProps {
  state: PipelineState;
}

const PipelineDetailView: React.FC<PipelineDetailViewProps> = ({ state }) => {
  return (
    <Box flexDirection="column" padding={1}>
      <Box borderStyle="round" borderColor="cyan" padding={1}>
        <Box flexDirection="column">
          <Text bold color="cyan">
            📊 Pipeline Details: {state.pipelineConfig.name}
          </Text>
          <Text dimColor>Press q or ESC to go back, o to open full log file</Text>
        </Box>
      </Box>

      <Box height={1} />

      <Box flexDirection="column">
        <Text>
          <Text bold>Run ID:</Text> {state.runId}
        </Text>
        <Text>
          <Text bold>Status:</Text>{' '}
          <Text
            color={
              state.status === 'completed'
                ? 'green'
                : state.status === 'failed'
                ? 'red'
                : 'yellow'
            }
          >
            {state.status.toUpperCase()}
          </Text>
        </Text>
        <Text>
          <Text bold>Duration:</Text> {state.artifacts.totalDuration.toFixed(2)}s
        </Text>
        <Text>
          <Text bold>Timestamp:</Text> {new Date(state.trigger.timestamp).toLocaleString()}
        </Text>
        <Text>
          <Text bold>Trigger:</Text> {state.trigger.type}
        </Text>
        <Text>
          <Text bold>Initial Commit:</Text>{' '}
          {state.artifacts.initialCommit?.substring(0, 7) || 'N/A'}
        </Text>
        <Text>
          <Text bold>Final Commit:</Text> {state.artifacts.finalCommit?.substring(0, 7) || 'N/A'}
        </Text>
      </Box>

      <Box height={1} />

      <Text bold color="cyan">Stages:</Text>
      <Box height={1} />

      {state.stages.map((stage) => (
        <Box key={stage.stageName} flexDirection="column" marginBottom={1}>
          <Text>
            {stage.status === 'success' ? '✅' : stage.status === 'failed' ? '❌' : '⏭️'}{' '}
            <Text bold>{stage.stageName}</Text>
            {stage.duration && <Text dimColor> ({stage.duration.toFixed(1)}s)</Text>}
          </Text>

          {stage.commitSha && (
            <Box marginLeft={3}>
              <Text dimColor>└─ Commit: </Text>
              <Text color="cyan">{stage.commitSha.substring(0, 7)}</Text>
            </Box>
          )}

          {stage.error && (
            <Box marginLeft={3} flexDirection="column">
              <Text color="red">└─ Error: {stage.error.message}</Text>
              {stage.error.suggestion && (
                <Text color="yellow">   💡 {stage.error.suggestion}</Text>
              )}
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
};
