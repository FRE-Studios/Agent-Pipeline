// src/__tests__/utils/errors.test.ts

import { describe, it, expect } from 'vitest';
import { PipelineError, StageError, ConfigurationError } from '../../utils/errors.js';

describe('PipelineError', () => {
  it('should create an error with the provided message', () => {
    const error = new PipelineError('Pipeline failed');
    expect(error.message).toBe('Pipeline failed');
  });

  it('should have name set to "PipelineError"', () => {
    const error = new PipelineError('test');
    expect(error.name).toBe('PipelineError');
  });

  it('should be an instance of Error', () => {
    const error = new PipelineError('test');
    expect(error).toBeInstanceOf(Error);
  });

  it('should be an instance of PipelineError', () => {
    const error = new PipelineError('test');
    expect(error).toBeInstanceOf(PipelineError);
  });

  it('should have a stack trace', () => {
    const error = new PipelineError('test');
    expect(error.stack).toBeDefined();
    expect(error.stack).toContain('PipelineError');
  });

  it('should preserve message through throw/catch', () => {
    const message = 'Critical pipeline failure';
    try {
      throw new PipelineError(message);
    } catch (e) {
      expect((e as PipelineError).message).toBe(message);
      expect((e as PipelineError).name).toBe('PipelineError');
    }
  });

  it('should handle empty message', () => {
    const error = new PipelineError('');
    expect(error.message).toBe('');
  });
});

describe('StageError', () => {
  it('should create an error with formatted message including stage name', () => {
    const error = new StageError('build', 'Build failed');
    expect(error.message).toBe('[build] Build failed');
  });

  it('should have name set to "StageError"', () => {
    const error = new StageError('test', 'test');
    expect(error.name).toBe('StageError');
  });

  it('should expose stageName property', () => {
    const error = new StageError('deploy', 'Deployment failed');
    expect(error.stageName).toBe('deploy');
  });

  it('should be an instance of Error', () => {
    const error = new StageError('stage', 'test');
    expect(error).toBeInstanceOf(Error);
  });

  it('should be an instance of StageError', () => {
    const error = new StageError('stage', 'test');
    expect(error).toBeInstanceOf(StageError);
  });

  it('should have a stack trace', () => {
    const error = new StageError('lint', 'Linting failed');
    expect(error.stack).toBeDefined();
    expect(error.stack).toContain('StageError');
  });

  it('should preserve stageName and message through throw/catch', () => {
    try {
      throw new StageError('security-scan', 'Vulnerability found');
    } catch (e) {
      expect((e as StageError).stageName).toBe('security-scan');
      expect((e as StageError).message).toBe('[security-scan] Vulnerability found');
    }
  });

  it('should handle stage names with special characters', () => {
    const error = new StageError('pre-commit-hook', 'Hook failed');
    expect(error.message).toBe('[pre-commit-hook] Hook failed');
    expect(error.stageName).toBe('pre-commit-hook');
  });

  it('should handle empty stage name', () => {
    const error = new StageError('', 'No stage');
    expect(error.message).toBe('[] No stage');
    expect(error.stageName).toBe('');
  });

  it('should handle empty message', () => {
    const error = new StageError('stage', '');
    expect(error.message).toBe('[stage] ');
  });
});

describe('ConfigurationError', () => {
  it('should create an error with the provided message', () => {
    const error = new ConfigurationError('Invalid configuration');
    expect(error.message).toBe('Invalid configuration');
  });

  it('should have name set to "ConfigurationError"', () => {
    const error = new ConfigurationError('test');
    expect(error.name).toBe('ConfigurationError');
  });

  it('should be an instance of Error', () => {
    const error = new ConfigurationError('test');
    expect(error).toBeInstanceOf(Error);
  });

  it('should be an instance of ConfigurationError', () => {
    const error = new ConfigurationError('test');
    expect(error).toBeInstanceOf(ConfigurationError);
  });

  it('should have a stack trace', () => {
    const error = new ConfigurationError('Missing required field');
    expect(error.stack).toBeDefined();
    expect(error.stack).toContain('ConfigurationError');
  });

  it('should preserve message through throw/catch', () => {
    const message = 'Pipeline name is required';
    try {
      throw new ConfigurationError(message);
    } catch (e) {
      expect((e as ConfigurationError).message).toBe(message);
      expect((e as ConfigurationError).name).toBe('ConfigurationError');
    }
  });

  it('should handle empty message', () => {
    const error = new ConfigurationError('');
    expect(error.message).toBe('');
  });
});

describe('Error discrimination', () => {
  it('should be able to distinguish PipelineError from other errors', () => {
    const pipelineError = new PipelineError('pipeline');
    const stageError = new StageError('stage', 'stage');
    const configError = new ConfigurationError('config');
    const genericError = new Error('generic');

    expect(pipelineError instanceof PipelineError).toBe(true);
    expect(stageError instanceof PipelineError).toBe(false);
    expect(configError instanceof PipelineError).toBe(false);
    expect(genericError instanceof PipelineError).toBe(false);
  });

  it('should be able to distinguish StageError from other errors', () => {
    const pipelineError = new PipelineError('pipeline');
    const stageError = new StageError('stage', 'stage');
    const configError = new ConfigurationError('config');
    const genericError = new Error('generic');

    expect(pipelineError instanceof StageError).toBe(false);
    expect(stageError instanceof StageError).toBe(true);
    expect(configError instanceof StageError).toBe(false);
    expect(genericError instanceof StageError).toBe(false);
  });

  it('should be able to distinguish ConfigurationError from other errors', () => {
    const pipelineError = new PipelineError('pipeline');
    const stageError = new StageError('stage', 'stage');
    const configError = new ConfigurationError('config');
    const genericError = new Error('generic');

    expect(pipelineError instanceof ConfigurationError).toBe(false);
    expect(stageError instanceof ConfigurationError).toBe(false);
    expect(configError instanceof ConfigurationError).toBe(true);
    expect(genericError instanceof ConfigurationError).toBe(false);
  });

  it('should be able to use error.name for string-based discrimination', () => {
    const errors = [
      new PipelineError('pipeline'),
      new StageError('stage', 'stage'),
      new ConfigurationError('config'),
    ];

    const names = errors.map(e => e.name);
    expect(names).toEqual(['PipelineError', 'StageError', 'ConfigurationError']);
  });
});
