import { getDb } from '../index';
import type { CollectedItem, SourceItem } from '@shared/types';

interface SourceRow {
  id: number;
  account_id: number;
  platform_item_id: string;
  author: string | null;
  content: string;
  images: string;
  topics: string;
  like_count: number;
  comment_count: number;
  published_at: string | null;
  simhash: string;
  fetched_at: string;
  task_id: number | null;
}

function map(r: SourceRow): SourceItem {
  return {
    id: r.id,
    accountId: r.account_id,
    platformItemId: r.platform_item_id,
    author: r.author ?? '',
    content: r.content,
    images: JSON.parse(r.images) as string[],
    topics: JSON.parse(r.topics) as string[],
    likeCount: r.like_count,
    commentCount: r.comment_count,
    publishedAt: r.published_at,
    simhash: r.simhash,
    fetchedAt: r.fetched_at,
    taskId: r.task_id,
  };
}

const SELECT = `SELECT s.*, t.id AS task_id
                FROM source_item s
                LEFT JOIN task t ON t.source_item_id = s.id`;

/** 事务批量入库（§4.2：先落库再改状态），返回新写入的 id 列表 */
export function insertMany(
  accountId: number,
  items: CollectedItem[],
  simhashOf: (t: string) => string,
): number[] {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO source_item
      (account_id, platform_item_id, author, content, images, topics, like_count, comment_count, published_at, simhash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const ids: number[] = [];
  for (const it of items) {
    const r = stmt.run(
      accountId,
      it.platformItemId,
      it.author,
      it.content,
      JSON.stringify(it.images),
      JSON.stringify(it.topics),
      it.likeCount,
      it.commentCount,
      it.publishedAt,
      simhashOf(it.content),
    );
    if (r.changes > 0) ids.push(Number(r.lastInsertRowid));
  }
  return ids;
}

/** 素材池：还没有建任务的素材 */
export function listUntasked(accountId: number, limit = 200): SourceItem[] {
  const rows = getDb()
    .prepare(
      `${SELECT} WHERE s.account_id = ? AND t.id IS NULL ORDER BY s.fetched_at DESC, s.id DESC LIMIT ?`,
    )
    .all(accountId, limit) as SourceRow[];
  return rows.map(map);
}

export function listByAccount(accountId: number, limit = 200): SourceItem[] {
  const rows = getDb()
    .prepare(`${SELECT} WHERE s.account_id = ? ORDER BY s.id DESC LIMIT ?`)
    .all(accountId, limit) as SourceRow[];
  return rows.map(map);
}

export function getSourceItem(id: number): SourceItem | null {
  const row = getDb().prepare(`${SELECT} WHERE s.id = ?`).get(id) as SourceRow | undefined;
  return row ? map(row) : null;
}

/** 去重用：取该账号全部指纹（SimHash 海明距离比对在内存做） */
export function allSimhashes(): { id: number; simhash: string }[] {
  return getDb().prepare('SELECT id, simhash FROM source_item').all() as {
    id: number;
    simhash: string;
  }[];
}
