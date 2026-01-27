// src/ui/components/loop-iteration-history.tsx

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { IterationHistoryEntry } from '../../config/schema.js';

interface LoopIterationHistoryProps {
  iterations: IterationHistoryEntry[];
}

// Format token count with K/M suffix
const formatTokens = (count: number): string => {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K`;
  }
  return String(count);
};

export const LoopIterationHistory: React.FC<LoopIterationHistoryProps> = ({
  iterations
}) => {
  const [expanded, setExpanded] = useState(false);

  useInput((input) => {
    if (input.toLowerCase() === 'h') {
      setExpanded(!expanded);
    }
  });

  const getStatusIcon = (status: IterationHistoryEntry['status']) => {
    switch (status) {
      case 'completed':
        return <Text color="green">✅</Text>;
      case 'failed':
        return <Text color="red">❌</Text>;
      case 'aborted':
        return <Text color="magenta">⚠️</Text>;
      default:
        return <Text>⏸️</Text>;
    }
  };

  const completedCount = iterations.filter(i => i.status === 'completed').length;

  if (iterations.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Header line */}
      <Box>
        <Text color="magenta" bold>🔁 Loop Progress: </Text>
        <Text color="green">{completedCount}</Text>
        <Text dimColor>/{iterations.length} completed</Text>
        <Text dimColor> | [h] {expanded ? 'collapse' : 'expand'}</Text>
      </Box>

      {/* Expanded view - detailed summary per iteration */}
      {expanded && (
        <Box flexDirection="column" marginLeft={2} marginTop={1}>
          {iterations.map((iter, idx) => (
            <Box key={iter.iterationNumber} flexDirection="column" marginBottom={idx < iterations.length - 1 ? 1 : 0}>
              {/* Iteration header */}
              <Box>
                {getStatusIcon(iter.status)}
                <Text> #{iter.iterationNumber} </Text>
                <Text bold>{iter.pipelineName}</Text>
                <Text dimColor> ({iter.duration.toFixed(1)}s)</Text>
              </Box>

              {/* Iteration details */}
              <Box marginLeft={3} flexDirection="column">
                <Box>
                  <Text dimColor>├─ Stages: </Text>
                  <Text color="green">{iter.successfulStages}</Text>
                  <Text dimColor>/{iter.stageCount}</Text>
                  {iter.failedStages > 0 && (
                    <Text color="red"> ({iter.failedStages} failed)</Text>
                  )}
                </Box>

                <Box>
                  <Text dimColor>{iter.tokenUsage ? '├' : '└'}─ Commits: </Text>
                  <Text>{iter.commitCount}</Text>
                </Box>

                {iter.tokenUsage && (
                  <Box>
                    <Text dimColor>└─ Tokens: </Text>
                    <Text color="cyan">{formatTokens(iter.tokenUsage.totalInput)} in</Text>
                    <Text dimColor> / </Text>
                    <Text color="yellow">{formatTokens(iter.tokenUsage.totalOutput)} out</Text>
                    {iter.tokenUsage.totalCacheRead > 0 && (
                      <>
                        <Text dimColor> / </Text>
                        <Text color="green">{formatTokens(iter.tokenUsage.totalCacheRead)} cached</Text>
                      </>
                    )}
                  </Box>
                )}
              </Box>
            </Box>
          ))}
        </Box>
      )}

      {/* Collapsed view - name and duration inline */}
      {!expanded && (
        <Box marginLeft={2} flexWrap="wrap">
          {iterations.slice(-3).map((iter, idx) => (
            <React.Fragment key={iter.iterationNumber}>
              {idx > 0 && <Text dimColor> | </Text>}
              {getStatusIcon(iter.status)}
              <Text> #{iter.iterationNumber} </Text>
              <Text>{iter.pipelineName}</Text>
              <Text dimColor> ({iter.duration.toFixed(1)}s)</Text>
            </React.Fragment>
          ))}
          {iterations.length > 3 && (
            <Text dimColor> (+{iterations.length - 3} more)</Text>
          )}
        </Box>
      )}
    </Box>
  );
};
