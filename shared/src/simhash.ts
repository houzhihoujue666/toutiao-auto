/**
 * 指纹与相似度算法（纯函数，便于单元测试）
 * §6.6 相似度 = SimHash 海明距离归一化 + 编辑距离复核，阈值 ★0.45
 */

/** 中文按字 bigram 切分，英文/数字按词切分 */
export function tokenize(text: string): string[] {
  const cleaned = text
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, ' ')
    .trim();
  if (!cleaned) return [];
  const tokens: string[] = [];
  const latinWords = cleaned.match(/[a-z0-9]+/g) ?? [];
  for (const w of latinWords) tokens.push(w);
  const cjk = cleaned.replace(/[a-z0-9]+/g, ' ').replace(/\s+/g, '');
  for (let i = 0; i < cjk.length - 1; i++) tokens.push(cjk.slice(i, i + 2));
  if (cjk.length === 1) tokens.push(cjk);
  return tokens;
}

function hash64(token: string): bigint {
  // FNV-1a 64bit
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < token.length; i++) {
    h = (h ^ BigInt(token.charCodeAt(i))) & mask;
    h = (h * prime) & mask;
  }
  return h;
}

/** 64 位 SimHash，返回 16 位十六进制字符串 */
export function simhash(text: string): string {
  const tokens = tokenize(text);
  const v = new Array<number>(64).fill(0);
  for (const t of tokens) {
    const h = hash64(t);
    for (let i = 0; i < 64; i++) {
      // 逐位取 BigInt 的第 i 位
      v[i] += (h >> BigInt(i)) & 1n ? 1 : -1;
    }
  }
  let out = 0n;
  for (let i = 0; i < 64; i++) {
    if (v[i] > 0) out |= 1n << BigInt(i);
  }
  return out.toString(16).padStart(16, '0');
}

export function hamming(a: string, b: string): number {
  if (a.length !== b.length) {
    // 长度不一致时按前缀对齐（理论上不会出现）
    const len = Math.min(a.length, b.length);
    a = a.slice(0, len);
    b = b.slice(0, len);
  }
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    const x = parseInt(a[i] ?? '0', 16);
    const y = parseInt(b[i] ?? '0', 16);
    let diff = x ^ y;
    while (diff) {
      d += diff & 1;
      diff >>= 1;
    }
  }
  return d;
}

/**
 * SimHash 相似度归一化
 * 64 位 SimHash 下，两篇完全无关的文本期望海明距离 = 32（位翻转概率 1/2），
 * 因此以 32 为「完全无关」基准归一化：距离 0 → 1.0，距离 ≥32 → 0。
 */
export function simhashSimilarity(a: string, b: string): number {
  const d = hamming(a, b);
  return Math.max(0, Math.min(1, 1 - d / 32));
}

/** 编辑距离（滚动数组，O(n·m)） */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array<number>(b.length + 1);
  let cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    const tmp = prev;
    prev = cur;
    cur = tmp;
  }
  return prev[b.length] ?? Math.max(a.length, b.length);
}

/** 编辑距离归一化相似度（复核用） */
export function editSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/** 综合相似度：SimHash 归一化 + 编辑距离复核，各占一半 */
export function textSimilarity(original: string, rewritten: string): number {
  const a = simhashSimilarity(simhash(original), simhash(rewritten));
  const b = editSimilarity(original, rewritten);
  const s = 0.5 * a + 0.5 * b;
  return Math.max(0, Math.min(1, Math.round(s * 10000) / 10000));
}
