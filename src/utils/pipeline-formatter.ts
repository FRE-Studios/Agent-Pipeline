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
}
