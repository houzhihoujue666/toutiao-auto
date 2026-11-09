import type { Page, Response } from 'playwright';
import { normalizeList } from './normalize';
import type { CollectedItem } from '@shared/types';

/**
 * 旁听接口取数 —— ADR-1 / 红线 3
 * 只旁听（page.on('response')），绝不 fulfill / abort，绝不拦截或伪造请求。
 */

export interface FeedListener {
  drain(): CollectedItem[];
  stop(): void;
  size(): number;
  /** 本次旁听到的 JSON 响应 URL（去重、截断）——用于「一条都没取到」时定位改版 */
  seenUrls(): string[];
}

/** 从平台 JSON 里挖出候选数组（不同接口结构不同，统一兜底） */
export function extractCandidates(json: unknown): unknown[] {
  if (!json || typeof json !== 'object') return [];
  const o = json as Record<string, unknown>;
  for (const key of ['data', 'list', 'items', 'result', 'feed', 'message']) {
    const v = o[key];
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') {
      const nested = extractCandidates(v);
      if (nested.length) return nested;
    }
  }
  return [];
}

export function attachFeedListener(page: Page, pattern: string): FeedListener {
  const raw: unknown[] = [];
  const seen = new Set<string>();
  const handler = (res: Response) => {
    const url = res.url();
    if (!url.includes(pattern)) return;
    void (async () => {
      try {
        const json: unknown = await res.json();
        raw.push(json);
      } catch {
        // 非 JSON 响应直接忽略（只旁听，不影响页面）
      }
      // 记下命中的接口，哪怕内容没归一出东西，也好定位是哪个接口变了
      const short = url.split('?')[0] ?? url;
      if (seen.size < 20) seen.add(short);
    })();
  };
  page.on('response', handler);
  return {
    drain() {
      const out: CollectedItem[] = [];
      for (const j of raw) {
        const candidates = extractCandidates(j);
        if (candidates.length) out.push(...normalizeList(candidates));
        else out.push(...normalizeList([j]));
      }
      raw.length = 0;
      return out;
    },
    stop() {
      page.off('response', handler);
    },
    size() {
      return raw.length;
    },
    seenUrls() {
      return [...seen];
    },
  };
}
