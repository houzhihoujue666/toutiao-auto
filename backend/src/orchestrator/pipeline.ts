import * as taskRepo from '../infra/db/repo/task';
import * as sourceRepo from '../infra/db/repo/source-item';
import * as rewriteRepo from '../infra/db/repo/rewrite';
import * as recordRepo from '../infra/db/repo/publish-record';
import * as accountRepo from '../infra/db/repo/account';
import * as logRepo from '../infra/db/repo/log';
import { publish, publishAlert } from '../infra/bus';
import { log } from '../infra/logger';
import { RewriteService } from '../modules/rewrite/service';
import { computeSimilarity } from '../modules/rewrite/similarity';
import { cleanRewritten } from '../modules/rewrite/clean';
import { ImageService } from '../modules/image/service';
import { extractKeywords } from '../modules/image/stock';
import { QualityService } from '../modules/quality/service';
import { PublishService } from '../modules/publish/service';
import { alreadyPublished } from '../modules/publish/idempotency';
import { defaultCollectOptions } from '../modules/crawl/service';
import { getMode, allowRealPublish, getNumber, getString, KEYS } from '../config/runtime';
import {
  DEFAULT_WORD_RANGE,
  DEFAULT_LLM_MODE,
  SIMILARITY_THRESHOLD,
  MIN_LENGTH,
  MAX_LENGTH,
  DEFAULT_IMAGE_STRATEGY,
  RUN_CRAWL_MAX_ROUNDS,
  FORCE_DECLARATION,
} from '@shared/constants';
import { AppError, isAppError } from '@shared/errors';
import { simhash } from '@shared/simhash';
import type { ImageStrategy, RunResult, Task } from '@shared/types';
import type { Crawler } from '@shared/types';
import { PublishQueue } from './queue';
import { publishScheduler } from './publishScheduler';
import { moveTask } from './stateMachine';
import { evaluate, intervalMinutes } from './rateLimit';
import { assertClosed, recordFailure, recordSuccess } from './circuitBreaker';

/**
 * 编排层 —— 状态流转、排队、限速、熔断、重试、断点续跑（§3.1 第 3 层）
 * 不含任何页面操作细节；所有进度以数据库为准（ADR-7）
 * §E.7：质检通过后自动放行，不再等人点确认。
 */

/** RATE_LIMITED 自动重试预算：瞬时限流重试可自愈，超此次数才落 failed 由人确认 */
const RATE_LIMIT_RETRY_BUDGET = 3;

export class Pipeline {
  private readonly rewriteService = new RewriteService();
  private readonly imageService = new ImageService();
  private readonly qualityService = new QualityService();
  private timer: ReturnType<typeof setInterval> | null = null;
  /** 自动放行开关：v4.1 起默认开启，质检通过即入队（§E.7） */
  autoApprove = true;
  /** 队列等待提示去重键：同一轮等待只提示一次，避免每 15 秒刷屏 */
  private queueNotice = '';
  /** 队列等待的定时器：tick 每 15 秒会重排一次，保留一个即可，避免定时器越积越多 */
  private drainTimer: ReturnType<typeof setTimeout> | null = null;
  /** 正在推进「改写→放行」的任务号：同一任务同时只允许一个流程（防并发踩踏） */
  private activeRewrites = new Set<number>();
  /**
   * 本账号自己的发布队列（CHG-0002：不再是进程级单例）。
   * 队列锁 = 同账号严格串行（红线 9 / ADR-6）；跨账号并发另由 publishScheduler 管。
   */
  readonly queue = new PublishQueue();

  constructor(
    private readonly accountName: string = accountRepo.DEFAULT_ACCOUNT_NAME,
    private readonly crawler: Crawler | null = null,
  ) {}

  private account() {
    return accountRepo.getAccountByName(this.accountName) ?? accountRepo.ensureAccount(this.accountName);
  }

  /* ───────────────── 建任务 ───────────────── */

  createTasksFromSources(sourceIds: number[]): Task[] {
    const acc = this.account();
    const strategy = (getString(KEYS.imageStrategy) || DEFAULT_IMAGE_STRATEGY) as ImageStrategy;
    const out: Task[] = [];
    for (const sid of sourceIds) {
      if (taskRepo.hasTaskForSource(sid)) continue;
      const t = taskRepo.createTask(acc.id, sid, strategy);
      // 素材已采集且去重通过 → 直接进入 fetched
      taskRepo.updateStatus(t.id, 'fetched');
      log('info', `task ${t.id} created from source ${sid}`, { strategy });
      publish({ type: 'task', payload: { taskId: t.id, from: 'pending', to: 'fetched' } });
      out.push(taskRepo.getTask(t.id)!);
    }
    this.emitPipeline();
    return out;
  }

