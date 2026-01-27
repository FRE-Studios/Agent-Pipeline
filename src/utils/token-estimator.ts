// src/utils/token-estimator.ts

import { get_encoding, type Tiktoken, type TiktokenEncoding } from 'tiktoken';

/**
 * Token estimation utility for context size management
 *
 * Provides three counting strategies:
 * 1. Fast character-based estimation (±20% accuracy)
 * 2. Precise tiktoken counting (exact)
 * 3. Smart hybrid approach (estimate first, precise if needed)
 */
export class TokenEstimator {
  private encoder: Tiktoken | null = null;
  private encoderInitialized = false;
  private readonly encoding: TiktokenEncoding;

  constructor(encoding: TiktokenEncoding = 'cl100k_base') {
    this.encoding = encoding;
  }

  /**
   * Fast character-based estimation (±20% accuracy)
   * Use for quick threshold checks
   *
   * Average: 1 token ≈ 4 characters for English/code
   *
   * @param text - Text to estimate
   * @returns Estimated token count
   */
  estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }

  /**
   * Accurate token count using tiktoken
   * Use when near limits or for analytics
   *
   * Lazily initializes encoder on first call.
   * Falls back to estimation if tiktoken fails.
   *
   * @param text - Text to count
   * @returns Exact token count
   */
  async countTokens(text: string): Promise<number> {
    if (!text) return 0;

    try {
      if (!this.encoderInitialized) {
        this.encoder = get_encoding(this.encoding);
        this.encoderInitialized = true;
      }

      const tokens = this.encoder!.encode(text);
      return tokens.length;
    } catch (error) {
      console.warn('Tiktoken failed, falling back to estimation:', error);
      return this.estimateTokens(text);
    }
  }

  /**
   * Hybrid approach: estimate first, count if near threshold
   *
   * Strategy:
   * - If estimated tokens < 80% of threshold → use estimation
   * - If estimated tokens ≥ 80% of threshold → use precise count
   *
   * This optimizes for performance while maintaining accuracy when needed.
   *
   * @param text - Text to count
   * @param threshold - Token limit threshold
   * @returns Token count and method used
   */
  async smartCount(
    text: string,
    threshold: number
  ): Promise<{
    tokens: number;
    method: 'estimated' | 'precise';
  }> {
    const estimated = this.estimateTokens(text);

    // If well under threshold (< 80%), use estimation
    if (estimated < threshold * 0.8) {
      return { tokens: estimated, method: 'estimated' };
    }

    // Near threshold, get precise count
    const precise = await this.countTokens(text);
    return { tokens: precise, method: 'precise' };
  }

  /**
   * Cleanup encoder resources
   * Call when done with all counting to prevent memory leaks
   */
  dispose(): void {
    if (this.encoder) {
      this.encoder.free();
      this.encoder = null;
      this.encoderInitialized = false;
    }
  }
}
