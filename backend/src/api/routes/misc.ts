import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import * as taskRepo from '../../infra/db/repo/task';
import * as sourceRepo from '../../infra/db/repo/source-item';
import * as recordRepo from '../../infra/db/repo/publish-record';
import * as accountRepo from '../../infra/db/repo/account';
import * as logRepo from '../../infra/db/repo/log';
import { listLogs } from '../../infra/db/repo/log';
import * as configRepo from '../../infra/db/repo/config';
import { getDefaultTemplate, getTemplate, updateTemplate } from '../../infra/db/repo/prompt';
import { getLastCrawlAt } from '../../modules/crawl/service';
import { dataRoot, fromRelative } from '../../infra/storage/paths';
import { publish } from '../../infra/bus';
import { log } from '../../infra/logger';
import { getMode, allowRealPublish, getString, getNumber, KEYS } from '../../config/runtime';
import { intervalMinutes, lastPublishMs } from '../../orchestrator/rateLimit';
import type { AccountRuntime } from '../../orchestrator/registry';
import { DEFAULT_LLM_MODE, DEFAULT_LLM_API_MODEL, LOCKED_CONFIG_ITEMS } from '@shared/constants';
import { ok, err } from '@shared/types';
import { AppError, isAppError } from '@shared/errors';
import type { Summary } from '@shared/types';

