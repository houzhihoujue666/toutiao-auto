import type { LlmWebAdapter, RewriteInput } from '@shared/types';

export type { LlmWebAdapter, RewriteInput };

export interface AdapterContext {
  /** 超时上限（★ rewriteTimeoutMs） */
  timeoutMs: number;
}
