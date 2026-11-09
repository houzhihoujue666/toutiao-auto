import { describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { useFreshDb } from '../helpers/setup';
import { createServer } from '../../src/api';
import { AccountRuntime } from '../../src/orchestrator/registry';
import { concurrencyLimit, publishScheduler } from '../../src/orchestrator/publishScheduler';
import * as accountRepo from '../../src/infra/db/repo/account';
import * as taskRepo from '../../src/infra/db/repo/task';
import * as sourceRepo from '../../src/infra/db/repo/source-item';
import type { CollectedItem } from '@shared/types';

/**
 * 多账号运营集成测试 —— CHG-0002 / REQ-0002-01~09
 * 关注点：账号清单、当前账号切换、数据与队列按账号隔离、跨账号并发闸门、删除保护。
 */

function item(accountIndex: number, i: number): CollectedItem {
  return {
    platformItemId: `mable-${accountIndex}-${i}`,
    author: `作者${accountIndex}-${i}`,
    content: `第 ${accountIndex} 个账号的第 ${i} 条素材，正文内容足够长以通过质检。${'。'.repeat(20)}`,
    images: [],
    topics: ['生活'],
    likeCount: 100 + i,
    commentCount: i,
    publishedAt: new Date().toISOString(),
  };
}

/** 给某个账号塞素材（走真实入库管线），返回素材 id */
function seedSource(accountId: number, n: number, index = accountId): number[] {
  return sourceRepo.insertMany(
    accountId,
    Array.from({ length: n }, (_, i) => item(index, i + 1)),
    // 测试里不需要真 simhash，唯一值即可（避免全局去重把两个账号的素材判成同一条）
    (t) => `hash-${t.length}-${index}-${t.slice(0, 8)}`,
  );
}

async function withApp(
  fn: (app: FastifyInstance, runtime: AccountRuntime) => Promise<void>,
): Promise<void> {
  const runtime = new AccountRuntime();
  const app = await createServer({ runtime });
  try {
    await fn(app, runtime);
  } finally {
    await app.close();
  }
}

const data = (res: { json: () => unknown }) =>
  (res.json() as { data: Record<string, unknown> }).data;

describe('账号仓库与运行时（CHG-0002）', () => {
  useFreshDb();

  it('新库自动有一个默认账号，且它就是当前账号 —— 老库零迁移（REQ-0002-08）', () => {
    expect(accountRepo.getActiveAccount().name).toBe(accountRepo.DEFAULT_ACCOUNT_NAME);
    expect(accountRepo.listAccounts()).toHaveLength(1);
  });

  it('新建账号：名字唯一、会话目录各自独立（REQ-0002-01 / ADR-4）', () => {
    const a = accountRepo.getActiveAccount();
    const b = accountRepo.createAccount('toutiao-second');

    expect(accountRepo.listAccounts()).toHaveLength(2);
    expect(b.id).not.toBe(a.id);
    expect(b.userDataDir).toContain('toutiao-second');
    expect(a.userDataDir).toContain(accountRepo.DEFAULT_ACCOUNT_NAME);
    // 重名 / 空名不给通过（AppError 由路由层翻成界面提示）
    expect(() => accountRepo.createAccount('toutiao-second')).toThrow(/已存在/);
    expect(() => accountRepo.createAccount('   ')).toThrow(/不能为空/);
  });

  it('切换当前账号并持久化（REQ-0002-02）', () => {
    const first = accountRepo.getActiveAccount();
    const second = accountRepo.createAccount('toutiao-second');
    const runtime = new AccountRuntime();

    expect(runtime.activeAccountId()).toBe(first.id);
    runtime.setActive(second.id);
    expect(runtime.activeAccountId()).toBe(second.id);
    expect(accountRepo.getActiveAccount().name).toBe('toutiao-second');
  });

  it('删除保护：最后一个账号不许删、有任务的账号不许删（REQ-0002-07）', () => {
    const only = accountRepo.getActiveAccount();
    expect(() => accountRepo.deleteAccount(only.id)).toThrow(/至少要保留一个账号/);

    // 只有素材、没有任务 → 可删（素材与指纹一起清理）
    const second = accountRepo.createAccount('toutiao-second');
    seedSource(second.id, 2);
    expect(() => accountRepo.deleteAccount(second.id)).not.toThrow();
    expect(accountRepo.listAccounts().map((a) => a.name)).not.toContain('toutiao-second');

    // 有任务的账号必须留证（§2.3 验收口径 6）
    const third = accountRepo.createAccount('toutiao-third');
    const s = seedSource(third.id, 1)[0]!;
    taskRepo.createTask(third.id, s);
    expect(() => accountRepo.deleteAccount(third.id)).toThrow(/已经产生过任务/);
    expect(accountRepo.listAccounts().map((a) => a.name)).toContain('toutiao-third');
  });

  it('删掉当前账号后，当前账号自动落到剩下那个（REQ-0002-02）', () => {
    const first = accountRepo.getActiveAccount();
    const second = accountRepo.createAccount('toutiao-second');
    const runtime = new AccountRuntime();
    runtime.setActive(second.id);

    runtime.remove(second.id);
    expect(runtime.activeAccountId()).toBe(first.id);
  });

  it('一个账号熔断，另一个账号不受影响（REQ-0002-06）', () => {
    const a = accountRepo.getActiveAccount();
    const b = accountRepo.createAccount('toutiao-second');
    accountRepo.setCircuit(a.id, 'open');

    expect(accountRepo.getAccount(a.id)!.circuit).toBe('open');
    expect(accountRepo.getAccount(b.id)!.circuit).toBe('closed');
  });
});

describe('数据与队列按账号隔离（REQ-0002-02 / 04 / 09）', () => {
  useFreshDb();

  it('素材池与任务列表都按账号隔离', () => {
    const a = accountRepo.getActiveAccount();
    const b = accountRepo.createAccount('toutiao-second');
    seedSource(a.id, 2, 1);
    seedSource(b.id, 3, 2);

    expect(sourceRepo.listUntasked(a.id, 100)).toHaveLength(2);
    expect(sourceRepo.listUntasked(b.id, 100)).toHaveLength(3);

    const sa = sourceRepo.listUntasked(a.id, 100)[0]!;
    taskRepo.createTask(a.id, sa.id);

    expect(taskRepo.listTasks(undefined, 100, a.id)).toHaveLength(1);
    expect(taskRepo.listTasks(undefined, 100, b.id)).toHaveLength(0);
    expect(taskRepo.countByStatus(a.id)['pending']).toBe(1);
    expect(taskRepo.countByStatus(b.id).all).toBe(0);
    // 不指定账号仍是全量口径（老行为）
    expect(taskRepo.listTasks(undefined, 100)).toHaveLength(1);
    // 建过任务的素材不再出现在「未建任务」里
    expect(sourceRepo.listUntasked(a.id, 100)).toHaveLength(1);
  });

  it('两个账号各有自己的发布队列：同账号串行、账号间互不干扰（REQ-0002-04）', () => {
    const runtime = new AccountRuntime();
    const a = accountRepo.getActiveAccount();
    const b = accountRepo.createAccount('toutiao-second');
    const pa = runtime.pipeline(a);
    const pb = runtime.pipeline(b);

    expect(pa.queue).not.toBe(pb.queue);
    pa.queue.enqueue(1);
    pa.queue.enqueue(2);
    expect(pa.queue.size()).toBe(2);
    expect(pb.queue.size()).toBe(0);
    // 同一个账号两次取到的 pipeline 必须是同一个实例（否则队列会「分裂」）
    expect(runtime.pipeline(a)).toBe(pa);

    // 同一账号同一时刻只允许一把锁 —— 第二个任务必须在队列里等着（红线 9）
    expect(pa.queue.tryLock()).toBe(true);
    expect(pa.queue.tryLock()).toBe(false);
    // 另一个账号有自己的锁，不受这一条约束
    expect(pb.queue.tryLock()).toBe(true);
    pa.queue.unlock();
    pb.queue.unlock();
  });
});

describe('跨账号并发闸门（ADR-0015 / REQ-0002-05）', () => {
  useFreshDb();

  it('默认上限是 1 —— 与多账号改造前的串行行为完全一致', () => {
    expect(concurrencyLimit()).toBe(1);
  });

  it('第二个账号要排队，前一个让出名额后才被唤醒', async () => {
    publishScheduler.reset();
    const grantedA = publishScheduler.acquire(1, () => undefined, 1);
    const grantedB = publishScheduler.acquire(2, () => undefined, 1);
    expect(grantedA).toBe(true);
    expect(grantedB).toBe(false);
    expect(publishScheduler.activeAccounts()).toEqual([1]);
    expect(publishScheduler.waitingAccounts()).toEqual([2]);

    let woke = false;
    publishScheduler.acquire(
      2,
      () => {
        woke = true;
      },
      1,
    );
    publishScheduler.release(1, 1);
    await Promise.resolve();
    await Promise.resolve();
    expect(woke).toBe(true);
    expect(publishScheduler.activeAccounts()).toEqual([2]);
    publishScheduler.reset();
  });

  it('同一账号重入不算超额（同账号的串行由它自己的队列锁负责）', () => {
    publishScheduler.reset();
    expect(publishScheduler.acquire(7, () => undefined, 1)).toBe(true);
    expect(publishScheduler.acquire(7, () => undefined, 1)).toBe(true);
    publishScheduler.reset();
  });
});

describe('接口层：账号资源与切换（REQ-0002-01 / 02 / 07 / 09）', () => {
  useFreshDb();

  it('summary 带上全部账号与当前账号 id', async () => {
    await withApp(async (app, runtime) => {
      runtime.create('toutiao-second');
      const res = await app.inject({ method: 'GET', url: '/api/summary' });
      const d = data(res);
      expect((d.accounts as unknown[]).length).toBe(2);
      expect(d.activeAccountId).toBe(runtime.activeAccountId());
      expect((d.account as { name: string }).name).toBe(accountRepo.DEFAULT_ACCOUNT_NAME);
    });
  });

  it('GET /api/accounts 返回列表；POST 新建；重名 400', async () => {
    await withApp(async (app) => {
      const first = await app.inject({ method: 'GET', url: '/api/accounts' });
      expect((data(first).accounts as unknown[]).length).toBe(1);

      const created = await app.inject({
        method: 'POST',
        url: '/api/accounts',
        payload: { name: 'toutiao-b' },
      });
      expect(created.statusCode).toBe(200);

      const dup = await app.inject({
        method: 'POST',
        url: '/api/accounts',
        payload: { name: 'toutiao-b' },
      });
      expect(dup.statusCode).toBe(400);
      expect((dup.json() as { error: { code: string } }).error.code).toBe('ACCOUNT_EXISTS');
    });
  });

  it('POST /api/accounts/:id/activate 后，summary 变成那个账号的数据', async () => {
    await withApp(async (app, runtime) => {
      const acc = runtime.create('toutiao-b');
      seedSource(acc.id, 4, 2);

      const before = await app.inject({ method: 'GET', url: '/api/summary' });
      expect((data(before).counts as { items: number }).items).toBe(0);

      await app.inject({ method: 'POST', url: `/api/accounts/${acc.id}/activate` });
      const after = await app.inject({ method: 'GET', url: '/api/summary' });
      const d = data(after);
      expect(d.activeAccountId).toBe(acc.id);
      expect((d.counts as { items: number }).items).toBe(4);
      expect((d.account as { name: string }).name).toBe('toutiao-b');
    });
  });

  it('GET /api/tasks 只返回当前账号的任务', async () => {
    await withApp(async (app, runtime) => {
      const acc = runtime.create('toutiao-b');
      const s = seedSource(acc.id, 1, 2)[0]!;
      taskRepo.createTask(acc.id, s);

      const currents = await app.inject({ method: 'GET', url: '/api/tasks' });
      expect((data(currents).tasks as unknown[]).length).toBe(0);

      await app.inject({ method: 'POST', url: `/api/accounts/${acc.id}/activate` });
      const after = await app.inject({ method: 'GET', url: '/api/tasks' });
      expect((data(after).tasks as unknown[]).length).toBe(1);
    });
  });

  it('DELETE：有任务的账号不给删（要留证）；没产出过任务的账号可删', async () => {
    await withApp(async (app, runtime) => {
      // ① 有任务的账号 → 拒绝删除（§2.3 验收口径 6：已发布内容必须留证）
      const busy = runtime.create('toutiao-busy');
      const s = seedSource(busy.id, 1, 2)[0]!;
      taskRepo.createTask(busy.id, s);

      const bad = await app.inject({ method: 'DELETE', url: `/api/accounts/${busy.id}` });
      expect(bad.statusCode).toBe(400);
      expect((bad.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
      expect(accountRepo.listAccounts().map((a) => a.name)).toContain('toutiao-busy');

      // ② 只有素材、没产出过任务的账号 → 允许删（素材与指纹一并清理）
      const idle = runtime.create('toutiao-idle');
      seedSource(idle.id, 2, 3);
      const okRes = await app.inject({ method: 'DELETE', url: `/api/accounts/${idle.id}` });
      expect(okRes.statusCode).toBe(200);
      expect(data(okRes).deleted).toBe(true);

      const list = await app.inject({ method: 'GET', url: '/api/accounts' });
      const names = (data(list).accounts as { name: string }[]).map((a) => a.name);
      expect(names).toContain('toutiao-busy');
      expect(names).not.toContain('toutiao-idle');
    });
  });
});