/** 看板 / 日志 / 设置 / 提示词 / 大模型登录（CHG-0002：看板数据按当前账号出，并带上全部账号概览） */
export function registerMiscRoutes(app: FastifyInstance, runtime: AccountRuntime): void {
  /**
   * 只读静态文件：给界面预览 media / shots
   * 红线：库里只存路径；这里把相对路径还原成 data/ 内的真实文件，且禁止越界到 data/ 之外。
   */
  app.get('/api/media/*', async (req, reply) => {
    const rel = decodeURIComponent(String((req.params as Record<string, string>)['*'] ?? ''));
    if (!rel || rel.includes('..')) {
      reply.code(400);
      return err('VALIDATION_FAILED', '非法的文件路径', '只能访问 data/ 内的相对路径');
    }
    const abs = fromRelative(rel);
    const root = dataRoot();
    if (!abs.startsWith(root) || !fs.existsSync(abs)) {
      reply.code(404);
      return err('NOT_FOUND', '文件不存在', '该产物可能已被清理');
    }
    const ext = abs.split('.').pop()?.toLowerCase() ?? '';
    const type =
      ext === 'png'
        ? 'image/png'
        : ext === 'webp'
          ? 'image/webp'
          : ext === 'jpg' || ext === 'jpeg'
            ? 'image/jpeg'
            : 'application/octet-stream';
    reply.header('content-type', type);
    return reply.send(fs.createReadStream(abs));
  });

  app.get('/api/summary', async (req) => {
    // CHG-0002：不传 accountId = 当前账号；传了就看指定账号（切换前的预览 / 测试用）
    const q = (req.query ?? {}) as { accountId?: string };
    const n = Number(q.accountId);
    const { account: acc, pipeline } = runtime.resolve(Number.isFinite(n) && n > 0 ? n : undefined);
    accountRepo.refreshQuota(acc.id);
    const c = taskRepo.countByStatus(acc.id);
    const items = sourceRepo.listUntasked(acc.id, 1000).length;
    const publishedToday = recordRepo.countPublishedToday(acc.id);
    const llmMode = getString(KEYS.llmMode) || DEFAULT_LLM_MODE;
    const llmLabel =
      llmMode === 'manual'
        ? '人工粘贴'
        : llmMode === 'api'
          ? `API · ${getString(KEYS.llmApiModel) || DEFAULT_LLM_API_MODEL}`
          : llmMode === 'simulated'
            ? '本地模拟改写'
            : 'DeepSeek 网页版';
    // 队列里还有任务时，给出「下一条最早可发时间」，供界面倒计时提示
    // CHG-0002：队列是本账号自己的队列（不是全局那条）
    const queueSize = pipeline.queue.size();
    const lastMs = lastPublishMs(acc);
    const nextMs = lastMs > 0 ? lastMs + intervalMinutes() * 60_000 : 0;
    const nextPublishAt =
      queueSize > 0 ? new Date(Math.max(Date.now(), nextMs)).toISOString() : null;
    const summary: Summary = {
      account: acc,
      accounts: runtime.list(),
      activeAccountId: runtime.activeAccountId(),
      counts: {
        reviewing: c['reviewing'] ?? 0,
        queue: queueSize,
        publishedToday: Math.max(publishedToday, acc.usedToday),
        items,
        running: (c['pending'] ?? 0) + (c['fetched'] ?? 0) + (c['rewritten'] ?? 0),
        failed: c['failed'] ?? 0,
      },
      quota: {
        used: acc.usedToday,
        limit: acc.dailyPublishLimit,
        remaining: Math.max(0, acc.dailyPublishLimit - acc.usedToday),
      },
      circuit: {
        state: acc.circuit,
        consecutiveFailures: acc.consecutiveFailures,
        threshold: getNumber(KEYS.circuitBreakFailures) || 3,
      },
      external: {
        toutiao: {
          ok: acc.status === 'logged_in',
          label: acc.status === 'logged_in' ? '已登录' : '未登录',
        },
        llm: {
          needLogin: llmMode === 'manual' || llmMode === 'web',
          label: llmLabel,
          mode: llmMode,
        },
        stock: {
          ok: true,
          label: getString(KEYS.stockProvider) === 'pexels' ? 'Pexels' : 'Commons（免 Key）',
          provider: getString(KEYS.stockProvider) || 'commons',
        },
      },
      runtimeMode: getMode(),
      allowRealPublish: allowRealPublish(),
      lastCrawlAt: getLastCrawlAt(),
      lastPublishAt: acc.lastPublishAt,
      minPublishIntervalMinutes: intervalMinutes(),
      nextPublishAt,
    };
    return ok(summary);
  });

  app.get('/api/logs', async (req) => {
    const q = (req.query ?? {}) as { taskId?: string; level?: string; limit?: string };
    const logs = listLogs({
      taskId: q.taskId ? Number(q.taskId) : undefined,
      level: q.level,
      limit: q.limit ? Number(q.limit) : 200,
    });
    return ok({ logs });
  });

  app.post('/api/logs', async (req) => {
    const body = (req.body ?? {}) as { taskId?: number; level?: string; message?: string };
    logRepo.insertLog({
      taskId: body.taskId ?? null,
      level: (body.level as 'debug' | 'info' | 'warn' | 'error') ?? 'info',
      message: body.message ?? '',
      context: {},
      createdAt: new Date().toISOString(),
    });
    return ok({ ok: true });
  });

  app.get('/api/settings', async () => {
    return ok({ editable: configRepo.getAll(), locked: LOCKED_CONFIG_ITEMS });
  });

  app.put('/api/settings', async (req, reply) => {
    const body = (req.body ?? {}) as { values?: Record<string, string> };
    const values = body.values ?? {};
    try {
      const saved: Record<string, string> = {};
      for (const [k, v] of Object.entries(values)) saved[k] = configRepo.setValue(k, String(v));
      return ok({ saved });
    } catch (e) {
      reply.code(400);
      if (e instanceof AppError) return err(e.code, e.message, e.hint);
      return err('VALIDATION_FAILED', String(e), '检查取值范围');
    }
  });

  app.get('/api/prompt-templates/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const tpl = id === 'default' ? getDefaultTemplate() : getTemplate(Number(id));
    if (!tpl) {
      reply.code(404);
      return err('NOT_FOUND', '模板不存在', '刷新设置页');
    }
    return ok(tpl);
  });

  app.put('/api/prompt-templates/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { content?: string };
    const tpl = id === 'default' ? getDefaultTemplate() : getTemplate(Number(id));
    if (!tpl) {
      reply.code(404);
      return err('NOT_FOUND', '模板不存在', '刷新设置页');
    }
    const content = (body.content ?? '').trim();
    if (!content) {
      reply.code(400);
      return err('VALIDATION_FAILED', '模板正文不能为空', '至少保留 {{originalText}} 占位符');
    }
    if (!content.includes('{{originalText}}')) {
      reply.code(400);
      return err(
        'VALIDATION_FAILED',
        '模板必须包含 {{originalText}} 占位符',
        '否则原文无法注入，会报 PROMPT_MISSING_INPUT',
      );
    }
    updateTemplate(tpl.id, content);
    return ok({ id: tpl.id, content });
  });

  app.get('/api/prompt-templates', async () => {
    const tpl = getDefaultTemplate();
    return ok({ templates: [tpl] });
  });

  /**
   * 测试 API 改写连接：用当前设置里的地址 / 模型 / Key 真打一次极小请求。
   * 只花几十个 token，避免用户点完「一键开始」才发现 Key 填错。
   */
  app.post('/api/llm/test', async (_req, reply) => {
    try {
      const { createAdapter } = await import('../../infra/llm/factory');
      const adapter = createAdapter('api');
      await adapter.ensureSession();
      const started = Date.now();
      const sample = await adapter.rewrite({
        template: '只回复四个字：连接正常',
        originalText: '',
      });
      await adapter.dispose();
      return ok({
        model: getString(KEYS.llmApiModel),
        ms: Date.now() - started,
        sample: sample.slice(0, 120),
      });
    } catch (e) {
      reply.code(400);
      return err(
        isAppError(e) ? e.code : 'INTERNAL',
        isAppError(e) ? e.message : String(e),
        isAppError(e) ? e.hint : '检查 API 地址、模型名和 Key 是否匹配',
      );
    }
  });

  /**
   * 打开大模型站点让人手工登录一次（不代注代填）。
   * §3.5：登录结果必须让人看见 —— 后台轮询，成功 / 超时都推一条明确的提示。
   */
  app.post('/api/llm/login', async (_req, reply) => {
    try {
      if (getMode() === 'simulated') {
        return ok({ mode: 'simulated', message: '模拟模式使用本地改写器，不需要登录' });
      }
      const { llmContext } = await import('../../infra/playwright/session');
      const { openLoginPage, hasChatInput, isLoginWall, classifyLlmPage } =
        await import('../../infra/llm/sessionGuard');
      const ctx = await llmContext({ headless: false });
      const page = ctx.pages()[0] ?? (await ctx.newPage());
      await openLoginPage(page);

      // ★后台等人在浏览器里登录：120 秒上限，超时明确提示，不静默重试（§3.5）
      void (async () => {
        const deadline = Date.now() + 120_000;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 2000));
          let verdict: 'ready' | 'need_login' | 'lost' = 'lost';
          try {
            verdict = classifyLlmPage({
              url: page.url(),
              hasChatInput: await hasChatInput(page),
              hasLoginWall: await isLoginWall(page),
            });
          } catch {
            verdict = 'lost';
          }
          if (verdict === 'ready') {
            log('info', 'llm login success (real)');
            publish({
              type: 'alert',
              payload: {
                level: 'info',
                code: 'LLM_LOGIN_OK',
                message: '大模型登录成功，会话已保存，可以回到工作台点一键开始了',
              },
            });
            return;
          }
        }
        log('warn', 'llm login timeout: 120 秒内没有检测到可用会话');
        publish({
          type: 'alert',
          payload: {
            level: 'warn',
            code: 'LLM_LOGIN_TIMEOUT',
            message: '等待大模型登录超时（120 秒），请重新点「去登录」再试一次',
          },
        });
      })();

      return ok({
        mode: 'real',
        message:
          '已打开 DeepSeek 登录页，请在弹出的浏览器里用手机号 + 验证码登录（不是扫码），成功后会自动提示',
      });
    } catch (e) {
      reply.code(400);
      return err(
        isAppError(e) ? e.code : 'INTERNAL',
        isAppError(e) ? e.message : String(e),
        '请确认已安装 Playwright 浏览器',
      );
    }
  });
}
