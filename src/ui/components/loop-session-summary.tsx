// src/ui/components/loop-session-summary.tsx

import React from 'react';
import { Box, Text, Newline } from 'ink';
import { IterationHistoryEntry } from '../../config/schema.js';
import { SummaryLine } from './summary-line.js';

interface LoopSessionSummaryProps {
  iterations: IterationHistoryEntry[];
  terminationReason?: 'natural' | 'limit-reached' | 'failure';
}

export const LoopSessionSummary: React.FC<LoopSessionSummaryProps> = ({
  iterations,
  terminationReason
}) => {
  if (iterations.length === 0) {
    return null;
  }

  const successCount = iterations.filter(i => i.status === 'completed').length;
  const failCount = iterations.filter(i => i.status === 'failed').length;
  const abortCount = iterations.filter(i => i.status === 'aborted').length;
  const totalDuration = iterations.reduce((sum, i) => sum + i.duration, 0);
  const totalCommits = iterations.reduce((sum, i) => sum + i.commitCount, 0);
  const successRate = iterations.length > 0
    ? ((successCount / iterations.length) * 100).toFixed(0)
    : '0';

  const isSuccess = terminationReason === 'natural' || !terminationReason;
  const resultLabel = isSuccess
    ? 'Completed'
    : terminationReason === 'limit-reached'
      ? 'Failed (limit reached)'
      : 'Failed';

  return (
    <Box
      flexDirection="column"
      marginBottom={1}
      borderStyle="round"
      borderColor={isSuccess ? 'magenta' : 'red'}
      paddingX={1}
    >
      <Text bold color={isSuccess ? 'magenta' : 'red'}>
        {isSuccess ? 'Loop Session Complete' : 'Loop Session Failed'}
      </Text>
      <Newline />

      <SummaryLine label="Result" value={resultLabel} color={isSuccess ? 'green' : 'red'} />
      <SummaryLine label="Total Iterations" value={`${iterations.length}`} />
      <SummaryLine
        label="Success Rate"
        value={`${successRate}% (${successCount}/${iterations.length})`}
        color={successCount === iterations.length ? 'green' : 'yellow'}
      />
      <SummaryLine label="Total Duration" value={`${totalDuration.toFixed(1)}s`} />
      <SummaryLine label="Total Commits" value={`${totalCommits}`} />

      {failCount > 0 && (
        <Box marginTop={1}>
          <Text color="red">Failed iterations: {failCount}</Text>
        </Box>
      )}

      {abortCount > 0 && (
        <Box>
          <Text color="magenta">Aborted iterations: {abortCount}</Text>
        </Box>
      )}
    </Box>
  );
};