  /* ───────────────── 一键运行（§E.7：填条数 → 采集到发布全自动） ───────────────── */

  /**
   * 一键开始：补采 → 建任务 → 改写 → 配图 → 质检 → 自动放行入队。
   * 额度耗尽时直接抛 QUOTA_EXHAUSTED，一个任务都不建（§E.7.3）。
   */
  async runOnce(count: number): Promise<RunResult> {
    const acc = this.account();
    const decision = evaluate(acc);
    if (decision.remaining <= 0) {
      publishAlert(
        'warn',
        'QUOTA_EXHAUSTED',
        `今日已全部发完（${acc.dailyPublishLimit}/${acc.dailyPublishLimit}），次日 0 点自动重置`,
      );
      throw new AppError(
        'QUOTA_EXHAUSTED',
        `今日已全部发完（${acc.dailyPublishLimit}/${acc.dailyPublishLimit}）`,
        '次日 0 点自动重置；可在设置页调整上限',
      );
    }
    if (!decision.ok && decision.reason === 'interval') {
      const waitMin = Math.max(1, Math.ceil(decision.waitMs / 60_000));
      publishAlert(
        'warn',
        'RATE_LIMITED',
        `距上次发布不足 ${intervalMinutes()} 分钟，请 ${waitMin} 分钟后重试`,
      );
      throw new AppError(
        'RATE_LIMITED',
        `距上次发布不足 ${intervalMinutes()} 分钟，请 ${waitMin} 分钟后重试`,
        '可在设置页调整「最小发布间隔」',
      );
    }

    const accepted = Math.min(Math.trunc(count), decision.remaining);
    const { ids, crawled, error } = await this.pickSources(accepted);
    if (ids.length === 0 && error) throw error;

    const tasks = this.createTasksFromSources(ids);
    const taskIds: number[] = [];
    let enqueued = 0;
    for (const t of tasks) {
      await this.runUntilReview(t.id);
      taskIds.push(t.id);
      const done = taskRepo.getTask(t.id);
      if (done && (done.status === 'publishing' || done.status === 'published')) enqueued++;
    }

    let message =
      tasks.length === 0
        ? `没有可用的新素材，本次未建任务（补采入库 ${crawled} 条，可能都被去重或与历史内容重复）`
        : `已启动 ${tasks.length} 条，其中 ${enqueued} 条进入发布队列，按 ${intervalMinutes()} 分钟间隔依次发出`;
    // 请求条数 > 实际能建的素材：明确告知缺口，避免「设 20 只发 9」的困惑
    if (tasks.length > 0 && tasks.length < accepted) {
      message += `（请求 ${accepted} 条，但素材池+补采仅拿到 ${tasks.length} 条新素材，其余无可用内容）`;
    }

    log(
      'info',
      `runOnce: requested=${count} accepted=${accepted} crawled=${crawled} created=${tasks.length} enqueued=${enqueued}`,
      {
        remaining: decision.remaining,
      },
    );
    this.emitPipeline();
    void this.drainQueue();

    return {
      requested: count,
      accepted,
      remaining: decision.remaining,
      crawled,
      created: tasks.length,
      enqueued,
      taskIds,
      message,
    };
  }

  /** 挑素材：先吃素材池，不够就补采，最多 RUN_CRAWL_MAX_ROUNDS 轮（§E.7.2 第 3 步） */
  private async pickSources(need: number): Promise<{
    ids: number[];
    crawled: number;
    error: unknown;
  }> {
    const acc = this.account();
    const picked = new Set<number>();
    let crawled = 0;
    let error: unknown = null;

    for (let round = 0; round < RUN_CRAWL_MAX_ROUNDS && picked.size < need; round++) {
      for (const it of sourceRepo.listUntasked(acc.id, need - picked.size)) {
        if (picked.size >= need) break;
        if (!taskRepo.hasTaskForSource(it.id)) picked.add(it.id);
      }
      if (picked.size >= need || !this.crawler) break;
      try {
        const r = await this.crawler.collect({
          ...defaultCollectOptions(),
          limit: need - picked.size,
        });
        crawled += r.insertedCount;
        if (r.insertedCount === 0) break; // 采不出新东西，别空转
      } catch (e) {
        error = e;
        log('warn', `runOnce 补采失败：${String(e)}`, { round });
        break;
      }
    }
    return { ids: [...picked], crawled, error };
  }

