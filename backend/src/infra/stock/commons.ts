import { LICENSE_WHITELIST } from '@shared/constants';
import type { StockHit, StockProvider } from '@shared/types';
import { fetchWithTimeout } from './types';

/**
 * Wikimedia Commons —— ADR-12 默认图源：开放接口，免注册、免 API Key、永久零元
 * 许可只认 CC0 / 公有领域，其余由 licenseFilter 过滤。
 */

interface CommonsPage {
  pageid: number;
  title: string;
  imageinfo?: {
    url: string;
    descriptionurl: string;
    extmetadata?: Record<string, { value: string }>;
  }[];
}

export class CommonsProvider implements StockProvider {
  readonly id = 'commons' as const;

  needsApiKey(): boolean {
    return false;
  }

  async search(keywords: string[], count: number): Promise<StockHit[]> {
    const q = keywords.filter(Boolean).join(' ') || 'nature';
    const url =
      'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search' +
      `&gsrsearch=${encodeURIComponent(`filetype:bitmap ${q}`)}&gsrnamespace=6&gsrlimit=${Math.max(1, Math.min(count * 3, 20))}` +
      '&prop=imageinfo&iiprop=url|extmetadata';

    const res = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'ToutiaoAuto2/0.1 (local tool)' },
    });
    if (!res.ok) throw new Error(`commons search failed: ${res.status}`);
    const json = (await res.json()) as { query?: { pages?: Record<string, CommonsPage> } };
    const pages = Object.values(json.query?.pages ?? {});

    const hits: StockHit[] = [];
    for (const p of pages) {
      const info = p.imageinfo?.[0];
      if (!info?.url) continue;
      const license = info.extmetadata?.['LicenseShortName']?.value ?? '';
      if (!LICENSE_WHITELIST.some((l) => license.toLowerCase().includes(l.toLowerCase()))) continue;
      hits.push({
        provider: 'commons',
        providerId: String(p.pageid),
        pageUrl:
          info.descriptionurl ??
          `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title)}`,
        license,
        author: stripHtml(info.extmetadata?.['Artist']?.value ?? ''),
        url: info.url,
      });
      if (hits.length >= count) break;
    }
    return hits;
  }
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '').trim();
}
