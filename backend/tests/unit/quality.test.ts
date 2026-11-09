import { describe, it, expect } from 'vitest';
import { QualityService } from '../../src/modules/quality/service';
import { checkSimilarity } from '../../src/modules/quality/similarityGate';
import { setWords, findSensitive } from '../../src/modules/quality/sensitive';
import { SIMILARITY_THRESHOLD, MIN_LENGTH, MAX_LENGTH } from '@shared/constants';

const ORIGINAL =
  '跑步坚持不下来的原因往往不是累，是开始太猛。前两周只要求自己换上鞋出门，哪怕走两圈也算完成，反而跑到了今天。';
const GOOD =
  '先说结论：很多人其实把重点搞反了。到头来跑不动，起步阶段就太猛了，留用房门的一步反而最关键，我后来专门留意了一下，发现身边几乎每个人都有类似的惯性。';

describe('质检四项（§6.6：只出报告，不改内容）', () => {
  const service = new QualityService();

  it('合格改写：通过，无 flags', async () => {
    const report = await service.check(ORIGINAL, GOOD);
    expect(report.passed).toBe(true);
    expect(report.flags).toEqual([]);
    expect(report.similarity).toBeLessThan(SIMILARITY_THRESHOLD);
  });

  it('原文照抄：相似度 1.0，判不合格且打出 SIMILARITY 旗', async () => {
    const report = await service.check(ORIGINAL, ORIGINAL);
    expect(report.passed).toBe(false);
    expect(report.similarityOk).toBe(false);
    expect(report.flags).toContain('SIMILARITY');
  });

  it('过短 / 过长都判 LENGTH', async () => {
    expect((await service.check(ORIGINAL, '太短了')).flags).toContain('LENGTH');
    const tooLong = '长'.repeat(MAX_LENGTH + 10);
    expect((await service.check(ORIGINAL, tooLong)).flags).toContain('LENGTH');
  });

  it('长度边界含端点（★50 ~ ★2000）', async () => {
    const exactly = '字'.repeat(MIN_LENGTH);
    const report = await service.check(ORIGINAL, exactly, { threshold: 0.9 });
    expect(report.lengthOk).toBe(true);
  });

  it('命中敏感词 → 硬闸门拦下', async () => {
    setWords(['刷单']);
    const report = await service.check(ORIGINAL, `${GOOD}顺便提一句刷单也能赚钱`);
    expect(report.noSensitiveWord).toBe(false);
    expect(report.passed).toBe(false);
    expect(report.flags.some((f) => f.startsWith('SENSITIVE'))).toBe(true);
    setWords([]);
  });

  it('findSensitive 支持自定义词库', () => {
    setWords(['私域引流']);
    expect(findSensitive('来做私域引流吧')).toEqual(['私域引流']);
    setWords([]);
    expect(findSensitive('完全正常的句子')).toEqual([]);
  });
});

describe('相似度闸门 ★0.45', () => {
  it('阈值取自 §9 定案值', () => {
    expect(checkSimilarity(ORIGINAL, GOOD).threshold).toBe(SIMILARITY_THRESHOLD);
  });

  it('超阈值 ok=false，且能读到真实相似度', () => {
    const r = checkSimilarity(ORIGINAL, ORIGINAL);
    expect(r.ok).toBe(false);
    expect(r.similarity).toBe(1);
  });
});
