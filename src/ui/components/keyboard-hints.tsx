// src/ui/components/keyboard-hints.tsx

import React from 'react';
import { Box, Text } from 'ink';

export interface KeyboardHint {
  key: string;
  label: string;
  disabled?: boolean;
}

interface KeyboardHintsProps {
  hints: KeyboardHint[];
}

export const KeyboardHints: React.FC<KeyboardHintsProps> = ({ hints }) => {
  return (
    <Box marginTop={1}>
      <Text dimColor>
        {hints.map((hint, index) => (
          <React.Fragment key={hint.key}>
            {index > 0 && ' | '}
            <Text dimColor={hint.disabled} strikethrough={hint.disabled}>
              [{hint.key}] {hint.label}
            </Text>
          </React.Fragment>
        ))}
      </Text>
    </Box>
  );
};
