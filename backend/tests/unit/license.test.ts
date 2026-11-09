import { describe, it, expect } from 'vitest';
import { isAllowedLicense, filterByLicense } from '../../src/modules/image/licenseFilter';
import { LICENSE_WHITELIST } from '@shared/constants';
import type { StockHit } from '@shared/types';

function hit(license: string): StockHit {
  return {
    url: 'local://demo/0',
    provider: 'local',
    providerId: 'demo-0',
    pageUrl: 'local://demo/0',
    license,
  };
}

describe('图库许可白名单（§6.5 / §8.5 锁定）', () => {
  it('白名单写死为 CC0 与 Public Domain', () => {
    expect([...LICENSE_WHITELIST]).toEqual(['CC0', 'Public Domain']);
  });

  it('允许 CC0 与公共领域', () => {
    expect(isAllowedLicense('CC0')).toBe(true);
    expect(isAllowedLicense('CC0 1.0')).toBe(true);
    expect(isAllowedLicense('Public Domain')).toBe(true);
    expect(isAllowedLicense('public domain mark')).toBe(true);
  });

  it('BY / NC / ND / SA 一律不用（赚流量冲突 + 署名不可自动 + 传染）', () => {
    expect(isAllowedLicense('CC BY 4.0')).toBe(false);
    expect(isAllowedLicense('CC BY-NC 4.0')).toBe(false);
    expect(isAllowedLicense('CC BY-SA 3.0')).toBe(false);
    expect(isAllowedLicense('CC BY-ND 4.0')).toBe(false);
  });

  it('没有许可信息的图当作不存在', () => {
    expect(isAllowedLicense(null)).toBe(false);
    expect(isAllowedLicense('')).toBe(false);
  });

  it('过滤后只剩合规图', () => {
    const hits = [hit('CC0'), hit('CC BY-NC 4.0'), hit('Public Domain'), hit('CC BY-SA 3.0')];
    const kept = filterByLicense(hits);
    expect(kept.map((h) => h.license)).toEqual(['CC0', 'Public Domain']);
  });
});
