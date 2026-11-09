import { getDb } from '../index';
import { accountSessionDir, storageStatePath } from '../../storage/paths';
import { DAILY_PUBLISH_LIMIT } from '@shared/constants';
import { AppError } from '@shared/errors';
import type { Account, AccountStatus, CircuitState } from '@shared/types';

interface AccountRow {
  id: number;
  name: string;
  user_data_dir: string;
  storage_state_path: string | null;
  status: string;
  credit_score: number | null;
  daily_publish_limit: number;
  used_today: number;
  quota_date: string | null;
  last_publish_at: string | null;
  circuit: string;
  consecutive_failures: number;
  last_login_at: string | null;
}

/**
 * 统一时间口径：SQLite 的 datetime('now') 产出 "YYYY-MM-DD HH:MM:SS"，是 UTC 但不带时区。
 * Date.parse 会按「本地时间」解析，东八区会凭空多出 8 小时，导致 15 分钟最小间隔失效。
 * 这里把历史遗留的无时区字符串规范成带 Z 的 ISO，读写两侧都走它。
 */
export function normalizeTime(v: string | null): string | null {
  if (!v) return null;
  const s = v.trim();
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) return s; // 已带时区，原样返回
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/.exec(s);
  if (m) return `${m[1]}T${m[2]}Z`;
  return s;
}

function map(r: AccountRow): Account {
  return {
    id: r.id,
    name: r.name,
    userDataDir: r.user_data_dir,
    storageStatePath: r.storage_state_path,
    status: (['logged_in', 'logged_out', 'expired'] as const).includes(r.status as AccountStatus)
      ? (r.status as AccountStatus)
      : 'logged_out',
    creditScore: r.credit_score,
    dailyPublishLimit: r.daily_publish_limit,
    usedToday: r.used_today,
    lastLoginAt: normalizeTime(r.last_login_at),
    circuit: r.circuit === 'open' ? 'open' : 'closed',
    consecutiveFailures: r.consecutive_failures,
    lastPublishAt: normalizeTime(r.last_publish_at),
  };
}

export const DEFAULT_ACCOUNT_NAME = 'toutiao-main';

/** 当前账号持久化键（CHG-0002 / ADR-10：可调项进 app_config，不新增列、不做迁移） */
export const ACTIVE_ACCOUNT_KEY = 'activeAccountId';

