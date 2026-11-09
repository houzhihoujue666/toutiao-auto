import type { StockHit, StockProvider } from '@shared/types';
import { fetchWithTimeout } from './types';

/**
 * Pexels —— 可选增强图源：需要自带免费 Key（MVP 不依赖它）
 * Key 失效 / 被限流 → 由 factory 自动回退到免 Key 图源，任务继续，不阻塞
 */
export class PexelsProvider implements StockProvider {
  readonly id = 'pexels' as const;

  constructor(private readonly apiKey: string) {}

  needsApiKey(): boolean {
    return true;
  }

  async search(keywords: string[], count: number): Promise<StockHit[]> {
    const q = keywords.filter(Boolean).join(' ') || 'nature';
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=${Math.max(1, Math.min(count, 10))}`;
    const res = await fetchWithTimeout(url, { headers: { Authorization: this.apiKey } });
    if (!res.ok) throw new Error(`pexels search failed: ${res.status}`);
    const json = (await res.json()) as {
      photos?: { id: number; url: string; photographer: string; src: { large: string } }[];
    };
    return (json.photos ?? []).map((p) => ({
      provider: 'pexels' as const,
      providerId: String(p.id),
      pageUrl: p.url,
      license: 'Pexels License',
      author: p.photographer,
      url: p.src.large,
    }));
  }
}
