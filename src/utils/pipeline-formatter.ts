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

  static formatSummary(state: PipelineState): string {
    const lines: string[] = [];
    const separator = '='.repeat(60);

    lines.push('');
    lines.push(separator);
    lines.push(`Pipeline Summary: ${state.pipelineConfig.name}`);
    lines.push(separator);
    lines.push('');

    lines.push(`Status: ${this.getStatusEmoji(state.status)} ${state.status.toUpperCase()}`);
    lines.push(`Duration: ${state.artifacts.totalDuration.toFixed(2)}s`);
    lines.push(`Commits: ${state.trigger.commitSha.substring(0, 7)} → ${state.artifacts.finalCommit?.substring(0, 7)}`);

    if (state.artifacts.pullRequest) {
      lines.push(`Pull Request: ${state.artifacts.pullRequest.url}`);
    }

    lines.push('');
    lines.push('Stages:');

    for (const stage of state.stages) {
      lines.push(this.formatStageInfo(stage));
    }

    lines.push('');
    lines.push(separator);
    lines.push('');

    return lines.join('\n');
  }

  static formatStageInfo(stage: StageExecution): string {
    const emoji = this.getStatusEmoji(stage.status);
    const duration = stage.duration ? `(${stage.duration.toFixed(1)}s)` : '';
    const lines: string[] = [`  ${emoji} ${stage.stageName} ${duration}`];

    if (stage.commitSha) {
      lines.push(`     └─ Commit: ${stage.commitSha.substring(0, 7)}`);
    }
    if (stage.tokenUsage) {
      lines.push(`     └─ Tokens: ${this.formatTokenUsage(stage.tokenUsage)}`);
    }
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
   * Example: "Estimated input: ~23k tokens | Actual input: 25.2k | Output: 13.1k"
   */
  static formatTokenUsage(tokenUsage: StageExecution['tokenUsage']): string {
    if (!tokenUsage) return '';

    const parts: string[] = [];

    // Estimated vs actual comparison
    parts.push(`Input: ${this.formatTokenCount(tokenUsage.actual_input)} tokens`);

    // Show estimation comparison if they differ significantly (>5%)
    const estimationDiff = Math.abs(tokenUsage.actual_input - tokenUsage.estimated_input);
    const estimationDiffPct = (estimationDiff / tokenUsage.actual_input) * 100;
    if (estimationDiffPct > 5) {
      parts.push(`(est. ${this.formatTokenCount(tokenUsage.estimated_input)})`);
    }

    // Output tokens
    parts.push(`Output: ${this.formatTokenCount(tokenUsage.output)}`);

    // Cache tokens if present
    if (tokenUsage.cache_creation) {
      parts.push(`Cache created: ${this.formatTokenCount(tokenUsage.cache_creation)}`);
    }
    if (tokenUsage.cache_read) {
      parts.push(`Cache read: ${this.formatTokenCount(tokenUsage.cache_read)}`);
    }

    return parts.join(' | ');
  }
}
