import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbPath } from '../storage/paths';
import { log } from '../logger';
import { AppError } from '@shared/errors';

/** SQLite 基础设施：WAL 模式 + 编号递增迁移，失败即停止启动并报错（§5.4） */

let instance: Database.Database | null = null;
let memory = false;

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(here, '..', '..', '..', 'migrations');

export interface DbOptions {
  /** 测试用内存库 */
  memory?: boolean;
  /** 自定义文件库路径（测试用临时目录） */
  file?: string;
}

export function initDb(opts: DbOptions = {}): Database.Database {
  if (instance) return instance;
  memory = opts.memory ?? false;
  const file = memory ? ':memory:' : (opts.file ?? dbPath());
  if (!memory && !opts.file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  instance = db;
  runMigrations(db);
  return db;
}

export function getDb(): Database.Database {
  if (!instance) return initDb();
  return instance;
}

export function isMemoryDb(): boolean {
  return memory;
}

export function closeDb(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}

export function runMigrations(db: Database.Database = getDb()): string[] {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version TEXT PRIMARY KEY,
       applied_at TEXT NOT NULL DEFAULT (datetime('now'))
     );`,
  );
  const applied = new Set(
    db
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((r) => String((r as { version: string }).version)),
  );
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const done: string[] = [];
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(f);
    } catch (e) {
      log('error', `migration failed: ${f}`, { error: String(e) });
      throw new AppError('DB_WRITE_FAILED', `数据库迁移失败：${f}（${String(e)}）`);
    }
    done.push(f);
    log('info', `migration applied: ${f}`);
  }
  return done;
}

export function transaction<T>(fn: (db: Database.Database) => T): T {
  const db = getDb();
  try {
    const out = db.transaction(() => fn(db))();
    return out;
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError('DB_WRITE_FAILED', `写库事务异常：${String(e)}`);
  }
}
