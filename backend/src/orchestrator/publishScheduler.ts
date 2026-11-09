import { getNumber, KEYS } from '../config/runtime';
import { log } from '../infra/logger';
import { DEFAULT_ACCOUNT_CONCURRENCY } from '@shared/constants';

/**
 * 跨账号发布并发闸门 —— CHG-0002 / ADR-0015
 *
 * 分工：
 * - `orchestrator/queue.ts` 的每账号队列锁：保证**同一账号严格串行**（红线 9 / ADR-6）
 * - 本调度器：限制**同时处在发布中的账号数**，防止多账号变成同一出口 IP 上的并发群发（ADR-5 风控优先）
 *
 * 两条铁律：
 * 1. 同一个账号重入是允许的（它自己的队列锁已经保证了串行），不要把「自己等自己」判成超额；
 * 2. 让出名额时按 FIFO 唤醒等待者，避免「谁 tick 得快谁一直占着」的饿死。
 */

type Waiter = () => void;

export function concurrencyLimit(override?: number): number {
  const v = override ?? getNumber(KEYS.accountConcurrencyLimit);
  return v > 0 ? Math.floor(v) : DEFAULT_ACCOUNT_CONCURRENCY;
}

class PublishScheduler {
  private readonly active = new Set<number>();
  private readonly waiting: number[] = [];
  private readonly waiters = new Map<number, Waiter>();

  /** 当前拿到名额的账号 id（测试断言用） */
  activeAccounts(): number[] {
    return [...this.active];
  }

  /** 正在等待名额的账号 id（测试断言用） */
  waitingAccounts(): number[] {
    return [...this.waiting];
  }

  /**
   * 取一个发布名额。
   * @returns true = 拿到了，可以发；false = 名额满了，已排进等待队列（后续由 release 唤醒）
   */
  acquire(accountId: number, onGranted: Waiter, limit?: number): boolean {
    if (this.active.has(accountId)) return true; // 同账号重入：串行由队列锁保证
    if (this.active.size < concurrencyLimit(limit)) {
      this.active.add(accountId);
      return true;
    }
    if (!this.waiting.includes(accountId)) this.waiting.push(accountId);
    this.waiters.set(accountId, onGranted);
    log('debug', '等待发布名额：已达账号并发上限', {
      accountId,
      active: this.active.size,
      waiting: this.waiting.length,
    });
    return false;
  }

  /** 让出名额，并按 FIFO 唤醒等待中的账号 */
  release(accountId: number, limit?: number): void {
    this.active.delete(accountId);
    const cap = concurrencyLimit(limit);
    while (this.waiting.length > 0 && this.active.size < cap) {
      const next = this.waiting.shift()!;
      const onGranted = this.waiters.get(next);
      this.waiters.delete(next);
      if (!onGranted) continue;
      this.active.add(next);
      // 微任务里再唤醒：让本次 drainQueue 的 finally 走完，避免重入自己的锁
      Promise.resolve().then(() => onGranted());
    }
  }

  /** 账号被删除 / 停用时从等待队列摘掉，避免唤醒一个已经不存在的 pipeline */
  forget(accountId: number): void {
    this.waiters.delete(accountId);
    const i = this.waiting.indexOf(accountId);
    if (i >= 0) this.waiting.splice(i, 1);
    this.active.delete(accountId);
  }

  /** 仅在测试里用：清空全部状态 */
  reset(): void {
    this.active.clear();
    this.waiters.clear();
    this.waiting.length = 0;
  }
}

export const publishScheduler = new PublishScheduler();
export { PublishScheduler };
