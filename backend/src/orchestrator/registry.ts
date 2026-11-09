import * as accountRepo from '../infra/db/repo/account';
import * as taskRepo from '../infra/db/repo/task';
import { releaseContext } from '../infra/playwright/session';
import { log } from '../infra/logger';
import { Pipeline } from './pipeline';
import { publishScheduler } from './publishScheduler';
import { AccountService } from '../modules/account/service';
import { CrawlService } from '../modules/crawl/service';
import { AppError } from '@shared/errors';
import type { Account, AccountOverview } from '@shared/types';

/**
 * 账号运行时登记册 —— CHG-0002 多账号运营的核心
 *
 * 解决的问题：改造前 `createDefaultDeps()` 在启动时按 `ACCOUNT_NAME` 构造一套
 * Pipeline / CrawlService / AccountService，进程一辈子只为一个账号服务。
 * 现在按账号 id **惰性构造并缓存**一套实例，每个 `Pipeline` 持有自己的发布队列，
 * 跨账号并发再交给 `publishScheduler` 收口。
 *
 * 红线：
 * - 9 「不许并行操作同一账号」—— 每账号一个队列实例 + 队列锁（结构上串行）
 * - 8 「熔断不许自动恢复」—— 熔断只在人工点恢复时改，这里不做任何自动复位
 */

export class AccountRuntime {
  private readonly pipelines = new Map<number, Pipeline>();
  private readonly crawlers = new Map<number, CrawlService>();
  private readonly services = new Map<number, AccountService>();
  /** 是否处于「已启动」状态：决定了新建的账号要不要立刻起自己的 tick */
  private loopMs = 0;

  /* ───────────── 当前账号 ───────────── */

  /**
   * 保证库里至少有一个账号（幂等）。
   * 服务启动 / 接口层初始化时调一次，避免「界面刚打开时账号列表是空的」——
   * getActiveAccount 内部已有「没有就建默认账号」的回落（REQ-0002-08 零迁移）。
   */
  ensureSeeded(): Account {
    return accountRepo.getActiveAccount();
  }

  /** 当前操作的目标账号（持久化在 app_config.activeAccountId） */
  active(): Account {
    return accountRepo.getActiveAccount();
  }

  /**
   * 切换当前账号。顺手释放上一个账号的浏览器上下文：
   * 多个有头浏览器常驻很吃内存，而登录态本来就在硬盘上（ADR-4），要用回来再开即可。
   */
  setActive(id: number): Account {
    const prev = this.active();
    const next = accountRepo.setActiveAccount(id);
    if (prev.id !== next.id) {
      void releaseContext(`toutiao:${prev.name}`, 'account-switch');
      log('info', '切换到账号', { from: prev.name, to: next.name });
    }
    return next;
  }

  /* ───────────── 清单 ───────────── */

  list(): AccountOverview[] {
    return accountRepo.listAccounts().map((acc) => this.overviewOf(acc));
  }

  overviewOf(acc: Account): AccountOverview {
    const fresh = accountRepo.refreshQuota(acc.id);
    const counts = taskRepo.countByStatus(acc.id);
    return {
      ...fresh,
      remaining: Math.max(0, fresh.dailyPublishLimit - fresh.usedToday),
      queueDepth: this.pipelines.get(acc.id)?.queue.size() ?? 0,
      reviewing: counts['reviewing'] ?? 0,
      failed: counts['failed'] ?? 0,
      failedToday: taskRepo.countFailedToday(acc.id),
      publishing: counts['publishing'] ?? 0,
    };
  }

  activeAccountId(): number {
    return this.active().id;
  }

  /* ───────────── 增删 ───────────── */

  create(name: string): Account {
    const acc = accountRepo.createAccount(name);
    log('info', '账号已创建', { account: acc.name, id: acc.id });
    // 运行中新建的账号要立刻起自己的 tick，否则它的任务要等重启才有人推进
    if (this.loopMs > 0) this.pipeline(acc).startAutoLoop(this.loopMs);
    return acc;
  }

