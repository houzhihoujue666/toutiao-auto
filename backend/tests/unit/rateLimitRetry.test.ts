import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initDb, closeDb } from '../../src/infra/db';
import { seedDefaults } from '../../src/infra/db/repo/config';
import * as accountRepo from '../../src/infra/db/repo/account';
import * as taskRepo from '../../src/infra/db/repo/task';
import * as sourceRepo from '../../src/infra/db/repo/source-item';
import { Pipeline } from '../../src/orchestrator/pipeline';
import { AppError } from '@shared/errors';

/**
 * RATE_LIMITED 自动重试回归（CHG-0005 后续优化）。
 *
 * 现象：改写/质检环节 LLM 网关返回 429 等瞬时限流时，handleStepError 把任何 AppError
 * 一刀切 moveTask('failed', code)，导致任务永久判失败（即便只是临时限流、重试即可自愈）。
 *
 * 修复：遇到 RATE_LIMITED 先带回 fetched 并 bumpRetry，由 15 秒 tick 自然重试，
 * 预算（默认 3 次）内不落 failed；超预算才转人工确认。这里用 mock 的 LLM 抛出
 * RATE_LIMITED，覆盖「预算内自动重试」与「超预算转 failed」两条分支。
 */

// 让改写环节的 LLM 一律抛 RATE_LIMITED
vi.mock('../../src/infra/llm/factory', () => ({
  createAdapter: vi.fn(() => ({
    ensureSession: async () => {},
    rewrite: async () => {
      throw new AppError('RATE_LIMITED', 'mock 429 from llm gateway', '等 1 分钟再试');
    },
    dispose: async () => {},
  })),
}));

function makeFetchedTask(accId: number): number {
  const [sid] = sourceRepo.insertMany(
    accId,
    [
      {
        platformItemId: `p-${Date.now()}-${Math.random()}`,
        author: 'tester',
        content: '这是一条用于回归测试的原始素材内容',
        images: [],
        topics: [],
        likeCount: 0,
        commentCount: 0,
        publishedAt: new Date().toISOString(),
      },
    ],
    (t) => `sim-${t.length}`,
  );
  const task = taskRepo.createTask(accId, sid, 'both');
  taskRepo.updateStatus(task.id, 'fetched');
  return task.id;
}

describe('RATE_LIMITED 自动重试', () => {
  let accId: number;
  let pipeline: Pipeline;

  beforeEach(() => {
    closeDb();
    initDb({ memory: true });
    seedDefaults();
    const acc = accountRepo.ensureAccount('toutiao-test');
    accId = acc.id;
    pipeline = new Pipeline('toutiao-test');
  });

  afterEach(() => {
    closeDb();
  });

  it('瞬时限流：预算内不判失败，重置回 fetched 且 retryCount 自增', async () => {
    const taskId = makeFetchedTask(accId);
    await pipeline.runUntilReview(taskId);

    const after = taskRepo.getTask(taskId)!;
    expect(after.status).toBe('fetched'); // 仍在改写队列，等待下次 tick 重试
    expect(after.errorCode).toBeNull(); // 没有被判失败
    expect(after.retryCount).toBe(1); // 已记一次重试
  });

  it('超预算：RATE_LIMITED 连续发生超过预算后转 failed 由人确认', async () => {
    const taskId = makeFetchedTask(accId);
    // 先把重试次数顶到预算上限（默认 3），使本次触发落入 failed 分支
    taskRepo.bumpRetry(taskId);
    taskRepo.bumpRetry(taskId);
    taskRepo.bumpRetry(taskId);

    await pipeline.runUntilReview(taskId);

    const after = taskRepo.getTask(taskId)!;
    expect(after.status).toBe('failed');
    expect(after.errorCode).toBe('RATE_LIMITED');
  });
});
