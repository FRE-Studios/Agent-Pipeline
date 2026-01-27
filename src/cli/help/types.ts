// src/cli/help/types.ts

export interface OptionHelp {
  flags: string;          // e.g., "-d, --dry-run"
  description: string;
  default?: string;
}

export interface ExampleHelp {
  command: string;
  description: string;
}

export interface CommandHelp {
  name: string;
  summary: string;        // One line, shown in main help
  description: string;    // Detailed, shown in command help
  usage: string[];        // Usage patterns
  options: OptionHelp[];
  examples: ExampleHelp[];
  seeAlso?: string[];     // Related commands
}

export interface CommandHelpRegistry {
  [commandName: string]: CommandHelp;
}
