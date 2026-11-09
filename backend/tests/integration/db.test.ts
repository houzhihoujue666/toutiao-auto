import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { useFreshDb } from '../helpers/setup';
import { initDb, closeDb, getDb, runMigrations } from '../../src/infra/db';
import { dataRoot } from '../../src/infra/storage/paths';
import { seedDefaults, getValue, setValue, getAll } from '../../src/infra/db/repo/config';
import { validateSelectors, selectorEntries } from '../../src/config/selectors';
import { APP_CONFIG_DEFS, LOCKED_CONFIG_ITEMS } from '@shared/constants';
import { AppError } from '@shared/errors';

describe('数据库与迁移（§5.4）', () => {
  useFreshDb();

  it('迁移后建出全部业务表', () => {
    const tables = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r) => String((r as { name: string }).name));
    for (const t of [
      'account',
      'source_item',
      'task',
      'rewrite_result',
      'publish_record',
      'prompt_template',
      'task_log',
      'app_config',
      'stock_image',
      'fingerprint',
    ]) {
      expect(tables).toContain(t);
    }
  });

  it('文件库开启 WAL（内存库不支持 WAL，单独用临时文件验）', () => {
    closeDb();
    const file = path.join(dataRoot(), `wal-${Date.now()}.db`);
    initDb({ file });
    try {
      expect(String(getDb().pragma('journal_mode', { simple: true })).toLowerCase()).toBe('wal');
    } finally {
      closeDb();
      for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${file}${suffix}`, { force: true });
    }
  });

  it('迁移可重复执行，不会重复插数据', () => {
    seedDefaults();
    const n = getDb().prepare('SELECT COUNT(*) AS c FROM app_config').get() as { c: number };
    expect(n.c).toBe(APP_CONFIG_DEFS.length);
    expect(runMigrations()).toEqual([]);
  });

  it('重启后可以重新初始化空库', () => {
    closeDb();
    initDb({ memory: true });
    seedDefaults();
    expect(getValue('dailyPublishLimit')).toBe('50');
  });
});

describe('配置校验（ADR-10 / §9 双重范围）', () => {
  useFreshDb();

  it('默认值已灌入，读取走 run 表', () => {
    expect(getValue('runtime.mode')).toBe('simulated');
    expect(getValue('allowRealPublish')).toBe('false');
    expect(getAll().length).toBe(APP_CONFIG_DEFS.length);
  });

  it('select 项要带回候选值，否则界面下拉是空的', () => {
    const item = getAll().find((i) => i.key === 'llm.mode')!;
    expect(item.valueType).toBe('select');
    expect(item.options).toContain('api');
  });

  it('超出 min/max 一律拒绝', () => {
    expect(() => setValue('dailyPublishLimit', '999')).toThrow(AppError);
    expect(() => setValue('similarityThreshold', '0.01')).toThrow(AppError);
    expect(() => setValue('minPublishIntervalMin', '1')).toThrow(AppError);
  });

  it('select 项只能取枚举值', () => {
    expect(() => setValue('stockProvider', 'unknown')).toThrow(AppError);
    expect(setValue('stockProvider', 'local')).toBe('local');
  });

  it('锁死项不在可改配置里（没有配置出口）', () => {
    expect(() => setValue('forceDeclaration', '原创')).toThrow(AppError);
    expect(LOCKED_CONFIG_ITEMS.map((i) => i.key)).toContain('forceDeclaration');
  });

  it('布尔项只能 true / false', () => {
    expect(() => setValue('allowRealPublish', 'yes')).toThrow(AppError);
    expect(setValue('allowRealPublish', 'true')).toBe('true');
  });
});

describe('选择器配置（§7.4）', () => {
  it('启动时校验通过（缺必填会直接启动失败）', () => {
    expect(() => validateSelectors()).not.toThrow();
  });

  it('选择器集中登记，条目非空', () => {
    const entries = selectorEntries();
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) expect(e.value.length).toBeGreaterThan(0);
  });
});