  /**
   * 自动放行：质检通过后直接入队，不再等人点确认（§E.7）。
   * 不入队时给出原因，任务留在 reviewing，等条件恢复后由 tick 补发。
   */
  releaseToQueue(taskId: number): {
    enqueued: boolean;
    reason: 'ok' | 'circuit' | 'quota' | 'similarity' | 'status';
  } {
    const acc = this.account();
    if (acc.circuit === 'open') return { enqueued: false, reason: 'circuit' };
    if (evaluate(acc).remaining <= 0) return { enqueued: false, reason: 'quota' };
    const task = taskRepo.getTask(taskId);
    if (!task || task.status !== 'reviewing') return { enqueued: false, reason: 'status' };
    // 放行前再拦一次相似度（§2.3 验收口径 5：不合格的内容绝不放行）
    const rw = rewriteRepo.getRewriteByTask(taskId);
    if (rw && rw.similarity > (getNumber(KEYS.similarityThreshold) || SIMILARITY_THRESHOLD)) {
      moveTask(taskId, 'failed', 'SIMILARITY');
      return { enqueued: false, reason: 'similarity' };
    }
    moveTask(taskId, 'publishing');
    this.queue.enqueue(taskId);
    return { enqueued: true, reason: 'ok' };
  }

  /* ───────────────── 自动推进（采集 → 改写 → 配图 → 质检 → 自动放行） ───────────────── */

  async runUntilReview(taskId: number): Promise<void> {
    const task = taskRepo.getTask(taskId);
    if (!task || task.status !== 'fetched') return;
    // 任务级互斥：tick（15 秒一轮）/ 一键开始 / 手动建任务 / 重试都会触发推进，
    // 并发跑同一任务时，落后的一方拿着过期状态写库会被状态机拒绝，
    // 还会把已入队甚至已发布的任务错标成 failed（2026-10-22 生产库实证）。
    if (this.activeRewrites.has(taskId)) {
      log('info', `task ${taskId} 已有流程在推进，跳过本次重复触发`, {});
      return;
    }
    this.activeRewrites.add(taskId);
    try {
      await this.runUntilReviewInner(taskId);
    } finally {
      this.activeRewrites.delete(taskId);
    }
  }

  private async runUntilReviewInner(taskId: number): Promise<void> {
    const task = taskRepo.getTask(taskId);
    if (!task || task.status !== 'fetched') return;
    const source = sourceRepo.getSourceItem(task.sourceItemId);
    if (!source) {
      moveTask(taskId, 'failed', 'NOT_FOUND');
      return;
    }

    try {
      const outcome = await this.rewriteService.run(source.content, {
        wordRange: getString(KEYS.wordRange) || DEFAULT_WORD_RANGE,
        threshold: getNumber(KEYS.similarityThreshold) || SIMILARITY_THRESHOLD,
        mode: getMode() === 'simulated' ? 'simulated' : getString(KEYS.llmMode) || DEFAULT_LLM_MODE,
        timeoutMs: getNumber(KEYS.rewriteTimeoutMs) || undefined,
        retries: getNumber(KEYS.rewriteRetry) || 0,
      });

      // 先落库再改状态
      const rw = rewriteRepo.insertRewrite({
        taskId,
        originalText: source.content,
        rewrittenText: outcome.text,
        similarity: outcome.similarity,
        qualityFlags: [],
        images: [],
        simhash: simhash(outcome.text),
      });
      moveTask(taskId, 'rewritten');
      taskRepo.setRewriteId(taskId, rw.id);

      await this.afterRewrite(taskId, rw.id, outcome.text);
    } catch (e) {
      this.handleStepError(taskId, e);
    }
  }

