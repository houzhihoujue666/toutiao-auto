import type { StockHit, StockProvider } from '@shared/types';

/**
 * 离线自带图源（local）—— 免注册、免 Key、零元、不依赖外网
 * 用途：默认图源 commons 在本机不可达时的兜底，保证「不配任何 Key 也能取到图」（§2.3 验收口径 4）
 * 许可固定为 CC0，来源页固定为 local:// 便于留证。
 */
export class LocalProvider implements StockProvider {
  readonly id = 'local' as const;

  needsApiKey(): boolean {
    return false;
  }

  async search(keywords: string[], count: number): Promise<StockHit[]> {
    const n = Math.max(1, Math.min(count, 9));
    const key = keywords.filter(Boolean).join('-') || 'sample';
    const hits: StockHit[] = [];
    for (let i = 0; i < n; i++) {
      hits.push({
        provider: 'local',
        providerId: `local-${hash(key)}-${i}`,
        pageUrl: `local://stock/${encodeURIComponent(key)}/${i}`,
        license: 'CC0',
        author: 'ToutiaoAuto2 built-in',
        url: `local://${hash(key)}-${i}`,
        // 这是本地生成的占位图，不是真实配图；真实模式下不能对外发布
        //（2026-10-21 踩坑：commons 不可达时它兜底，结果发出去的是黑底无意义图）
        placeholder: true,
      });
    }
    return hits;
  }
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return Math.abs(h) % 100000;
}
