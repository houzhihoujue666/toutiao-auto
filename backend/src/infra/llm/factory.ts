import { AppError } from '@shared/errors';
import {
  DEFAULT_LLM_API_BASE_URL,
  DEFAULT_LLM_API_MODEL,
  REWRITE_TIMEOUT_MS,
} from '@shared/constants';
import type { LlmWebAdapter } from '@shared/types';
import type { LlmMode } from '@shared/types';
import { getString, KEYS } from '../../config/runtime';
import { SimulatedLlmAdapter } from './simulated';
import { DeepSeekWebAdapter } from './deepseek';
import { OpenAICompatibleAdapter } from './openai-compatible';

/** 新增平台 = 一个实现类 + 一份选择器配置（ADR-2） */
export function createAdapter(
  mode: LlmMode | string,
  timeoutMs: number = REWRITE_TIMEOUT_MS,
): LlmWebAdapter {
  switch (mode) {
    case 'simulated':
      return new SimulatedLlmAdapter({ timeoutMs });
    case 'web':
      return new DeepSeekWebAdapter(timeoutMs);
    case 'manual':
      throw new AppError(
        'LLM_NEED_LOGIN',
        '当前是人工粘贴模式：请复制提示词到网页版大模型，再把结果粘回复核页',
        '在任务详情里点「复制提示词」，粘回后在改写稿框里保存',
      );
    case 'api':
      // ADR-0016 起的默认路径：不依赖浏览器登录，也不怕网页改版；配免费档模型即零大模型费用
      return new OpenAICompatibleAdapter({
        baseUrl: getString(KEYS.llmApiBaseUrl) || DEFAULT_LLM_API_BASE_URL,
        apiKey: getString(KEYS.llmApiKey),
        model: getString(KEYS.llmApiModel) || DEFAULT_LLM_API_MODEL,
        timeoutMs,
      });
    default:
      throw new AppError(
        'VALIDATION_FAILED',
        `未知的改写方式：${String(mode)}`,
        '只能在 web / manual / api / simulated 中选择',
      );
  }
}
