import type { FastifyInstance } from 'fastify';
import * as taskRepo from '../../infra/db/repo/task';
import * as rewriteRepo from '../../infra/db/repo/rewrite';
import * as recordRepo from '../../infra/db/repo/publish-record';
import * as sourceRepo from '../../infra/db/repo/source-item';
import * as stockRepo from '../../infra/db/repo/stock-image';
import type { AccountRuntime } from '../../orchestrator/registry';
import type { Pipeline } from '../../orchestrator/pipeline';
import { renderPrompt } from '../../modules/rewrite/prompt';
import { computeSimilarity } from '../../modules/rewrite/similarity';
import { getDefaultTemplate } from '../../infra/db/repo/prompt';
import { getString, KEYS, getNumber } from '../../config/runtime';
import { DEFAULT_WORD_RANGE } from '@shared/constants';
import { ok, err, type TaskStatus } from '@shared/types';
import { AppError, isAppError } from '@shared/errors';

interface IdParams {
  id: string;
}

export function registerTaskRoutes(app: FastifyInstance, runtime: AccountRuntime): void {
  /**
   * 按任务本身找到它的账号对应的流水线 —— CHG-0002：
   * 明细页可能对「非当前账号」的任务做操作（比如从列表点进去），
   * 这时必须走这条任务的归属账号，不能用界面的选中账号。
   */
  const pipelineOfTask = (rawId: string): Pipeline => {
    const task = taskRepo.getTask(Number(rawId));
    if (!task) throw new AppError('NOT_FOUND', `任务 #${rawId} 不存在`, '刷新列表后重试');
    return runtime.resolve(task.accountId).pipeline;
  };

  /** CHG-0002：账号为「当前账号」或显式指定的 accountId；任务永远归属于某个账号 */
  const ctxOf = (req: { body?: unknown; query?: unknown }) => {
    const b = (req.body ?? {}) as { accountId?: number | string };
    const q = (req.query ?? {}) as { accountId?: number | string };
    const n = Number(b.accountId ?? q.accountId);
    return runtime.resolve(Number.isFinite(n) && n > 0 ? n : undefined);
  };

  /** 由素材批量创建任务 */
  app.post('/api/tasks', async (req, reply) => {
    const body = (req.body ?? {}) as { sourceIds?: number[]; imageStrategy?: string };
    const ids = body.sourceIds ?? [];
    if (!ids.length) {
      reply.code(400);
      return err('VALIDATION_FAILED', '请至少勾选一条素材', '在素材池里勾选后再点「生成任务」');
    }
    const { account, pipeline } = ctxOf(req);
    const tasks = pipeline.createTasksFromSources(ids);
    // 立刻自动推进（改写 → 配图 → 质检 → 自动放行，§E.7）
    void (async () => {
      for (const t of tasks) await pipeline.runUntilReview(t.id);
      await pipeline.drainQueue();
    })();
    return ok({ created: tasks.length, tasks, accountId: account.id });
  });

  app.get('/api/tasks', async (req) => {
    const q = (req.query ?? {}) as { status?: string; accountId?: number | string };
    const status = q.status && q.status !== 'all' ? (q.status as TaskStatus) : undefined;
    const { account } = ctxOf(req);
    const tasks = taskRepo.listTasks(status, 500, account.id);
    return ok({ tasks, accountId: account.id });
  });

  app.get('/api/tasks/:id', async (req, reply) => {
    const { id } = req.params as IdParams;
    const task = taskRepo.getTask(Number(id));
    if (!task) {
      reply.code(404);
      return err('NOT_FOUND', `任务 #${id} 不存在`, '刷新列表后重试');
    }
    const source = sourceRepo.getSourceItem(task.sourceItemId);
    const rewrite = rewriteRepo.getRewriteByTask(task.id);
    const record = recordRepo.getRecordByTask(task.id);
    const stock = stockRepo.listByTask(task.id);
    const template = getDefaultTemplate();
    const prompt = source
      ? renderPrompt(template.content, {
          originalText: source.content,
          wordRange: getString(KEYS.wordRange) || DEFAULT_WORD_RANGE,
        })
      : '';
    return ok({
      task,
      source,
      rewrite,
      record,
      stock,
      prompt,
      queue:
        runtime
          .resolve(task.accountId)
          .pipeline.queueInfo()
          .find((q) => q.taskId === task.id) ?? null,
      threshold: getNumber(KEYS.similarityThreshold) || 0.45,
    });
  });

  /** 人工编辑改写稿（manual 模式粘贴结果 / 复核页微调） */
  app.patch('/api/tasks/:id/rewrite', async (req, reply) => {
    const { id } = req.params as IdParams;
    const body = (req.body ?? {}) as { rewrittenText?: string };
    const taskId = Number(id);
    const task = taskRepo.getTask(taskId);
    if (!task) {
      reply.code(404);
      return err('NOT_FOUND', `任务 #${id} 不存在`, '刷新列表后重试');
    }
    const text = (body.rewrittenText ?? '').trim();
    if (!text) {
      reply.code(400);
      return err('VALIDATION_FAILED', '改写稿不能为空', '粘贴或输入正文后再保存');
    }

    const rw = rewriteRepo.getRewriteByTask(taskId);
    if (!rw) {
      // manual 模式：任务停在 fetched 等人粘贴，首次保存即创建改写稿并跑完后续流程（§3.5）
      try {
        const newId = await runtime
          .resolve(task.accountId)
          .pipeline.applyManualRewrite(taskId, text);
        return ok({ id: newId, rewrittenText: text, continued: true });
      } catch (e) {
        reply.code(400);
        return err(
          isAppError(e) ? e.code : 'INTERNAL',
          isAppError(e) ? e.message : String(e),
          isAppError(e) ? e.hint : '粘贴正文后再保存',
        );
      }
    }
    // 人改过就重算相似度，避免用旧值放行不合格内容（§2.3 验收口径 5）
    const source = sourceRepo.getSourceItem(task.sourceItemId);
    rewriteRepo.updateRewrite(rw.id, {
      rewrittenText: text,
      ...(source ? { similarity: computeSimilarity(source.content, text) } : {}),
    });
    return ok({ id: rw.id, rewrittenText: text });
  });

  app.post('/api/tasks/:id/publish', async (req, reply) => {
    const { id } = req.params as IdParams;
    try {
      pipelineOfTask(id).approve(Number(id));
      return ok({ taskId: Number(id), status: 'publishing' });
    } catch (e) {
      reply.code(400);
      return err(
        isAppError(e) ? e.code : 'INTERNAL',
        isAppError(e) ? e.message : String(e),
        isAppError(e) ? e.hint : '查看服务端日志',
      );
    }
  });

  app.post('/api/tasks/:id/discard', async (req, reply) => {
    const { id } = req.params as IdParams;
    try {
      pipelineOfTask(id).discard(Number(id));
      return ok({ taskId: Number(id), status: 'failed' });
    } catch (e) {
      reply.code(400);
      return err(
        isAppError(e) ? e.code : 'INTERNAL',
        isAppError(e) ? e.message : String(e),
        isAppError(e) ? e.hint : '',
      );
    }
  });

  /** 删除失败任务（连同改写稿 / 发布记录 / 日志），用于清理不再重试的失败条目 */
  app.delete('/api/tasks/:id', async (req, reply) => {
    const { id } = req.params as IdParams;
    try {
      pipelineOfTask(id).removeTask(Number(id));
      return ok({ taskId: Number(id), deleted: true });
    } catch (e) {
      reply.code(isAppError(e) && e.code === 'NOT_FOUND' ? 404 : 400);
      return err(
        isAppError(e) ? e.code : 'INTERNAL',
        isAppError(e) ? e.message : String(e),
        isAppError(e) ? e.hint : '刷新列表后重试',
      );
    }
  });

  app.post('/api/tasks/:id/retry', async (req, reply) => {
    const { id } = req.params as IdParams;
    try {
      pipelineOfTask(id).retry(Number(id));
      return ok({ taskId: Number(id), status: 'fetched' });
    } catch (e) {
      reply.code(400);
      return err(
        isAppError(e) ? e.code : 'INTERNAL',
        isAppError(e) ? e.message : String(e),
        isAppError(e) ? e.hint : '',
      );
    }
  });
}
