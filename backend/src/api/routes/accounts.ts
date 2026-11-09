import type { FastifyInstance } from 'fastify';
import type { AccountRuntime } from '../../orchestrator/registry';
import { publish } from '../../infra/bus';
import { ok, err } from '@shared/types';
import { isAppError } from '@shared/errors';
import type { AccountOverview } from '@shared/types';

/**
 * 账号资源接口 —— CHG-0002：列表 / 新建 / 切换当前账号 / 删除
 * 出口统一走 { ok, data } / { ok:false, error }（§7.1），业务校验抛 AppError 后在此翻成信封。
 */
export function registerAccountsRoutes(app: FastifyInstance, runtime: AccountRuntime): void {
  app.get('/api/accounts', async (req) => {
    const q = (req.query ?? {}) as { active?: string };
    const accounts: AccountOverview[] = runtime.list();
    const activeId = Number(q.active) > 0 ? Number(q.active) : runtime.activeAccountId();
    return ok({ accounts, activeId });
  });

  app.post('/api/accounts', async (req, reply) => {
    const body = (req.body ?? {}) as { name?: string };
    try {
      const acc = runtime.create(body.name ?? '');
      const accounts = runtime.list();
      publish({
        type: 'account',
        payload: {
          id: acc.id,
          status: acc.status,
          creditScore: acc.creditScore,
          circuit: acc.circuit,
        },
      });
      return ok({ account: overviewOf(accounts, acc.id), activeId: runtime.activeAccountId() });
    } catch (e) {
      reply.code(400);
      return err(
        isAppError(e) ? e.code : 'INTERNAL',
        isAppError(e) ? e.message : String(e),
        isAppError(e) ? e.hint : '换个账号名再试',
      );
    }
  });

  app.post('/api/accounts/:id/activate', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const acc = runtime.setActive(Number(id));
      return ok({
        account: runtime.overviewOf(acc),
        activeId: acc.id,
      });
    } catch (e) {
      reply.code(isAppError(e) && e.code === 'NOT_FOUND' ? 404 : 400);
      return err(
        isAppError(e) ? e.code : 'INTERNAL',
        isAppError(e) ? e.message : String(e),
        isAppError(e) ? e.hint : '刷新页面后再试',
      );
    }
  });

  app.delete('/api/accounts/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const out = runtime.remove(Number(id));
      return ok({ ...out, activeId: runtime.activeAccountId() });
    } catch (e) {
      const notFound = isAppError(e) && e.code === 'NOT_FOUND';
      reply.code(notFound ? 404 : 400);
      return err(
        isAppError(e) ? e.code : 'INTERNAL',
        isAppError(e) ? e.message : String(e),
        isAppError(e) ? e.hint : '刷新页面后再试',
      );
    }
  });
}

function overviewOf(list: AccountOverview[], id: number): AccountOverview | null {
  return list.find((a) => a.id === id) ?? null;
}
