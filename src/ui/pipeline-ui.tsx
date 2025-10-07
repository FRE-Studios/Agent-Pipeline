// src/ui/pipeline-ui.tsx

import React, { useState, useEffect } from 'react';
import { Box, Text, Newline } from 'ink';
import { PipelineState } from '../config/schema.js';
import { StageRow } from './components/stage-row.js';
import { StatusBadge } from './components/status-badge.js';

interface PipelineUIProps {
  pipelineName: string;
  onStateChange: (callback: (state: PipelineState) => void) => void;
}

export const PipelineUI: React.FC<PipelineUIProps> = ({
  onStateChange
}) => {
  const [state, setState] = useState<PipelineState | null>(null);

  useEffect(() => {
    onStateChange(setState);
  }, [onStateChange]);

  if (!state) {
    return <Text>Initializing pipeline...</Text>;
  }

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box borderStyle="round" borderColor="cyan" padding={1}>
        <Box flexDirection="column">
          <Text bold color="cyan">
            🤖 Agent Pipeline: {state.pipelineConfig.name}
          </Text>
          <Text dimColor>Run ID: {state.runId.substring(0, 8)}</Text>
        </Box>
      </Box>

      <Newline />

      {/* Stages */}
      <Box flexDirection="column">
        {state.stages.map((stage, index) => (
          <StageRow
            key={stage.stageName}
            stage={stage}
            isLast={index === state.stages.length - 1}
          />
        ))}

        {/* Pending stages */}
        {state.pipelineConfig.agents
          .slice(state.stages.length)
          .map((agent) => (
            <Box key={agent.name} marginLeft={2}>
              <Text dimColor>⏸️  {agent.name}</Text>
              <Text dimColor> (pending)</Text>
            </Box>
          ))}
      </Box>

      <Newline />

      {/* Footer */}
      <Box borderStyle="single" borderColor="gray" padding={1}>
        <Text>
          Status: <StatusBadge status={state.status} /> | Duration:{' '}
          {state.artifacts.totalDuration.toFixed(1)}s | Commits:{' '}
          {state.stages.filter((s) => s.commitSha).length}
        </Text>
      </Box>
    </Box>
  );
};
