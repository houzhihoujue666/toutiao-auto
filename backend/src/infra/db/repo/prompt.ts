import { getDb } from '../index';
import { DEFAULT_PROMPT_TEMPLATE } from '@shared/prompts';
import type { PromptTemplate } from '@shared/types';

interface Row {
  id: number;
  name: string;
  content: string;
  variant: string | null;
  is_default: number;
}

function map(r: Row): PromptTemplate {
  return {
    id: r.id,
    name: r.name,
    content: r.content,
    variant: r.variant,
    isDefault: r.is_default === 1,
  };
}

/** 取默认模板；库里没有就用 §6.4 的 v1 兜底（迁移 002 会种子） */
export function getDefaultTemplate(): PromptTemplate {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM prompt_template WHERE is_default = 1 ORDER BY id LIMIT 1')
    .get() as Row | undefined;
  if (row) return map(row);
  const any = db.prepare('SELECT * FROM prompt_template ORDER BY id LIMIT 1').get() as
    Row | undefined;
  if (any) return map(any);
  const r = db
    .prepare('INSERT INTO prompt_template (name, content, is_default) VALUES (?, ?, 1)')
    .run('默认模板 v1', DEFAULT_PROMPT_TEMPLATE);
  return map(
    db.prepare('SELECT * FROM prompt_template WHERE id = ?').get(Number(r.lastInsertRowid)) as Row,
  );
}

export function getTemplate(id: number): PromptTemplate | null {
  const row = getDb().prepare('SELECT * FROM prompt_template WHERE id = ?').get(id) as
    Row | undefined;
  return row ? map(row) : null;
}

export function updateTemplate(id: number, content: string, name?: string): void {
  const db = getDb();
  if (name)
    db.prepare('UPDATE prompt_template SET content = ?, name = ? WHERE id = ?').run(
      content,
      name,
      id,
    );
  else db.prepare('UPDATE prompt_template SET content = ? WHERE id = ?').run(content, id);
}
