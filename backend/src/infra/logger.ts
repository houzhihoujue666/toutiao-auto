import pino from 'pino';
import type { TaskLog } from '@shared/types';

/**
 * 日志基础设施 —— §8.4 敏感信息：cookie / token / phone / qr / password → [REDACTED]
 * 红线：业务代码禁止 console.log，一律走这里。
 */

export const REDACT_PATHS = [
  'cookie',
  '*.cookie',
  'cookies',
  '*.cookies',
  'token',
  '*.token',
  'phone',
  '*.phone',
  'password',
  '*.password',
  'qr',
  '*.qr',
  'qrcode',
  '*.qrcode',
  'authorization',
  '*.authorization',
  'storageState',
  '*.storageState',
] as const;

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: { paths: [...REDACT_PATHS], censor: '[REDACTED]' },
  base: undefined,
});

type LogListener = (entry: TaskLog & { id: number }) => void;

const listeners = new Set<LogListener>();

export function onLog(listener: LogListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let seq = 0;

/** 写日志：pino 输出 + 推送给订阅者（WebSocket 广播 / 内存缓冲） */
export function log(
  level: TaskLog['level'],
  message: string,
  context: Record<string, unknown> = {},
  taskId: number | null = null,
): void {
  const safeMessage = redactText(message);
  const safeContext = redactObject(context);
  logger[level]({ taskId, ...safeContext }, safeMessage);
  const entry: TaskLog & { id: number } = {
    id: ++seq,
    taskId,
    level,
    message: safeMessage,
    context: safeContext,
    createdAt: new Date().toISOString(),
  };
  for (const l of listeners) {
    try {
      l(entry);
    } catch {
      /* 订阅者异常不影响主流程 */
    }
  }
}

const REDACT_WORDS = /cookie|token|phone|password|authorization/gi;

/** 文本脱敏：把疑似敏感键值替换掉（用于无法结构化处理的字符串） */
export function redactText(text: string): string {
  return text
    .replace(/(cookie|token|phone|password|authorization)\s*[:=]\s*\S+/gi, '$1=[REDACTED]')
    .replace(REDACT_WORDS, (m) =>
      /^(cookie|token|phone|password|authorization)$/i.test(m) ? m : m,
    );
}

export function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = k.toLowerCase();
    if (
      key.includes('cookie') ||
      key.includes('token') ||
      key.includes('phone') ||
      key.includes('password') ||
      key.includes('qr') ||
      key.includes('authorization')
    ) {
      out[k] = '[REDACTED]';
      continue;
    }
    out[k] = typeof v === 'string' ? redactText(v) : v;
  }
  return out;
}
