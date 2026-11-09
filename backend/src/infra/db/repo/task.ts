import { getDb } from '../index';
import { TASK_STATUSES } from '@shared/types';
import type { ImageStrategy, Task, TaskStatus } from '@shared/types';

interface TaskRow {
  id: number;
  account_id: number;
  source_item_id: number;
  status: string;
  prompt_template_id: number | null;
  image_strategy: string;
  rewrite_id: number | null;
  error_code: string | null;
  retry_count: number;
  created_at: string;
  updated_at: string;
}

function map(r: TaskRow): Task {
  return {
    id: r.id,
    accountId: r.account_id,
    sourceItemId: r.source_item_id,
    status: (TASK_STATUSES as readonly string[]).includes(r.status)
      ? (r.status as TaskStatus)
      : 'pending',
    promptTemplateId: r.prompt_template_id,
    imageStrategy: (['dedup', 'stock', 'both'] as const).includes(r.image_strategy as ImageStrategy)
      ? (r.image_strategy as ImageStrategy)
      : 'both',
    rewriteId: r.rewrite_id,
    errorCode: r.error_code,
    retryCount: r.retry_count,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function createTask(
  accountId: number,
  sourceItemId: number,
  strategy: ImageStrategy = 'both',
  promptTemplateId: number | null = null,
): Task {
  const db = getDb();
  const r = db
    .prepare(
      `INSERT INTO task (account_id, source_item_id, image_strategy, prompt_template_id)
       VALUES (?, ?, ?, ?)`,
    )
    .run(accountId, sourceItemId, strategy, promptTemplateId);
  return getTask(Number(r.lastInsertRowid))!;
}

export function getTask(id: number): Task | null {
  const row = getDb().prepare('SELECT * FROM task WHERE id = ?').get(id) as TaskRow | undefined;
  return row ? map(row) : null;
}

/**
 * 任务列表（CHG-0002 多账号）：不传 accountId 就是全量；传入则只统计该账号。
 * Count-by-status 同理，两者口径必须一致，否则看板数字和列表对不上。
 */
export function listTasks(status?: TaskStatus, limit = 500, accountId?: number): Task[] {
  const db = getDb();
  if (accountId == null) {
    const rows = status
      ? (db
          .prepare('SELECT * FROM task WHERE status = ? ORDER BY id DESC LIMIT ?')
          .all(status, limit) as TaskRow[])
      : (db.prepare('SELECT * FROM task ORDER BY id DESC LIMIT ?').all(limit) as TaskRow[]);
    return rows.map(map);
  }
  const rows = status
    ? (db
        .prepare(
          'SELECT * FROM task WHERE status = ? AND account_id = ? ORDER BY id DESC LIMIT ?',
        )
        .all(status, accountId, limit) as TaskRow[])
    : (db
        .prepare('SELECT * FROM task WHERE account_id = ? ORDER BY id DESC LIMIT ?')
        .all(accountId, limit) as TaskRow[]);
  return rows.map(map);
}

export function countByStatus(accountId?: number): Record<string, number> {
  const db = getDb();
  const rows =
    accountId == null
      ? (db.prepare('SELECT status, COUNT(*) AS n FROM task GROUP BY status').all() as {
          status: string;
          n: number;
        }[])
      : (db
          .prepare(
            'SELECT status, COUNT(*) AS n FROM task WHERE account_id = ? GROUP BY status',
          )
          .all(accountId) as { status: string; n: number }[]);
  const out: Record<string, number> = { all: 0 };
  for (const s of TASK_STATUSES) out[s] = 0;
  for (const r of rows) {
    out[r.status] = r.n;
    out['all'] += r.n;
  }
  return out;
}

/**
 * 今日失败条数：状态为 failed 且最后更新落在当天（updated_at 由 updateStatus 在失败时写入）。
 * 看板要在累计「失败」之外单独展示「今日失败」，便于一眼看出当天健康度。
 */
export function countFailedToday(accountId: number): number {
  const row = getDb()
    .prepare(
      "SELECT COUNT(*) AS n FROM task WHERE account_id = ? AND status = 'failed' AND date(updated_at) = date('now')",
    )
    .get(accountId) as { n: number };
  return row.n;
}

/** 先落库再改状态：任何时刻崩溃都能从数据库知道做到哪一步（§4.2） */
export function updateStatus(
  id: number,
  status: TaskStatus,
  errorCode: string | null = null,
): void {
  getDb()
    .prepare(
      "UPDATE task SET status = ?, error_code = ?, updated_at = datetime('now') WHERE id = ?",
    )
    .run(status, errorCode, id);
}

export function setRewriteId(id: number, rewriteId: number): void {
  getDb()
    .prepare("UPDATE task SET rewrite_id = ?, updated_at = datetime('now') WHERE id = ?")
    .run(rewriteId, id);
}

export function bumpRetry(id: number): number {
  const db = getDb();
  db.prepare(
    "UPDATE task SET retry_count = retry_count + 1, updated_at = datetime('now') WHERE id = ?",
  ).run(id);
  return getTask(id)?.retryCount ?? 0;
}

/** 手动重试：回到 pending，保留重试次数，清空错误码（§4.1） */
export function resetToPending(id: number): void {
  getDb()
    .prepare(
      "UPDATE task SET status = 'pending', error_code = NULL, updated_at = datetime('now') WHERE id = ?",
    )
    .run(id);
}

/**
 * 删除任务及其全部产物（改写稿 / 发布记录 / 配图记录 / 日志 / 指纹）。
 * 只给「失败」任务做人工清库用：已发布任务要留证，不允许删（§2.3 验收口径 6）。
 * 顺序不能反：先删引用方，再删被引用的 task（外键 ON）。
 */
export function deleteTask(id: number): boolean {
  const db = getDb();
  const run = db.transaction((taskId: number) => {
    // task.rewrite_id 反向引用 rewrite_result，先解开，否则删改写稿会撞外键
    db.prepare('UPDATE task SET rewrite_id = NULL WHERE id = ?').run(taskId);
    db.prepare(
      `DELETE FROM fingerprint
       WHERE ref_type = 'rewrite_result'
         AND ref_id IN (SELECT id FROM rewrite_result WHERE task_id = ?)`,
    ).run(taskId);
    db.prepare('DELETE FROM publish_record WHERE task_id = ?').run(taskId);
    db.prepare('DELETE FROM stock_image WHERE task_id = ?').run(taskId);
    db.prepare('DELETE FROM task_log WHERE task_id = ?').run(taskId);
    db.prepare('DELETE FROM rewrite_result WHERE task_id = ?').run(taskId);
    return db.prepare('DELETE FROM task WHERE id = ?').run(taskId).changes > 0;
  });
  return run(id);
}

export function hasTaskForSource(sourceItemId: number): boolean {
  const row = getDb()
    .prepare('SELECT 1 AS x FROM task WHERE source_item_id = ? LIMIT 1')
    .get(sourceItemId);
  return Boolean(row);
}
