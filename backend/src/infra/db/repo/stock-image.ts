import { getDb } from '../index';
import type { StockImageRow } from '@shared/types';

interface Row {
  id: number;
  task_id: number | null;
  provider: string;
  provider_id: string;
  page_url: string | null;
  license: string;
  author: string | null;
  local_path: string;
}

function map(r: Row): StockImageRow {
  return {
    id: r.id,
    taskId: r.task_id,
    provider: r.provider,
    providerId: r.provider_id,
    pageUrl: r.page_url,
    license: r.license,
    author: r.author,
    localPath: r.local_path,
  };
}

/** 图库图必须记录 page_url 与 license，缺一不可（§6.5 要点 2） */
export function insertStockImage(input: {
  taskId: number | null;
  provider: string;
  providerId: string;
  pageUrl: string | null;
  license: string;
  author: string | null;
  localPath: string;
}): StockImageRow {
  const db = getDb();
  const r = db
    .prepare(
      `INSERT INTO stock_image (task_id, provider, provider_id, page_url, license, author, local_path)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.taskId,
      input.provider,
      input.providerId,
      input.pageUrl,
      input.license,
      input.author,
      input.localPath,
    );
  return map(
    db.prepare('SELECT * FROM stock_image WHERE id = ?').get(Number(r.lastInsertRowid)) as Row,
  );
}

export function listByTask(taskId: number): StockImageRow[] {
  return (
    getDb().prepare('SELECT * FROM stock_image WHERE task_id = ? ORDER BY id').all(taskId) as Row[]
  ).map(map);
}
