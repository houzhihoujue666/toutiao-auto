import { DEFAULT_STOCK_PROVIDER } from '@shared/constants';
import { log } from '../logger';
import type { StockProvider, StockProviderId } from '@shared/types';
import { CommonsProvider } from './commons';
import { PexelsProvider } from './pexels';
import { LocalProvider } from './local';

/** 图源工厂：commons 免 Key（默认）；pexels 需 Key；local 离线兜底 */
export function createStockProvider(id?: string, apiKey?: string): StockProvider {
  switch (id) {
    case 'pexels':
      if (!apiKey) {
        log('warn', 'pexels 需要 Key 但未配置，回退到免 Key 图源', { from: 'pexels' });
        break;
      }
      return new PexelsProvider(apiKey);
    case 'local':
      return new LocalProvider();
    case 'commons':
    default:
      return new CommonsProvider();
  }
  return new CommonsProvider();
}

/** 降级链：主图源失败 → local（离线免 Key）→ 抛错由上层降级为「只用洗过的原图」 */
export function fallbackProvider(id?: string): StockProvider {
  void id;
  return new LocalProvider();
}

/**
 * 图源失败冷却（实现参数）：某图源连续失败时，冷却期内不再重试，
 * 避免每个任务都干等一次网络超时（本机 commons 不可达时尤其明显）。
 */
const COOLDOWN_MS = 10 * 60_000;
const downUntil = new Map<string, number>();

export function isProviderCoolingDown(id: string): boolean {
  const until = downUntil.get(id);
  if (!until) return false;
  if (Date.now() >= until) {
    downUntil.delete(id);
    return false;
  }
  return true;
}

export function markProviderDown(id: string): void {
  downUntil.set(id, Date.now() + COOLDOWN_MS);
  log('warn', `图源 ${id} 进入冷却 ${COOLDOWN_MS / 1000}s`, { provider: id });
}

export function resetProviderCooldown(): void {
  downUntil.clear();
}

export function defaultProviderId(): StockProviderId {
  return DEFAULT_STOCK_PROVIDER as StockProviderId;
}
