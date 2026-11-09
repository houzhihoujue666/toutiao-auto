import type { FastifyInstance } from 'fastify';
import type { AccountRuntime } from '../../orchestrator/registry';
import { defaultCollectOptions, getLastCrawlAt } from '../../modules/crawl/service';
import { listUntasked, listByAccount } from '../../infra/db/repo/source-item';
import { ok, err } from '@shared/types';
import { isAppError } from '@shared/errors';

/**
 * 采集接口 —— CHG-0002：素材池按账号隔离，采集也落在指定账号名下（默认当前账号）。
 */
export function registerCrawlRoutes(app: FastifyInstance, runtime: AccountRuntime): void {
  const accountOf = (req: { body?: unknown; query?: unknown }) => {
    const b = (req.body ?? {}) as { accountId?: number | string };
    const q = (req.query ?? {}) as { accountId?: number | string };
    const n = Number(b.accountId ?? q.accountId);
    return runtime.resolve(Number.isFinite(n) && n > 0 ? n : undefined).account;
  };

  app.post('/api/crawl', async (req, reply) => {
    try {
      const acc = accountOf(req);
      const result = await runtime.crawler(acc).collect(defaultCollectOptions());
      return ok(result);
    } catch (e) {
      const code = isAppError(e) ? e.code : 'INTERNAL';
      reply.code(400);
      return err(
        code,
        isAppError(e) ? e.message : String(e),
        isAppError(e) ? e.hint : '查看服务端日志',
      );
    }
  });

  app.get('/api/items', async (req) => {
    const acc = accountOf(req);
    const items = listUntasked(acc.id, 500);
    const all = listByAccount(acc.id, 500);
    return ok({ items, total: all.length, lastCrawlAt: getLastCrawlAt(), accountId: acc.id });
  });
}
