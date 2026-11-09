import { describe, it, expect } from 'vitest';
import { useFreshDb, waitUntil } from '../helpers/setup';
import { setConfig, KEYS } from '../../src/config/runtime';
import { CrawlService, defaultCollectOptions } from '../../src/modules/crawl/service';
import { Pipeline } from '../../src/orchestrator/pipeline';
import * as accountRepo from '../../src/infra/db/repo/account';
import { ensureAccount } from '../../src/infra/db/repo/account';
import { listUntasked } from '../../src/infra/db/repo/source-item';
import * as taskRepo from '../../src/infra/db/repo/task';
import * as rewriteRepo from '../../src/infra/db/repo/rewrite';
import * as recordRepo from '../../src/infra/db/repo/publish-record';
import { PublishService } from '../../src/modules/publish/service';
import { moveTask } from '../../src/orchestrator/stateMachine';
import { AppError, isAppError } from '@shared/errors';
import { simhash } from '@shared/simhash';
import { SIMILARITY_THRESHOLD } from '@shared/constants';

const ACCOUNT = 'toutiao-main';

/**
 * 造一条「质检已过」的任务。
 * 注意：v4.1 起默认自动放行（§E.7），这里显式关掉，用来测人工 `approve()` 这条兜底路径。
 */
async function seedOneReviewingTask(pipeline: Pipeline): Promise<number> {
  pipeline.autoApprove = false;
  const acc = ensureAccount(ACCOUNT); // 先建账号，采集入库需要它的 id
  const crawler = new CrawlService(ACCOUNT);
  await crawler.collect(defaultCollectOptions());
  const pool = listUntasked(acc.id, 3).slice(0, 1);
  const [task] = pipeline.createTasksFromSources(pool.map((p) => p.id));
  await pipeline.runUntilReview(task!.id);
  return task!.id;
}

describe('采集 → 入库 → 去重（§6.2 / SMOKE-2）', () => {
  useFreshDb();

  it('一次采集入库 ≥10 条', async () => {
    ensureAccount(ACCOUNT);
    const crawler = new CrawlService(ACCOUNT);
    const first = await crawler.collect(defaultCollectOptions());
    expect(first.insertedCount).toBeGreaterThanOrEqual(10);
  });

  it('重复采集 0 新增（指纹去重生效）', async () => {
    ensureAccount(ACCOUNT);
    const crawler = new CrawlService(ACCOUNT);
    await crawler.collect(defaultCollectOptions());
    const second = await crawler.collect(defaultCollectOptions());
    expect(second.insertedCount).toBe(0);
    expect(second.dedupedCount).toBeGreaterThan(0);
  });
});

describe('自动推进到待复核（§4.1）', () => {
  useFreshDb();

  it('fetched → rewritten → reviewing，改写稿低于闸门且有配图', async () => {
    const pipeline = new Pipeline(ACCOUNT);
    const taskId = await seedOneReviewingTask(pipeline);

    expect(taskRepo.getTask(taskId)!.status).toBe('reviewing');
    const rw = rewriteRepo.getRewriteByTask(taskId)!;
    expect(rw.similarity).toBeLessThan(SIMILARITY_THRESHOLD);
    expect(rw.images.length).toBeGreaterThan(0);
    expect(taskRepo.getTask(taskId)!.errorCode).toBeNull();
  });
});

