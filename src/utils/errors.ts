// src/utils/errors.ts

export class PipelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PipelineError';
  }
}

export class StageError extends Error {
  constructor(
    public stageName: string,
    message: string
  ) {
    super(`[${stageName}] ${message}`);
    this.name = 'StageError';
  }
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}