  /**
   * 改写稿落库之后的公共尾巴：配图 → 质检 → 自动放行（§E.7）。
   * 自动改写和 manual 模式「人粘贴改写稿」都走这里，保证两种来源行为一致。
   */
  private async afterRewrite(taskId: number, rewriteId: number, text: string): Promise<void> {
    const task = taskRepo.getTask(taskId);
    const source = sourceRepo.getSourceItem(task?.sourceItemId ?? 0);
    if (!task || !source) {
      moveTask(taskId, 'failed', 'NOT_FOUND');
      return;
    }
    try {
      // 配图（关键词取自改写后正文）
      const images = await this.imageService.process({
        taskId,
        sources: source.images,
        strategy: task.imageStrategy,
        keywords: extractKeywords(text),
        providerId: getString(KEYS.stockProvider) || undefined,
        apiKey: getString(KEYS.stockApiKey) || undefined,
      });
      rewriteRepo.updateRewrite(rewriteId, { images: images.images.map((i) => i.localPath) });

      // 质检
      const report = await this.qualityService.check(source.content, text, {
        minLength: getNumber(KEYS.minLength) || MIN_LENGTH,
        maxLength: getNumber(KEYS.maxLength) || MAX_LENGTH,
        threshold: getNumber(KEYS.similarityThreshold) || SIMILARITY_THRESHOLD,
      });
      rewriteRepo.updateRewrite(rewriteId, { qualityFlags: report.flags });

      if (report.passed) {
        moveTask(taskId, 'reviewing');
        // §E.7：质检通过即自动放行，不再等人点「通过并发布」
        if (this.autoApprove) {
          const r = this.releaseToQueue(taskId);
          if (r.enqueued) {
            log('info', `task ${taskId} auto-approved -> queued`, {});
            // 入队后立刻尝试排空：发布按 ★15 分钟间隔串行推进（§4.3）
            void this.drainQueue();
          } else if (r.reason === 'circuit') {
            publishAlert(
              'error',
              'CIRCUIT_OPEN',
              `任务 #${taskId} 质检已过，但账号已熔断，需你在设置页点「恢复」后才会发出`,
            );
          } else if (r.reason === 'quota') {
            publishAlert(
              'warn',
              'QUOTA_EXHAUSTED',
              `任务 #${taskId} 质检已过，但今日额度已用完，次日 0 点重置后自动补发`,
            );
          }
        }
      } else {
        const code = report.flags.includes('SENSITIVE')
          ? 'SENSITIVE'
          : report.flags.some((f) => f.startsWith('SENSITIVE'))
            ? 'SENSITIVE'
            : report.flags.includes('LENGTH')
              ? 'LENGTH'
              : 'SIMILARITY';
        moveTask(taskId, 'failed', code);
        publishAlert('error', code, `任务 #${taskId} 质检未通过：${report.flags.join(',')}`);
        log('error', `task ${taskId} blocked by quality gate`, { flags: report.flags });
      }
      this.emitPipeline();
    } catch (e) {
      this.handleStepError(taskId, e);
    }
  }

  /**
   * manual 模式：人把改写结果粘回来后，从「配图 → 质检 → 自动放行」继续跑完（§3.5）。
   * 返回新建的改写稿 id。
   */
  async applyManualRewrite(taskId: number, rawText: string): Promise<number> {
    const task = taskRepo.getTask(taskId);
    if (!task) throw new AppError('NOT_FOUND', `任务 #${taskId} 不存在`, '刷新列表后重试');
    if (task.status !== 'fetched') {
      throw new AppError(
        'VALIDATION_FAILED',
        `任务 #${taskId} 当前是 ${task.status}，只有「等人粘贴」的任务能接收改写稿`,
        '只有停在 fetched 的任务才能保存改写稿',
      );
    }
    const source = sourceRepo.getSourceItem(task.sourceItemId);
    if (!source) {
      moveTask(taskId, 'failed', 'NOT_FOUND');
      throw new AppError('NOT_FOUND', '素材不存在', '换一条素材重跑');
    }
    const text = cleanRewritten(rawText);
    if (!text.trim()) {
      throw new AppError('VALIDATION_FAILED', '改写稿不能为空', '粘贴或输入正文后再保存');
    }
    const similarity = computeSimilarity(source.content, text);
    const rw = rewriteRepo.insertRewrite({
      taskId,
      originalText: source.content,
      rewrittenText: text,
      similarity,
      qualityFlags: [],
      images: [],
      simhash: simhash(text),
    });
    moveTask(taskId, 'rewritten');
    taskRepo.setRewriteId(taskId, rw.id);
    log('info', `task ${taskId} manual rewrite saved: similarity=${similarity.toFixed(3)}`, {});
    await this.afterRewrite(taskId, rw.id, text);
    return rw.id;
  }

