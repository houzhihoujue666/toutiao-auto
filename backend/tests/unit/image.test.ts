import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { dedupProcess, hasExif } from '../../src/modules/image/dedup';
import { extractKeywords } from '../../src/modules/image/stock';

async function sourceWithExif(): Promise<Buffer> {
  return sharp({ create: { width: 120, height: 90, channels: 3, background: '#88aa33' } })
    .jpeg()
    .withMetadata({ exif: { IFD0: { Copyright: 'demo photographer', Make: 'DemoCam' } } })
    .toBuffer();
}

describe('洗原图（ADR-8）', () => {
  it('源图有 EXIF → 洗完后彻底没有 EXIF', async () => {
    const src = await sourceWithExif();
    expect(await hasExif(src)).toBe(true);

    const out = await dedupProcess(src);
    expect(await hasExif(out.buffer)).toBe(false);
  });

  it('输出重编码为 webp', async () => {
    const src = await sourceWithExif();
    const meta = await sharp((await dedupProcess(src)).buffer).metadata();
    expect(meta.format).toBe('webp');
  });

  it('轻旋转不会把图弄坏：尺寸仍然有效', async () => {
    const src = await sourceWithExif();
    const out = await dedupProcess(src);
    expect(out.width).toBeGreaterThan(0);
    expect(out.height).toBeGreaterThan(0);
  });
});

describe('配图关键词（§6.5 要点 1：取自改写后正文）', () => {
  it('能抽出高频中文词并丢掉停用词', () => {
    const kws = extractKeywords(
      '装修最容易后悔的地方不是风格，是插座。住进去半年才知道哪里该留、留几个。插座插座插座，装修装修。',
      2,
    );
    expect(kws.length).toBe(2);
    expect(kws).toContain('插座');
  });

  it('正文没有可用词时返回空数组而不是崩', () => {
    expect(extractKeywords('')).toEqual([]);
  });
});
