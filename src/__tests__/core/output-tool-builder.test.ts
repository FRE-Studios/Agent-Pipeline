// src/__tests__/core/output-tool-builder.test.ts

import { describe, it, expect } from 'vitest';
import { OutputToolBuilder } from '../../core/output-tool-builder.js';

describe('OutputToolBuilder', () => {
  describe('getMcpServer', () => {
    it('should create MCP server with report_outputs tool', () => {
      const server = OutputToolBuilder.getMcpServer();

      expect(server).toBeDefined();
      expect(server.name).toBe('pipeline-outputs');
    });

    it('should return singleton instance on repeated calls', () => {
      const server1 = OutputToolBuilder.getMcpServer();
      const server2 = OutputToolBuilder.getMcpServer();

      expect(server1).toBe(server2);
    });
  });

  describe('buildOutputInstructions', () => {
    it('should return empty string when no output keys provided', () => {
      const instructions = OutputToolBuilder.buildOutputInstructions();

      expect(instructions).toBe('');
    });

    it('should return empty string when empty output keys array', () => {
      const instructions = OutputToolBuilder.buildOutputInstructions([]);

      expect(instructions).toBe('');
    });

    it('should build instructions for single output key', () => {
      const instructions = OutputToolBuilder.buildOutputInstructions(['issues_found']);

      expect(instructions).toContain('report_outputs');
      expect(instructions).toContain('issues_found');
      expect(instructions).toContain('Reporting Outputs');
    });

    it('should build instructions for multiple output keys', () => {
      const instructions = OutputToolBuilder.buildOutputInstructions([
        'issues_found',
        'severity',
        'score'
      ]);

      expect(instructions).toContain('issues_found');
      expect(instructions).toContain('severity');
      expect(instructions).toContain('score');
      expect(instructions).toContain('Expected outputs:');
    });

    it('should include example usage in instructions', () => {
      const instructions = OutputToolBuilder.buildOutputInstructions(['test_output']);

      expect(instructions).toContain('Example:');
      expect(instructions).toContain('report_outputs');
      expect(instructions).toContain('test_output');
    });

    it('should format output keys in example', () => {
      const instructions = OutputToolBuilder.buildOutputInstructions([
        'key1',
        'key2'
      ]);

      expect(instructions).toMatch(/"key1":/);
      expect(instructions).toMatch(/"key2":/);
    });
  });
});
