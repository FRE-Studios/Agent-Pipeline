// src/ui/components/stage-row.tsx

import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { StageExecution } from '../../config/schema.js';
import { PipelineFormatter } from '../../utils/pipeline-formatter.js';

interface StageRowProps {
  stage: StageExecution;
  isLast: boolean;
}

export const StageRow: React.FC<StageRowProps> = ({
  stage,
  isLast,
}) => {
  const getIcon = () => {
    switch (stage.status) {
      case 'running':
        return (
          <Text color="yellow">
            <Spinner type="dots" />
          </Text>
        );
      case 'success':
        return <Text color="green">✅</Text>;
      case 'failed':
        return <Text color="red">❌</Text>;
      case 'skipped':
        return <Text dimColor>⏭️</Text>;
      default:
        return <Text>⏸️</Text>;
    }
  };

  return (
    <Box flexDirection="column" marginLeft={2} marginBottom={isLast ? 0 : 1}>
      <Box>
        {getIcon()}
        <Text bold> {stage.stageName}</Text>
        {stage.duration && (
          <Text dimColor> ({stage.duration.toFixed(1)}s)</Text>
        )}
        {stage.retryAttempt !== undefined && stage.retryAttempt > 0 && (
          <Text color="yellow">
            {' '}
            [retry {stage.retryAttempt}/{stage.maxRetries}]
          </Text>
        )}
      </Box>

      {stage.commitSha && (
        <Box marginLeft={3}>
          <Text dimColor>└─ Commit: </Text>
          <Text color="cyan">{stage.commitSha.substring(0, 7)}</Text>
        </Box>
      )}

      {stage.tokenUsage && stage.status === 'success' && (
        <Box marginLeft={3}>
          <Text dimColor>└─ Tokens: </Text>
          <Text color="magenta">{PipelineFormatter.formatTokenUsage(stage.tokenUsage)}</Text>
        </Box>
      )}

      {/* Show tool activity for running stages */}
      {stage.status === 'running' && stage.toolActivity && stage.toolActivity.length > 0 && (
        <Box marginLeft={3} flexDirection="column">
          {stage.toolActivity.map((activity, idx) => (
            <Text key={idx} dimColor>
              {idx === stage.toolActivity!.length - 1 ? '└─ ' : '├─ '}
              {activity}
            </Text>
          ))}
        </Box>
      )}

      {/* Show agent output for failed stages */}
      {stage.status === 'failed' && stage.agentOutput && (
        <Box marginLeft={3} flexDirection="column">
          <Text dimColor>└─ Output:</Text>
          <Box marginLeft={3} flexDirection="column">
            <Text>{stage.agentOutput.split('\n').slice(-3).join('\n')}</Text>
          </Box>
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
  );
};
