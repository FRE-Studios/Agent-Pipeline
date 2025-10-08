import { vi } from 'vitest';

export interface MockAgentResponse {
  success?: boolean;
  output?: string;
  error?: Error;
}

export function createMockClaudeAgent(response: MockAgentResponse = {}) {
  return {
    run: vi.fn().mockImplementation(async () => {
      if (response.error) {
        throw response.error;
      }
      return {
        success: response.success !== false,
        output: response.output || 'Mock agent output',
        artifacts: {},
      };
    }),
    execute: vi.fn().mockImplementation(async () => {
      if (response.error) {
        throw response.error;
      }
      return {
        success: response.success !== false,
        output: response.output || 'Mock agent output',
        artifacts: {},
      };
    }),
  };
}

export function mockClaudeAgentSdk(response: MockAgentResponse = {}) {
  const mockAgent = createMockClaudeAgent(response);

  vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
    Agent: vi.fn(() => mockAgent),
    default: vi.fn(() => mockAgent),
  }));

  return mockAgent;
}
