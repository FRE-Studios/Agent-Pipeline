// src/ui/components/stage-row.tsx

import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { StageExecution } from '../../config/schema.js';
import { PipelineFormatter } from '../../utils/pipeline-formatter.js';

interface StageRowProps {
  stage: StageExecution;
  isLast: boolean;
  condition?: string;
}

export const StageRow: React.FC<StageRowProps> = ({
  stage,
  isLast,
  condition,
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

  const hasExtractedData =
    stage.extractedData && Object.keys(stage.extractedData).length > 0;

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

      {stage.conditionEvaluated && !stage.conditionResult && condition && (
        <Box marginLeft={3}>
          <Text dimColor>└─ Condition not met: </Text>
          <Text color="gray">{condition}</Text>
        </Box>
      )}

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

      {stage.status === 'success' && hasExtractedData && (
        <Box marginLeft={3} flexDirection="column">
          <Text dimColor>└─ Outputs:</Text>
          {Object.entries(stage.extractedData || {}).map(([key, value]) => (
            <Box key={key} marginLeft={2}>
              <Text>
                - {key}: {JSON.stringify(value)}
              </Text>
            </Box>
          ))}
        </Box>
      )}

      {(stage.status === 'running' || stage.status === 'failed') &&
        stage.agentOutput && (
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