  private handleStepError(taskId: number, e: unknown): void {
    const raw =
      e instanceof Error
        ? (e.stack ?? e.message)
        : typeof e === 'object' && e !== null
          ? JSON.stringify(e)
          : String(e);
    const appErr = isAppError(e) ? e : new AppError('INTERNAL', String(e));
    log('error', `task ${taskId} step error (${appErr.code}): ${appErr.message}`, {
      raw,
      hint: appErr.hint,
    });
    // LLM_NEED_LOGIN：停在 fetched 等人登录，不重试、不代填（§3.5）
    if (appErr.code === 'LLM_NEED_LOGIN') {
      log('warn', `task ${taskId} 停在 fetched：${appErr.message}`, { hint: appErr.hint });
      publishAlert('warn', 'LLM_NEED_LOGIN', `任务 #${taskId} ${appErr.message}（${appErr.hint}）`);
      this.emitPipeline();
      return;
    }
    // RATE_LIMITED（多为 LLM 网关 429 / 平台瞬时限流）：瞬态可自愈，不应永久判失败。
    // 给一个重试预算（默认 3 次），超预算再落 failed 由人确认（§4.3 防误判原则：瞬态可重试）。
    if (appErr.code === 'RATE_LIMITED') {
      const t = taskRepo.getTask(taskId);
      const budget = RATE_LIMIT_RETRY_BUDGET;
      if (t && (t.retryCount ?? 0) < budget) {
        taskRepo.bumpRetry(taskId);
        taskRepo.resetToPending(taskId);
        taskRepo.updateStatus(taskId, 'fetched');
        log('warn', `task ${taskId} RATE_LIMITED 瞬时限流，自动重试（${t.retryCount + 1}/${budget}）`, {
          account: this.account().name,
        });
        publishAlert(
          'warn',
          'RATE_LIMITED',
          `任务 #${taskId} 触发限流，自动重试（${t.retryCount + 1}/${budget}）`,
        );
        // 不在此处立即重跑：当前栈还在 runUntilReview 的 finally 中（activeRewrites 未释放），
        // 且 429 立即重试会毫秒内打光预算；重置回 fetched 后由 15 秒 tick 自然重试，给 LLM 喘息。
        this.emitPipeline();
        return;
      }
      log('warn', `task ${taskId} RATE_LIMITED 超过重试预算 ${budget}，转人工确认`, {
        account: this.account().name,
      });
    }
    // 防污染：改写链抛错时任务可能已被并发流程推进（已入队、发布中甚至已发布）。
    // 此时绝不能拉回 failed —— 那会把发成功的内容标成失败，诱导重复发布。
    const current = taskRepo.getTask(taskId);
    if (current && !['fetched', 'rewritten'].includes(current.status)) {
      log('warn', `task ${taskId} 出错时已在 ${current.status}，不置 failed（疑似并发触发）`, {
        code: appErr.code,
      });
      this.emitPipeline();
      return;
    }
    moveTask(taskId, 'failed', appErr.code);
    publishAlert('error', appErr.code, `任务 #${taskId} ${appErr.message}（${appErr.hint}）`);
    this.emitPipeline();
  }

  /* ───────────────── 人工复核 → 发布 ───────────────── */

  approve(taskId: number): void {
    const acc = this.account();
    assertClosed(acc);
    const task = taskRepo.getTask(taskId);
    if (!task) throw new AppError('NOT_FOUND', `任务 #${taskId} 不存在`, '刷新列表后重试');
    if (task.status !== 'reviewing') {
      throw new AppError(
        'VALIDATION_FAILED',
        `任务 #${taskId} 当前状态是 ${task.status}，不能发布`,
        '只有待复核的任务可以发布',
      );
    }
    // 发布前再拦一次（§2.3 验收口径 5：不合格点不动发布按钮）
    const rw = rewriteRepo.getRewriteByTask(taskId);
    if (rw && rw.similarity > (getNumber(KEYS.similarityThreshold) || SIMILARITY_THRESHOLD)) {
      moveTask(taskId, 'failed', 'SIMILARITY');
      throw new AppError(
        'SIMILARITY',
        `相似度 ${rw.similarity.toFixed(2)} 超过闸门，已拦截`,
        '重试让模型重写，或手动编辑改写稿',
      );
    }
    moveTask(taskId, 'publishing');
    this.queue.enqueue(taskId);
    this.emitPipeline();
    void this.drainQueue();
  }

  discard(taskId: number): void {
    const task = taskRepo.getTask(taskId);
    if (!task) throw new AppError('NOT_FOUND', `任务 #${taskId} 不存在`, '刷新列表后重试');
    this.queue.remove(taskId);
    if (task.status === 'reviewing' || task.status === 'publishing') {
      moveTask(taskId, 'failed', 'NOT_FOUND');
      log('info', `task ${taskId} discarded by operator`);
    }
    this.emitPipeline();
  }

