import * as accountRepo from '../infra/db/repo/account';
import { normalizeTime } from '../infra/db/repo/account';
import { getNumber } from '../config/runtime';
import { KEYS } from '../config/runtime';
import { MIN_PUBLISH_INTERVAL_MIN } from '@shared/constants';
import { AppError } from '@shared/errors';
import type { Account } from '@shared/types';

/**
 * 限速 —— §8.2：日上限 ★50 条、最小间隔 ★15 分钟；达上限拒绝入队并告警，次日 0 点重置
 */
export interface RateDecision {
  ok: boolean;
  reason?: 'daily' | 'interval';
  waitMs: number;
  remaining: number;
}

/**
 * 上次发布时间的毫秒值。
 * 历史数据里可能存的是 SQLite 的 "YYYY-MM-DD HH:MM:SS"（UTC 无时区），
 * 直接 Date.parse 会被当成本地时间 → 东八区多算 8 小时 → 间隔形同虚设。
 * 统一走 normalizeTime 转成带 Z 的 ISO 再解析。
 */
export function lastPublishMs(account: Account): number {
  const iso = normalizeTime(account.lastPublishAt);
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

export function intervalMinutes(): number {
  const v = getNumber(KEYS.minPublishIntervalMin);
  return v > 0 ? v : MIN_PUBLISH_INTERVAL_MIN;
}

export function dailyLimit(): number {
  const v = getNumber(KEYS.dailyPublishLimit);
  return v > 0 ? v : 50;
}

export function evaluate(account: Account): RateDecision {
  const limit = Math.min(dailyLimit(), account.dailyPublishLimit || dailyLimit());
  const used = accountRepo.refreshQuota(account.id).usedToday;
  const remaining = Math.max(0, limit - used);
  if (remaining <= 0) {
    return { ok: false, reason: 'daily', waitMs: msUntilTomorrow(), remaining: 0 };
  }
  const interval = intervalMinutes();
  const last = lastPublishMs(account);
  if (last <= 0) {
    return { ok: true, waitMs: 0, remaining };
  }
  const elapsed = Date.now() - last;
  const need = interval * 60_000;
  if (elapsed < need) {
    return { ok: false, reason: 'interval', waitMs: need - elapsed, remaining };
  }
  return { ok: true, waitMs: 0, remaining };
}

export function assertCanPublish(account: Account): void {
  const d = evaluate(account);
  if (!d.ok && d.reason === 'daily') {
    throw new AppError(
      'RATE_LIMITED',
      `今日发布已达上限 ${dailyLimit()} 条`,
      '次日 0 点自动重置；可在设置页调整上限',
    );
  }
  if (!d.ok && d.reason === 'interval') {
    throw new AppError(
      'RATE_LIMITED',
      `距上次发布不足 ${intervalMinutes()} 分钟，已延后`,
      '系统会自动排队等待；不建议把间隔调小',
    );
  }
}

export function msUntilTomorrow(): number {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
  return next.getTime() - now.getTime();
}
