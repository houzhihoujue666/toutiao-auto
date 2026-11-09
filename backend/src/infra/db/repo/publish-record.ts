import { getDb } from '../index';
import type { PublishRecord } from '@shared/types';

interface Row {
  id: number;
  task_id: number;
  published_url: string | null;
  screenshot_path: string | null;
  status: string;
  first_publish_confirmed: number;
  published_at: string;
}

function map(r: Row): PublishRecord {
  return {
    id: r.id,
    taskId: r.task_id,
    publishedUrl: r.published_url,
    screenshotPath: r.screenshot_path,
    status: (['success', 'draft', 'failed'] as const).includes(r.status as PublishRecord['status'])
      ? (r.status as PublishRecord['status'])
      : 'failed',
    firstPublishConfirmed: r.first_publish_confirmed === 1,
    publishedAt: r.published_at,
  };
}

export function insertRecord(input: {
  taskId: number;
  publishedUrl: string | null;
  screenshotPath: string | null;
  status: PublishRecord['status'];
  firstPublishConfirmed: boolean;
}): PublishRecord {
  const db = getDb();
  const r = db
    .prepare(
      `INSERT INTO publish_record (task_id, published_url, screenshot_path, status, first_publish_confirmed)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      input.taskId,
      input.publishedUrl,
      input.screenshotPath,
      input.status,
      input.firstPublishConfirmed ? 1 : 0,
    );
  const row = db
    .prepare('SELECT * FROM publish_record WHERE id = ?')
    .get(Number(r.lastInsertRowid)) as Row;
  return map(row);
}

/** 发布幂等：进入 published 前先查是否已有成功记录（§4.3 / 红线 7） */
export function hasSuccessRecord(taskId: number): boolean {
  const row = getDb()
    .prepare("SELECT 1 AS x FROM publish_record WHERE task_id = ? AND status = 'success' LIMIT 1")
    .get(taskId);
  return Boolean(row);
}

export function getRecordByTask(taskId: number): PublishRecord | null {
  const row = getDb()
    .prepare('SELECT * FROM publish_record WHERE task_id = ? ORDER BY id DESC LIMIT 1')
    .get(taskId) as Row | undefined;
  return row ? map(row) : null;
}

export function listRecords(limit = 200): PublishRecord[] {
  const rows = getDb()
    .prepare('SELECT * FROM publish_record ORDER BY id DESC LIMIT ?')
    .all(limit) as Row[];
  return rows.map(map);
}

/**
 * 今日已发条数（与 account.used_today 互为校验）。
 * CHG-0002：传 accountId 时只统计该账号 —— 否则看板上会把别的账号的发布数算进来。
 */
export function countPublishedToday(accountId?: number): number {
  const db = getDb();
  const row =
    accountId == null
      ? (db
          .prepare(
            "SELECT COUNT(*) AS n FROM publish_record WHERE status = 'success' AND date(published_at) = date('now')",
          )
          .get() as { n: number })
      : (db
          .prepare(
            `SELECT COUNT(*) AS n FROM publish_record r
             JOIN task t ON t.id = r.task_id
             WHERE r.status = 'success' AND date(r.published_at) = date('now') AND t.account_id = ?`,
          )
          .get(accountId) as { n: number });
  return row.n;
}
