// src/ui/components/loop-session-summary.tsx

import React from 'react';
import { Box, Text, Newline } from 'ink';
import { IterationHistoryEntry } from '../../config/schema.js';
import { SummaryLine } from './summary-line.js';

interface LoopSessionSummaryProps {
  iterations: IterationHistoryEntry[];
}

export const LoopSessionSummary: React.FC<LoopSessionSummaryProps> = ({
  iterations
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

  return (
    <Box
      flexDirection="column"
      marginBottom={1}
      borderStyle="round"
      borderColor="magenta"
      paddingX={1}
    >
      <Text bold color="magenta">Loop Session Complete</Text>
      <Newline />

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
