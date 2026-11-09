import type { FastifyInstance } from 'fastify';
import type { AccountRuntime } from '../../orchestrator/registry';
import { RUN_MIN_COUNT, RUN_MAX_COUNT } from '@shared/constants';
import { ok, err } from '@shared/types';
import { isAppError } from '@shared/errors';

/**
 * 一键开始（§E.7）—— 工作台唯一主入口。
 * 传一个条数，跑完「补采 → 建任务 → 改写 → 配图 → 质检 → 自动放行入队」全流程。
 * CHG-0002：可选 `accountId` 指定账号，不传就是当前账号 —— 一次只跑一个账号，不做跨账号分摊。
 */
export function registerRunRoutes(app: FastifyInstance, runtime: AccountRuntime): void {
  app.post('/api/run', async (req, reply) => {
    const body = (req.body ?? {}) as { count?: number; accountId?: number | string };
    const raw = Number(body.count);
    if (!Number.isInteger(raw) || raw < RUN_MIN_COUNT) {
      reply.code(400);
      return err(
        'VALIDATION_FAILED',
        `条数必须是 ${RUN_MIN_COUNT} 到 ${RUN_MAX_COUNT} 之间的整数`,
        '在输入框里填一个整数条数再点「一键开始」',
      );
    }
    // 填多了按上限截断；真正的额度校验在编排层（会按当日剩余额度再截一次）
    const count = Math.min(raw, RUN_MAX_COUNT);
    const n = Number(body.accountId);
    const { account, pipeline } = runtime.resolve(Number.isFinite(n) && n > 0 ? n : undefined);
    try {
      const result = await pipeline.runOnce(count);
      return ok({ ...result, accountId: account.id, accountName: account.name });
    } catch (e) {
      reply.code(400);
      return err(
        isAppError(e) ? e.code : 'INTERNAL',
        isAppError(e) ? e.message : String(e),
        isAppError(e) ? e.hint : '查看服务端日志',
      );
    }
  });
}