  /**
   * 人工删除失败任务：从队列摘掉，再连同改写稿 / 发布记录 / 日志一起清库。
   * 只允许删 failed —— 已发布的任务要留证，发布中的任务删了会让队列指向空气。
   */
  removeTask(taskId: number): void {
    const task = taskRepo.getTask(taskId);
    if (!task) throw new AppError('NOT_FOUND', `任务 #${taskId} 不存在`, '刷新列表后重试');
    if (task.status !== 'failed') {
      throw new AppError(
        'VALIDATION_FAILED',
        `任务 #${taskId} 当前是 ${task.status}，只有失败任务可以删除`,
        '已发布的任务需要留证，不能删除',
      );
    }
    this.queue.remove(taskId);
    if (!taskRepo.deleteTask(taskId)) {
      throw new AppError('NOT_FOUND', `任务 #${taskId} 已被删除`, '刷新列表后重试');
    }
    log('info', `task ${taskId} deleted by operator`, { errorCode: task.errorCode });
    this.emitPipeline();
  }

  /** 手动重试：回到 pending，保留重试次数，清空错误码（§4.1） */
  retry(taskId: number): void {
    const task = taskRepo.getTask(taskId);
    if (!task) throw new AppError('NOT_FOUND', `任务 #${taskId} 不存在`, '刷新列表后重试');
    taskRepo.bumpRetry(taskId);
    taskRepo.resetToPending(taskId);
    // pending → fetched（素材仍在库里）
    taskRepo.updateStatus(taskId, 'fetched');
    log('info', `task ${taskId} retry -> fetched`, { retryCount: task.retryCount + 1 });
    publish({ type: 'task', payload: { taskId, from: task.status, to: 'fetched' } });
    this.emitPipeline();
    void this.runUntilReview(taskId);
  }

  /* ───────────────── 队列与限速 ───────────────── */

  /**
   * 排空本账号队列。两把锁缺一不可（CHG-0002 / ADR-0015）：
   * - `queue.tryLock()`：同账号严格串行（红线 9）
   * - `publishScheduler`：同时在发布的账号数 ≤ accountConcurrencyLimit（默认 1）
   *
   * 取不到名额时不告警 —— tick 每 15 秒会来一次，发提示就是每 15 秒刷屏；
   * 由调度器在名额让出时按 FIFO 唤醒，等待时长可预期且不被「手快」抢占。
   */
  async drainQueue(): Promise<void> {
    const accId = this.account().id;
    const granted = publishScheduler.acquire(accId, () => {
      void this.drainQueue();
    });
    if (!granted) return;
    if (!this.queue.tryLock()) {
      publishScheduler.release(accId);
      return;
    }
    try {
      while (this.queue.size() > 0) {
        const taskId = this.queue.peek();
        if (taskId == null) break;
        const acc = this.account();
        if (acc.circuit === 'open') {
          publishAlert(
            'error',
            'CIRCUIT_OPEN',
            `账号「${acc.name}」已熔断，队列暂停，需人工恢复`,
          );
          break;
        }
        const d = evaluate(acc);
        if (!d.ok) {
          const wait = Math.min(d.waitMs, 60 * 60_000);
          log('warn', `RATE_LIMITED: ${d.reason}，${Math.round(wait / 1000)} 秒后再试`, {
            taskId,
            account: acc.name,
          });
          // 队列确实在等：给一次明确提示（含下一条预计时间），不再静默延后
          this.notifyQueueWait(d.reason, d.waitMs);
          if (this.drainTimer) clearTimeout(this.drainTimer);
          this.drainTimer = setTimeout(() => {
            this.drainTimer = null;
            void this.drainQueue();
          }, wait);
          this.drainTimer.unref?.();
          break;
        }
        await this.publishNow(taskId);
        this.queue.remove(taskId);
      }
      if (this.queue.size() === 0) this.queueNotice = '';
    } finally {
      this.queue.unlock();
      publishScheduler.release(accId);
    }
    this.emitPipeline();
  }

  /**
   * 队列等待提示：只在「开始等待」时推一次，避免每 15 秒的 tick 反复弹 toast。
   * 界面上另有常驻倒计时（summary.nextPublishAt），两者互补。
   */
  private notifyQueueWait(reason: 'daily' | 'interval' | undefined, waitMs: number): void {
    const size = this.queue.size();
    if (size <= 0) return;
    const next = new Date(Date.now() + waitMs);
    const hhmm = `${String(next.getHours()).padStart(2, '0')}:${String(next.getMinutes()).padStart(2, '0')}`;
    // 同一轮等待内（同一分钟级 ETA + 同样原因）只推一次
    const key = `${reason}:${size}:${Math.round(next.getTime() / 60_000)}`;
    if (key === this.queueNotice) return;
    this.queueNotice = key;
    if (reason === 'daily') {
      publishAlert(
        'warn',
        'QUOTA_EXHAUSTED',
        `今日额度已用完，队列里还有 ${size} 条，次日 0 点后自动继续发布`,
      );
      return;
    }
    publishAlert(
      'info',
      'QUEUE_WAITING',
      `发布间隔未到（间隔 ${intervalMinutes()} 分钟）：队列里还有 ${size} 条，下一条约 ${hhmm} 发出`,
    );
  }

