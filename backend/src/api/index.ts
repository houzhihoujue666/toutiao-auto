import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { isAppError } from '@shared/errors';
import { registerWs } from './ws';
import { registerAccountLoginRoutes } from './routes/account';
import { registerAccountsRoutes } from './routes/accounts';
import { registerCrawlRoutes } from './routes/crawl';
import { registerTaskRoutes } from './routes/tasks';
import { registerRunRoutes } from './routes/run';
import { registerMiscRoutes } from './routes/misc';
import { log } from '../infra/logger';
import { AccountRuntime } from '../orchestrator/registry';
import * as accountRepo from '../infra/db/repo/account';

/**
 * CHG-0002：单账号三件套换成账号运行时登记册 —— 路由按请求里的 accountId 取对应实例，
 * 不传就是当前账号（activeAccountId）。
 */
export interface ServerDeps {
  runtime: AccountRuntime;
}

/** 接口层 —— §3.1 第 2 层：路由分发、入参校验、WS 广播；不含业务规则 */
export async function createServer(deps: ServerDeps): Promise<FastifyInstance> {
  // CHG-0002：先保证库里至少有一个账号 —— 否则界面刚打开时账号列表是空的
  deps.runtime.ensureSeeded();
  const app = Fastify({ logger: false, trustProxy: false });

  /**
   * 兼容「带 content-type: application/json 但没有 body」的请求（浏览器点按钮就是这种）。
   * 内置解析器会把空 body 判为 Unsupported Media Type，这里放行为空对象。
   */
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, raw, done) => {
    if (raw === undefined || raw === '') {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(String(raw)));
    } catch (e) {
      const err = e as Error & { statusCode?: number };
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  await registerWs(app);
  registerAccountsRoutes(app, deps.runtime);
  registerAccountLoginRoutes(app, deps.runtime);
  registerCrawlRoutes(app, deps.runtime);
  registerTaskRoutes(app, deps.runtime);
  registerRunRoutes(app, deps.runtime);
  registerMiscRoutes(app, deps.runtime);

  app.setErrorHandler((e, req, reply) => {
    if (isAppError(e)) {
      reply
        .status(400)
        .send({ ok: false, error: { code: e.code, message: e.message, hint: e.hint } });
      return;
    }
    // 非预期异常必须落日志：否则控制台上只剩一个「服务器内部错误」，无从排查（§7.5）
    log('error', `接口异常：${String(e)}`, {
      url: req.url,
      method: req.method,
      stack: e instanceof Error ? e.stack : undefined,
    });
    reply.status(500).send({
      ok: false,
      error: {
        code: 'INTERNAL',
        message: '服务器内部错误',
        hint: '已记录到日志，查看服务端输出',
      },
    });
  });

  app.get('/api/health', async () => ({ ok: true, data: { status: 'up' } }));

  return app;
}

/**
 * 默认依赖 —— CHG-0002：只造一个登记册，具体账号的 Pipeline / CrawlService / AccountService
 * 由 `runtime` 按账号 id 惰性构造；`ACCOUNT_NAME` 仍被尊重（服务启动时视为当前账号）。
 */
export function createDefaultDeps(): ServerDeps {
  const runtime = new AccountRuntime();
  if (process.env.ACCOUNT_NAME) {
    const acc = accountRepo.ensureAccount(process.env.ACCOUNT_NAME);
    runtime.setActive(acc.id);
  }
  return { runtime };
}
