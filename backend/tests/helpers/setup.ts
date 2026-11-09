import { beforeEach, afterEach } from 'vitest';
import { initDb, closeDb } from '../../src/infra/db';
import { seedDefaults } from '../../src/infra/db/repo/config';
import { setConfig, KEYS } from '../../src/config/runtime';
import { resetSimulatedSource } from '../../src/modules/crawl/simulated';
import { resetProviderCooldown } from '../../src/infra/stock/factory';
import { publishScheduler } from '../../src/orchestrator/publishScheduler';

/**
 * 每个用例一套全新的内存库 + 默认值；
 * 并强制走「离线改写器 + 离线图源」，保证测试不依赖外网、可重复执行。
 *
 * CHG-0002：发布队列改为每个 Pipeline 实例私有（不再有全局单例），所以这里不再清队列；
 * 但跨账号并发调度器仍是进程级单例，必须在用例间复位，否则上一个用例没让出的名额会堵住下一个用例。
 */
export function useFreshDb(): void {
  beforeEach(() => {
    closeDb();
    initDb({ memory: true });
    seedDefaults();
    setConfig(KEYS.runtimeMode, 'simulated');
    setConfig(KEYS.llmMode, 'simulated');
    setConfig(KEYS.stockProvider, 'local');
    resetSimulatedSource();
    resetProviderCooldown();
    publishScheduler.reset();
  });

  afterEach(async () => {
    // 先让上一个用例里「还在飞的异步推进」落定：v4.1 起质检通过会自动发布（§E.7），
    // 不 settle 的话这些异步任务会写进下一个用例的新库，造成跨用例干扰。
    await new Promise((r) => setTimeout(r, 300));
    publishScheduler.reset();
    closeDb();
  });
}

/** 等待某个条件成立（发布是异步推进的，需要轮询而不是死等） */
export async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 20_000,
  stepMs = 50,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  throw new Error(`waitUntil 超时：条件在 ${timeoutMs}ms 内未成立`);
}
