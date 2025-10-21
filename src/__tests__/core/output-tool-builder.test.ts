// src/__tests__/core/output-tool-builder.test.ts

import { describe, it, expect, vi } from 'vitest';

// Mock the Claude SDK to return the tool structure we can test
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  tool: vi.fn((name, description, schema, handler) => ({
    name,
    description,
    inputSchema: schema,
    handler
  })),
  createSdkMcpServer: vi.fn((options) => ({
    type: 'sdk',
    name: options.name,
    instance: { tools: options.tools }
  }))
}));

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

  describe('Tool Handler Invocation', () => {
    it('should successfully invoke the report_outputs tool handler', async () => {
      const server = OutputToolBuilder.getMcpServer();

      expect(server).toBeDefined();
      expect(server.instance).toBeDefined();
      expect(server.instance.tools).toBeDefined();
      expect(server.instance.tools.length).toBe(1);

      const reportTool = server.instance.tools[0];
      expect(reportTool.name).toBe('report_outputs');

      // Invoke the handler directly
      const testOutputs = {
        issues_found: 5,
        severity: 'high',
        details: { critical: 2, warning: 3 }
      };

      const result = await reportTool.handler({ outputs: testOutputs });

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(result.content.length).toBe(1);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('Stage outputs recorded successfully');
      expect(result.content[0].text).toContain('available to the next pipeline stage');
    });

    it('should handle empty outputs in handler', async () => {
      const server = OutputToolBuilder.getMcpServer();
      const reportTool = server.instance.tools[0];

      const result = await reportTool.handler({ outputs: {} });

      expect(result).toBeDefined();
      expect(result.content[0].text).toContain('Stage outputs recorded successfully');
    });

    it('should handle complex nested outputs in handler', async () => {
      const server = OutputToolBuilder.getMcpServer();
      const reportTool = server.instance.tools[0];

      const complexOutputs = {
        array: [1, 2, 3],
        object: { nested: { value: true } },
        number: 42,
        string: 'test',
        boolean: false
      };

      const result = await reportTool.handler({ outputs: complexOutputs });

      expect(result).toBeDefined();
      expect(result.content[0].text).toContain('Stage outputs recorded successfully');
    });
  });
});
