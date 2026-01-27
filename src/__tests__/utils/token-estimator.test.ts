// src/__tests__/utils/token-estimator.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TokenEstimator } from '../../utils/token-estimator.js';

describe('TokenEstimator', () => {
  let estimator: TokenEstimator;

  beforeEach(() => {
    estimator = new TokenEstimator();
  });

  afterEach(() => {
    estimator.dispose();
  });

  describe('estimateTokens', () => {
    it('estimates approximately 1 token per 4 characters', () => {
      const text = 'a'.repeat(100);
      const estimate = estimator.estimateTokens(text);
      expect(estimate).toBe(25);
    });

    it('handles empty strings', () => {
      expect(estimator.estimateTokens('')).toBe(0);
    });

    it('rounds up fractional results', () => {
      const text = 'abc'; // 3 chars / 4 = 0.75, should round to 1
      expect(estimator.estimateTokens(text)).toBe(1);
    });

    it('estimates tokens for typical code', () => {
      const code = `function hello() {\n  console.log("world");\n}`;
      const estimate = estimator.estimateTokens(code);
      // Should be around 11 tokens (44 chars / 4)
      expect(estimate).toBeGreaterThan(0);
      expect(estimate).toBeLessThan(20);
    });

    it('estimates tokens for JSON', () => {
      const json = JSON.stringify({ foo: 'bar', baz: [1, 2, 3] }, null, 2);
      const estimate = estimator.estimateTokens(json);
      expect(estimate).toBeGreaterThan(0);
    });

    it('estimates tokens for markdown', () => {
      const markdown = '# Heading\n\nSome text with **bold** and *italic*';
      const estimate = estimator.estimateTokens(markdown);
      expect(estimate).toBeGreaterThan(0);
    });

    it('handles very long text', () => {
      const longText = 'a'.repeat(10000);
      const estimate = estimator.estimateTokens(longText);
      expect(estimate).toBe(2500); // 10000 / 4
    });

    it('handles unicode characters', () => {
      const unicode = '你好世界'; // "Hello world" in Chinese
      const estimate = estimator.estimateTokens(unicode);
      expect(estimate).toBeGreaterThan(0);
    });
  });

  describe('countTokens', () => {
    it('provides exact token count for simple text', async () => {
      const text = 'Hello, world!';
      const count = await estimator.countTokens(text);
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThan(10); // Should be around 4-5 tokens
    });

    it('handles empty strings', async () => {
      const count = await estimator.countTokens('');
      expect(count).toBe(0);
    });

    it('counts tokens in code accurately', async () => {
      const code = 'function add(a, b) { return a + b; }';
      const count = await estimator.countTokens(code);
      expect(count).toBeGreaterThan(5);
      expect(count).toBeLessThan(20);
    });

    it('counts tokens in JSON accurately', async () => {
      const json = '{"name": "test", "value": 123}';
      const count = await estimator.countTokens(json);
      expect(count).toBeGreaterThan(5);
      expect(count).toBeLessThan(15);
    });

    it('reuses encoder instance across multiple calls', async () => {
      const text1 = 'First call';
      const text2 = 'Second call';

      const count1 = await estimator.countTokens(text1);
      const count2 = await estimator.countTokens(text2);

      expect(count1).toBeGreaterThan(0);
      expect(count2).toBeGreaterThan(0);
      // Both calls should succeed using same encoder
    });

    it('handles unicode characters', async () => {
      const unicode = '你好世界';
      const count = await estimator.countTokens(unicode);
      expect(count).toBeGreaterThan(0);
    });

    it('handles very long text', async () => {
      const longText = 'word '.repeat(1000); // 5000 chars
      const count = await estimator.countTokens(longText);
      expect(count).toBeGreaterThan(500);
      expect(count).toBeLessThan(2000);
    });

    it('provides counts in similar range to estimation', async () => {
      const text = 'The quick brown fox jumps over the lazy dog';
      const estimated = estimator.estimateTokens(text);
      const precise = await estimator.countTokens(text);

      // Both should return valid counts
      expect(estimated).toBeGreaterThan(0);
      expect(precise).toBeGreaterThan(0);
      // Should be within ±50% of each other (estimation is ±20% accurate)
      expect(precise).toBeGreaterThan(estimated * 0.5);
      expect(precise).toBeLessThan(estimated * 1.5);
    });
  });

  describe('smartCount', () => {
    it('uses estimation when well under threshold (< 80%)', async () => {
      const text = 'a'.repeat(100); // ~25 tokens estimated
      const threshold = 100; // 25 < 80, so use estimation

      const result = await estimator.smartCount(text, threshold);

      expect(result.method).toBe('estimated');
      expect(result.tokens).toBe(25);
    });

    it('uses precise count when near threshold (>= 80%)', async () => {
      const text = 'a'.repeat(400); // ~100 tokens estimated, which is >= 80% of 100
      const threshold = 100;

      const result = await estimator.smartCount(text, threshold);

      expect(result.method).toBe('precise');
      expect(result.tokens).toBeGreaterThan(0);
      // Precise count should be reasonably close to estimation
    });

    it('uses estimation at exactly 79% of threshold', async () => {
      const threshold = 100;
      const targetTokens = 79; // Just under 80%
      const text = 'a'.repeat(targetTokens * 4); // Estimate will be 79

      const result = await estimator.smartCount(text, threshold);

      expect(result.method).toBe('estimated');
      expect(result.tokens).toBe(79);
    });

    it('uses precise at exactly 80% of threshold', async () => {
      const threshold = 100;
      const targetTokens = 80; // Exactly 80%
      const text = 'a'.repeat(targetTokens * 4); // Estimate will be 80

      const result = await estimator.smartCount(text, threshold);

      expect(result.method).toBe('precise');
    });

    it('handles empty string', async () => {
      const result = await estimator.smartCount('', 100);

      expect(result.method).toBe('estimated');
      expect(result.tokens).toBe(0);
    });

    it('handles very high threshold', async () => {
      const text = 'Hello world';
      const result = await estimator.smartCount(text, 1000000);

      expect(result.method).toBe('estimated');
      expect(result.tokens).toBeGreaterThan(0);
    });

    it('handles very low threshold', async () => {
      const text = 'Hello world this is a test';
      const result = await estimator.smartCount(text, 1);

      expect(result.method).toBe('precise');
      expect(result.tokens).toBeGreaterThan(0);
    });

    it('optimizes for performance on large texts under threshold', async () => {
      const largeText = 'word '.repeat(1000); // ~1250 tokens estimated
      const threshold = 10000; // Well under

      const startTime = Date.now();
      const result = await estimator.smartCount(largeText, threshold);
      const duration = Date.now() - startTime;

      expect(result.method).toBe('estimated');
      expect(duration).toBeLessThan(10); // Should be very fast
    });
  });

  describe('dispose', () => {
    it('cleans up encoder resources', async () => {
      await estimator.countTokens('test'); // Initialize encoder
      estimator.dispose();

      // After dispose, should reinitialize on next call
      const count = await estimator.countTokens('test again');
      expect(count).toBeGreaterThan(0);
    });

    it('can be called multiple times safely', () => {
      estimator.dispose();
      estimator.dispose();
      estimator.dispose();
      // Should not throw
    });

    it('can be called before encoder initialization', () => {
      const newEstimator = new TokenEstimator();
      newEstimator.dispose();
      // Should not throw
      newEstimator.dispose();
    });

    it('allows reuse after disposal', async () => {
      await estimator.countTokens('first');
      estimator.dispose();

      await estimator.countTokens('second');
      estimator.dispose();

      await estimator.countTokens('third');
      estimator.dispose();
      // All should succeed
    });
  });

  describe('edge cases', () => {
    it('handles special characters', async () => {
      const special = '!@#$%^&*()_+-=[]{}|;:,.<>?';
      const estimate = estimator.estimateTokens(special);
      const precise = await estimator.countTokens(special);

      expect(estimate).toBeGreaterThan(0);
      expect(precise).toBeGreaterThan(0);
    });

    it('handles newlines and whitespace', async () => {
      const text = 'Line 1\n\nLine 2\n\n\nLine 3';
      const estimate = estimator.estimateTokens(text);
      const precise = await estimator.countTokens(text);

      expect(estimate).toBeGreaterThan(0);
      expect(precise).toBeGreaterThan(0);
    });

    it('handles mixed content (code + prose + JSON)', async () => {
      const mixed = `
# Title

Some text here.

\`\`\`javascript
function test() {
  return { foo: 'bar' };
}
\`\`\`

{"key": "value"}
      `;

      const estimate = estimator.estimateTokens(mixed);
      const precise = await estimator.countTokens(mixed);

      expect(estimate).toBeGreaterThan(10);
      expect(precise).toBeGreaterThan(10);
    });

    it('estimation accuracy is within reasonable bounds', async () => {
      const samples = [
        'Hello world',
        'function test() { return true; }',
        '{"name": "test", "value": 123}',
        'The quick brown fox jumps over the lazy dog',
        '# Markdown\n\n- Item 1\n- Item 2'
      ];

      for (const sample of samples) {
        const estimate = estimator.estimateTokens(sample);
        const precise = await estimator.countTokens(sample);

        // Estimation should be within ±50% of precise count
        const ratio = estimate / precise;
        expect(ratio).toBeGreaterThan(0.5);
        expect(ratio).toBeLessThanOrEqual(1.5);
      }
    });
  });

  describe('multiple instances', () => {
    it('different instances do not interfere', async () => {
      const estimator1 = new TokenEstimator();
      const estimator2 = new TokenEstimator();

      const count1 = await estimator1.countTokens('test 1');
      const count2 = await estimator2.countTokens('test 2');

      expect(count1).toBeGreaterThan(0);
      expect(count2).toBeGreaterThan(0);

      estimator1.dispose();
      estimator2.dispose();
    });

    it('disposal of one instance does not affect others', async () => {
      const estimator1 = new TokenEstimator();
      const estimator2 = new TokenEstimator();

      await estimator1.countTokens('test 1');
      await estimator2.countTokens('test 2');

      estimator1.dispose();

      const count = await estimator2.countTokens('test 3');
      expect(count).toBeGreaterThan(0);

      estimator2.dispose();
    });
  });
});
