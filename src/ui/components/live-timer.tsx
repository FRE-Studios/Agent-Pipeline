// src/ui/components/live-timer.tsx

import React, { useState, useEffect } from 'react';
import { Text } from 'ink';

interface LiveTimerProps {
  startTime: string; // ISO timestamp
  isRunning: boolean;
  finalDuration?: number; // Use this when finished
}

/**
 * A live timer that updates every second while running.
 * Shows elapsed time from startTime, or finalDuration when finished.
 */
export const LiveTimer: React.FC<LiveTimerProps> = ({
  startTime,
  isRunning,
  finalDuration,
}) => {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!isRunning) {
      // When not running, just show the final duration
      return;
    }

    // Calculate initial elapsed time
    const start = new Date(startTime).getTime();
    const updateElapsed = () => {
      const now = Date.now();
      setElapsed((now - start) / 1000);
    };

    // Update immediately
    updateElapsed();

    // Then update every second
    const interval = setInterval(updateElapsed, 1000);

    return () => clearInterval(interval);
  }, [startTime, isRunning]);

  // Use final duration if available and not running, otherwise use live elapsed
  const displayDuration = !isRunning && finalDuration !== undefined
    ? finalDuration
    : elapsed;

  return <Text>{displayDuration.toFixed(1)}s</Text>;
};
