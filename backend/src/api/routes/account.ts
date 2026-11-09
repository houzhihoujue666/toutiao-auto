import type { FastifyInstance } from 'fastify';
import type { AccountRuntime } from '../../orchestrator/registry';
import { publish } from '../../infra/bus';
import { log } from '../../infra/logger';
import { ok, err } from '@shared/types';
import { isAppError } from '@shared/errors';

/** 账号登录接口 —— §7.2：登录开始 / 状态 / 重置；CHG-0002：支持指定账号（默认当前账号） */
export function registerAccountLoginRoutes(app: FastifyInstance, runtime: AccountRuntime): void {
  /** 从 body / query 取 accountId，没传就用当前账号 */
  const target = (req: { body?: unknown; query?: unknown }) => {
    const b = (req.body ?? {}) as { accountId?: number | string };
    const q = (req.query ?? {}) as { accountId?: number | string };
    const raw = b.accountId ?? q.accountId;
    const n = Number(raw);
    return runtime.resolve(Number.isFinite(n) && n > 0 ? n : undefined);
  };

  app.post('/api/account/login/start', async (req, reply) => {
    const { account } = target(req);
    try {
      const svc = runtime.accountService(account);
      const r = await svc.startLogin();
      // 二维码只经本地 WS 推送，不落盘、不写日志（§8.4）；CHG-0003：带账号 id 与名称，支持多账号同时登录
      // 会话已经登录时 image 为空：不推二维码，等后台 waitForLogin 直接确认并推送 account 状态
      if (r.image) {
        publish({ type: 'qr', payload: { accountId: account.id, name: account.name, image: r.image } });
      }
      // 后台等待扫码完成（★120 秒上限）；已登录时等待会立即返回
      void svc
        .waitForLogin()
        .then((acc) => {
          publish({
            type: 'account',
            payload: {
              id: acc.id,
              status: acc.status,
              creditScore: acc.creditScore,
              circuit: acc.circuit,
            },
          });
        })
        .catch((e) => {
          log('error', `login failed: ${String(e)}`, { account: account.name });
        });
      return ok({ qr: r.alreadyLoggedIn ? 'already' : r.image ? 'pushed' : 'none', accountId: account.id });
    } catch (e) {
      const code = isAppError(e) ? e.code : 'INTERNAL';
      const message = isAppError(e) ? e.message : String(e);
      const hint = isAppError(e) ? e.hint : '查看服务端日志';
      reply.code(400);
      return err(code, message, hint);
    }
  });

  app.get('/api/account/status', async (req) => {
    const { account } = target(req);
    return ok(runtime.overviewOf(account));
  });

  app.post('/api/account/login/reset', async (req) => {
    const { account } = target(req);
    const acc = await runtime.accountService(account).reset();
    publish({
      type: 'account',
      payload: {
        id: acc.id,
        status: acc.status,
        creditScore: acc.creditScore,
        circuit: acc.circuit,
      },
    });
    return ok({ ...runtime.overviewOf(acc), accountId: acc.id });
  });

  /** 熔断恢复：必须由人点「恢复」（§8.2） */
  app.post('/api/account/circuit/resume', async (req) => {
    const { account } = target(req);
    const acc = runtime.accountService(account).resumeCircuit();
    publish({
      type: 'account',
      payload: {
        id: acc.id,
        status: acc.status,
        creditScore: acc.creditScore,
        circuit: acc.circuit,
      },
    });
    return ok({ ...runtime.overviewOf(acc), accountId: acc.id });
  });

  app.post('/api/account/login/check', async (req) => {
    const { account } = target(req);
    const status = await runtime.accountService(account).checkSession();
    const fresh = runtime.overviewOf(account);
    publish({
      type: 'account',
      payload: {
        id: account.id,
        status,
        creditScore: fresh.creditScore,
        circuit: fresh.circuit,
      },
    });
    return ok({ status, creditScore: fresh.creditScore, accountId: account.id });
  });
}
