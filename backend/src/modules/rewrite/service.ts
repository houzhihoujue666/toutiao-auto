import { getDefaultTemplate } from '../../infra/db/repo/prompt';
import { createAdapter } from '../../infra/llm/factory';
import { log } from '../../infra/logger';
import { STRONGER_PROMPT } from '@shared/prompts';
import { DEFAULT_WORD_RANGE, REWRITE_TIMEOUT_MS } from '@shared/constants';
import { AppError } from '@shared/errors';
import type { LlmMode } from '@shared/types';
import { cleanRewritten, isEmptyOutput } from './clean';
import { renderPrompt, withStronger } from './prompt';
import { computeSimilarity } from './similarity';

export interface RewriteOutcome {
  text: string;
  similarity: number;
  attempts: number;
  /** 相似度仍超标时为 true，由质检环节拦截 */
  stillOver: boolean;
}

export interface RewriteOptions {
  wordRange?: string;
  threshold: number;
  mode: LlmMode | string;
  timeoutMs?: number;
  /** 强化重写次数（★ rewriteRetry） */
  retries?: number;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new AppError(
            'LLM_TIMEOUT',
            `生成超时（>${Math.round(ms / 1000)} 秒）`,
            '重试 1 次；连续 2 次熔断该适配器',
          ),
        ),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export class RewriteService {
  /** 改写 + 清洗 + 算相似度；相似度不达标则强化重写（★最多 1 次） */
  async run(original: string, opts: RewriteOptions): Promise<RewriteOutcome> {
    const template = getDefaultTemplate().content;
    const basePrompt = renderPrompt(template, {
      originalText: original,
      wordRange: opts.wordRange ?? DEFAULT_WORD_RANGE,
    });
    const timeoutMs = opts.timeoutMs ?? REWRITE_TIMEOUT_MS;
    const maxAttempts = 1 + Math.max(0, opts.retries ?? 1);
    const adapter = createAdapter(opts.mode, timeoutMs);

    try {
      await adapter.ensureSession();
      let prompt = basePrompt;
      let lastText = '';
      let lastSim = 1;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const raw = await withTimeout(
          adapter.rewrite({ template: prompt, originalText: original }),
          timeoutMs,
        );
        const text = cleanRewritten(raw);
        if (isEmptyOutput(raw)) {
          log('warn', `LLM_EMPTY: 第 ${attempt} 次改写返回空或全是客套话`);
          if (attempt < maxAttempts) {
            prompt = withStronger(basePrompt, STRONGER_PROMPT);
            continue;
          }
          throw new AppError(
            'LLM_EMPTY',
            '模型返回空或全是客套话',
            '换一条素材重试，或改用 manual 模式',
          );
        }
        const sim = computeSimilarity(original, text);
        lastText = text;
        lastSim = sim;
        log('info', `rewrite attempt ${attempt}: similarity=${sim.toFixed(3)}`, {
          threshold: opts.threshold,
        });
        if (sim <= opts.threshold) {
          return { text, similarity: sim, attempts: attempt, stillOver: false };
        }
        if (attempt < maxAttempts) {
          log('warn', `相似度 ${sim.toFixed(3)} 超标，强化重写 1 次`);
          prompt = withStronger(basePrompt, STRONGER_PROMPT);
        }
      }

      return {
        text: lastText,
        similarity: lastSim,
        attempts: maxAttempts,
        stillOver: lastSim > opts.threshold,
      };
    } finally {
      await adapter.dispose();
    }
  }
}
