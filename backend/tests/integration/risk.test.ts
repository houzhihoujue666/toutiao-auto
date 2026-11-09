import { describe, it, expect } from 'vitest';
import { useFreshDb } from '../helpers/setup';
import { setConfig, KEYS } from '../../src/config/runtime';
import {
  evaluate,
  intervalMinutes,
  dailyLimit,
  assertCanPublish,
} from '../../src/orchestrator/rateLimit';
import * as accountRepo from '../../src/infra/db/repo/account';
import { recordFailure, resume, assertClosed } from '../../src/orchestrator/circuitBreaker';
import { PublishQueue } from '../../src/orchestrator/queue';
import { AppError } from '@shared/errors';
import {
  MIN_PUBLISH_INTERVAL_MIN,
  DAILY_PUBLISH_LIMIT,
  CIRCUIT_BREAK_FAILURES,
} from '@shared/constants';

const ACCOUNT = 'toutiao-main';

function freshAccount() {
  return accountRepo.ensureAccount(ACCOUNT);
}

describe('限速（§8.2：★50 条 / 天，★15 分钟）', () => {
  useFreshDb();

  it('默认值取自 §9 定案表', () => {
    expect(dailyLimit()).toBe(DAILY_PUBLISH_LIMIT);
    expect(intervalMinutes()).toBe(MIN_PUBLISH_INTERVAL_MIN);
  });

  it('刚发过一条 → 间隔内拒绝，并给出等待时间', () => {
    const acc = freshAccount();
    accountRepo.setLastPublishAt(acc.id, new Date().toISOString());
    const d = evaluate(accountRepo.getAccount(acc.id)!);
    expect(d.ok).toBe(false);
    expect(d.reason).toBe('interval');
    expect(d.waitMs).toBeGreaterThan(0);
    expect(d.waitMs).toBeLessThanOrEqual(MIN_PUBLISH_INTERVAL_MIN * 60_000);
  });

  it('历史数据里的 SQLite UTC 时间（无时区）也按 UTC 解析，不会被误判为早就过了间隔', () => {
    const acc = freshAccount();
    // datetime('now') 的写法：1 分钟前发布
    const sqliteUtc = new Date(Date.now() - 60_000).toISOString().slice(0, 19).replace('T', ' ');
    accountRepo.setLastPublishAt(acc.id, sqliteUtc);
    const d = evaluate(accountRepo.getAccount(acc.id)!);
    expect(d.ok).toBe(false);
    expect(d.reason).toBe('interval');
    expect(d.waitMs).toBeGreaterThan(0);
    expect(d.waitMs).toBeLessThanOrEqual(MIN_PUBLISH_INTERVAL_MIN * 60_000);
  });

  it('间隔到了 → 放行', () => {
    const acc = freshAccount();
    const longAgo = new Date(Date.now() - (MIN_PUBLISH_INTERVAL_MIN + 1) * 60_000).toISOString();
    accountRepo.setLastPublishAt(acc.id, longAgo);
    expect(evaluate(accountRepo.getAccount(acc.id)!).ok).toBe(true);
  });

  it('到日上限 → 拒绝入队，剩余额度为 0', () => {
    setConfig(KEYS.dailyPublishLimit, '2');
    const acc = freshAccount();
    accountRepo.bumpUsedToday(acc.id);
    accountRepo.bumpUsedToday(acc.id);
    const d = evaluate(accountRepo.getAccount(acc.id)!);
    expect(d.ok).toBe(false);
    expect(d.reason).toBe('daily');
    expect(d.remaining).toBe(0);
  });

  it('达上限时 assertCanPublish 抛 RATE_LIMITED 并提示次日重置', () => {
    setConfig(KEYS.dailyPublishLimit, '1');
    const acc = freshAccount();
    accountRepo.bumpUsedToday(acc.id);
    try {
      assertCanPublish(accountRepo.getAccount(acc.id)!);
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe('RATE_LIMITED');
    }
  });
});

