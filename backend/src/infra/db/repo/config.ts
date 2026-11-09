import { getDb } from '../index';
import { APP_CONFIG_DEFS } from '@shared/constants';
import { AppError } from '@shared/errors';
import type { AppConfigItem } from '@shared/types';

interface Row {
  key: string;
  value: string;
  value_type: string;
  label: string;
  hint: string | null;
  min: number | null;
  max: number | null;
}

/** 启动时把 §9 可调项默认值灌进 app_config（ADR-10） */
export function seedDefaults(): void {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO app_config (key, value, value_type, label, hint, min, max)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const d of APP_CONFIG_DEFS) {
    stmt.run(d.key, d.value, d.valueType, d.label, d.hint ?? null, d.min, d.max);
  }
}

export function getAll(): AppConfigItem[] {
  const rows = getDb().prepare('SELECT * FROM app_config ORDER BY key').all() as Row[];
  return rows.map((r) => {
    const def = defOf(r.key);
    return {
      key: r.key,
      value: r.value,
      valueType: (def?.valueType ?? r.value_type) as AppConfigItem['valueType'],
      label: def?.label ?? r.label,
      hint: def?.hint ?? r.hint ?? '',
      min: def?.min ?? r.min,
      max: def?.max ?? r.max,
      locked: false, // 锁死项不进这张表（ADR-10）
      // select 的候选项只定义在代码常量里，库里没有这列；不从 defs 合并的话下拉会是空的
      options: def?.options,
    };
  });
}

export function getValue(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM app_config WHERE key = ?').get(key) as
    { value: string } | undefined;
  return row?.value ?? APP_CONFIG_DEFS.find((d) => d.key === key)?.value ?? null;
}

function defOf(key: string) {
  return APP_CONFIG_DEFS.find((d) => d.key === key);
}

/** 改配置：界面与后端双重校验（§9 min/max） */
export function setValue(key: string, raw: string): string {
  const def = defOf(key);
  if (!def) throw new AppError('VALIDATION_FAILED', `配置项 ${key} 不存在或为锁定项，不允许修改`);
  let value = raw;
  if (def.valueType === 'number') {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new AppError('VALIDATION_FAILED', `${def.label} 必须是数字`);
    if (def.min != null && n < def.min)
      throw new AppError('VALIDATION_FAILED', `${def.label} 不能小于 ${def.min}`);
    if (def.max != null && n > def.max)
      throw new AppError('VALIDATION_FAILED', `${def.label} 不能大于 ${def.max}`);
    value = String(n);
  } else if (def.valueType === 'boolean') {
    if (raw !== 'true' && raw !== 'false')
      throw new AppError('VALIDATION_FAILED', `${def.label} 只能是 true / false`);
  } else if (def.valueType === 'select') {
    if (!def.options?.includes(raw))
      throw new AppError(
        'VALIDATION_FAILED',
        `${def.label} 只能取 ${(def.options ?? []).join(' / ')}`,
      );
  }
  getDb()
    .prepare(
      `INSERT INTO app_config (key, value, value_type, label, hint, min, max, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    )
    .run(key, value, def.valueType, def.label, def.hint ?? null, def.min, def.max);
  return value;
}
