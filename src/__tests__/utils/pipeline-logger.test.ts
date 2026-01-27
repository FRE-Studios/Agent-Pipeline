// src/__tests__/utils/pipeline-logger.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { PipelineLogger } from '../../utils/pipeline-logger.js';
import { createTempDir, cleanupTempDir } from '../setup.js';

describe('PipelineLogger', () => {
  let tempDir: string;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tempDir = await createTempDir('pipeline-logger-');
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await cleanupTempDir(tempDir);
  });

  describe('constructor', () => {
    it('should create log directory if it does not exist', () => {
      const logger = new PipelineLogger(tempDir, 'test-pipeline');
      const logDir = path.join(tempDir, '.agent-pipeline', 'logs');

      expect(fs.existsSync(logDir)).toBe(true);
      logger.close();
    });

    it('should create log file with pipeline name', () => {
      const logger = new PipelineLogger(tempDir, 'my-pipeline');
      const logPath = path.join(tempDir, '.agent-pipeline', 'logs', 'my-pipeline.log');

      expect(logger.getLogPath()).toBe(logPath);
      logger.close();
    });

    it('should handle interactive mode parameter', () => {
      const interactiveLogger = new PipelineLogger(tempDir, 'test', true);
      const nonInteractiveLogger = new PipelineLogger(tempDir, 'test2', false);

      interactiveLogger.close();
      nonInteractiveLogger.close();
    });
  });

  describe('getLogPath()', () => {
    it('should return the log file path', () => {
      const logger = new PipelineLogger(tempDir, 'my-pipeline');
      const expectedPath = path.join(tempDir, '.agent-pipeline', 'logs', 'my-pipeline.log');

      expect(logger.getLogPath()).toBe(expectedPath);
      logger.close();
    });
  });

  describe('log()', () => {
    it('should write to log file with timestamp', async () => {
      const logger = new PipelineLogger(tempDir, 'test');
      logger.log('Test message');
      logger.close();

      // Wait for file write
      await new Promise(resolve => setTimeout(resolve, 50));

      const logContent = fs.readFileSync(logger.getLogPath(), 'utf-8');
      expect(logContent).toContain('Test message');
      expect(logContent).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should write to console in non-interactive mode', () => {
      const logger = new PipelineLogger(tempDir, 'test', false);
      logger.log('Console message');

      expect(consoleLogSpy).toHaveBeenCalledWith('Console message');
      logger.close();
    });

    it('should NOT write to console in interactive mode', () => {
      const logger = new PipelineLogger(tempDir, 'test', true);
      logger.log('Interactive message');

      expect(consoleLogSpy).not.toHaveBeenCalled();
      logger.close();
    });
  });

  describe('logRaw()', () => {
    it('should write without timestamp', async () => {
      const logger = new PipelineLogger(tempDir, 'test');
      logger.logRaw('Raw message');
      logger.close();

      await new Promise(resolve => setTimeout(resolve, 50));

      const logContent = fs.readFileSync(logger.getLogPath(), 'utf-8');
      expect(logContent).toContain('Raw message');
      // Should not have timestamp prefix
      expect(logContent).not.toMatch(/\[\d{4}-\d{2}-\d{2}.*\] Raw message/);
    });

    it('should write to console in non-interactive mode', () => {
      const logger = new PipelineLogger(tempDir, 'test', false);
      logger.logRaw('Raw console');

      expect(consoleLogSpy).toHaveBeenCalledWith('Raw console');
      logger.close();
    });

    it('should NOT write to console in interactive mode', () => {
      const logger = new PipelineLogger(tempDir, 'test', true);
      logger.logRaw('Raw interactive');

      expect(consoleLogSpy).not.toHaveBeenCalled();
      logger.close();
    });
  });

  describe('error()', () => {
    it('should write ERROR prefix to log file', async () => {
      const logger = new PipelineLogger(tempDir, 'test');
      logger.error('Error occurred');
      logger.close();

      await new Promise(resolve => setTimeout(resolve, 50));

      const logContent = fs.readFileSync(logger.getLogPath(), 'utf-8');
      expect(logContent).toContain('ERROR: Error occurred');
    });

    it('should write to console.error in non-interactive mode', () => {
      const logger = new PipelineLogger(tempDir, 'test', false);
      logger.error('Console error');

      expect(consoleErrorSpy).toHaveBeenCalledWith('Console error');
      logger.close();
    });

    it('should NOT write to console in interactive mode', () => {
      const logger = new PipelineLogger(tempDir, 'test', true);
      logger.error('Interactive error');

      expect(consoleErrorSpy).not.toHaveBeenCalled();
      logger.close();
    });
  });

  describe('section()', () => {
    it('should write section header with separators', async () => {
      const logger = new PipelineLogger(tempDir, 'test');
      logger.section('My Section');
      logger.close();

      await new Promise(resolve => setTimeout(resolve, 50));

      const logContent = fs.readFileSync(logger.getLogPath(), 'utf-8');
      expect(logContent).toContain('─'.repeat(50));
      expect(logContent).toContain('My Section');
    });
  });

  describe('stageStart()', () => {
    it('should log stage start without attempt info', () => {
      const logger = new PipelineLogger(tempDir, 'test', false);
      logger.stageStart('build');

      expect(consoleLogSpy).toHaveBeenCalledWith('Stage: build - STARTED');
      logger.close();
    });

    it('should log stage start with attempt info when attempt > 0', () => {
      const logger = new PipelineLogger(tempDir, 'test', false);
      logger.stageStart('build', 1);

      expect(consoleLogSpy).toHaveBeenCalledWith('Stage: build (attempt 2) - STARTED');
      logger.close();
    });

    it('should not include attempt info when attempt is 0', () => {
      const logger = new PipelineLogger(tempDir, 'test', false);
      logger.stageStart('build', 0);

      expect(consoleLogSpy).toHaveBeenCalledWith('Stage: build - STARTED');
      logger.close();
    });
  });

  describe('stageComplete()', () => {
    it('should log stage completion with duration', () => {
      const logger = new PipelineLogger(tempDir, 'test', false);
      logger.stageComplete('build', 45.5);

      expect(consoleLogSpy).toHaveBeenCalledWith('Stage: build - COMPLETED (45.5s)');
      logger.close();
    });

    it('should include commit SHA when provided', () => {
      const logger = new PipelineLogger(tempDir, 'test', false);
      logger.stageComplete('build', 30.2, 'abc1234567890');

      expect(consoleLogSpy).toHaveBeenCalledWith('Stage: build - COMPLETED (30.2s) [abc1234]');
      logger.close();
    });
  });

  describe('stageFailed()', () => {
    it('should log stage failure with error message', () => {
      const logger = new PipelineLogger(tempDir, 'test', false);
      logger.stageFailed('deploy', 'Connection refused');

      expect(consoleLogSpy).toHaveBeenCalledWith('Stage: deploy - FAILED: Connection refused');
      logger.close();
    });
  });

  describe('stageSkipped()', () => {
    it('should log stage skip with reason', () => {
      const logger = new PipelineLogger(tempDir, 'test', false);
      logger.stageSkipped('test', 'No tests found');

      expect(consoleLogSpy).toHaveBeenCalledWith('Stage: test - SKIPPED: No tests found');
      logger.close();
    });
  });

  describe('pipelineStart()', () => {
    it('should log pipeline start header with all info', async () => {
      const logger = new PipelineLogger(tempDir, 'test');
      logger.pipelineStart('my-pipeline', 'run-12345678-abcd', 'commit1234567');
      logger.close();

      await new Promise(resolve => setTimeout(resolve, 50));

      const logContent = fs.readFileSync(logger.getLogPath(), 'utf-8');
      expect(logContent).toContain('═'.repeat(60));
      expect(logContent).toContain('Pipeline: my-pipeline');
      expect(logContent).toContain('Run ID: run-1234');
      expect(logContent).toContain('Trigger commit: commit1');
    });
  });

  describe('pipelineComplete()', () => {
    it('should log pipeline completion summary', async () => {
      const logger = new PipelineLogger(tempDir, 'test');
      logger.pipelineComplete('completed', 120.5, 5);
      logger.close();

      await new Promise(resolve => setTimeout(resolve, 50));

      const logContent = fs.readFileSync(logger.getLogPath(), 'utf-8');
      expect(logContent).toContain('═'.repeat(60));
      expect(logContent).toContain('Pipeline COMPLETED');
      expect(logContent).toContain('Total duration: 120.5s');
      expect(logContent).toContain('Stages executed: 5');
    });

    it('should uppercase the status', () => {
      const logger = new PipelineLogger(tempDir, 'test', false);
      logger.pipelineComplete('failed', 60.0, 3);

      expect(consoleLogSpy).toHaveBeenCalledWith('Pipeline FAILED');
      logger.close();
    });
  });

  describe('close()', () => {
    it('should close the log stream', () => {
      const logger = new PipelineLogger(tempDir, 'test');
      logger.log('Before close');
      logger.close();

      // Should not throw when closed
      expect(() => logger.close()).not.toThrow();
    });

    it('should handle multiple close calls', () => {
      const logger = new PipelineLogger(tempDir, 'test');
      logger.close();
      logger.close();
      logger.close();
      // Should not throw
    });

    it('should handle logging after close gracefully', () => {
      const logger = new PipelineLogger(tempDir, 'test', false);
      logger.close();

      // These should not throw, just silently fail to write to file
      expect(() => logger.log('After close')).not.toThrow();
      expect(() => logger.logRaw('After close raw')).not.toThrow();
      expect(() => logger.error('After close error')).not.toThrow();
    });
  });

  describe('multiple log writes', () => {
    it('should append multiple log entries to same file', async () => {
      const logger = new PipelineLogger(tempDir, 'test');
      logger.log('First entry');
      logger.log('Second entry');
      logger.log('Third entry');
      logger.close();

      await new Promise(resolve => setTimeout(resolve, 50));

      const logContent = fs.readFileSync(logger.getLogPath(), 'utf-8');
      expect(logContent).toContain('First entry');
      expect(logContent).toContain('Second entry');
      expect(logContent).toContain('Third entry');
    });

    it('should persist logs across logger instances', async () => {
      const logger1 = new PipelineLogger(tempDir, 'persistent');
      logger1.log('From logger 1');
      logger1.close();

      await new Promise(resolve => setTimeout(resolve, 50));

      const logger2 = new PipelineLogger(tempDir, 'persistent');
      logger2.log('From logger 2');
      logger2.close();

      await new Promise(resolve => setTimeout(resolve, 50));

      const logContent = fs.readFileSync(logger2.getLogPath(), 'utf-8');
      expect(logContent).toContain('From logger 1');
      expect(logContent).toContain('From logger 2');
    });
  });
});
