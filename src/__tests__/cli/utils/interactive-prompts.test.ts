// src/__tests__/cli/utils/interactive-prompts.test.ts
// Tests for InteractivePrompts utility

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InteractivePrompts } from '../../../cli/utils/interactive-prompts.js';
import * as readline from 'readline';

// Mock readline module
vi.mock('readline');

describe('InteractivePrompts', () => {
  let mockRl: {
    question: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock readline interface
    mockRl = {
      question: vi.fn(),
      close: vi.fn()
    };

    vi.mocked(readline.createInterface).mockReturnValue(mockRl as any);
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  describe('confirm()', () => {
    it('should return true when user enters "y"', async () => {
      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('y');
      });

      const result = await InteractivePrompts.confirm('Proceed?');

      expect(result).toBe(true);
      expect(mockRl.question).toHaveBeenCalledWith(
        'Proceed? (y/N): ',
        expect.any(Function)
      );
      expect(mockRl.close).toHaveBeenCalled();
    });

    it('should return true when user enters "yes"', async () => {
      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('yes');
      });

      const result = await InteractivePrompts.confirm('Proceed?');

      expect(result).toBe(true);
    });

    it('should return true when user enters "Y" (uppercase)', async () => {
      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('Y');
      });

      const result = await InteractivePrompts.confirm('Proceed?');

      expect(result).toBe(true);
    });

    it('should return true when user enters "YES" (uppercase)', async () => {
      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('YES');
      });

      const result = await InteractivePrompts.confirm('Proceed?');

      expect(result).toBe(true);
    });

    it('should return false when user enters "n"', async () => {
      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('n');
      });

      const result = await InteractivePrompts.confirm('Proceed?');

      expect(result).toBe(false);
    });

    it('should return false when user enters "no"', async () => {
      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('no');
      });

      const result = await InteractivePrompts.confirm('Proceed?');

      expect(result).toBe(false);
    });

    it('should return false when user enters any other value', async () => {
      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('maybe');
      });

      const result = await InteractivePrompts.confirm('Proceed?');

      expect(result).toBe(false);
    });

    it('should return default value (false) when user enters empty string', async () => {
      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('');
      });

      const result = await InteractivePrompts.confirm('Proceed?', false);

      expect(result).toBe(false);
    });

    it('should return default value (true) when user enters empty string', async () => {
      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('');
      });

      const result = await InteractivePrompts.confirm('Proceed?', true);

      expect(result).toBe(true);
    });

    it('should show Y/n prompt when default is true', async () => {
      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('');
      });

      await InteractivePrompts.confirm('Continue?', true);

      expect(mockRl.question).toHaveBeenCalledWith(
        'Continue? (Y/n): ',
        expect.any(Function)
      );
    });

    it('should show y/N prompt when default is false', async () => {
      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('');
      });

      await InteractivePrompts.confirm('Continue?', false);

      expect(mockRl.question).toHaveBeenCalledWith(
        'Continue? (y/N): ',
        expect.any(Function)
      );
    });

    it('should handle leading/trailing whitespace', async () => {
      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('  y  ');
      });

      const result = await InteractivePrompts.confirm('Proceed?');

      // Current implementation doesn't trim before comparison, only for empty check
      // So "  y  " !== "y" and returns false
      expect(result).toBe(false);
    });
  });

  describe('ask()', () => {
    it('should return user input', async () => {
      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('test-input');
      });

      const result = await InteractivePrompts.ask('Enter name');

      expect(result).toBe('test-input');
      expect(mockRl.question).toHaveBeenCalledWith(
        'Enter name: ',
        expect.any(Function)
      );
      expect(mockRl.close).toHaveBeenCalled();
    });

    it('should return default value when user enters empty string', async () => {
      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('');
      });

      const result = await InteractivePrompts.ask('Enter name', 'default-name');

      expect(result).toBe('default-name');
    });

    it('should show default value in prompt', async () => {
      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('');
      });

      await InteractivePrompts.ask('Enter name', 'default-name');

      expect(mockRl.question).toHaveBeenCalledWith(
        'Enter name (default-name): ',
        expect.any(Function)
      );
    });

    it('should not show default when not provided', async () => {
      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('input');
      });

      await InteractivePrompts.ask('Enter name');

      expect(mockRl.question).toHaveBeenCalledWith(
        'Enter name: ',
        expect.any(Function)
      );
    });

    it('should trim whitespace from input', async () => {
      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('  trimmed  ');
      });

      const result = await InteractivePrompts.ask('Enter value');

      expect(result).toBe('trimmed');
    });

    it('should return empty string when no input and no default', async () => {
      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('');
      });

      const result = await InteractivePrompts.ask('Enter value');

      expect(result).toBe('');
    });

    it('should prefer user input over default value', async () => {
      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('user-input');
      });

      const result = await InteractivePrompts.ask('Enter name', 'default');

      expect(result).toBe('user-input');
    });
  });

  describe('choose()', () => {
    const options = ['option1', 'option2', 'option3'];

    it('should return selected option', async () => {
      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('2');
      });

      const result = await InteractivePrompts.choose('Select option', options);

      expect(result).toBe('option2');
      expect(consoleLogSpy).toHaveBeenCalledWith('Select option');
      expect(consoleLogSpy).toHaveBeenCalledWith('  1. option1');
      expect(consoleLogSpy).toHaveBeenCalledWith('  2. option2');
      expect(consoleLogSpy).toHaveBeenCalledWith('  3. option3');
      expect(mockRl.close).toHaveBeenCalled();
    });

    it('should mark default option with asterisk', async () => {
      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('');
      });

      await InteractivePrompts.choose('Select option', options, 'option2');

      expect(consoleLogSpy).toHaveBeenCalledWith('  1. option1');
      expect(consoleLogSpy).toHaveBeenCalledWith('* 2. option2');
      expect(consoleLogSpy).toHaveBeenCalledWith('  3. option3');
    });

    it('should return default value when user enters empty string', async () => {
      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('');
      });

      const result = await InteractivePrompts.choose('Select', options, 'option2');

      expect(result).toBe('option2');
    });

    it('should show default number in prompt', async () => {
      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('');
      });

      await InteractivePrompts.choose('Select', options, 'option2');

      expect(mockRl.question).toHaveBeenCalledWith(
        'Enter number [1-3] (default: 2): ',
        expect.any(Function)
      );
    });

    it('should show simple prompt when no default', async () => {
      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('1');
      });

      await InteractivePrompts.choose('Select', options);

      expect(mockRl.question).toHaveBeenCalledWith(
        'Enter number [1-3]: ',
        expect.any(Function)
      );
    });

    it('should handle first option selection', async () => {
      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('1');
      });

      const result = await InteractivePrompts.choose('Select', options);

      expect(result).toBe('option1');
    });

    it('should handle last option selection', async () => {
      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('3');
      });

      const result = await InteractivePrompts.choose('Select', options);

      expect(result).toBe('option3');
    });

    it('should exit with code 1 for invalid selection (too low)', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('0');
      });

      await InteractivePrompts.choose('Select', options);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '❌ Invalid selection. Please enter a number between 1 and 3.'
      );
      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it('should exit with code 1 for invalid selection (too high)', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('4');
      });

      await InteractivePrompts.choose('Select', options);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '❌ Invalid selection. Please enter a number between 1 and 3.'
      );
      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it('should exit with code 1 for non-numeric input', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('abc');
      });

      await InteractivePrompts.choose('Select', options);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '❌ Invalid selection. Please enter a number between 1 and 3.'
      );
      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it('should trim whitespace from input', async () => {
      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('  2  ');
      });

      const result = await InteractivePrompts.choose('Select', options);

      expect(result).toBe('option2');
    });
  });

  describe('selectSingle()', () => {
    const options = [
      { name: 'Agent 1', value: 'agent1' },
      { name: 'Agent 2', value: 'agent2' },
      { name: 'Agent 3', value: 'agent3' }
    ];

    it('should return selected value', async () => {
      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('2');
      });

      const result = await InteractivePrompts.selectSingle('Select an agent', options);

      expect(result).toBe('agent2');
      expect(consoleLogSpy).toHaveBeenCalledWith('Select an agent');
      expect(consoleLogSpy).toHaveBeenCalledWith('  1. Agent 1');
      expect(consoleLogSpy).toHaveBeenCalledWith('  2. Agent 2');
      expect(consoleLogSpy).toHaveBeenCalledWith('  3. Agent 3');
      expect(mockRl.close).toHaveBeenCalled();
    });

    it('should handle first option selection', async () => {
      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('1');
      });

      const result = await InteractivePrompts.selectSingle('Select', options);

      expect(result).toBe('agent1');
    });

    it('should handle last option selection', async () => {
      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('3');
      });

      const result = await InteractivePrompts.selectSingle('Select', options);

      expect(result).toBe('agent3');
    });

    it('should show correct prompt format', async () => {
      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('1');
      });

      await InteractivePrompts.selectSingle('Pick one', options);

      expect(mockRl.question).toHaveBeenCalledWith(
        'Select [1-3]: ',
        expect.any(Function)
      );
    });

    it('should trim whitespace from input', async () => {
      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('  2  ');
      });

      const result = await InteractivePrompts.selectSingle('Select', options);

      expect(result).toBe('agent2');
    });

    it('should exit with code 1 for invalid selection (too low)', async () => {
      // Mock process.exit to throw an error to stop execution (simulates actual exit behavior)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('0');
      });

      await expect(InteractivePrompts.selectSingle('Select', options)).rejects.toThrow('process.exit called');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '❌ Invalid selection. Please enter 1-3.'
      );
      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it('should exit with code 1 for invalid selection (too high)', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('4');
      });

      await expect(InteractivePrompts.selectSingle('Select', options)).rejects.toThrow('process.exit called');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '❌ Invalid selection. Please enter 1-3.'
      );
      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it('should exit with code 1 for non-numeric input', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('abc');
      });

      await expect(InteractivePrompts.selectSingle('Select', options)).rejects.toThrow('process.exit called');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '❌ Invalid selection. Please enter 1-3.'
      );
      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it('should exit with code 1 for empty input', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('');
      });

      await expect(InteractivePrompts.selectSingle('Select', options)).rejects.toThrow('process.exit called');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '❌ Invalid selection. Please enter 1-3.'
      );
      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it('should exit with code 1 for negative number', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('-1');
      });

      await expect(InteractivePrompts.selectSingle('Select', options)).rejects.toThrow('process.exit called');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '❌ Invalid selection. Please enter 1-3.'
      );
      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });
  });

  describe('multiSelect()', () => {
    const options = [
      { name: 'Agent 1', value: 'agent1' },
      { name: 'Agent 2', value: 'agent2' },
      { name: 'Agent 3', value: 'agent3' }
    ];

    it('should return selected values', async () => {
      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('1,3');
      });

      const result = await InteractivePrompts.multiSelect('Select agents', options);

      expect(result).toEqual(['agent1', 'agent3']);
      expect(consoleLogSpy).toHaveBeenCalledWith('Select agents');
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '(Enter numbers separated by commas, e.g., "1,3,4" or "all" for all)'
      );
      expect(consoleLogSpy).toHaveBeenCalledWith('  1. Agent 1');
      expect(consoleLogSpy).toHaveBeenCalledWith('  2. Agent 2');
      expect(consoleLogSpy).toHaveBeenCalledWith('  3. Agent 3');
      expect(mockRl.close).toHaveBeenCalled();
    });

    it('should handle single selection', async () => {
      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('2');
      });

      const result = await InteractivePrompts.multiSelect('Select', options);

      expect(result).toEqual(['agent2']);
    });

    it('should handle all selections', async () => {
      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('1,2,3');
      });

      const result = await InteractivePrompts.multiSelect('Select', options);

      expect(result).toEqual(['agent1', 'agent2', 'agent3']);
    });

    it('should trim whitespace from each selection', async () => {
      mockRl.question.mockImplementation((_prompt, callback) => {
        callback(' 1 , 2 , 3 ');
      });

      const result = await InteractivePrompts.multiSelect('Select', options);

      expect(result).toEqual(['agent1', 'agent2', 'agent3']);
    });

    it('should return empty array when any selection is invalid', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('1,5,2');
      });

      const result = await InteractivePrompts.multiSelect('Select', options);

      expect(result).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '❌ Invalid selection(s): 5. Valid range is 1-3.'
      );

      consoleErrorSpy.mockRestore();
    });

    it('should return empty array for zero and negative numbers', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('0,1,-1,2');
      });

      const result = await InteractivePrompts.multiSelect('Select', options);

      expect(result).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '❌ Invalid selection(s): 0, -1. Valid range is 1-3.'
      );

      consoleErrorSpy.mockRestore();
    });

    it('should return empty array for all invalid selections', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('0,5,10');
      });

      const result = await InteractivePrompts.multiSelect('Select', options);

      expect(result).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '❌ Invalid selection(s): 0, 5, 10. Valid range is 1-3.'
      );

      consoleErrorSpy.mockRestore();
    });

    it('should return empty array for empty input', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('');
      });

      const result = await InteractivePrompts.multiSelect('Select', options);

      expect(result).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '❌ No selection made. Please enter at least one number.'
      );

      consoleErrorSpy.mockRestore();
    });

    it('should return empty array for non-numeric input', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('1,abc,2');
      });

      const result = await InteractivePrompts.multiSelect('Select', options);

      expect(result).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '❌ Invalid selection(s): abc. Valid range is 1-3.'
      );

      consoleErrorSpy.mockRestore();
    });

    it('should deduplicate selections', async () => {
      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('1,2,1,2,3');
      });

      const result = await InteractivePrompts.multiSelect('Select', options);

      // Implementation deduplicates selections
      expect(result).toEqual(['agent1', 'agent2', 'agent3']);
    });

    it('should preserve selection order', async () => {
      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('3,1,2');
      });

      const result = await InteractivePrompts.multiSelect('Select', options);

      expect(result).toEqual(['agent3', 'agent1', 'agent2']);
    });

    it('should use "Select agents" with range in prompt', async () => {
      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('1');
      });

      await InteractivePrompts.multiSelect('Choose items', options);

      expect(mockRl.question).toHaveBeenCalledWith(
        'Select agents [1-3]: ',
        expect.any(Function)
      );
    });

    it('should handle "all" keyword to select all options', async () => {
      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('all');
      });

      const result = await InteractivePrompts.multiSelect('Select', options);

      expect(result).toEqual(['agent1', 'agent2', 'agent3']);
    });

    it('should handle "ALL" keyword case-insensitively', async () => {
      mockRl.question.mockImplementation((_prompt, callback) => {
        callback('ALL');
      });

      const result = await InteractivePrompts.multiSelect('Select', options);

      expect(result).toEqual(['agent1', 'agent2', 'agent3']);
    });
  });
});