export function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function ensureAccount(name: string = DEFAULT_ACCOUNT_NAME): Account {
  const db = getDb();
  const row = db.prepare('SELECT * FROM account WHERE name = ?').get(name) as
    AccountRow | undefined;
  if (row) return map(row);
  const dir = accountSessionDir(name);
  db.prepare(
    `INSERT INTO account (name, user_data_dir, storage_state_path, daily_publish_limit, quota_date)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(name, dir, storageStatePath(name), DAILY_PUBLISH_LIMIT, today());
  const created = db.prepare('SELECT * FROM account WHERE name = ?').get(name) as AccountRow;
  return map(created);
}

export function getAccount(id: number): Account | null {
  const row = getDb().prepare('SELECT * FROM account WHERE id = ?').get(id) as
    AccountRow | undefined;
  return row ? map(row) : null;
}

export function getAccountByName(name: string): Account | null {
  const row = getDb().prepare('SELECT * FROM account WHERE name = ?').get(name) as
    AccountRow | undefined;
  return row ? map(row) : null;
}

export function listAccounts(): Account[] {
  const rows = getDb().prepare('SELECT * FROM account ORDER BY id ASC').all() as AccountRow[];
  return rows.map(map);
}

export function countAccounts(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM account').get() as { n: number };
  return row.n;
}

/**
 * 当前操作的目标账号（CHG-0002）。
 * 取值顺序：app_config.activeAccountId → 首个账号 → 默认账号。
 * 最后一级回落保证「老库零迁移」：升级后 toutiao-main 自动成为当前账号。
 */
export function getActiveAccount(): Account {
  const db = getDb();
  const current = db.prepare('SELECT value FROM app_config WHERE key = ?').get(ACTIVE_ACCOUNT_KEY) as
    { value: string } | undefined;
  const id = Number(current?.value ?? 0);
  if (Number.isInteger(id) && id > 0) {
    const hit = getAccount(id);
    if (hit) return hit;
  }
  const first = listAccounts()[0];
  if (first) {
    if (first.id !== id) setActiveAccount(first.id);
    return first;
  }
  const created = ensureAccount(DEFAULT_ACCOUNT_NAME);
  setActiveAccount(created.id);
  return created;
}

export function setActiveAccount(id: number): Account {
  const db = getDb();
  const acc = getAccount(id);
  if (!acc) throw new AppError('NOT_FOUND', `账号 #${id} 不存在`, '刷新页面后再试');
  db.prepare(
    `INSERT INTO app_config (key, value, value_type, label, hint, updated_at)
     VALUES (?, ?, 'number', '当前操作账号', '界面切换账号时自动写入', datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  ).run(ACTIVE_ACCOUNT_KEY, String(id));
  return acc;
}

/**
 * 新建账号（CHG-0002）：账号名即浏览器会话目录名（ADR-4 已在位）。
 * 重名 / 空名直接抛错交给界面提示，不静默改名、不自动加后缀。
 */
export function createAccount(name: string): Account {
  const clean = name.trim();
  if (!clean)
    throw new AppError('VALIDATION_FAILED', '账号名不能为空', '填一个便于你自己分辨的名字');
  if (clean.length > 32)
    throw new AppError('VALIDATION_FAILED', '账号名不能超过 32 个字符', '用短一点的名字');
  if (getAccountByName(clean))
    throw new AppError('ACCOUNT_EXISTS', `账号「${clean}」已存在`, '换一个名字，或直接切换到它');
  return ensureAccount(clean);
}

/** 该账号有没有已产生的任务（删除保护：已发布的内容必须留证，§2.3 验收口径 6） */
export function hasTasks(id: number): boolean {
  const row = getDb().prepare('SELECT 1 AS x FROM task WHERE account_id = ? LIMIT 1').get(id) as
    { x: number } | undefined;
  return Boolean(row);
}

/**
 * 删除账号：只删库记录，不删 data/sessions/<账号名>/（误删时登录态还在盘上）。
 * 闸门：① 最后一个账号不许删；② 有任务的账号不许删。
 */
export function deleteAccount(id: number): {
  deleted: boolean;
  sessionDir: string;
  sourcesRemoved: number;
} {
  const acc = getAccount(id);
  if (!acc) throw new AppError('NOT_FOUND', `账号 #${id} 不存在`, '刷新页面后再试');
  if (countAccounts() <= 1)
    throw new AppError('VALIDATION_FAILED', '至少要保留一个账号', '先新建一个账号，再删不要的那个');
  if (hasTasks(id))
    throw new AppError(
      'VALIDATION_FAILED',
      `账号「${acc.name}」已经产生过任务，不允许删除`,
      '已发布的内容必须留证；确认不用就换个名字重建，不要删旧的',
    );
  const sessionDir = accountSessionDir(acc.name);
  const db = getDb();
  // 顺序不能反：先删引用方的素材与指纹，再删 account 本身（外键 ON）
  const run = db.transaction((accountId: number) => {
    const ids = (
      db.prepare('SELECT id FROM source_item WHERE account_id = ?').all(accountId) as {
        id: number;
      }[]
    ).map((r) => r.id);
    for (const sid of ids) {
      db.prepare(
        `DELETE FROM fingerprint WHERE ref_type = 'source_item' AND ref_id = ?`,
      ).run(sid);
    }
    db.prepare('DELETE FROM source_item WHERE account_id = ?').run(accountId);
    return db.prepare('DELETE FROM account WHERE id = ?').run(accountId).changes > 0;
  });
  const before = db.prepare('SELECT COUNT(*) AS n FROM source_item WHERE account_id = ?').get(id) as
    { n: number } | undefined;
  const sourcesRemoved = before?.n ?? 0;
  const ok = run(id);
  if (!ok) throw new AppError('NOT_FOUND', `账号 #${id} 已被删除`, '刷新页面后再试');
  // 删的如果是当前账号，把当前账号交还给首个账号
  const current = db.prepare('SELECT value FROM app_config WHERE key = ?').get(ACTIVE_ACCOUNT_KEY) as
    { value: string } | undefined;
  if (Number(current?.value ?? 0) === id) {
    const first = listAccounts()[0];
    if (first) setActiveAccount(first.id);
    else db.prepare('DELETE FROM app_config WHERE key = ?').run(ACTIVE_ACCOUNT_KEY);
  }
  return { deleted: true, sessionDir, sourcesRemoved };
}

/** 跨天重置当日额度（§8.2：次日 0 点重置） */
export function refreshQuota(id: number): Account {
  const db = getDb();
  const acc = getAccount(id);
  if (!acc) throw new Error('account not found');
  const row = db.prepare('SELECT quota_date FROM account WHERE id = ?').get(id) as
    { quota_date: string | null } | undefined;
  if (!row || row.quota_date !== today()) {
    db.prepare('UPDATE account SET used_today = 0, quota_date = ? WHERE id = ?').run(today(), id);
  }
  return getAccount(id)!;
}

export function setAccountStatus(id: number, status: AccountStatus): void {
  if (status === 'logged_in') {
    getDb()
      .prepare('UPDATE account SET status = ?, last_login_at = ? WHERE id = ?')
      .run(status, new Date().toISOString(), id);
    return;
  }
  getDb().prepare('UPDATE account SET status = ? WHERE id = ?').run(status, id);
}

export function setStorageState(id: number, p: string | null): void {
  getDb().prepare('UPDATE account SET storage_state_path = ? WHERE id = ?').run(p, id);
}

export function setCreditScore(id: number, score: number | null): void {
  getDb().prepare('UPDATE account SET credit_score = ? WHERE id = ?').run(score, id);
}

export function bumpUsedToday(id: number): void {
  getDb()
    .prepare('UPDATE account SET used_today = used_today + 1, last_publish_at = ? WHERE id = ?')
    .run(new Date().toISOString(), id);
}

export function setLastPublishAt(id: number, iso: string): void {
  getDb().prepare('UPDATE account SET last_publish_at = ? WHERE id = ?').run(iso, id);
}

export function setCircuit(id: number, state: CircuitState): void {
  getDb().prepare('UPDATE account SET circuit = ? WHERE id = ?').run(state, id);
}

export function setConsecutiveFailures(id: number, n: number): void {
  getDb().prepare('UPDATE account SET consecutive_failures = ? WHERE id = ?').run(n, id);
}

export function remainingQuota(id: number): number {
  const acc = refreshQuota(id);
  return Math.max(0, acc.dailyPublishLimit - acc.usedToday);
}
