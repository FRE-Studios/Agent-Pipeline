// src/ui/components/loop-iteration-history.tsx

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { IterationHistoryEntry } from '../../config/schema.js';

interface LoopIterationHistoryProps {
  iterations: IterationHistoryEntry[];
}

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

      {/* Expanded view - show all iterations */}
      {expanded && (
        <Box flexDirection="column" marginLeft={2} marginTop={1}>
          {iterations.map((iter) => (
            <Box key={iter.iterationNumber}>
              {getStatusIcon(iter.status)}
              <Text> #{iter.iterationNumber} </Text>
              <Text bold>{iter.pipelineName}</Text>
              <Text dimColor> ({iter.duration.toFixed(1)}s, {iter.commitCount} commits)</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Collapsed view - show last 3 iterations inline */}
      {!expanded && (
        <Box marginLeft={2}>
          {iterations.slice(-3).map((iter, idx) => (
            <React.Fragment key={iter.iterationNumber}>
              {idx > 0 && <Text dimColor> | </Text>}
              {getStatusIcon(iter.status)}
              <Text dimColor> #{iter.iterationNumber}</Text>
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
