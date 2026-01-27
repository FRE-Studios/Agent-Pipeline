// src/ui/components/summary-line.tsx

import React from 'react';
import { Box, Text } from 'ink';

interface SummaryLineProps {
  label: string;
  value: string | undefined;
  color?: string;
}

export const SummaryLine: React.FC<SummaryLineProps> = ({ label, value, color = 'white' }) => {
  if (!value) {
    return null;
  }

  return (
    <Box>
      <Text bold>{label}: </Text>
      <Text color={color}>{value}</Text>
    </Box>
  );
};
