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

    const prompt = defaultValue
      ? `Enter number (default: ${options.indexOf(defaultValue) + 1}): `
      : 'Enter number: ';

    const answer = await new Promise<string>((resolve) => {
      rl.question(prompt, resolve);
    });

    rl.close();

    const index = answer.trim() ? parseInt(answer.trim(), 10) - 1 : options.indexOf(defaultValue!);

    if (index < 0 || index >= options.length) {
      console.log('Invalid selection');
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
    console.log('(Enter numbers separated by commas, e.g., "1,3,4")');
    options.forEach((opt, idx) => {
      console.log(`  ${idx + 1}. ${opt.name}`);
    });

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const answer = await new Promise<string>((resolve) => {
      rl.question('Select agents: ', resolve);
    });

    rl.close();

    const selections = answer
      .split(',')
      .map(s => parseInt(s.trim(), 10) - 1)
      .filter(idx => idx >= 0 && idx < options.length);

    return selections.map(idx => options[idx].value);
  }
}
