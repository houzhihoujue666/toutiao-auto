import { getDb } from '../index';
import type { RewriteResult } from '@shared/types';

interface Row {
  id: number;
  task_id: number;
  original_text: string;
  rewritten_text: string;
  similarity: number;
  quality_flags: string;
  images: string;
  simhash: string | null;
  created_at: string;
}

function map(r: Row): RewriteResult {
  return {
    id: r.id,
    taskId: r.task_id,
    originalText: r.original_text,
    rewrittenText: r.rewritten_text,
    similarity: r.similarity,
    qualityFlags: JSON.parse(r.quality_flags) as string[],
    images: JSON.parse(r.images) as string[],
    simhash: r.simhash,
    createdAt: r.created_at,
  };
}

export function insertRewrite(input: {
  taskId: number;
  originalText: string;
  rewrittenText: string;
  similarity: number;
  qualityFlags: string[];
  images: string[];
  simhash: string | null;
}): RewriteResult {
  const db = getDb();
  const r = db
    .prepare(
      `INSERT INTO rewrite_result
        (task_id, original_text, rewritten_text, similarity, quality_flags, images, simhash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.taskId,
      input.originalText,
      input.rewrittenText,
      input.similarity,
      JSON.stringify(input.qualityFlags),
      JSON.stringify(input.images),
      input.simhash,
    );
  const created = db
    .prepare('SELECT * FROM rewrite_result WHERE id = ?')
    .get(Number(r.lastInsertRowid)) as Row;
  return map(created);
}

export function updateRewrite(
  id: number,
  patch: {
    rewrittenText?: string;
    similarity?: number;
    qualityFlags?: string[];
    images?: string[];
  },
): void {
  const db = getDb();
  const cur = db.prepare('SELECT * FROM rewrite_result WHERE id = ?').get(id) as Row | undefined;
  if (!cur) return;
  db.prepare(
    `UPDATE rewrite_result
       SET rewritten_text = ?, similarity = ?, quality_flags = ?, images = ?
     WHERE id = ?`,
  ).run(
    patch.rewrittenText ?? cur.rewritten_text,
    patch.similarity ?? cur.similarity,
    JSON.stringify(patch.qualityFlags ?? (JSON.parse(cur.quality_flags) as string[])),
    JSON.stringify(patch.images ?? (JSON.parse(cur.images) as string[])),
    id,
  );
}

export function getRewrite(id: number): RewriteResult | null {
  const row = getDb().prepare('SELECT * FROM rewrite_result WHERE id = ?').get(id) as
    Row | undefined;
  return row ? map(row) : null;
}

export function getRewriteByTask(taskId: number): RewriteResult | null {
  const row = getDb()
    .prepare('SELECT * FROM rewrite_result WHERE task_id = ? ORDER BY id DESC LIMIT 1')
    .get(taskId) as Row | undefined;
  return row ? map(row) : null;
}
