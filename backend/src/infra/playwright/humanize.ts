import type { Page } from 'playwright';
import { HUMANIZE } from '@shared/constants';

/**
 * 拟人化原语 —— §9「拟人化」：参数集中配置，业务代码里不许到处写随机数
 * 目的：降频（像人一样慢），不是躲机器识别（§8.5）
 */

export function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function stepPause(): Promise<void> {
  await sleep(rand(HUMANIZE.STEP_INTERVAL_MS[0], HUMANIZE.STEP_INTERVAL_MS[1]));
}

/** 逐字输入：每字 ★40~120 ms，句间 ★300~600 ms */
export async function typeLikeHuman(page: Page, selector: string, text: string): Promise<void> {
  const locator = page.locator(selector).first();
  await locator.click();
  await sleep(rand(HUMANIZE.HOVER_BEFORE_CLICK_MS[0], HUMANIZE.HOVER_BEFORE_CLICK_MS[1]));
  for (const ch of text) {
    await page.keyboard.type(ch, { delay: 0 });
    await sleep(rand(HUMANIZE.TYPE_CHAR_MS[0], HUMANIZE.TYPE_CHAR_MS[1]));
    if (/[。！？!?；;\n]/.test(ch)) {
      await sleep(rand(HUMANIZE.SENTENCE_PAUSE_MS[0], HUMANIZE.SENTENCE_PAUSE_MS[1]));
    }
  }
}

/** 点击前悬停 ★200~500 ms */
export async function hoverAndClick(page: Page, selector: string): Promise<void> {
  const locator = page.locator(selector).first();
  await locator.hover({ timeout: 10_000 });
  await sleep(rand(HUMANIZE.HOVER_BEFORE_CLICK_MS[0], HUMANIZE.HOVER_BEFORE_CLICK_MS[1]));
  await locator.click({ timeout: 10_000 });
}

/** 拟人化滚动：随机步长 + ★150~400 ms */
export async function humanScroll(page: Page, steps = 6): Promise<void> {
  for (let i = 0; i < steps; i++) {
    const dy = Math.floor(rand(200, 700));
    await page.mouse.wheel(0, dy);
    await sleep(rand(HUMANIZE.SCROLL_STEP_MS[0], HUMANIZE.SCROLL_STEP_MS[1]));
  }
}
