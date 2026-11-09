import { getDb } from '../index';
import type { TaskLog } from '@shared/types';

interface Row {
  id: number;
  task_id: number | null;
  level: string;
  message: string;
  context: string;
  created_at: string;
}

function map(r: Row): TaskLog {
  return {
    id: r.id,
    taskId: r.task_id,
    level: (['debug', 'info', 'warn', 'error'] as const).includes(r.level as TaskLog['level'])
      ? (r.level as TaskLog['level'])
      : 'info',
    message: r.message,
    context: JSON.parse(r.context) as Record<string, unknown>,
    createdAt: r.created_at,
  };
}

export function insertLog(entry: Omit<TaskLog, 'id'>): void {
  getDb()
    .prepare(
      `INSERT INTO task_log (task_id, level, message, context, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(entry.taskId, entry.level, entry.message, JSON.stringify(entry.context), entry.createdAt);
}

export function listLogs(
  opts: { taskId?: number; level?: string; limit?: number } = {},
): TaskLog[] {
  const limit = opts.limit ?? 200;
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.taskId != null) {
    where.push('task_id = ?');
    args.push(opts.taskId);
  }
  if (opts.level && opts.level !== 'all') {
    where.push('level = ?');
    args.push(opts.level);
  }
  const sql = `SELECT * FROM task_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`;
  const rows = getDb()
    .prepare(sql)
    .all(...args, limit) as Row[];
  return rows.map(map);
}
