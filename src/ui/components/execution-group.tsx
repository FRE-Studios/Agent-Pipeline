// src/ui/components/execution-group.tsx

import React from 'react';
import { Box, Text } from 'ink';
import { StageRow } from './stage-row.js';
import { AgentStageConfig, StageExecution } from '../../config/schema.js';

interface ExecutionGroupProps {
  group: AgentStageConfig[];
  executedStages: StageExecution[];
  title: string;
}

export const ExecutionGroup: React.FC<ExecutionGroupProps> = ({
  group,
  executedStages,
  title,
}) => {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>{title}</Text>
      {group.map((agentConfig, index) => {
        const stage = executedStages.find(
          (s) => s.stageName === agentConfig.name,
        );

        if (stage) {
          return (
            <StageRow
              key={agentConfig.name}
              stage={stage}
              isLast={index === group.length - 1}
            />
          );
        }

        // Render pending stage
        return (
          <Box key={agentConfig.name} marginLeft={2}>
            <Text dimColor>⏸️ {agentConfig.name} (pending)</Text>
          </Box>
        );
      })}
    </Box>
  );
};
