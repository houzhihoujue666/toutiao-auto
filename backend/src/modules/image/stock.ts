import sharp from 'sharp';
import {
  createStockProvider,
  fallbackProvider,
  isProviderCoolingDown,
  markProviderDown,
} from '../../infra/stock/factory';
import { renderSampleImage } from '../../infra/image/generate';
import { log } from '../../infra/logger';
import { WEBP_QUALITY } from '@shared/constants';
import type { StockHit } from '@shared/types';
import { filterByLicense } from './licenseFilter';

/** 关键词取自【改写后正文】而非原文，降低「图文不符」扣分（§6.5 要点 1） */
export function extractKeywords(text: string, count = 3): string[] {
  const cleaned = text.replace(/[\s\p{P}\p{S}]+/gu, ' ');
  const words = cleaned
    .split(' ')
    .filter((w) => w.length >= 2)
    .filter((w) => !/^\d+$/.test(w));
  const freq = new Map<string, number>();
  for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);

  const cjkBigrams: string[] = [];
  const cjk = cleaned.replace(/\s/g, '');
  for (let i = 0; i < cjk.length - 1; i++) cjkBigrams.push(cjk.slice(i, i + 2));
  for (const b of cjkBigrams) freq.set(b, (freq.get(b) ?? 0) + 1);

  const stop = new Set([
    '这个',
    '我们',
    '你们',
    '他们',
    '自己',
    '什么',
    '怎么',
    '因为',
    '所以',
    '但是',
    '就是',
    '可以',
  ]);
  return [...freq.entries()]
    .filter(([w]) => !stop.has(w))
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, count)
    .map(([w]) => w);
}

export async function downloadAsWebp(hit: StockHit): Promise<Buffer> {
  if (hit.url.startsWith('local://')) {
    const seed = hashString(hit.url);
    return renderSampleImage({ seed, withExif: false });
  }
  const res = await fetch(hit.url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return sharp(buf).webp({ quality: WEBP_QUALITY }).toBuffer();
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return Math.abs(h);
}

/** 检索图库图：主图源失败则降级到免 Key 离线图源；再失败抛 STOCK_FETCH_FAILED */
export async function searchStockHits(
  keywords: string[],
  count: number,
  providerId?: string,
  apiKey?: string,
): Promise<{ hits: StockHit[]; provider: string }> {
  const primary = createStockProvider(providerId, apiKey);
  if (isProviderCoolingDown(primary.id)) {
    log('warn', `图源 ${primary.id} 在冷却中，直接走降级图源`, { provider: primary.id });
  } else {
    try {
      const raw = await primary.search(keywords, count);
      const hits = filterByLicense(raw);
      if (hits.length) return { hits, provider: primary.id };
      log('warn', '图库检索命中 0 张合规图，尝试降级图源', { provider: primary.id });
    } catch (e) {
      markProviderDown(primary.id);
      log('warn', `图库检索失败，降级：${String(e)}`, { provider: primary.id });
    }
  }

  const fb = fallbackProvider(providerId);
  try {
    const raw = await fb.search(keywords, count);
    const hits = filterByLicense(raw);
    if (hits.length) return { hits, provider: fb.id };
  } catch (e) {
    log('warn', `降级图源也失败：${String(e)}`, { provider: fb.id });
  }
  throw new Error('STOCK_FETCH_FAILED');
}
