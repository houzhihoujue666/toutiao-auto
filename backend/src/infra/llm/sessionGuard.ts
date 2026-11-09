import type { Page } from 'playwright';
import { deepseekSelectors } from '../../config/selectors';
import { AppError } from '@shared/errors';

/**
 * 会话探测 —— §3.5 / ADR-13
 * 1. 能直接进输入框 → 直接用（免登录可用时最省事）
 * 2. 探测到登录墙 → 报 LLM_NEED_LOGIN，界面给「去登录」，等人（不重试、不代填）
 */

export interface LlmPageProbe {
  url: string;
  hasChatInput: boolean;
  hasLoginWall: boolean;
}

export type LlmPageVerdict = 'ready' | 'need_login' | 'lost';

/**
 * 纯判定：把「页面长什么样」翻译成结论，便于单测覆盖（不依赖真浏览器）。
 * ready=能直接用；need_login=停在 fetched 等人登录；lost=转人工。
 */
export function classifyLlmPage(p: LlmPageProbe): LlmPageVerdict {
  if (p.hasChatInput) return 'ready';
  if (p.hasLoginWall || p.url.includes(deepseekSelectors.loginUrlHint)) return 'need_login';
  return 'lost';
}

export async function isLoginWall(page: Page): Promise<boolean> {
  if (page.url().includes(deepseekSelectors.loginUrlHint)) return true;
  const wall = page.locator(deepseekSelectors.loginWall).first();
  return await wall.isVisible().catch(() => false);
}

export async function hasChatInput(page: Page): Promise<boolean> {
  const input = page.locator(deepseekSelectors.chatInput).first();
  return await input.isVisible().catch(() => false);
}

export async function ensureLlmSession(page: Page): Promise<void> {
  await page.goto(deepseekSelectors.chatUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(1500);

  const verdict = classifyLlmPage({
    url: page.url(),
    hasChatInput: await hasChatInput(page),
    hasLoginWall: await isLoginWall(page),
  });

  if (verdict === 'ready') return;
  if (verdict === 'need_login') {
    throw new AppError(
      'LLM_NEED_LOGIN',
      '大模型站点出现登录墙，当前没有可用会话',
      '请在设置页点「去登录」，由你本人在浏览器里登录一次；程序不代填账号',
    );
  }
  throw new AppError(
    'LLM_SESSION_LOST',
    '大模型网页不可用或被风控',
    '转人工处理，或使用 manual 模式粘贴结果',
  );
}

/** 人工登录：打开站点等人登录，登录完成后落盘会话（不做代注代填） */
export async function openLoginPage(page: Page): Promise<void> {
  await page.goto(deepseekSelectors.chatUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
}