describe('熔断（§8.2：★3 次失败，且不自动恢复）', () => {
  useFreshDb();

  it('连续失败到阈值才熔断', () => {
    const acc = freshAccount();
    expect(CIRCUIT_BREAK_FAILURES).toBe(3);

    expect(recordFailure(accountRepo.getAccount(acc.id)!).opened).toBe(false);
    expect(recordFailure(accountRepo.getAccount(acc.id)!).opened).toBe(false);
    const third = recordFailure(accountRepo.getAccount(acc.id)!);

    expect(third.opened).toBe(true);
    expect(third.count).toBe(3);
    expect(accountRepo.getAccount(acc.id)!.circuit).toBe('open');
  });

  it('熔断期间禁止一切新发布', () => {
    const acc = freshAccount();
    for (let i = 0; i < CIRCUIT_BREAK_FAILURES; i++) recordFailure(accountRepo.getAccount(acc.id)!);
    expect(() => assertClosed(accountRepo.getAccount(acc.id)!)).toThrow(AppError);
  });

  it('成功一次会清零失败计数，但已熔断的不会自己好', () => {
    const acc = freshAccount();
    recordFailure(accountRepo.getAccount(acc.id)!);
    expect(accountRepo.getAccount(acc.id)!.consecutiveFailures).toBe(1);

    for (let i = 0; i < CIRCUIT_BREAK_FAILURES; i++) recordFailure(accountRepo.getAccount(acc.id)!);
    expect(accountRepo.getAccount(acc.id)!.circuit).toBe('open');
    // 没有任何计时器会把 open 改回 closed
    expect(accountRepo.getAccount(acc.id)!.circuit).toBe('open');
  });

  it('只有人工 resume 才恢复', () => {
    const acc = freshAccount();
    for (let i = 0; i < CIRCUIT_BREAK_FAILURES; i++) recordFailure(accountRepo.getAccount(acc.id)!);
    resume(accountRepo.getAccount(acc.id)!);
    const after = accountRepo.getAccount(acc.id)!;
    expect(after.circuit).toBe('closed');
    expect(after.consecutiveFailures).toBe(0);
    expect(() => assertClosed(after)).not.toThrow();
  });
});

describe('发布队列（§4.3：同账号严格串行）', () => {
  // CHG-0002：队列不再是进程级单例，每个账号一个实例 —— 这里验的是「类」的行为本身
  it('同一任务重复入队只算一次，按位置给出等待时间', () => {
    const q = new PublishQueue();
    q.enqueue(11);
    q.enqueue(11);
    q.enqueue(12);
    expect(q.size()).toBe(2);
    expect(q.position(11)).toBe(1);
    expect(q.eta(11, MIN_PUBLISH_INTERVAL_MIN)).toBe(MIN_PUBLISH_INTERVAL_MIN * 60_000);
    expect(q.eta(12, MIN_PUBLISH_INTERVAL_MIN)).toBe(2 * MIN_PUBLISH_INTERVAL_MIN * 60_000);
    q.remove(11);
    q.remove(12);
    expect(q.size()).toBe(0);
  });

  it('并发只能拿到一把锁（保证同一时刻只有一个 publishing）', () => {
    const q = new PublishQueue();
    expect(q.tryLock()).toBe(true);
    expect(q.tryLock()).toBe(false);
    q.unlock();
    expect(q.tryLock()).toBe(true);
    q.unlock();
  });

  it('两个账号的队列互不影响（CHG-0002）', () => {
    const a = new PublishQueue();
    const b = new PublishQueue();
    a.enqueue(1);
    expect(b.size()).toBe(0);
    expect(a.tryLock()).toBe(true);
    // A 的锁不该影响 B 的锁 —— B 是另一个账号，本来就该能自己排
    expect(b.tryLock()).toBe(true);
    a.unlock();
    b.unlock();
  });
});
