// src/ui/pipeline-ui.tsx

import React, { useState, useEffect } from 'react';
import { Box, Text, Newline } from 'ink';
import {
  AgentStageConfig,
  PipelineConfig,
  PipelineState,
} from '../config/schema.js';
import { ExecutionGroup } from './components/execution-group.js';
import { StatusBadge } from './components/status-badge.js';
import { SummaryLine } from './components/summary-line.js';
import { LiveTimer } from './components/live-timer.js';

interface PipelineUIProps {
  onStateChange: (callback: (state: PipelineState) => void) => void;
}

// Helper to group stages by dependencies for visualization
const getExecutionGroups = (pipelineConfig: PipelineConfig) => {
  const groups: AgentStageConfig[][] = [];
  const stages = [...pipelineConfig.agents];
  const stageNames = new Set(stages.map((s) => s.name));

  let level = 0;
  while (stages.length > 0) {
    const currentGroup: AgentStageConfig[] = [];
    const remainingStages: AgentStageConfig[] = [];

    stages.forEach((stage) => {
      const deps = stage.dependsOn || [];
      const depsMet = deps.every((dep) => !stageNames.has(dep));
      if (depsMet) {
        currentGroup.push(stage);
      } else {
        remainingStages.push(stage);
      }
    });

    if (currentGroup.length === 0 && remainingStages.length > 0) {
      // Circular dependency detected, avoid infinite loop
      groups.push(remainingStages);
      break;
    }

    groups.push(currentGroup);
    currentGroup.forEach((s) => stageNames.delete(s.name));
    stages.splice(0, stages.length, ...remainingStages);
    level++;
  }

  return groups;
};

const FinalSummary: React.FC<{ state: PipelineState }> = ({ state }) => (
  <Box flexDirection="column" marginTop={1} borderStyle="round" padding={1}>
    <Text bold>Pipeline {state.status}</Text>
    <Newline />
    <SummaryLine label="Total Duration" value={`${state.artifacts.totalDuration.toFixed(1)}s`} />
    <SummaryLine label="Total Commits" value={`${state.stages.filter(s => s.commitSha).length}`} />
    <SummaryLine label="PR" value={state.artifacts.pullRequest?.url} color="cyan" />
  </Box>
);

export const PipelineUI: React.FC<PipelineUIProps> = ({ onStateChange }) => {
  const [state, setState] = useState<PipelineState | null>(null);

  useEffect(() => {
    onStateChange(setState);
  }, [onStateChange]);

  if (!state) {
    return <Text>Initializing pipeline...</Text>;
  }

  const executionGroups = getExecutionGroups(state.pipelineConfig);
  const isFinished = state.status === 'completed' || state.status === 'failed' || state.status === 'partial';

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box borderStyle="round" borderColor="cyan" paddingX={1} paddingY={0}>
        <Box flexDirection="column">
          <Text bold color="cyan">
            🤖 Agent Pipeline: {state.pipelineConfig.name}
          </Text>
          {/* Loop context indicator */}
          {state.loopContext && (
            <SummaryLine
              label="Loop"
              value={
                state.loopContext.maxIterations
                  ? `${state.loopContext.currentIteration}/${state.loopContext.maxIterations}`
                  : `${state.loopContext.currentIteration}`
              }
              color="magenta"
            />
          )}
          <SummaryLine label="Run ID" value={state.runId.substring(0, 8)} />
          <SummaryLine label="Branch" value={state.artifacts.pullRequest?.branch} />
        </Box>
      </Box>

      <Newline />

      {/* Stages */}
      {executionGroups.map((group, index) => (
        <ExecutionGroup
          key={index}
          title={`Group ${index + 1}`}
          group={group}
          executedStages={state.stages}
        />
      ))}

      {isFinished && <FinalSummary state={state} />}

      {!isFinished && (
        <Box borderStyle="single" borderColor="gray" paddingX={1} marginTop={1}>
          <Text>
            {state.loopContext && <Text color="magenta">🔁 Loop {state.loopContext.currentIteration} | </Text>}
            Status: <StatusBadge status={state.status} /> | Duration:{' '}
            <LiveTimer
              startTime={state.trigger.timestamp}
              isRunning={!isFinished}
              finalDuration={state.artifacts.totalDuration}
            />
            {' '}| Commits:{' '}
            {state.stages.filter((s) => s.commitSha).length}
          </Text>
        </Box>
      )}
    </Box>
  );
};