  /**
   * 删除账号：先停它的流水线（不再有可能在飞的发布），再释放浏览器上下文，
   * 最后才删库记录。data/sessions/<账号名>/ 保留 —— 误删时登录态还在盘上。
   */
  remove(id: number): { deleted: boolean; sessionDir: string; sourcesRemoved: number } {
    const acc = accountRepo.getAccount(id);
    if (!acc) throw new AppError('NOT_FOUND', `账号 #${id} 不存在`, '刷新页面后再试');
    const pipeline = this.pipelines.get(id);
    if (pipeline) {
      // 队列是纯内存态（ADR-7：数据库才是进度来源），随实例一起丢弃，不跨账号转移任务
      pipeline.stopAutoLoop();
      this.pipelines.delete(id);
    }
    this.crawlers.delete(id);
    this.services.delete(id);
    publishScheduler.forget(id);
    void releaseContext(`toutiao:${acc.name}`, 'account-removed');
    const out = accountRepo.deleteAccount(id);
    log('warn', '账号已删除', { account: acc.name, ...out });
    return out;
  }

  /* ───────────── 按账号取实例 ───────────── */

  pipeline(acc: Account | number): Pipeline {
    const account = typeof acc === 'number' ? this.mustGet(acc) : acc;
    const hit = this.pipelines.get(account.id);
    if (hit) return hit;
    const p = new Pipeline(account.name, this.crawler(account));
    this.pipelines.set(account.id, p);
    return p;
  }

  crawler(acc: Account | number): CrawlService {
    const account = typeof acc === 'number' ? this.mustGet(acc) : acc;
    const hit = this.crawlers.get(account.id);
    if (hit) return hit;
    const c = new CrawlService(account.name);
    this.crawlers.set(account.id, c);
    return c;
  }

  accountService(acc: Account | number): AccountService {
    const account = typeof acc === 'number' ? this.mustGet(acc) : acc;
    const hit = this.services.get(account.id);
    if (hit) return hit;
    const s = new AccountService(account.name);
    this.services.set(account.id, s);
    return s;
  }

  /** 按 id / name / 缺省（当前账号）解析出「账号 + 它的流水线」 */
  resolve(input?: number | string | null): { account: Account; pipeline: Pipeline } {
    if (input == null || input === '') {
      const acc = this.active();
      return { account: acc, pipeline: this.pipeline(acc) };
    }
    if (typeof input === 'number') {
      const acc = this.mustGet(input);
      return { account: acc, pipeline: this.pipeline(acc) };
    }
    const named = accountRepo.getAccountByName(input);
    if (named) return { account: named, pipeline: this.pipeline(named) };
    const acc = this.active();
    return { account: acc, pipeline: this.pipeline(acc) };
  }

  private mustGet(id: number): Account {
    const acc = accountRepo.getAccount(id);
    if (!acc) throw new AppError('NOT_FOUND', `账号 #${id} 不存在`, '刷新页面后再试');
    return acc;
  }

  /* ───────────── 生命周期 ───────────── */

  startAll(intervalMs = 15_000): void {
    this.loopMs = intervalMs;
    for (const acc of accountRepo.listAccounts()) this.pipeline(acc).startAutoLoop(intervalMs);
  }

  stopAll(): void {
    this.loopMs = 0;
    for (const p of this.pipelines.values()) p.stopAutoLoop();
  }

  /** 崩溃恢复：逐个账号捞各自卡在 publishing 的任务（§4.3） */
  recoverAll(): number {
    let n = 0;
    for (const acc of accountRepo.listAccounts()) n += this.pipeline(acc).recoverOnStartup();
    return n;
  }

  emitAll(): void {
    for (const acc of accountRepo.listAccounts()) this.pipeline(acc).emitPipeline();
  }
}
