import { describe, it, expect } from 'vitest';
import { ConditionEvaluator } from './condition-evaluator.js';
import { PipelineState } from '../config/schema.js';
import { parallelPipelineState } from '../__tests__/fixtures/pipeline-states.js';
import { simplePipelineConfig } from '../__tests__/fixtures/pipeline-configs.js';

describe('ConditionEvaluator', () => {
  const evaluator = new ConditionEvaluator();

  // Helper to create a minimal pipeline state for testing
  const createTestState = (extractedData: Record<string, any> = {}): PipelineState => ({
    runId: 'test-run',
    pipelineConfig: simplePipelineConfig,
    trigger: {
      type: 'manual',
      commitSha: 'abc123',
      timestamp: '2024-01-01T00:00:00.000Z',
    },
    stages: [
      {
        stageName: 'code-review',
        status: 'success',
        startTime: '2024-01-01T00:00:00.000Z',
        duration: 60,
        extractedData,
      },
    ],
    status: 'running',
    artifacts: {
      initialCommit: 'abc123',
      changedFiles: [],
      totalDuration: 60,
    },
  });

  describe('evaluate', () => {
    describe('comparison operators', () => {
      it('should evaluate greater than (>) correctly', () => {
        const state = createTestState({ issues_found: 5 });

        expect(evaluator.evaluate('{{ stages.code-review.outputs.issues_found > 0 }}', state)).toBe(true);
        expect(evaluator.evaluate('{{ stages.code-review.outputs.issues_found > 10 }}', state)).toBe(false);
        expect(evaluator.evaluate('{{ stages.code-review.outputs.issues_found > 5 }}', state)).toBe(false);
      });

      it('should evaluate less than (<) correctly', () => {
        const state = createTestState({ issues_found: 5 });

        expect(evaluator.evaluate('{{ stages.code-review.outputs.issues_found < 10 }}', state)).toBe(true);
        expect(evaluator.evaluate('{{ stages.code-review.outputs.issues_found < 5 }}', state)).toBe(false);
        expect(evaluator.evaluate('{{ stages.code-review.outputs.issues_found < 0 }}', state)).toBe(false);
      });

      it('should evaluate greater than or equal (>=) correctly', () => {
        const state = createTestState({ issues_found: 5 });

        expect(evaluator.evaluate('{{ stages.code-review.outputs.issues_found >= 5 }}', state)).toBe(true);
        expect(evaluator.evaluate('{{ stages.code-review.outputs.issues_found >= 4 }}', state)).toBe(true);
        expect(evaluator.evaluate('{{ stages.code-review.outputs.issues_found >= 6 }}', state)).toBe(false);
      });

      it('should evaluate less than or equal (<=) correctly', () => {
        const state = createTestState({ issues_found: 5 });

        expect(evaluator.evaluate('{{ stages.code-review.outputs.issues_found <= 5 }}', state)).toBe(true);
        expect(evaluator.evaluate('{{ stages.code-review.outputs.issues_found <= 6 }}', state)).toBe(true);
        expect(evaluator.evaluate('{{ stages.code-review.outputs.issues_found <= 4 }}', state)).toBe(false);
      });

      it('should evaluate equality (==) correctly', () => {
        const state = createTestState({ severity: 'high', count: 5 });

        expect(evaluator.evaluate('{{ stages.code-review.outputs.severity == "high" }}', state)).toBe(true);
        expect(evaluator.evaluate('{{ stages.code-review.outputs.severity == "low" }}', state)).toBe(false);
        expect(evaluator.evaluate('{{ stages.code-review.outputs.count == 5 }}', state)).toBe(true);
        expect(evaluator.evaluate('{{ stages.code-review.outputs.count == 0 }}', state)).toBe(false);
      });

      it('should evaluate inequality (!=) correctly', () => {
        const state = createTestState({ severity: 'high', count: 5 });

        expect(evaluator.evaluate('{{ stages.code-review.outputs.severity != "low" }}', state)).toBe(true);
        expect(evaluator.evaluate('{{ stages.code-review.outputs.severity != "high" }}', state)).toBe(false);
        expect(evaluator.evaluate('{{ stages.code-review.outputs.count != 0 }}', state)).toBe(true);
      });
    });

    describe('logical operators', () => {
      it('should evaluate AND (&&) correctly', () => {
        const state = createTestState({ issues_found: 5, severity: 'high' });

        expect(evaluator.evaluate(
          '{{ stages.code-review.outputs.issues_found > 0 && stages.code-review.outputs.severity == "high" }}',
          state
        )).toBe(true);

        expect(evaluator.evaluate(
          '{{ stages.code-review.outputs.issues_found > 0 && stages.code-review.outputs.severity == "low" }}',
          state
        )).toBe(false);

        expect(evaluator.evaluate(
          '{{ stages.code-review.outputs.issues_found == 0 && stages.code-review.outputs.severity == "high" }}',
          state
        )).toBe(false);
      });

      it('should evaluate OR (||) correctly', () => {
        const state = createTestState({ issues_found: 5, severity: 'high' });

        expect(evaluator.evaluate(
          '{{ stages.code-review.outputs.issues_found > 0 || stages.code-review.outputs.severity == "low" }}',
          state
        )).toBe(true);

        expect(evaluator.evaluate(
          '{{ stages.code-review.outputs.issues_found == 0 || stages.code-review.outputs.severity == "high" }}',
          state
        )).toBe(true);

        expect(evaluator.evaluate(
          '{{ stages.code-review.outputs.issues_found == 0 || stages.code-review.outputs.severity == "low" }}',
          state
        )).toBe(false);
      });

      it('should handle complex logical expressions', () => {
        const state = createTestState({ issues_found: 5, severity: 'high', vulnerabilities: 0 });

        // (issues > 0 AND severity == "high") OR vulnerabilities > 0
        expect(evaluator.evaluate(
          '{{ stages.code-review.outputs.issues_found > 0 && stages.code-review.outputs.severity == "high" || stages.code-review.outputs.vulnerabilities > 0 }}',
          state
        )).toBe(true);
      });
    });

    describe('property access', () => {
      it('should access nested properties correctly', () => {
        const state = parallelPipelineState;

        expect(evaluator.evaluate('{{ stages.review.outputs.issues_found > 0 }}', state)).toBe(true);
        expect(evaluator.evaluate('{{ stages.security.outputs.vulnerabilities == 0 }}', state)).toBe(true);
        expect(evaluator.evaluate('{{ stages.quality.outputs.score > 80 }}', state)).toBe(true);
      });

      it('should handle missing properties gracefully', () => {
        const state = createTestState({ issues_found: 5 });

        // Missing stage should evaluate to false
        expect(evaluator.evaluate('{{ stages.non-existent.outputs.value > 0 }}', state)).toBe(false);

        // Missing property should evaluate to false
        expect(evaluator.evaluate('{{ stages.code-review.outputs.non_existent > 0 }}', state)).toBe(false);
      });

      it('should handle undefined and null values', () => {
        const state = createTestState({ value: null });

        expect(evaluator.evaluate('{{ stages.code-review.outputs.value == null }}', state)).toBe(true);
        // Undefined/missing properties should evaluate to false when compared
        expect(evaluator.evaluate('{{ stages.code-review.outputs.nonexistent > 0 }}', state)).toBe(false);
      });
    });

    describe('data types', () => {
      it('should handle numbers', () => {
        const state = createTestState({ count: 42, score: 3.14 });

        expect(evaluator.evaluate('{{ stages.code-review.outputs.count == 42 }}', state)).toBe(true);
        expect(evaluator.evaluate('{{ stages.code-review.outputs.score > 3 }}', state)).toBe(true);
      });

      it('should handle strings', () => {
        const state = createTestState({ status: 'success', message: 'all good' });

        expect(evaluator.evaluate('{{ stages.code-review.outputs.status == "success" }}', state)).toBe(true);
        expect(evaluator.evaluate('{{ stages.code-review.outputs.message == "all good" }}', state)).toBe(true);
      });

      it('should handle booleans', () => {
        const state = createTestState({ passed: true, failed: false });

        expect(evaluator.evaluate('{{ stages.code-review.outputs.passed }}', state)).toBe(true);
        expect(evaluator.evaluate('{{ stages.code-review.outputs.failed }}', state)).toBe(false);
      });
    });

    describe('edge cases', () => {
      it('should handle whitespace in expressions', () => {
        const state = createTestState({ issues_found: 5 });

        expect(evaluator.evaluate('{{  stages.code-review.outputs.issues_found  >  0  }}', state)).toBe(true);
        expect(evaluator.evaluate('{{stages.code-review.outputs.issues_found>0}}', state)).toBe(true);
      });

      it('should handle stage names with hyphens', () => {
        const stateWithHyphens: PipelineState = {
          runId: 'test-run',
          pipelineConfig: simplePipelineConfig,
          trigger: {
            type: 'manual',
            commitSha: 'abc123',
            timestamp: '2024-01-01T00:00:00.000Z',
          },
          stages: [
            {
              stageName: 'code-review-stage',
              status: 'success',
              startTime: '2024-01-01T00:00:00.000Z',
              duration: 60,
              extractedData: { count: 10 },
            },
          ],
          status: 'running',
          artifacts: {
            initialCommit: 'abc123',
            changedFiles: [],
            totalDuration: 60,
          },
        };

        expect(evaluator.evaluate('{{ stages.code-review-stage.outputs.count > 5 }}', stateWithHyphens)).toBe(true);
      });

      it('should handle invalid property access', () => {
        const state = createTestState({ count: 5 });

        // Property access with spaces - might be treated as truthy if it resolves
        // Let's test actual invalid access
        expect(evaluator.evaluate('{{ stages.nonexistent.outputs.value > 0 }}', state)).toBe(false);
      });

      it('should handle zero values correctly', () => {
        const state = createTestState({ issues_found: 0 });

        expect(evaluator.evaluate('{{ stages.code-review.outputs.issues_found == 0 }}', state)).toBe(true);
        expect(evaluator.evaluate('{{ stages.code-review.outputs.issues_found > 0 }}', state)).toBe(false);
        expect(evaluator.evaluate('{{ stages.code-review.outputs.issues_found }}', state)).toBe(false); // 0 is falsy
      });
    });
  });

  describe('validateSyntax', () => {
    it('should validate correct syntax', () => {
      const result = evaluator.validateSyntax('{{ stages.review.outputs.count > 0 }}');

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should reject expressions without template braces', () => {
      const result = evaluator.validateSyntax('stages.review.outputs.count > 0');

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle empty expressions', () => {
      // Empty expressions might extract to empty string which could be valid syntax
      // but should evaluate to false
      const state = createTestState({});
      const result = evaluator.evaluate('{{  }}', state);
      expect(result).toBe(false);
    });

    it('should accept complex valid expressions', () => {
      const result = evaluator.validateSyntax(
        '{{ stages.review.outputs.issues > 0 && stages.security.outputs.vulnerabilities == 0 }}'
      );

      expect(result.valid).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should catch errors and return false for truly malformed syntax', () => {
      const state = createTestState({});

      // Malformed template syntax
      const result = evaluator.evaluate('{{ }', state);
      expect(result).toBe(false);
    });

    it('should handle malformed template syntax gracefully', () => {
      const state = createTestState({ count: 5 });

      expect(evaluator.evaluate('{{ }', state)).toBe(false);
      expect(evaluator.evaluate('}} {{', state)).toBe(false);
      expect(evaluator.evaluate('no braces at all', state)).toBe(false);
    });
  });

  describe('real-world scenarios', () => {
    it('should evaluate condition for auto-fix stage', () => {
      const stateWithIssues = createTestState({ issues_found: 3 });
      const stateNoIssues = createTestState({ issues_found: 0 });

      const condition = '{{ stages.code-review.outputs.issues_found > 0 }}';

      expect(evaluator.evaluate(condition, stateWithIssues)).toBe(true);
      expect(evaluator.evaluate(condition, stateNoIssues)).toBe(false);
    });

    it('should evaluate condition for emergency fix', () => {
      const state: PipelineState = {
        runId: 'test-run',
        pipelineConfig: simplePipelineConfig,
        trigger: {
          type: 'manual',
          commitSha: 'abc123',
          timestamp: '2024-01-01T00:00:00.000Z',
        },
        stages: [
          {
            stageName: 'code-review',
            status: 'success',
            startTime: '2024-01-01T00:00:00.000Z',
            duration: 60,
            extractedData: { severity: 'critical', issues_found: 5 },
          },
          {
            stageName: 'security-scan',
            status: 'success',
            startTime: '2024-01-01T00:01:00.000Z',
            duration: 60,
            extractedData: { vulnerabilities: 2 },
          },
        ],
        status: 'running',
        artifacts: {
          initialCommit: 'abc123',
          changedFiles: [],
          totalDuration: 120,
        },
      };

      // Critical severity OR vulnerabilities found
      const condition = '{{ stages.code-review.outputs.severity == "critical" || stages.security-scan.outputs.vulnerabilities > 0 }}';

      expect(evaluator.evaluate(condition, state)).toBe(true);
    });

    it('should evaluate celebration condition', () => {
      const perfectState = createTestState({ issues_found: 0, severity: 'none' });
      const imperfectState = createTestState({ issues_found: 1, severity: 'low' });

      const condition = '{{ stages.code-review.outputs.issues_found == 0 }}';

      expect(evaluator.evaluate(condition, perfectState)).toBe(true);
      expect(evaluator.evaluate(condition, imperfectState)).toBe(false);
    });
  });
});