  private async publishNow(taskId: number): Promise<void> {
    const task = taskRepo.getTask(taskId);
    if (!task) return;
    const rw = rewriteRepo.getRewriteByTask(taskId);
    if (!rw) {
      moveTask(taskId, 'failed', 'NOT_FOUND');
      return;
    }
    // 幂等自愈：这条内容其实已经发布成功过（典型场景：曾被并发误标失败，人点了重试）。
    // 纠正状态直接收尾，绝不再发一次 —— 重复发布不可逆。
    if (alreadyPublished(taskId)) {
      log('warn', `task ${taskId} 已有成功发布记录，跳过重复发布`, {});
      this.markPublishedEvenIfFailed(taskId);
      return;
    }
    const source = sourceRepo.getSourceItem(task.sourceItemId);
    const acc = this.account();
    const publisher = new PublishService(this.accountName, taskId);
    const isDraft = !allowRealPublish();
    try {
      const res = await publisher.publish({
        text: rw.rewrittenText,
        images: rw.images,
        topic: source?.topics[0],
        declaration: FORCE_DECLARATION,
        draft: isDraft,
      });
      recordRepo.insertRecord({
        taskId,
        publishedUrl: res.url ?? null,
        screenshotPath: res.screenshotPath,
        status: res.status,
        firstPublishConfirmed: res.firstPublishChecked,
      });
      if (res.status === 'success') {
        accountRepo.bumpUsedToday(acc.id);
        recordSuccess(acc);
        moveTask(taskId, 'published');
        log('info', `task ${taskId} published`, { url: res.url, screenshot: res.screenshotPath });
      } else {
        // Dry Run：只存草稿，不占额度
        accountRepo.setLastPublishAt(acc.id, new Date().toISOString());
        moveTask(taskId, 'published');
        log('info', `task ${taskId} draft saved (dry run)`, { screenshot: res.screenshotPath });
      }
    } catch (e) {
      const appErr = isAppError(e) ? e : new AppError('PUBLISH_FAILED', String(e));
      // 关键防误判：内容其实已经发成功（库里已有 success 记录），只是收尾的状态流转报错
      //（如并发把任务标成 failed 后 published 流转被拒）。此时不能记失败 —— 会诱导重复发布。
      if (recordRepo.hasSuccessRecord(taskId)) {
        log('warn', `task ${taskId} 实际已发布成功，忽略收尾错误：${appErr.message}`, {
          code: appErr.code,
        });
        this.markPublishedEvenIfFailed(taskId);
        return;
      }
      recordRepo.insertRecord({
        taskId,
        publishedUrl: null,
        screenshotPath: null,
        status: 'failed',
        firstPublishConfirmed: appErr.code !== 'FIRST_PUBLISH_CHECK_FAILED',
      });
      moveTask(taskId, 'failed', appErr.code);
      const { opened } = recordFailure(acc);
      if (appErr.code === 'FIRST_PUBLISH_CHECK_FAILED' || opened) {
        publishAlert('error', appErr.code, appErr.message);
      }
      log('error', `publish failed: ${appErr.message}`, { taskId, code: appErr.code });
    }
    this.emitPipeline();
  }

  /**
   * 按「事实优先」把任务置为 published：库里已有 success 发布记录，内容确实发出去了。
   * 正常流转（publishing → published）走状态机；被并发污染成 failed 时状态机不允许
   * failed → published，此时直接纠正状态 —— 宁可绕过状态机也不能让已发布内容显示为失败。
   */
  private markPublishedEvenIfFailed(taskId: number): void {
    try {
      if (taskRepo.getTask(taskId)?.status !== 'published') moveTask(taskId, 'published');
    } catch {
      taskRepo.updateStatus(taskId, 'published');
      publish({
        type: 'task',
        payload: { taskId, from: 'failed', to: 'published', errorCode: null },
      });
    }
    this.emitPipeline();
  }

  /* ───────────────── 自动循环与恢复 ───────────────── */

