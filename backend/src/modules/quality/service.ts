import { MIN_LENGTH, MAX_LENGTH, SIMILARITY_THRESHOLD } from '@shared/constants';
import type { QualityChecker, QualityReport } from '@shared/types';
import { findSensitive } from './sensitive';
import { checkSimilarity } from './similarityGate';
import { checkReadability } from './readability';

export interface CheckOptions {
  minLength?: number;
  maxLength?: number;
  threshold?: number;
}

/**
 * 质检四项 —— §6.6：质检不改内容，只出报告
 * 长度 / 敏感词 / 相似度 → 硬闸门；可读性 → 只标记告警
 */
export class QualityService implements QualityChecker {
  check(original: string, rewritten: string): Promise<QualityReport>;
  check(original: string, rewritten: string, opts: CheckOptions): Promise<QualityReport>;
  async check(
    original: string,
    rewritten: string,
    opts: CheckOptions = {},
  ): Promise<QualityReport> {
    const min = opts.minLength ?? MIN_LENGTH;
    const max = opts.maxLength ?? MAX_LENGTH;
    const threshold = opts.threshold ?? SIMILARITY_THRESHOLD;

    const length = rewritten.replace(/\s/g, '').length;
    const lengthOk = length >= min && length <= max;

    const hits = findSensitive(rewritten);
    const noSensitiveWord = hits.length === 0;

    const gate = checkSimilarity(original, rewritten, threshold);
    const readability = checkReadability(rewritten);

    const flags: string[] = [];
    if (!lengthOk) flags.push('LENGTH');
    for (const h of hits) flags.push(`SENSITIVE:${h}`);
    if (!gate.ok) flags.push('SIMILARITY');
    if (!readability.readable) flags.push('LOW_READABILITY');

    return {
      lengthOk,
      noSensitiveWord,
      similarity: gate.similarity,
      similarityOk: gate.ok,
      readable: readability.readable,
      flags,
      passed: lengthOk && noSensitiveWord && gate.ok,
      length,
    };
  }
}

export function describeReport(report: QualityReport): string {
  const parts = [
    `长度 ${report.length} 字${report.lengthOk ? '（合格）' : '（不合格）'}`,
    report.noSensitiveWord ? '未命中敏感词' : '命中敏感词',
    `相似度 ${report.similarity.toFixed(2)}${report.similarityOk ? '（合格）' : '（超标）'}`,
    report.readable ? '可读性正常' : '可读性告警（仅标记）',
  ];
  return parts.join(' · ');
}
