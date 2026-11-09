import { describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { useFreshDb } from '../helpers/setup';
import { createServer, createDefaultDeps } from '../../src/api';
import { setConfig, KEYS } from '../../src/config/runtime';
import * as accountRepo from '../../src/infra/db/repo/account';
import { ensureAccount } from '../../src/infra/db/repo/account';
import * as sourceRepo from '../../src/infra/db/repo/source-item';
import * as taskRepo from '../../src/infra/db/repo/task';
import { SIMILARITY_THRESHOLD } from '@shared/constants';

/**
 * 接口层集成测试 —— 走真实 Fastify 路由（app.inject），验证「路由接线 + 信封 + 业务」串起来是真通的，
 * 不是只验 service。§10.2 SMOKE 的自动化部分落在这里。
 */

interface Payload {
  statusCode: number;
  json: () => unknown;
  headers: Record<string, unknown>;
}

function body(res: Payload): Record<string, unknown> {
  return res.json() as Record<string, unknown>;
}

/** 轮询等待某个状态的任务达到期望条数（任务推进是异步的） */
async function waitForTasks(
  app: FastifyInstance,
  url: string,
  count: number,
): Promise<{ id: number }[]> {
  for (let i = 0; i < 300; i++) {
    const res = await app.inject({ method: 'GET', url });
    const tasks = (body(res).data as { tasks: { id: number }[] }).tasks;
    if (tasks.length >= count) return tasks;
    await new Promise((r) => setTimeout(r, 100));
  }
  return [];
}

async function withApp(fn: (app: FastifyInstance) => Promise<void>): Promise<void> {
  const deps = createDefaultDeps();
  const app = await createServer(deps);
  try {
    await fn(app);
  } finally {
    await app.close();
  }
}

describe('接口层（真实路由）', () => {
  useFreshDb();

  it('/api/health 与 /api/summary 正常返回', async () => {
    await withApp(async (app) => {
      const h = await app.inject({ method: 'GET', url: '/api/health' });
      expect(h.statusCode).toBe(200);
      expect(body(h).ok).toBe(true);

      const s = await app.inject({ method: 'GET', url: '/api/summary' });
      expect(s.statusCode).toBe(200);
      const data = body(s).data as Record<string, unknown>;
      expect(data.runtimeMode).toBe('simulated');
      expect(data.quota).toMatchObject({ limit: 50 });
    });
  });

  it('无 body 的 POST（浏览器直接点按钮）也要能过 --- content-type 解析兜底', async () => {
    await withApp(async (app) => {
      ensureAccount('toutiao-main');
      const c = await app.inject({
        method: 'POST',
        url: '/api/crawl',
        headers: { 'content-type': 'application/json' },
      });
      expect(c.statusCode).toBe(200);
      expect((body(c).data as { insertedCount: number }).insertedCount).toBeGreaterThanOrEqual(10);
    });
  });

  it('POST /api/crawl → GET /api/items 拿到素材（SMOKE-2 的自动化部分）', async () => {
    await withApp(async (app) => {
      ensureAccount('toutiao-main');
      const c = await app.inject({ method: 'POST', url: '/api/crawl' });
      expect(c.statusCode).toBe(200);
      const crawl = (body(c).data ?? {}) as Record<string, number>;
      expect(crawl.insertedCount).toBeGreaterThanOrEqual(10);

      const i = await app.inject({ method: 'GET', url: '/api/items' });
      const items = (body(i).data as { items: unknown[] }).items;
      expect(items.length).toBeGreaterThanOrEqual(10);
    });
  });

  it('DELETE /api/tasks/:id：只允许删失败任务，删掉后详情返回 404', async () => {
    await withApp(async (app) => {
      ensureAccount('toutiao-main');
      await app.inject({ method: 'POST', url: '/api/crawl' });
      const acc = ensureAccount('toutiao-main');
      const ids = sourceRepo.listUntasked(acc.id, 1).map((s) => s.id);
      const created = await app.inject({
        method: 'POST',
        url: '/api/tasks',
        payload: { sourceIds: ids },
      });
      const taskId = (body(created).data as { tasks: { id: number }[] }).tasks[0]!.id;

      // 先等自动流程跑完（质检 → 自动放行 → 发布），避免和并发流程抢状态
      for (let i = 0; i < 300; i++) {
        const status = taskRepo.getTask(taskId)?.status;
        if (status === 'published' || status === 'failed') break;
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(taskRepo.getTask(taskId)?.status).toBe('published');

      // 非失败任务（已发布）不能删：已发布内容要留证
      const denied = await app.inject({ method: 'DELETE', url: `/api/tasks/${taskId}` });
      expect(denied.statusCode).toBe(400);

      // 失败任务可删，改写稿 / 发布记录 / 日志一并清掉
      taskRepo.updateStatus(taskId, 'failed', 'SIMILARITY');
      const del = await app.inject({ method: 'DELETE', url: `/api/tasks/${taskId}` });
      expect(del.statusCode).toBe(200);
      expect((body(del).data as { deleted: boolean }).deleted).toBe(true);

      const detail = await app.inject({ method: 'GET', url: `/api/tasks/${taskId}` });
      expect(detail.statusCode).toBe(404);
    });
  });

  it('采集 → 生成任务 → 质检通过后自动放行（SMOKE-3/4，§E.7）', async () => {
    await withApp(async (app) => {
      ensureAccount('toutiao-main');
      await app.inject({ method: 'POST', url: '/api/crawl' });
      const acc = ensureAccount('toutiao-main');
      const ids = sourceRepo.listUntasked(acc.id, 2).map((s) => s.id);
      expect(ids.length).toBe(2);

      const t = await app.inject({
        method: 'POST',
        url: '/api/tasks',
        payload: { sourceIds: ids },
      });
      expect(t.statusCode).toBe(200);
      const created = body(t).data as { created: number; tasks: { id: number }[] };
      expect(created.created).toBe(2);

      const taskId = created.tasks[0]!.id;
      let detail = body(await app.inject({ method: 'GET', url: `/api/tasks/${taskId}` })).data as {
        task: { status: string };
        rewrite: { similarity: number; images: string[] } | null;
        threshold: number;
      };
      // 等到「改写 + 配图 + 质检」全部落库（配图在 moveTask('rewritten') 之后才回写）
      for (
        let i = 0;
        i < 300 && ['pending', 'fetched', 'rewritten'].includes(detail.task.status);
        i++
      ) {
        await new Promise((r) => setTimeout(r, 100));
        detail = body(await app.inject({ method: 'GET', url: `/api/tasks/${taskId}` }))
          .data as typeof detail;
      }
      expect(detail.threshold).toBe(SIMILARITY_THRESHOLD);
      expect(detail.rewrite!.similarity).toBeLessThan(SIMILARITY_THRESHOLD);
      expect(detail.rewrite!.images.length).toBeGreaterThan(0);

      // §E.7：质检通过后自动放行，不再停在 reviewing 等人确认
      for (let i = 0; i < 100 && detail.task.status === 'reviewing'; i++) {
        await new Promise((r) => setTimeout(r, 100));
        detail = body(await app.inject({ method: 'GET', url: `/api/tasks/${taskId}` }))
          .data as typeof detail;
      }
      expect(['publishing', 'published']).toContain(detail.task.status);
    });
  });

  it('一键开始 POST /api/run：填一个条数跑通全流程（§E.7）', async () => {
    await withApp(async (app) => {
      ensureAccount('toutiao-main');
      const r = await app.inject({
        method: 'POST',
        url: '/api/run',
        payload: { count: 2 },
      });
      expect(r.statusCode).toBe(200);
      const data = body(r).data as {
        requested: number;
        accepted: number;
        created: number;
        enqueued: number;
        message: string;
      };
      expect(data.requested).toBe(2);
      expect(data.accepted).toBe(2);
      expect(data.created).toBe(2);
      expect(data.enqueued).toBe(2);
      expect(data.message).toContain('已启动');

      const tasks = await waitForTasks(app, '/api/tasks', 2);
      expect(tasks.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('当日额度耗尽：POST /api/run 返回 400 QUOTA_EXHAUSTED（§E.7.3）', async () => {
    await withApp(async (app) => {
      const acc = ensureAccount('toutiao-main');
      accountRepo.bumpUsedToday(acc.id);
      const s = await app.inject({
        method: 'PUT',
        url: '/api/settings',
        payload: { values: { dailyPublishLimit: '1' } },
      });
      expect(s.statusCode).toBe(200);

      const r = await app.inject({ method: 'POST', url: '/api/run', payload: { count: 5 } });
      expect(r.statusCode).toBe(400);
      const e = body(r).error as { code: string; message: string };
      expect(e.code).toBe('QUOTA_EXHAUSTED');
      expect(e.message).toContain('今日已全部发完');
    });
  });

  it('发布间隔不足：POST /api/run 返回 400 RATE_LIMITED，不采集（§E.7.4）', async () => {
    await withApp(async (app) => {
      const acc = ensureAccount('toutiao-main');
      accountRepo.setLastPublishAt(acc.id, new Date().toISOString());

      const r = await app.inject({ method: 'POST', url: '/api/run', payload: { count: 2 } });
      expect(r.statusCode).toBe(400);
      const e = body(r).error as { code: string; message: string };
      expect(e.code).toBe('RATE_LIMITED');
      expect(e.message).toContain('距上次发布不足');
    });
  });

  it('发布：成功落记录、留截图、幂等拒绝重发（红线 7）', async () => {
    await withApp(async (app) => {
      setConfig(KEYS.allowRealPublish, 'true');
      ensureAccount('toutiao-main');
      await app.inject({ method: 'POST', url: '/api/crawl' });
      const acc = ensureAccount('toutiao-main');
      const ids = sourceRepo.listUntasked(acc.id, 1).map((s) => s.id);
      const created = await app.inject({
        method: 'POST',
        url: '/api/tasks',
        payload: { sourceIds: ids },
      });
      const taskId = (body(created).data as { tasks: { id: number }[] }).tasks[0]!.id;

      // §E.7：不再需要人工点「通过并发布」，自动放行后直接等它发完
      for (let i = 0; i < 300; i++) {
        const cur = body(await app.inject({ method: 'GET', url: `/api/tasks/${taskId}` })).data as {
          task: { status: string };
          record: {
            status: string;
            screenshotPath: string | null;
            publishedUrl: string | null;
          } | null;
        };
        if (cur.task.status === 'published') {
          expect(cur.record?.status).toBe('success');
          expect(cur.record?.screenshotPath).toBeTruthy();
          expect(cur.record?.publishedUrl).toBeTruthy();
          break;
        }
        await new Promise((r) => setTimeout(r, 100));
      }

      // 幂等：已发布成功的任务再点发布 → 400
      const again = await app.inject({ method: 'POST', url: `/api/tasks/${taskId}/publish` });
      expect(again.statusCode).toBe(400);
      const errBody = body(again).error as { code: string };
      expect(errBody.code).toBeTruthy();
    });
  });

  it('静态预览只服务 data/ 内的文件，并带正确 content-type', async () => {
    await withApp(async (app) => {
      ensureAccount('toutiao-main');
      await app.inject({ method: 'POST', url: '/api/crawl' });
      const acc = ensureAccount('toutiao-main');
      const ids = sourceRepo.listUntasked(acc.id, 1).map((s) => s.id);
      const created = await app.inject({
        method: 'POST',
        url: '/api/tasks',
        payload: { sourceIds: ids },
      });
      const taskId = (body(created).data as { tasks: { id: number }[] }).tasks[0]!.id;

      let images: string[] = [];
      for (let i = 0; i < 300 && images.length === 0; i++) {
        const cur = body(await app.inject({ method: 'GET', url: `/api/tasks/${taskId}` })).data as {
          rewrite: { images: string[] } | null;
        };
        images = cur.rewrite?.images ?? [];
        if (images.length === 0) await new Promise((r) => setTimeout(r, 100));
      }
      expect(images.length).toBeGreaterThan(0);

      const rel = images[0]!;
      const res = await app.inject({ method: 'GET', url: `/api/media/${rel}` });
      expect(res.statusCode).toBe(200);
      expect(String(res.headers['content-type'])).toContain('image/');

      const bad = await app.inject({ method: 'GET', url: '/api/media/..%2F..%2Fpackage.json' });
      expect(bad.statusCode).toBe(400);
    });
  });

  it('设置：读取含锁定项，越界值被拒（ADR-10）', async () => {
    await withApp(async (app) => {
      const s = await app.inject({ method: 'GET', url: '/api/settings' });
      const { editable, locked } = body(s).data as {
        editable: { key: string }[];
        locked: { key: string }[];
      };
      expect(editable.some((e) => e.key === 'similarityThreshold')).toBe(true);
      expect(locked.some((l) => l.key === 'forceDeclaration')).toBe(true);

      const okPut = await app.inject({
        method: 'PUT',
        url: '/api/settings',
        payload: { values: { similarityThreshold: '0.4' } },
      });
      expect(okPut.statusCode).toBe(200);

      const badPut = await app.inject({
        method: 'PUT',
        url: '/api/settings',
        payload: { values: { similarityThreshold: '9' } },
      });
      expect(badPut.statusCode).toBe(400);
    });
  });

  it('提示词模板：缺占位符不给保存（PROMPT_MISSING_INPUT 前置防线）', async () => {
    await withApp(async (app) => {
      const g = await app.inject({ method: 'GET', url: '/api/prompt-templates/default' });
      expect(g.statusCode).toBe(200);
      const tpl = body(g).data as { content: string };
      expect(tpl.content).toContain('{{originalText}}');

      const bad = await app.inject({
        method: 'PUT',
        url: '/api/prompt-templates/default',
        payload: { content: '没有占位符的模板' },
      });
      expect(bad.statusCode).toBe(400);

      const good = await app.inject({
        method: 'PUT',
        url: '/api/prompt-templates/default',
        payload: { content: `请改写：\n{{originalText}}` },
      });
      expect(good.statusCode).toBe(200);
    });
  });

  it('登录与熔断接口（模拟模式不启动浏览器）', async () => {
    await withApp(async (app) => {
      const start = await app.inject({ method: 'POST', url: '/api/account/login/start' });
      expect(start.statusCode).toBe(200);
      expect((body(start).data as { qr: string }).qr).toBeTruthy();

      const check = await app.inject({ method: 'POST', url: '/api/account/login/check' });
      expect(check.statusCode).toBe(200);

      const resume = await app.inject({ method: 'POST', url: '/api/account/circuit/resume' });
      expect(resume.statusCode).toBe(200);
      expect((body(resume).data as { circuit: string }).circuit).toBe('closed');
    });
  });
});
