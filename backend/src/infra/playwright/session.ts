import { chromium, type BrowserContext } from 'playwright';
import { accountSessionDir, llmSessionDir, storageStatePath } from '../storage/paths';
import { log } from '../logger';
import { IDLE_BROWSER_RELEASE_MIN } from '@shared/constants';

/**
 * Playwright 会话基础设施 —— ADR-4：每账号独立浏览器目录 + 指纹
 * 红线：禁止指向系统 Chrome 默认目录；空闲即释放（★5 分钟）。
 */

interface Managed {
  ctx: BrowserContext;
  timer: ReturnType<typeof setTimeout> | null;
  key: string;
}

const contexts = new Map<string, Managed>();

let idleMinutes = IDLE_BROWSER_RELEASE_MIN;

export function setIdleReleaseMinutes(min: number): void {
  idleMinutes = Math.max(1, min);
}

function scheduleIdleRelease(key: string): void {
  const m = contexts.get(key);
  if (!m) return;
  if (m.timer) clearTimeout(m.timer);
  m.timer = setTimeout(
    () => {
      void releaseContext(key, 'idle');
    },
    idleMinutes * 60 * 1000,
  );
  m.timer.unref?.();
}

export interface OpenOptions {
  headless?: boolean;
  slowMo?: number;
}

/** 打开（或复用）持久化上下文 */
export async function getPersistentContext(
  key: string,
  userDataDir: string,
  opts: OpenOptions = {},
): Promise<BrowserContext> {
  const existing = contexts.get(key);
  if (existing) {
    scheduleIdleRelease(key);
    return existing.ctx;
  }
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    // 本机桌面工具：默认有头运行。无头浏览器更容易被站点识别，也不方便你自己看登录页扫二维码
    headless: opts.headless ?? false,
    slowMo: opts.slowMo ?? 0,
    viewport: { width: 1440, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  contexts.set(key, { ctx, timer: null, key });
  scheduleIdleRelease(key);
  log('info', `persistent context opened: ${key}`, { userDataDir });
  return ctx;
}

/** 头条账号上下文（每账号独立目录） */
export function toutiaoContext(accountName: string, opts?: OpenOptions): Promise<BrowserContext> {
  return getPersistentContext(`toutiao:${accountName}`, accountSessionDir(accountName), opts);
}

/** 大模型上下文：与头条会话完全隔离（§3.5） */
export function llmContext(opts?: OpenOptions): Promise<BrowserContext> {
  return getPersistentContext('llm:deepseek', llmSessionDir(), opts);
}

export async function saveStorageState(key: string, target: string): Promise<void> {
  const m = contexts.get(key);
  if (!m) return;
  await m.ctx.storageState({ path: target });
  log('debug', `storageState saved: ${key}`, { path: target });
}

export async function releaseContext(key: string, reason = 'manual'): Promise<void> {
  const m = contexts.get(key);
  if (!m) return;
  if (m.timer) clearTimeout(m.timer);
  contexts.delete(key);
  try {
    await m.ctx.close();
    log('info', `browser context released: ${key}`, { reason });
  } catch (e) {
    log('warn', `release context failed: ${key}`, { error: String(e) });
  }
}

export async function releaseAll(reason = 'shutdown'): Promise<void> {
  for (const key of [...contexts.keys()]) await releaseContext(key, reason);
}

export function activeContexts(): string[] {
  return [...contexts.keys()];
}

export { storageStatePath };
