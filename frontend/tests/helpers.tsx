import { vi } from 'vitest';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render } from '@testing-library/react';
import { StoreProvider } from '../src/state/store';

type Handler = (url: string, init?: RequestInit) => unknown;

/** 按「METHOD /path 前缀」打桩 fetch：不真的起后端，也不引入额外的网络库 */
export function stubHttp(routes: Record<string, Handler | unknown>): void {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    for (const [key, body] of Object.entries(routes).sort(
      ([a], [b]) => Number(b.includes(' ')) - Number(a.includes(' ')),
    )) {
      const hasMethod = key.includes(' ');
      const keyMethod = hasMethod ? key.slice(0, key.indexOf(' ')).toUpperCase() : null;
      const keyPath = hasMethod ? key.slice(key.indexOf(' ') + 1) : key;
      if (keyMethod && keyMethod !== method) continue;
      if (url.startsWith(keyPath)) {
        const value = typeof body === 'function' ? (body as Handler)(url, init) : body;
        // 桩里直接给 { ok:false, error } 时原样返回，用来测失败分支
        const isErr =
          !!value && typeof value === 'object' && (value as { ok?: boolean }).ok === false;
        return { json: async () => (isErr ? value : { ok: true, data: value }) };
      }
    }
    return {
      json: async () => ({
        ok: false,
        error: { code: 'NOT_FOUND', message: `测试未打桩：${method} ${url}`, hint: '补一个桩' },
      }),
    };
  });
}

export function renderApp(ui: ReactElement, initialEntry = '/'): ReturnType<typeof render> {
  return render(
    <StoreProvider>
      <MemoryRouter initialEntries={[initialEntry]}>{ui}</MemoryRouter>
    </StoreProvider>,
  );
}
