import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * 文件布局 —— §5.3
 * data/app.db · data/sessions/<账号>/ · data/media/<任务ID>/{src,out,stock} · data/shots/<任务ID>/
 * 红线：数据库只存相对路径，根目录由配置注入，便于整体搬迁。
 */

export function repoRoot(): string {
  // backend/src/infra/storage → 上四级为仓库根
  return path.resolve(here, '..', '..', '..', '..');
}

export function dataRoot(): string {
  const root = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(repoRoot(), 'data');
  ensureDir(root);
  return root;
}

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function dbPath(): string {
  return path.join(dataRoot(), 'app.db');
}

export function sessionsDir(): string {
  return ensureDir(path.join(dataRoot(), 'sessions'));
}

/** 每账号独立浏览器目录（ADR-4：禁止指向系统 Chrome 默认目录） */
export function accountSessionDir(accountName: string): string {
  return ensureDir(path.join(sessionsDir(), sanitize(accountName)));
}

export function llmSessionDir(): string {
  return ensureDir(path.join(sessionsDir(), 'llm-deepseek'));
}

export function storageStatePath(accountName: string): string {
  return path.join(accountSessionDir(accountName), 'storageState.json');
}

export function taskMediaDir(taskId: number): string {
  return ensureDir(path.join(dataRoot(), 'media', String(taskId)));
}

export function taskSubDir(taskId: number, sub: 'src' | 'out' | 'stock'): string {
  return ensureDir(path.join(taskMediaDir(taskId), sub));
}

export function taskShotsDir(taskId: number): string {
  return ensureDir(path.join(dataRoot(), 'shots', String(taskId)));
}

/** 相对路径（写库用）：统一 posix 分隔，便于跨平台搬运 */
export function toRelative(absPath: string): string {
  return path.relative(dataRoot(), absPath).split(path.sep).join('/');
}

export function fromRelative(relPath: string): string {
  return path.join(dataRoot(), ...relPath.split('/'));
}

/** 截图文件名：publish-success-20260918T1015.png */
export function shotFileName(prefix: string, at: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}T${p(at.getHours())}${p(at.getMinutes())}`;
  return `${prefix}-${stamp}.png`;
}

function sanitize(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'default';
}
