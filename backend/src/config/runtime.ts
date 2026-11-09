import * as configRepo from '../infra/db/repo/config';
import type { RuntimeMode } from '@shared/types';

/**
 * 运行时配置门面 —— ADR-10：可调项改完立即生效，值取自 app_config（默认值来自 §9）
 * 业务代码禁止硬编码数值，一律走这里。
 */

export function getString(key: string): string {
  return configRepo.getValue(key) ?? '';
}

export function getNumber(key: string): number {
  const v = configRepo.getValue(key);
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function getBoolean(key: string): boolean {
  return configRepo.getValue(key) === 'true';
}

export function getMode(): RuntimeMode {
  return getString('runtime.mode') === 'real' ? 'real' : 'simulated';
}

export function isRealMode(): boolean {
  return getMode() === 'real';
}

/** 真实发布总开关：关闭时真实模式也只走 Dry Run 存草稿 */
export function allowRealPublish(): boolean {
  return getBoolean('allowRealPublish');
}

export function setConfig(key: string, value: string): string {
  return configRepo.setValue(key, value);
}

export function allConfig() {
  return configRepo.getAll();
}

export const KEYS = {
  runtimeMode: 'runtime.mode',
  allowRealPublish: 'allowRealPublish',
  dailyPublishLimit: 'dailyPublishLimit',
  minPublishIntervalMin: 'minPublishIntervalMin',
  similarityThreshold: 'similarityThreshold',
  wordRange: 'wordRange',
  circuitBreakFailures: 'circuitBreakFailures',
  rewriteTimeoutMs: 'rewriteTimeoutMs',
  rewriteRetry: 'rewriteRetry',
  llmMode: 'llm.mode',
  llmApiBaseUrl: 'llm.api.baseUrl',
  llmApiModel: 'llm.api.model',
  llmApiKey: 'llm.api.key',
  blockedTopics: 'crawl.blockedTopics',
  stockProvider: 'stockProvider',
  stockApiKey: 'stockApiKey',
  imageStrategy: 'imageStrategy',
  minLength: 'minLength',
  maxLength: 'maxLength',
  idleBrowserReleaseMin: 'idleBrowserReleaseMin',
  /** CHG-0002：跨账号发布并发上限（ADR-0015） */
  accountConcurrencyLimit: 'accountConcurrencyLimit',
} as const;