describe('发布与幂等（§4.3 / 红线 7）', () => {
  useFreshDb();

  it('approve → publishing → published，并有 URL 与截图留证', async () => {
    setConfig(KEYS.allowRealPublish, 'true');
    const pipeline = new Pipeline(ACCOUNT);
    const taskId = await seedOneReviewingTask(pipeline);

    pipeline.approve(taskId);
    await waitUntil(() => taskRepo.getTask(taskId)!.status !== 'publishing');

    expect(taskRepo.getTask(taskId)!.status).toBe('published');
    const rec = recordRepo.getRecordByTask(taskId)!;
    expect(rec.status).toBe('success');
    expect(rec.screenshotPath).toBeTruthy();
    expect(rec.publishedUrl).toBeTruthy();
  });

  it('已发布成功的任务再发一次会被幂等拦住', async () => {
    setConfig(KEYS.allowRealPublish, 'true');
    const pipeline = new Pipeline(ACCOUNT);
    const taskId = await seedOneReviewingTask(pipeline);
    pipeline.approve(taskId);
    await waitUntil(() => taskRepo.getTask(taskId)!.status === 'published');

    const rw = rewriteRepo.getRewriteByTask(taskId)!;
    await expect(
      new PublishService(ACCOUNT, taskId).publish({
        text: rw.rewrittenText,
        images: rw.images,
        declaration: '取材网络',
      }),
    ).rejects.toThrow(AppError);
  });

  it('Dry Run（未开允许真实发布）只存草稿，不占额度', async () => {
    setConfig(KEYS.allowRealPublish, 'false');
    const pipeline = new Pipeline(ACCOUNT);
    const taskId = await seedOneReviewingTask(pipeline);
    pipeline.approve(taskId);
    await waitUntil(() => taskRepo.getTask(taskId)!.status !== 'publishing');

    const rec = recordRepo.getRecordByTask(taskId)!;
    expect(rec.status).toBe('draft');
    expect(rec.publishedUrl).toBeNull();
    expect(ensureAccount(ACCOUNT).usedToday).toBe(0);
  });

  it('作品声明不是「取材网络」直接拒绝（类型锁死，无配置出口）', async () => {
    const pipeline = new Pipeline(ACCOUNT);
    const taskId = await seedOneReviewingTask(pipeline);
    await expect(
      new PublishService(ACCOUNT, taskId).publish({
        text: '正文',
        images: [],
        declaration: '原创' as never,
      }),
    ).rejects.toThrow(AppError);
  });

  it('「头条首发」被勾选 → 中止发布（合规硬闸门）', async () => {
    const { assertFirstPublishUnchecked } = await import('../../src/modules/publish/service');
    expect(() => assertFirstPublishUnchecked(true)).toThrow(AppError);
    expect(() => assertFirstPublishUnchecked(false)).not.toThrow();
  });
});

describe('发布误判自愈（2026-10-22 生产实证）', () => {
  useFreshDb();

  it('已发布成功的内容被并发误标失败后，重试不再发布，直接纠正回 published', async () => {
    setConfig(KEYS.allowRealPublish, 'true');
    const pipeline = new Pipeline(ACCOUNT);
    const taskId = await seedOneReviewingTask(pipeline);
    pipeline.autoApprove = true; // helper 里为了测人工路径关掉了，这里重新打开
    pipeline.approve(taskId);
    await waitUntil(() => taskRepo.getTask(taskId)!.status === 'published');

    // 模拟并发踩踏：发布成功后任务被一条过期的改写流程拉回 failed
    taskRepo.updateStatus(taskId, 'failed', 'VALIDATION_FAILED');
    // 绕开 15 分钟间隔：重试链在 drainQueue 里会被限速拦住，测试里把上次发布时间拨回 1 小时前
    accountRepo.setLastPublishAt(
      ensureAccount(ACCOUNT).id,
      new Date(Date.now() - 60 * 60_000).toISOString(),
    );

    // 用户看到「失败」点重试 → 重新走完推进链 → 到发布入口时必须自愈，而不是再发一次
    pipeline.retry(taskId);
    await waitUntil(() => taskRepo.getTask(taskId)!.status === 'published');

    expect(taskRepo.getTask(taskId)!.errorCode).toBeNull();
    const failedRecords = recordRepo
      .listRecords(500)
      .filter((r) => r.taskId === taskId && r.status === 'failed');
    expect(failedRecords).toHaveLength(0);
  });

  it('改写链报错时任务已被并发推进（publishing），不置 failed', async () => {
    const pipeline = new Pipeline(ACCOUNT);
    const taskId = await seedOneReviewingTask(pipeline);
    moveTask(taskId, 'publishing'); // 模拟另一条流程已把它推进到发布

    (pipeline as unknown as { handleStepError: (id: number, e: unknown) => void }).handleStepError(
      taskId,
      new AppError('VALIDATION_FAILED', '不允许的状态流转：rewritten → rewritten'),
    );

    expect(taskRepo.getTask(taskId)!.status).toBe('publishing');
    expect(taskRepo.getTask(taskId)!.errorCode).toBeNull();
  });
});

