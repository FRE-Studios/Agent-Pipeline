// src/ui/components/status-badge.tsx

import React from 'react';
import { Text } from 'ink';

interface StatusBadgeProps {
  status: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  const colors: Record<string, string> = {
    running: 'yellow',
    completed: 'green',
    failed: 'red',
    partial: 'yellow'
  };

  return (
    <Text bold color={colors[status] || 'white'}>
      {status.toUpperCase()}
    </Text>
  );
};
