import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 敏感词检查 —— §6.6：本地词库多模式匹配，双保险（提示词已要求不要敏感词，本地再查一遍）
 * 词库来源：开源通用词库 + 自定义追加（§11.2 待拍板 4）
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const WORD_FILE = path.resolve(here, '..', '..', 'config', 'sensitive-words.txt');

let cache: string[] | null = null;

export function loadWords(): string[] {
  if (cache) return cache;
  let words: string[] = [];
  try {
    const raw = fs.readFileSync(WORD_FILE, 'utf8');
    words = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
  } catch {
    words = [];
  }
  cache = words;
  return words;
}

export function setWords(list: string[]): void {
  cache = list;
}

export function findSensitive(text: string): string[] {
  const words = loadWords();
  const hits: string[] = [];
  for (const w of words) {
    if (!w) continue;
    if (text.includes(w)) hits.push(w);
  }
  return hits;
}
