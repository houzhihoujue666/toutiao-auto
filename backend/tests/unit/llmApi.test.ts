import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenAICompatibleAdapter } from '../../src/infra/llm/openai-compatible';
import { AppError } from '@shared/errors';

const OPTS = {
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: 'sk-test',
  model: 'deepseek-chat',
  timeoutMs: 5000,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('OpenAI 兼容 API 适配器（llm.mode = api）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('拼接 /chat/completions，并带 Bearer Key', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: '  改写后的正文  ' } }] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new OpenAICompatibleAdapter(OPTS);
    const text = await adapter.rewrite({ template: '提示词', originalText: '原文' });

    expect(text).toBe('改写后的正文');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.deepseek.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
    const body = JSON.parse(String(init.body)) as { model: string; messages: unknown[] };
    expect(body.model).toBe('deepseek-chat');
    expect(body.messages).toEqual([{ role: 'user', content: '提示词' }]);
  });

  it('没填 Key 时直接报错，不发请求', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new OpenAICompatibleAdapter({ ...OPTS, apiKey: '  ' });

    await expect(adapter.ensureSession()).rejects.toBeInstanceOf(AppError);
    await expect(adapter.rewrite({ template: 'p', originalText: 'o' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('401 映射成「Key 被拒绝」的可读提示', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: { message: 'invalid api key' } }, 401)),
    );
    const adapter = new OpenAICompatibleAdapter(OPTS);
    await expect(adapter.rewrite({ template: 'p', originalText: 'o' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('429 映射成限流，走重试语义', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: { message: 'slow down' } }, 429)),
    );
    const adapter = new OpenAICompatibleAdapter(OPTS);
    await expect(adapter.rewrite({ template: 'p', originalText: 'o' })).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
  });

  it('返回 200 但不是 JSON → LLM_EMPTY（多半是地址填成了网页）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>登录</html>', { status: 200 })),
    );
    const adapter = new OpenAICompatibleAdapter(OPTS);
    await expect(adapter.rewrite({ template: 'p', originalText: 'o' })).rejects.toMatchObject({
      code: 'LLM_EMPTY',
    });
  });

  it('智谱默认模型会关掉「深度思考」，避免短文本改写变慢', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: '改写结果' } }] }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new OpenAICompatibleAdapter({
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: 'sk-test',
      model: 'glm-4.7-flash',
      timeoutMs: 5000,
    });

    await adapter.rewrite({ template: '提示词', originalText: '原文' });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { thinking?: { type: string } };
    expect(body.thinking).toEqual({ type: 'disabled' });
  });

  it('换别家服务商时不附加 thinking，保持标准 OpenAI 兼容请求', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: '改写结果' } }] }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new OpenAICompatibleAdapter(OPTS);

    await adapter.rewrite({ template: '提示词', originalText: '原文' });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { thinking?: unknown };
    expect(body.thinking).toBeUndefined();
  });

  it('智谱域名但换成别的型号时也不附加 thinking', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: '改写结果' } }] }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new OpenAICompatibleAdapter({
      ...OPTS,
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'glm-4-flash-250414',
    });

    await adapter.rewrite({ template: '提示词', originalText: '原文' });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { thinking?: unknown };
    expect(body.thinking).toBeUndefined();
  });
});