describe('发布前的闸门（§2.3 验收口径 5）', () => {
  useFreshDb();

  it('相似度超标的任务点发布会被拦下并置失败', async () => {
    const pipeline = new Pipeline(ACCOUNT);
    const acc = ensureAccount(ACCOUNT); // 先建账号，采集入库需要它的 id
    const crawler = new CrawlService(ACCOUNT);
    await crawler.collect(defaultCollectOptions());
    const pool = listUntasked(acc.id, 1);
    const [task] = pipeline.createTasksFromSources(pool.map((p) => p.id));

    const original = '原文内容足够长以便通过长度检查，这里只是占位用的句子而已。';
    const copy = original; // 照抄 → 相似度 1.0
    const rw = rewriteRepo.insertRewrite({
      taskId: task!.id,
      originalText: original,
      rewrittenText: copy,
      similarity: 1,
      qualityFlags: [],
      images: [],
      simhash: simhash(copy),
    });
    moveTask(task!.id, 'rewritten');
    taskRepo.setRewriteId(task!.id, rw.id);
    moveTask(task!.id, 'reviewing');

    expect(() => pipeline.approve(task!.id)).toThrow(AppError);
    expect(taskRepo.getTask(task!.id)!.status).toBe('failed');
    expect(taskRepo.getTask(task!.id)!.errorCode).toBe('SIMILARITY');
  });

  it('非待复核状态不能发布', async () => {
    const pipeline = new Pipeline(ACCOUNT);
    const taskId = await seedOneReviewingTask(pipeline);
    pipeline.approve(taskId);
    await waitUntil(() => taskRepo.getTask(taskId)!.status === 'published');
    expect(() => pipeline.approve(taskId)).toThrow(AppError);
  });
});

describe('一键运行（§E.7：填条数 → 采集到发布全自动）', () => {
  useFreshDb();

  it('runOnce 建任务后质检通过即自动入队，不需要人点确认', async () => {
    setConfig(KEYS.allowRealPublish, 'true');
    const pipeline = new Pipeline(ACCOUNT, new CrawlService(ACCOUNT));
    const r = await pipeline.runOnce(2);

    expect(r.requested).toBe(2);
    expect(r.created).toBe(2);
    expect(r.enqueued).toBe(2);
    expect(['publishing', 'published']).toContain(taskRepo.getTask(r.taskIds[0]!)!.status);
  });

  it('条数超过当日剩余额度时按剩余额度截断', async () => {
    setConfig(KEYS.dailyPublishLimit, '3');
    const pipeline = new Pipeline(ACCOUNT, new CrawlService(ACCOUNT));
    const r = await pipeline.runOnce(20);

    expect(r.remaining).toBe(3);
    expect(r.accepted).toBe(3);
    expect(r.created).toBeLessThanOrEqual(3);
  });

  it('当日额度耗尽后 runOnce 抛 QUOTA_EXHAUSTED，且一个任务都不建', async () => {
    setConfig(KEYS.dailyPublishLimit, '1');
    const pipeline = new Pipeline(ACCOUNT, new CrawlService(ACCOUNT));
    accountRepo.bumpUsedToday(ensureAccount(ACCOUNT).id); // 用掉当天唯一的 1 条

    const before = taskRepo.countByStatus()['all'] ?? 0;
    const e = await pipeline.runOnce(5).catch((err: unknown) => err);

    expect(isAppError(e)).toBe(true);
    expect((e as AppError).code).toBe('QUOTA_EXHAUSTED');
    expect(String((e as Error).message)).toContain('今日已全部发完');
    expect(taskRepo.countByStatus()['all'] ?? 0).toBe(before);
  });

  it('额度为 0 时自动放行不放行，任务留在 reviewing 等补发', async () => {
    setConfig(KEYS.dailyPublishLimit, '1');
    const pipeline = new Pipeline(ACCOUNT, new CrawlService(ACCOUNT));
    const acc = ensureAccount(ACCOUNT);
    accountRepo.bumpUsedToday(acc.id);

    await new CrawlService(ACCOUNT).collect(defaultCollectOptions());
    const pool = listUntasked(acc.id, 1);
    const [task] = pipeline.createTasksFromSources(pool.map((p) => p.id));
    await pipeline.runUntilReview(task!.id);

    expect(taskRepo.getTask(task!.id)!.status).toBe('reviewing');
    expect(pipeline.releaseToQueue(task!.id)).toMatchObject({
      enqueued: false,
      reason: 'quota',
    });
  });

  it('距上次发布不足最小间隔时 runOnce 直接抛 RATE_LIMITED，不建任务', async () => {
    setConfig(KEYS.allowRealPublish, 'true');
    const pipeline = new Pipeline(ACCOUNT, new CrawlService(ACCOUNT));
    const acc = ensureAccount(ACCOUNT);
    accountRepo.setLastPublishAt(acc.id, new Date().toISOString());

    const before = taskRepo.countByStatus()['all'] ?? 0;
    const e = await pipeline.runOnce(5).catch((err: unknown) => err);

    expect(isAppError(e)).toBe(true);
    expect((e as AppError).code).toBe('RATE_LIMITED');
    expect(String((e as Error).message)).toContain('距上次发布不足');
    expect(taskRepo.countByStatus()['all'] ?? 0).toBe(before);
  });
});
