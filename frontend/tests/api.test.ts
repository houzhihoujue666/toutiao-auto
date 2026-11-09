import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchSummary, startCrawl, saveSettings } from '../src/lib/api';
import { summaryFixture } from './fixtures';

function stubFetch(body: unknown, okStatus = true): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      json: async () => (okStatus ? { ok: true, data: body } : body),
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('接口信封（§7.1）', () => {
  it('ok=true 时直接解包 data', async () => {
    const s = summaryFixture();
    stubFetch(s);
    await expect(fetchSummary()).resolves.toMatchObject({ runtimeMode: 'simulated' });
  });

  it('ok=false 时抛「原因 + 错误码 + 下一步」', async () => {
    stubFetch(
      { ok: false, error: { code: 'CRAWL_DOM_EMPTY', message: '取不到内容', hint: '跑 selftest' } },
      false,
    );
    await expect(startCrawl()).rejects.toThrow(/取不到内容（CRAWL_DOM_EMPTY）.*跑 selftest/);
  });

  it('后端返回非法 JSON 时给出可读提示', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ json: async () => null })),
    );
    await expect(fetchSummary()).rejects.toThrow(/后端没有返回可解析的结果/);
  });

  it('保存配置会带上 values 信封', async () => {
    const fn = vi.fn(async (_url: string, _init?: RequestInit) => ({
      json: async () => ({ ok: true, data: { saved: { a: '1' } } }),
    }));
    vi.stubGlobal('fetch', fn);
    await saveSettings({ similarityThreshold: '0.4' });
    const call = fn.mock.calls[0]!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({
      values: { similarityThreshold: '0.4' },
    });
  });
});
