import { authSelectors, publishSelectors } from '../../config/selectors';
import { getMode } from '../../config/runtime';
import { log } from '../../infra/logger';
import { renderQrPng } from '../../infra/image/qr';
import { releaseContext, saveStorageState, toutiaoContext } from '../../infra/playwright/session';
import { storageStatePath } from '../../infra/storage/paths';
import * as accountRepo from '../../infra/db/repo/account';
import { AppError } from '@shared/errors';
import type { Account, AccountStatus } from '@shared/types';

/**
 * 账号与登录 —— §6.1
 * 职责：扫码登录、推送二维码、检测是否登录、读信用分。不参与内容生产。
 * 红线：二维码不落盘、不写日志；掉登录只能人工扫码，程序不自动重试。
 */

export const LOGIN_TIMEOUT_MS = 120_000;

export class AccountService {
  constructor(private readonly name: string = accountRepo.DEFAULT_ACCOUNT_NAME) {}

  /**
   * 定位本账号。
   * CHG-0002：多账号下「查不到就顺手建一个」会把拼错的名字变成真账号 —— 先查，查不到才回落默认账号，
   * 且只在调用方明确用默认账号时才自动建。**拼错的名字绝不静默建库。**
   */
  account(): Account {
    return (
      accountRepo.getAccountByName(this.name) ?? accountRepo.ensureAccount(accountRepo.DEFAULT_ACCOUNT_NAME)
    );
  }

  /**
   * 发起扫码登录：返回二维码 base64（不落盘）。
   * CHG-0005 修复：会话里可能还留着上一次登录的 cookie —— 头条会直接跳到已登录后台，
   * 根本没二维码可截。这种情况不再抛 SELECTOR_TIMEOUT（否则后台 waitForLogin 不会被调度，
   * 账号状态永远停在 logged_out），而是直接交给 waitForLogin 确认并写回状态。
   */
  async startLogin(): Promise<{ image: string; mode: string; alreadyLoggedIn?: boolean }> {
    const acc = this.account();
    // 已经登录的账号再点「扫码登录」没必要去硬找不存在的二维码（会 SELECTOR_TIMEOUT），直接告知
    if (getMode() === 'real' && acc.status === 'logged_in') {
      throw new AppError(
        'ALREADY_LOGGED_IN',
        `账号「${this.name}」已经处于登录态`,
        '无需重复扫码；若要换号请先「退出登录」',
      );
    }
    if (getMode() === 'simulated') {
      const buf = await renderQrPng(Date.now() % 100000);
      log('info', 'login qr generated (simulated)', { account: this.name });
      return { image: buf.toString('base64'), mode: 'simulated' };
    }

    const ctx = await toutiaoContext(this.name);
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto(authSelectors.loginUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });

    // 先等「要么已登录界面、要么二维码」出现其一，避免硬找二维码时误报超时
    const indicator = page.locator(`${authSelectors.loggedInFlag}, ${authSelectors.qrcode}`).first();
    try {
      await indicator.waitFor({ timeout: 15_000 });
    } catch {
      throw new AppError(
        'SELECTOR_TIMEOUT',
        '登录页既没识别到已登录界面也没找到二维码元素',
        '多半是平台改版，请跑 npm run selftest',
      );
    }

    // 有二维码 = 需要扫码；没二维码但有已登录标志 = 会话已经登录
    const qrcodeVisible = await page
      .locator(authSelectors.qrcode)
      .first()
      .isVisible()
      .catch(() => false);
    if (qrcodeVisible) {
      const shot = await page.locator(authSelectors.qrcode).first().screenshot();
      log('info', 'login qr captured', { account: this.name });
      return { image: shot.toString('base64'), mode: 'real' };
    }
    const alreadyLoggedIn = await page
      .locator(authSelectors.loggedInFlag)
      .first()
      .isVisible()
      .catch(() => false);
    if (alreadyLoggedIn) {
      log('info', 'login detected: session already logged in', { account: this.name });
      return { image: '', mode: 'real', alreadyLoggedIn: true };
    }
    throw new AppError(
      'SELECTOR_TIMEOUT',
      '登录页既没找到二维码也没识别到已登录界面',
      '多半是平台改版，请跑 npm run selftest',
    );
  }

  /** 等待扫码完成：上限 ★120 秒；失败不静默重试 */
  async waitForLogin(timeoutMs = LOGIN_TIMEOUT_MS): Promise<Account> {
    const acc = this.account();
    if (getMode() === 'simulated') {
      accountRepo.setAccountStatus(acc.id, 'logged_in');
      accountRepo.setStorageState(acc.id, storageStatePath(this.name));
      accountRepo.setCreditScore(acc.id, 100);
      log('info', 'login success (simulated)', { account: this.name });
      return this.account();
    }

    const ctx = await toutiaoContext(this.name);
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    try {
      await page.waitForSelector(authSelectors.loggedInFlag, { timeout: timeoutMs });
    } catch {
      throw new AppError('LOGIN_UNKNOWN', '等待登录超时或跳转异常', '请重新获取二维码再扫一次');
    }
    const statePath = storageStatePath(this.name);
    await saveStorageState(`toutiao:${this.name}`, statePath);
    accountRepo.setAccountStatus(acc.id, 'logged_in');
    accountRepo.setStorageState(acc.id, statePath);

    const score = await page
      .locator(authSelectors.creditScore)
      .first()
      .innerText()
      .catch(() => '');
    const n = Number((score.match(/\d+/) ?? [''])[0]);
    if (Number.isFinite(n) && n > 0) accountRepo.setCreditScore(acc.id, n);

    log('info', 'login success', { account: this.name, creditScore: n || null });
    return this.account();
  }

  /** 使用过程中掉登录 → 状态改 expired，暂停任务并告警 */
  async checkSession(): Promise<AccountStatus> {
    const acc = this.account();
    if (getMode() === 'simulated') return acc.status;
    const ctx = await toutiaoContext(this.name);
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    // 用「发布页能不能看见正文编辑器」来验证登录态：
    // 登录页上也有头像 / user-info 之类的元素，用它判断会把过期会话误判成已登录。
    await page.goto(publishSelectors.publishUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    const ok = await page
      .locator(publishSelectors.editor)
      .first()
      .isVisible()
      .catch(() => false);
    if (!ok) {
      accountRepo.setAccountStatus(acc.id, 'expired');
      log('error', 'LOGIN_EXPIRED: 发布页已跳回登录框，登录态失效', {
        account: this.name,
        url: page.url(),
      });
      return 'expired';
    }
    // CHG-0005 修复：检出已登录必须把状态写回 DB，否则界面列表（读 overviewOf）一直显示未登录
    accountRepo.setAccountStatus(acc.id, 'logged_in');
    return 'logged_in';
  }

  /** 重置登录：清会话，需要重新扫码 */
  async reset(): Promise<Account> {
    const acc = this.account();
    accountRepo.setAccountStatus(acc.id, 'logged_out');
    accountRepo.setStorageState(acc.id, null);
    await releaseContext(`toutiao:${this.name}`, 'reset');
    log('warn', 'login reset', { account: this.name });
    return this.account();
  }

  /** 熔断恢复：必须由人点「恢复」（§8.2 不允许自动恢复） */
  resumeCircuit(): Account {
    const acc = this.account();
    accountRepo.setCircuit(acc.id, 'closed');
    accountRepo.setConsecutiveFailures(acc.id, 0);
    log('info', 'circuit resumed by operator', { account: this.name });
    return this.account();
  }
}
