// src/ui/components/interactive-summary.tsx

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Box, Text, Newline, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import * as fs from 'fs/promises';
import * as path from 'path';
import { PipelineState } from '../../config/schema.js';
import { SummaryLine } from './summary-line.js';
import { StatusBadge } from './status-badge.js';
import { KeyboardHints, KeyboardHint } from './keyboard-hints.js';
import { openWithSystem, openInPager } from '../../utils/platform-opener.js';

interface InteractiveSummaryProps {
  state: PipelineState;
}

type InputMode = 'navigation' | 'input';

export const InteractiveSummary: React.FC<InteractiveSummaryProps> = ({ state }) => {
  const { exit } = useApp();
  const [mode, setMode] = useState<InputMode>('navigation');
  const [noteText, setNoteText] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isExiting, setIsExiting] = useState(false);
  const statusTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Derived availability flags
  const hasHandoverDir = Boolean(state.artifacts.handoverDir);
  const hasPrUrl = Boolean(state.artifacts.pullRequest?.url);
  const logPath = hasHandoverDir
    ? path.join(state.artifacts.handoverDir, 'LOG.md')
    : null;

  // Status message timeout helper
  const showStatus = useCallback((message: string, duration = 2000) => {
    if (statusTimeoutRef.current) {
      clearTimeout(statusTimeoutRef.current);
    }
    setStatusMessage(message);
    statusTimeoutRef.current = setTimeout(() => setStatusMessage(null), duration);
  }, []);

  useEffect(() => {
    return () => {
      if (statusTimeoutRef.current) {
        clearTimeout(statusTimeoutRef.current);
      }
    };
  }, []);

  // Action handlers
  const handleOpenDirectory = useCallback(async () => {
    if (!hasHandoverDir) return;
    try {
      await openWithSystem(state.artifacts.handoverDir, 'directory');
      showStatus('Opened directory in file manager');
    } catch {
      showStatus('Failed to open directory');
    }
  }, [state.artifacts.handoverDir, hasHandoverDir, showStatus]);

  const handleOpenPr = useCallback(async () => {
    if (!hasPrUrl || !state.artifacts.pullRequest) return;
    try {
      await openWithSystem(state.artifacts.pullRequest.url, 'url');
      showStatus('Opened PR in browser');
    } catch {
      showStatus('Failed to open PR');
    }
  }, [state.artifacts.pullRequest, hasPrUrl, showStatus]);

  const handleOpenLogs = useCallback(async () => {
    if (!logPath) return;

    // Must exit Ink before spawning pager (same pattern as history.tsx)
    setIsExiting(true);
    exit();

    // Let Ink restore terminal state before launching pager
    await new Promise(resolve => setImmediate(resolve));
    await openInPager(logPath);

    // After pager closes, process will exit naturally
  }, [logPath, exit]);

  const handleAddNote = useCallback(async () => {
    if (!logPath || !noteText.trim()) {
      setMode('navigation');
      setNoteText('');
      return;
    }

    try {
      const timestamp = new Date().toISOString();
      const noteEntry = `\n---\n## [${timestamp}] User Note\n${noteText.trim()}\n`;
      await fs.appendFile(logPath, noteEntry);
      showStatus('Note added to LOG.md');
    } catch {
      showStatus('Failed to add note');
    }

    setMode('navigation');
    setNoteText('');
  }, [logPath, noteText, showStatus]);

  const handleExit = useCallback(() => {
    exit();
  }, [exit]);

  // Keyboard input handling
  useInput((input, key) => {
    if (isExiting) return;

    if (mode === 'input') {
      if (key.escape) {
        setMode('navigation');
        setNoteText('');
      }
      // Note: Enter is handled by TextInput's onSubmit
      return;
    }

    // Navigation mode shortcuts
    switch (input.toLowerCase()) {
      case 'o':
        handleOpenDirectory();
        break;
      case 'p':
        if (hasPrUrl) handleOpenPr();
        break;
      case 'n':
        if (hasHandoverDir) setMode('input');
        break;
      case 'l':
        if (hasHandoverDir) handleOpenLogs();
        break;
      case 'q':
        handleExit();
        break;
    }

    if (key.escape) {
      handleExit();
    }
  });

  // Build keyboard hints based on available options
  const hints: KeyboardHint[] = [
    { key: 'o', label: 'Open directory', disabled: !hasHandoverDir },
    // Only show PR option when a PR was actually created
    ...(hasPrUrl ? [{ key: 'p', label: 'Open PR' }] : []),
    { key: 'n', label: 'Add note', disabled: !hasHandoverDir },
    { key: 'l', label: 'View logs', disabled: !hasHandoverDir },
    { key: 'q', label: 'Exit' },
  ];

  if (isExiting) {
    return <Text dimColor>Opening logs...</Text>;
  }

  return (
    <Box flexDirection="column" marginTop={1} borderStyle="round" padding={1}>
      {/* Header */}
      <Box>
        <Text bold>Pipeline </Text>
        <StatusBadge status={state.status} />
      </Box>

      <Newline />

      {/* Error message for failed pipelines */}
      {state.status === 'failed' && state.stages.some(s => s.error) && (
        <Box flexDirection="column" marginBottom={1}>
          {state.stages
            .filter(s => s.error)
            .map((stage, idx) => (
              <Box key={idx} flexDirection="column">
                <Text color="red" bold>Error in {stage.stageName}:</Text>
                <Text color="red">{stage.error?.message}</Text>
              </Box>
            ))}
        </Box>
      )}

      {/* Summary stats */}
      <SummaryLine
        label="Total Duration"
        value={`${state.artifacts.totalDuration.toFixed(1)}s`}
      />
      <SummaryLine
        label="Total Commits"
        value={`${state.stages.filter(s => s.commitSha).length}`}
      />
      <SummaryLine
        label="PR"
        value={state.artifacts.pullRequest?.url}
        color="cyan"
      />
      <SummaryLine
        label="Handover Dir"
        value={state.artifacts.handoverDir}
        color="gray"
      />

      {/* Status message */}
      {statusMessage && (
        <Box marginTop={1}>
          <Text color="green">{statusMessage}</Text>
        </Box>
      )}

      {/* Note input mode */}
      {mode === 'input' && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Add note to LOG.md:</Text>
          <Box>
            <Text color="cyan">&gt; </Text>
            <TextInput
              value={noteText}
              onChange={setNoteText}
              onSubmit={handleAddNote}
              placeholder="Type your note and press Enter..."
            />
          </Box>
          <Text dimColor>Press Enter to save, Escape to cancel</Text>
        </Box>
      )}

      {/* Keyboard hints (only in navigation mode) */}
      {mode === 'navigation' && <KeyboardHints hints={hints} />}
    </Box>
  );
};
