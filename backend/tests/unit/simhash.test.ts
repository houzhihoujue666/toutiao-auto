import { describe, it, expect } from 'vitest';
import {
  simhash,
  hamming,
  simhashSimilarity,
  editSimilarity,
  textSimilarity,
  tokenize,
} from '@shared/simhash';
import { SIMILARITY_THRESHOLD } from '@shared/constants';

const ORIGINAL =
  '早上七点的菜市场已经很热闹了。卖菜的大姐说，今年本地大白菜比去年同期便宜了三成，来买的人反而没变多。她说了一句挺有意思的话：便宜的时候大家反而不着急。';
const REWRITTEN =
  '先说结论：很多人其实把重点搞反了。到头来销量不好起步阶段就定了，说到底是由于价格一降，顾客反倒慢下来，我后来专门留意了一下，发现身边几乎每个人都有类似的惯性。如果你也遇到过类似的情况，应该马上就能对上号。';

describe('SimHash 指纹', () => {
  it('同一文本指纹稳定且为 16 位十六进制', () => {
    const a = simhash(ORIGINAL);
    expect(a).toBe(simhash(ORIGINAL));
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it('相同文本海明距离为 0，不同文本大于 0', () => {
    expect(hamming(simhash(ORIGINAL), simhash(ORIGINAL))).toBe(0);
    expect(hamming(simhash(ORIGINAL), simhash(REWRITTEN))).toBeGreaterThan(0);
  });

  it('tokenize 中文按 bigram 切分、英文按词切分', () => {
    const tokens = tokenize('Hello world，你好世界');
    expect(tokens).toContain('hello');
    expect(tokens).toContain('world');
    expect(tokens).toContain('你好');
    expect(tokens).toContain('好世');
  });

  it('空文本不会抛错', () => {
    expect(() => simhash('')).not.toThrow();
    expect(tokenize('')).toEqual([]);
  });
});

describe('相似度（★阈值 0.45）', () => {
  it('原文照抄 → 相似度 1.0', () => {
    expect(textSimilarity(ORIGINAL, ORIGINAL)).toBe(1);
    expect(editSimilarity(ORIGINAL, ORIGINAL)).toBe(1);
  });

  it('改几个字 → 相似度仍在闸门之上，会被拦截', () => {
    const patched = ORIGINAL.replace('菜市场', '农贸市场').replace('便宜', '廉价');
    expect(textSimilarity(ORIGINAL, patched)).toBeGreaterThan(SIMILARITY_THRESHOLD);
  });

  it('真正换说法重写 → 相似度低于闸门', () => {
    expect(textSimilarity(ORIGINAL, REWRITTEN)).toBeLessThan(SIMILARITY_THRESHOLD);
  });

  it('两篇无关文本 → SimHash 相似度接近 0', () => {
    const other =
      '洗衣机有异味，八成不是衣服的问题，是胶圈夹层里积的絮屑，用旧牙刷加中性清洁剂刷一圈比买清洗剂管用。';
    expect(simhashSimilarity(simhash(ORIGINAL), simhash(other))).toBeLessThan(0.5);
  });

  it('相似度归一化落在 [0,1]', () => {
    const s = textSimilarity(ORIGINAL, REWRITTEN);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });
});