  startAutoLoop(intervalMs = 15_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    this.timer.unref?.();
  }

  stopAutoLoop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.drainTimer) clearTimeout(this.drainTimer);
    this.drainTimer = null;
  }

  async tick(): Promise<void> {
    // ① 自动推进 fetched 的任务（改写 → 配图 → 质检 → 自动放行）
    // CHG-0002：只推进**本账号**的任务，别的账号由它们自己的 Pipeline 推进
    // manual 模式：改写等人粘贴，自动推进只会反复刷 LLM_NEED_LOGIN（§3.5）
    if (!this.isManualMode()) {
      for (const t of taskRepo.listTasks('fetched', 20, this.account().id)) {
        await this.runUntilReview(t.id);
      }
    }
    // ② 补发：把因额度 / 熔断暂留在 reviewing 的任务放行（§E.7.3）
    if (this.autoApprove) this.releasePendingReviews();
    await this.drainQueue();
  }

  /** 是否「人工粘贴改写」模式：此时 fetched 任务等人，不能被自动推进（§3.5） */
  private isManualMode(): boolean {
    return getMode() !== 'simulated' && (getString(KEYS.llmMode) || DEFAULT_LLM_MODE) === 'manual';
  }

  /**
   * 补发滞留在 reviewing 的任务（额度耗尽或熔断期间没能放行的那批）。
   * 硬约束：队列长度 + 本次放行条数永不超过当日剩余额度（§4.3 背压 ③）。
   */
  private releasePendingReviews(): void {
    const acc = this.account();
    if (acc.circuit === 'open') return;
    let room = evaluate(acc).remaining - this.queue.size();
    if (room <= 0) return;
    for (const t of taskRepo.listTasks('reviewing', 100, acc.id)) {
      if (room <= 0) break;
      const r = this.releaseToQueue(t.id);
      if (r.enqueued) {
        room--;
        log('info', `task ${t.id} 补发入队`, {});
        continue;
      }
      // 熔断 / 额度再次耗尽 / 状态不对：本轮到此为止
      if (r.reason !== 'similarity') break;
    }
  }

  /**
   * 崩溃恢复：卡在 publishing 的一律标 failed + 截图，由人确认，绝不自动重发（§4.3）。
   * CHG-0002：只捞本账号的任务 —— 每个账号自己的 pipeline 各自恢复。
   */
  recoverOnStartup(): number {
    const stuck = taskRepo.listTasks('publishing', 100, this.account().id);
    for (const t of stuck) {
      taskRepo.updateStatus(t.id, 'failed', 'PUBLISH_FAILED');
      log('error', `recover: task ${t.id} 卡在 publishing，已置失败防重复发布`, {});
      publish({
        type: 'task',
        payload: { taskId: t.id, from: 'publishing', to: 'failed', errorCode: 'PUBLISH_FAILED' },
      });
      this.queue.enqueue(t.id);
    }
    if (stuck.length)
      publishAlert(
        'error',
        'PUBLISH_FAILED',
        `${stuck.length} 个任务在崩溃时卡在发布中，已置失败，请人工确认后再重试`,
      );
    return stuck.length;
  }

  emitPipeline(): void {
    const acc = this.account();
    // CHG-0002：流水线计数按账号统计，并带上 accountId，界面据此知道是哪条流水线变了
    const c = taskRepo.countByStatus(acc.id);
    const untasked = sourceRepo.listUntasked(acc.id, 1000).length;
    publish({
      type: 'pipeline',
      payload: {
        accountId: acc.id,
        items: untasked,
        pending: c['pending'] ?? 0,
        fetched: c['fetched'] ?? 0,
        rewritten: c['rewritten'] ?? 0,
        reviewing: c['reviewing'] ?? 0,
        publishing: c['publishing'] ?? 0,
        published: c['published'] ?? 0,
        failed: c['failed'] ?? 0,
        queue: this.queue.size(),
        usedToday: acc.usedToday,
        limit: acc.dailyPublishLimit,
      },
    });
  }

  /** 队列顺位与预计发出时间（明细页「待发布」用） */
  queueInfo(): { taskId: number; position: number; etaMs: number }[] {
    const interval = intervalMinutes();
    return this.queue.list().map((i) => ({
      taskId: i.taskId,
      position: this.queue.position(i.taskId),
      etaMs: this.queue.eta(i.taskId, interval),
    }));
  }

  logTask(taskId: number, level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
    logRepo.insertLog({ taskId, level, message, context: {}, createdAt: new Date().toISOString() });
  }
}
