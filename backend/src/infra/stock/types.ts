import type { StockProvider, StockProviderId } from '@shared/types';

export type { StockProvider, StockProviderId };

export const STOCK_TIMEOUT_MS = 8000;

export async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(STOCK_TIMEOUT_MS) });
}
