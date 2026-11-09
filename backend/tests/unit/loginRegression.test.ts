import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initDb, closeDb } from '../../src/infra/db';
import { seedDefaults } from '../../src/infra/db/repo/config';
import { setConfig, KEYS } from '../../src/config/runtime';
import * as accountRepo from '../../src/infra/db/repo/account';
import { AccountService } from '../../src/modules/account/service';

/**
 * 登录态回归（CHG-0005 修复）。
 *
 * 现象：账号浏览器会话（userDataDir）里还存着上一次登录的 cookie 时，点「扫码登录」
 * 头条会直接跳到已登录后台，没有二维码可截。原 startLogin 默认「一定有二维码」，
 * 找不到就抛 SELECTOR_TIMEOUT，导致后台 waitForLogin 不被调度、状态永远停在 logged_out。
 * 同时 checkSession 检出已登录却没把状态写回 DB。
 *
 * 这里用内存库 + mock 出来的 Playwright 页面，把三种登录页状态都覆盖到：
 *  - 已登录（无二维码）→ startLogin 返回 alreadyLoggedIn，不再抛错
 *  - 未登录且有二维码 → startLogin 正常返回二维码 base64
 *  - 两者皆无 → 仍抛 SELECTOR_TIMEOUT（真实的平台改版信号）
 *  - checkSession 检出已登录 → 把状态写回 DB
 */

const h = vi.hoisted(() => ({
  page: { qrcode: false, loggedIn: false, editor: false },
}));

vi.mock('../../src/infra/playwright/session', () => ({
  toutiaoContext: vi.fn(async () => ({
    pages: () => [
      {
        async goto() {},
        locator(sel: string) {
          let visible = false;
          if (sel.includes('qrcode') && sel.includes('user-info')) {
            // 合并选择器「已登录标志, 二维码」：任一可见即算命中
            visible = h.page.qrcode || h.page.loggedIn;
          } else if (sel.includes('qrcode')) {
            visible = h.page.qrcode;
          } else if (sel.includes('user-info') || sel.includes('avatar') || sel.includes('mp-username')) {
            visible = h.page.loggedIn;
          } else if (sel.includes('contenteditable')) {
            visible = h.page.editor;
          }
          return {
            first: () => ({
              isVisible: async () => visible,
              waitFor: async () => {
                if (!visible) throw new Error('timeout');
              },
              screenshot: async () => Buffer.from('qr'),
            }),
          };
        },
      },
    ],
  })),
  saveStorageState: vi.fn(async () => {}),
  releaseContext: vi.fn(async () => {}),
}));

describe('登录态回归（CHG-0005 修复）', () => {
  beforeEach(() => {
    closeDb();
    initDb({ memory: true });
    seedDefaults();
    setConfig(KEYS.runtimeMode, 'real');
    // 保证默认账号存在且处于未登录态，避免 early guard 误报 ALREADY_LOGGED_IN
    const def = accountRepo.ensureAccount('toutiao-main');
    accountRepo.setAccountStatus(def.id, 'logged_out');
    h.page = { qrcode: false, loggedIn: false, editor: false };
  });

  afterEach(() => {
    closeDb();
  });

  it('会话已登录（无二维码）时 startLogin 不再抛错，返回 alreadyLoggedIn', async () => {
    h.page = { qrcode: false, loggedIn: true, editor: false };
    const svc = new AccountService('toutiao-test');
    const r = await svc.startLogin();
    expect(r.image).toBe('');
    expect(r.mode).toBe('real');
    expect(r.alreadyLoggedIn).toBe(true);
  });

  it('会话未登录且有二维码时 startLogin 正常返回二维码 base64', async () => {
    h.page = { qrcode: true, loggedIn: false, editor: false };
    const svc = new AccountService('toutiao-test');
    const r = await svc.startLogin();
    expect(typeof r.image).toBe('string');
    expect(r.image.length).toBeGreaterThan(0);
    expect(r.alreadyLoggedIn).toBeFalsy();
  });

  it('登录页既无二维码也无已登录标志时仍抛 SELECTOR_TIMEOUT', async () => {
    h.page = { qrcode: false, loggedIn: false, editor: false };
    const svc = new AccountService('toutiao-test');
    await expect(svc.startLogin()).rejects.toMatchObject({ code: 'SELECTOR_TIMEOUT' });
  });

  it('checkSession 检出已登录时把状态写回 DB', async () => {
    h.page = { qrcode: false, loggedIn: false, editor: true };
    const svc = new AccountService('toutiao-test');
    const status = await svc.checkSession();
    expect(status).toBe('logged_in');
    const acc = svc.account();
    expect(accountRepo.getAccount(acc.id)!.status).toBe('logged_in');
  });
});
