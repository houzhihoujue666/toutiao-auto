import { AppError } from '@shared/errors';
import { DEFAULT_LLM_API_MODEL } from '@shared/constants';
import type { LlmWebAdapter, RewriteInput } from '@shared/types';

/**
 * OpenAI 兼容 API 适配器（llm.mode = api）
 *
 * 只要求服务端实现 POST {baseUrl}/chat/completions，因此同一套代码可以接：
 *   - 智谱 GLM      https://open.bigmodel.cn/api/paas/v4 model: glm-4.7-flash（默认 · 免费档）
 *   - DeepSeek      https://api.deepseek.com/v1          model: deepseek-chat
 *   - 硅基流动      https://api.siliconflow.cn/v1        model: Qwen/Qwen2.5-7B-Instruct
 *   - 阿里百炼      https://dashscope.aliyuncs.com/compatible-mode/v1
 *   - 火山方舟      https://ark.cn-beijing.volces.com/api/v3
 *
 * 相比网页自动化：不需要登录、不怕改版、速度稳定。ADR-0016 起为默认改写路径；
 * 配上免费档模型即「零大模型费用」，各家的免费政策以官网为准，见设置页引导卡片。
 */

export interface ApiAdapterOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

/** 生成类任务略高一点温度，避免改写后过于贴近原文 */
const TEMPERATURE = 0.8;
const MAX_TOKENS = 2000;

export class OpenAICompatibleAdapter implements LlmWebAdapter {
  readonly id = 'api';

  constructor(private readonly opts: ApiAdapterOptions) {}

  async ensureSession(): Promise<void> {
    if (!this.opts.apiKey.trim()) {
      throw new AppError(
        'VALIDATION_FAILED',
        '还没填「AI 钥匙」',
        '到设置页「免费 AI 改写」卡片照三步申请一把免费钥匙，粘进「可调设置」的「API Key」那一行',
      );
    }
    if (!this.opts.baseUrl.trim() || !this.opts.model.trim()) {
      throw new AppError(
        'VALIDATION_FAILED',
        'AI 的地址或型号还没填',
        '到设置页补齐「API 地址」和「API 模型名」，或用「免费 AI 改写」卡片里的下拉一键填好',
      );
    }
  }

  async rewrite(input: RewriteInput): Promise<string> {
    await this.ensureSession();
    const url = endpointOf(this.opts.baseUrl);
    const model = this.opts.model.trim();
    const body: Record<string, unknown> = {
      model,
      messages: [{ role: 'user', content: input.template }],
      temperature: TEMPERATURE,
      max_tokens: MAX_TOKENS,
      stream: false,
    };
    // 智谱 GLM-4.7-Flash 默认开启「深度思考」，改写几百字会明显变慢、更占免费档并发。
    // 官方支持显式关闭；别家不认这个私有字段，故严格限定「智谱域名 + 默认模型」才附加，
    // 换服务商或换型号时自动退回标准 OpenAI 兼容请求（边界见 llmApi.test.ts）。
    if (/bigmodel\.cn/i.test(this.opts.baseUrl) && model === DEFAULT_LLM_API_MODEL) {
      body.thinking = { type: 'disabled' };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.opts.apiKey.trim()}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const raw = await res.text();
      if (!res.ok) throw mapHttpError(res.status, raw);
      return extractContent(raw);
    } catch (e) {
      if (e instanceof AppError) throw e;
      if ((e as Error)?.name === 'AbortError') {
        throw new AppError(
          'LLM_TIMEOUT',
          `AI 改写等太久了（超过 ${Math.round(this.opts.timeoutMs / 1000)} 秒）`,
          '检查网络；或在设置页调大「改写等待上限」',
        );
      }
      throw new AppError(
        'INTERNAL',
        `连不上 AI 服务：${(e as Error).message}`,
        '检查网络，以及地址和钥匙有没有填对；设置页「免费 AI 改写」卡片里有图文步骤',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async dispose(): Promise<void> {
    // 无长连接需要释放
  }
}

/** baseUrl 允许填到 /v1，也允许直接填完整的 /chat/completions */
function endpointOf(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
}

interface ChatCompletion {
  choices?: {
    message?: { content?: string | { type?: string; text?: string }[] };
    text?: string;
  }[];
  error?: { message?: string; code?: string | number };
}

function extractContent(raw: string): string {
  let data: ChatCompletion;
  try {
    data = JSON.parse(raw) as ChatCompletion;
  } catch {
    throw new AppError(
      'LLM_EMPTY',
      'AI 回的内容看不懂（不是标准格式）',
      '多半把「API 地址」填成了官网网址，应填以 /v1 结尾的接口地址',
    );
  }
  const content = data.choices?.[0]?.message?.content ?? data.choices?.[0]?.text ?? '';
  if (typeof content === 'string') return content.trim();
  return content
    .map((p) => (typeof p === 'string' ? p : (p?.text ?? '')))
    .join('')
    .trim();
}

function mapHttpError(status: number, body: string): AppError {
  const detail = safeErrorMessage(body);
  if (status === 401 || status === 403) {
    return new AppError(
      'VALIDATION_FAILED',
      `钥匙没被认可（HTTP ${status}）${detail ? `：${detail}` : ''}`,
      '重新复制粘贴一次，别带多余空格，也确认钥匙和「API 地址」是同一家；怎么申请看设置页「免费 AI 改写」卡片',
    );
  }
  if (status === 402 || /insufficient|balance|余额/i.test(body)) {
    return new AppError(
      'VALIDATION_FAILED',
      `这家 AI 账户余额不够${detail ? `：${detail}` : ''}`,
      '多半选到了要花钱的型号：在设置页「免费 AI 改写」卡片换回免费的智谱，或去那家官网看免费额度',
    );
  }
  if (status === 429) {
    return new AppError(
      'RATE_LIMITED',
      `AI 那边排队了（HTTP 429）${detail ? `：${detail}` : ''}`,
      '免费的通常每分钟有次数限制：程序会自动重试，还不行就等一分钟再试，或在设置页换一家',
    );
  }
  if (status === 404) {
    return new AppError(
      'VALIDATION_FAILED',
      `地址或型号填错了（HTTP 404）${detail ? `：${detail}` : ''}`,
      '照官网写的名字重填；或者用设置页「免费 AI 改写」卡片里的下拉一键填好',
    );
  }
  return new AppError(
    'INTERNAL',
    `AI 服务返回 HTTP ${status}${detail ? `：${detail}` : ''}`,
    '等一会儿再试；也可能是那家官网暂时出问题了',
  );
}

function safeErrorMessage(body: string): string {
  try {
    const j = JSON.parse(body) as { error?: { message?: string }; message?: string };
    return (j.error?.message ?? j.message ?? '').slice(0, 200);
  } catch {
    return body.slice(0, 200).replace(/\s+/g, ' ');
  }
}
