// src/utils/pipeline-formatter.ts

import { PipelineState, StageExecution } from '../config/schema.js';

export class PipelineFormatter {
  static getStatusEmoji(status: string): string {
    const emojiMap: Record<string, string> = {
      'running': '⏳',
      'success': '✅',
      'completed': '✅',
      'failed': '❌',
      'skipped': '⏭️',
      'pending': '⏸️',
      'partial': '⚠️'
    };
    return emojiMap[status] || '❓';
  }

  static formatSummary(
    state: PipelineState,
    verbose: boolean = true,
    totals?: { totalProcessed: number; totalOutput: number; totalTurns: number; totalCacheRead: number }
  ): string {
    const lines: string[] = [];
    const separator = '='.repeat(60);

    lines.push('');
    lines.push(separator);
    lines.push(`Pipeline Summary: ${state.pipelineConfig.name}`);
    lines.push(separator);
    lines.push('');

    lines.push(`Status: ${this.getStatusEmoji(state.status)} ${state.status.toUpperCase()}`);
    lines.push(`Duration: ${state.artifacts.totalDuration.toFixed(2)}s`);

    // Always show total tokens in summary (regardless of verbose)
    if (totals && (totals.totalProcessed > 0 || totals.totalOutput > 0)) {
      lines.push(`Total Tokens: ${this.formatTokenLine(
        totals.totalProcessed,
        totals.totalOutput,
        totals.totalTurns,
        totals.totalCacheRead,
        totals.totalProcessed
      )}`);
    }

    if (verbose) {
      lines.push(`Commits: ${state.trigger.commitSha.substring(0, 7)} → ${state.artifacts.finalCommit?.substring(0, 7)}`);
    }

    if (state.artifacts.pullRequest) {
      lines.push(`Pull Request: ${state.artifacts.pullRequest.url}`);
    }

    lines.push('');
    lines.push('Stages:');

    for (const stage of state.stages) {
      lines.push(this.formatStageInfo(stage, verbose));
    }

    lines.push('');
    lines.push(separator);
    lines.push('');

    return lines.join('\n');
  }

  static formatStageInfo(stage: StageExecution, verbose: boolean = true): string {
    const emoji = this.getStatusEmoji(stage.status);
    const duration = stage.duration ? `(${stage.duration.toFixed(1)}s)` : '';
    const lines: string[] = [`  ${emoji} ${stage.stageName} ${duration}`];

    // Only show detailed info in verbose mode
    if (verbose) {
      if (stage.commitSha) {
        lines.push(`     └─ Commit: ${stage.commitSha.substring(0, 7)}`);
      }
      if (stage.tokenUsage) {
        lines.push(`     └─ Tokens: ${this.formatTokenUsage(stage.tokenUsage)}`);
      }
    }

    // Always show errors (per user request)
    if (stage.error) {
      lines.push(`     └─ Error: ${stage.error.message}`);
    }

    return lines.join('\n');
  }

  static formatRetryInfo(retryAttempt: number | undefined, maxRetries: number | undefined): string {
    return retryAttempt && retryAttempt > 0
      ? ` (retry ${retryAttempt}/${maxRetries})`
      : '';
  }

  /**
   * Format token count with k suffix for thousands
   * Examples: 23000 → "23k", 25234 → "25.2k", 500 → "500"
   */
  static formatTokenCount(tokens: number): string {
    if (tokens >= 1000) {
      const k = tokens / 1000;
      const formatted = k.toFixed(1);
      // Remove .0 suffix for round numbers
      return formatted.endsWith('.0') ? `${Math.round(k)}k` : `${formatted}k`;
    }
    return tokens.toString();
  }

  /**
   * Format token usage information
   * Example: "~25.2k processed | ~13.1k output | Turns: 3 | Cache: 50% hit"
   *
   * Note: Claude API reports input_tokens as only NEW (non-cached) tokens.
   * Total input = actual_input + cache_read (tokens retrieved from cache).
   * We display total input to give an accurate picture of context size.
   */
  static formatTokenUsage(tokenUsage: StageExecution['tokenUsage']): string {
    if (!tokenUsage) return '';

    const cacheRead = tokenUsage.cache_read || 0;
    const cacheCreation = tokenUsage.cache_creation || 0;

    // Calculate total input size across all turns, accounting for cache creation
    // Some runtimes report input_tokens excluding cache_creation_input_tokens.
    const cacheCreationIncluded = cacheCreation > 0 && tokenUsage.actual_input >= cacheCreation;
    const totalInput = tokenUsage.actual_input + cacheRead + (cacheCreationIncluded ? 0 : cacheCreation);

    return this.formatTokenLine(
      totalInput,
      tokenUsage.output,
      tokenUsage.num_turns,
      cacheRead,
      totalInput
    );
  }

  /**
   * Format a standardized token usage line
   * Used by both per-stage and summary totals for consistent output
   */
  static formatTokenLine(
    processed: number,
    output: number,
    turns?: number,
    cacheRead?: number,
    totalForCacheRatio?: number
  ): string {
    const parts: string[] = [];

    // Processed and output tokens
    parts.push(`~${this.formatTokenCount(processed)} processed`);
    parts.push(`~${this.formatTokenCount(output)} output`);

    // Conversation turns if present
    if (turns !== undefined && turns > 0) {
      parts.push(`Turns: ${turns}`);
    }

    // Cache efficiency (if caching was used)
    if (cacheRead && cacheRead > 0 && totalForCacheRatio && totalForCacheRatio > 0) {
      const cacheHitRatio = Math.round((cacheRead / totalForCacheRatio) * 100);
      parts.push(`Cache: ${cacheHitRatio}% hit`);
    }

    return parts.join(' | ');
  }
}
