// src/cli/utils/interactive-prompts.ts
// Utility for interactive CLI prompts

import * as readline from 'readline';

export class InteractivePrompts {
  /**
   * Ask a yes/no question
   */
  static async confirm(question: string, defaultValue = false): Promise<boolean> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const defaultStr = defaultValue ? 'Y/n' : 'y/N';
    const answer = await new Promise<string>((resolve) => {
      rl.question(`${question} (${defaultStr}): `, resolve);
    });

    rl.close();

    if (answer.trim() === '') {
      return defaultValue;
    }

    return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
  }

  /**
   * Ask for text input
   */
  static async ask(question: string, defaultValue?: string): Promise<string> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const prompt = defaultValue ? `${question} (${defaultValue}): ` : `${question}: `;
    const answer = await new Promise<string>((resolve) => {
      rl.question(prompt, resolve);
    });

    rl.close();

    return answer.trim() || defaultValue || '';
  }

  /**
   * Choose from a list of options
   */
  static async choose<T extends string>(
    question: string,
    options: T[],
    defaultValue?: T
  ): Promise<T> {
    console.log(question);
    options.forEach((opt, idx) => {
      const marker = opt === defaultValue ? '*' : ' ';
      console.log(`${marker} ${idx + 1}. ${opt}`);
    });

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const defaultIndex = defaultValue ? options.indexOf(defaultValue) + 1 : undefined;
    const prompt = defaultIndex
      ? `Enter number [1-${options.length}] (default: ${defaultIndex}): `
      : `Enter number [1-${options.length}]: `;

    const answer = await new Promise<string>((resolve) => {
      rl.question(prompt, resolve);
    });

    rl.close();

    const trimmed = answer.trim();

    // Handle empty input with default
    if (trimmed === '' && defaultValue !== undefined) {
      return defaultValue;
    }

    const index = parseInt(trimmed, 10) - 1;

    if (isNaN(index) || index < 0 || index >= options.length) {
      console.error(`❌ Invalid selection. Please enter a number between 1 and ${options.length}.`);
      process.exit(1);
    }

    return options[index];
  }

  /**
   * Multi-select from a list of options
   */
  static async multiSelect<T extends { name: string; value: string }>(
    question: string,
    options: T[]
  ): Promise<string[]> {
    console.log(question);
    console.log(`(Enter numbers separated by commas, e.g., "1,3,4" or "all" for all)`);
    options.forEach((opt, idx) => {
      console.log(`  ${idx + 1}. ${opt.name}`);
    });

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const answer = await new Promise<string>((resolve) => {
      rl.question(`Select agents [1-${options.length}]: `, resolve);
    });

    rl.close();

    const trimmed = answer.trim().toLowerCase();

    // Handle "all" selection
    if (trimmed === 'all') {
      return options.map(opt => opt.value);
    }

    // Parse comma-separated numbers
    const parts = trimmed.split(',').map(s => s.trim()).filter(s => s !== '');

    if (parts.length === 0) {
      console.error('❌ No selection made. Please enter at least one number.');
      return [];
    }

    const selections: number[] = [];
    const invalidParts: string[] = [];

    for (const part of parts) {
      const num = parseInt(part, 10);
      if (isNaN(num) || num < 1 || num > options.length) {
        invalidParts.push(part);
      } else {
        selections.push(num - 1);
      }
    }

    if (invalidParts.length > 0) {
      console.error(`❌ Invalid selection(s): ${invalidParts.join(', ')}. Valid range is 1-${options.length}.`);
      return [];
    }

    // Remove duplicates
    const uniqueSelections = [...new Set(selections)];
    return uniqueSelections.map(idx => options[idx].value);
  }
}
