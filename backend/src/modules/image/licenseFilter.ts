import { LICENSE_WHITELIST } from '@shared/constants';
import type { StockHit } from '@shared/types';

/**
 * 许可白名单 —— §6.5：只要 CC0 和 Public Domain，写死，不给配置出口
 * NC（非商业）冲突于赚流量；ND（禁止演绎）冲突于重编码；SA（传染）；BY（程序不自动署名）
 */

export function isAllowedLicense(license: string | null | undefined): boolean {
  if (!license) return false;
  const norm = license.toLowerCase().replace(/[\s-]/g, '');
  return LICENSE_WHITELIST.some((l) => {
    const target = l.toLowerCase().replace(/[\s-]/g, '');
    return norm.includes(target);
  });
}

/** 命不中白名单的图，当作不存在 */
export function filterByLicense(hits: StockHit[]): StockHit[] {
  return hits.filter((h) => isAllowedLicense(h.license));
}
