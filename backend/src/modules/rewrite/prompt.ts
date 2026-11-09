import { INJECTION_PATTERNS } from '@shared/prompts';
import { PROMPT_TRUNCATE_LENGTH } from '@shared/constants';
import { AppError } from '@shared/errors';

/**
 * 提示词渲染 —— §6.4
 * 渲染顺序：校验原文非空 → 超长截断（防网页生成超时）→ 替换占位符
 */

export interface RenderOptions {
  originalText: string;
  wordRange: string;
  extraRules?: string;
  maxLength?: number;
}

/** 注入防护：原文来自网页，可能藏「忽略以上要求…」 */
export function sanitizeOriginal(text: string): string {
  let out = text;
  for (const re of INJECTION_PATTERNS) {
    out = out.replace(re, '');
  }
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

export function renderPrompt(template: string, opts: RenderOptions): string {
  const original = sanitizeOriginal(opts.originalText);
  if (!original) {
    // 缺失直接报错，不许调模型（PROMPT_MISSING_INPUT）
    throw new AppError('PROMPT_MISSING_INPUT', '原文为空，不能调用大模型', '请先采集或选择素材');
  }
  const max = opts.maxLength ?? PROMPT_TRUNCATE_LENGTH;
  const truncated = original.length > max ? `${original.slice(0, max)}…` : original;
  return template
    .replace(/\{\{originalText\}\}/g, truncated)
    .replace(/\{\{wordRange\}\}/g, opts.wordRange)
    .replace(/\{\{extraRules\}\}/g, opts.extraRules ?? '');
}

/** 强化重写：追加在提示词末尾，优先级高于第 9 条 */
export function withStronger(prompt: string, stronger: string): string {
  return `${prompt}\n\n${stronger}`;
}
