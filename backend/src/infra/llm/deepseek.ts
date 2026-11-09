import type { Page } from 'playwright';
import { deepseekSelectors } from '../../config/selectors';
import { llmContext } from '../playwright/session';
import { log } from '../logger';
import { AppError } from '@shared/errors';
import type { LlmWebAdapter, RewriteInput } from '@shared/types';
import { ensureLlmSession } from './sessionGuard';

/**
 * DeepSeek 网页版适配器（llm.mode = web）
 * 「AI 写完了」的判断优先级：①「停止生成」按钮出现后消失（首选）
 *                            ② 输出长度一段时间不增长
 *                            ③ 满 ★120 秒判超时
 */

const STABLE_ROUNDS = 4;
const STABLE_INTERVAL_MS = 2000;

export class DeepSeekWebAdapter implements LlmWebAdapter {
  readonly id = 'deepseek';
  private page: Page | null = null;

  constructor(private readonly timeoutMs: number) {}

  private async ensurePage(): Promise<Page> {
    if (this.page) return this.page;
    const ctx = await llmContext();
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    this.page = page;
    return page;
  }

  async ensureSession(): Promise<void> {
    const page = await this.ensurePage();
    await ensureLlmSession(page);
  }

  async rewrite(input: RewriteInput): Promise<string> {
    const page = await this.ensurePage();
    log('info', 'deepseek: ensureSession start');
    await ensureLlmSession(page);
    log('info', 'deepseek: ensureSession ok');

    const box = page.locator(deepseekSelectors.chatInput).first();
    log('info', 'deepseek: click chat input');
    await box.click({ timeout: 15_000 });
    log('info', 'deepseek: fill prompt', { length: input.template.length });
    await box.fill(input.template);

    // DeepSeek 按钮类名经常改版，点「发送」按钮的选择器不可靠；
    // 在输入框 focus 状态下按 Enter 是更稳定的触发方式。
    log('info', 'deepseek: press Enter to send');
    await box.press('Enter');

    log('info', 'deepseek: wait for completion');
    const text = await this.waitForCompletion(page);
    log('info', 'deepseek: completion done', { length: text.length });
    if (!text)
      throw new AppError('LLM_EMPTY', '模型返回空内容', '换一条素材重试，或改用 manual 模式');
    return text;
  }

  private async waitForCompletion(page: Page): Promise<string> {
    const deadline = Date.now() + this.timeoutMs;
    const stop = page.locator(deepseekSelectors.stopGenerating).first();
    const blocks = page.locator(deepseekSelectors.responseBlock);

    // ① 等待「停止生成」出现（说明开始生成）
    let started = false;
    while (Date.now() < deadline) {
      const visible = await stop.isVisible().catch(() => false);
      log('debug', 'deepseek: wait started tick', { visible });
      if (visible) {
        started = true;
        break;
      }
      await page.waitForTimeout(500);
    }
    log('info', `deepseek: generation started=${started}`);

    // ② 停止生成消失 = 生成结束（首选判据）
    let last = '';
    let stable = 0;
    while (Date.now() < deadline) {
      const stillGenerating = await stop.isVisible().catch(() => false);
      const count = await blocks.count();
      const current = count
        ? (await blocks
            .nth(count - 1)
            .innerText()
            .catch(() => '')) || ''
        : '';
      log('debug', 'deepseek: wait completion tick', {
        stillGenerating,
        count,
        length: current.length,
        stable,
      });
      if (started && !stillGenerating && current.trim()) {
        log('info', 'llm generation finished (stop button gone)', { length: current.length });
        return current;
      }
      if (current.trim() && current.length === last.length) {
        stable++;
        if (stable >= STABLE_ROUNDS) {
          log('info', 'llm generation finished (length stable)', { length: current.length });
          return current;
        }
      } else {
        stable = 0;
      }
      last = current;
      await page.waitForTimeout(STABLE_INTERVAL_MS);
    }
    throw new AppError(
      'LLM_TIMEOUT',
      `生成超时（>${Math.round(this.timeoutMs / 1000)} 秒）`,
      '重试 1 次；连续 2 次熔断该适配器',
    );
  }

  async dispose(): Promise<void> {
    this.page = null;
  }
}
