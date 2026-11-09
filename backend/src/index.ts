import { createServer, createDefaultDeps } from './api';
import { validateSelectors } from './config/selectors';
import { getNumber, KEYS } from './config/runtime';
import { initDb, closeDb } from './infra/db';
import { seedDefaults } from './infra/db/repo/config';
import { ensureAccount, DEFAULT_ACCOUNT_NAME } from './infra/db/repo/account';
import { log } from './infra/logger';
import { releaseAll, setIdleReleaseMinutes } from './infra/playwright/session';
import { DEFAULT_SERVER_PORT, SERVER_HOST, IDLE_BROWSER_RELEASE_MIN } from '@shared/constants';

/** 启动自检：选择器缺必填项直接启动失败（§7.4） */
async function main(): Promise<void> {
  try {
    process.loadEnvFile('.env');
  } catch {
    // 没有 .env 就用默认值（零配置起步）
  }

  validateSelectors();

  initDb();
  seedDefaults();

  // CHG-0002：确保默认账号存在（老库零迁移），具体由 AccountRuntime 按账号惰性取实例
  const name = process.env.ACCOUNT_NAME || DEFAULT_ACCOUNT_NAME;
  const acc = ensureAccount(name);
  log('info', `account ready: ${acc.name}`, { status: acc.status });

  const deps = createDefaultDeps();
  // 逐个账号捞各自卡在 publishing 的任务（§4.3）
  const recovered = deps.runtime.recoverAll();
  if (recovered) log('warn', `recovered ${recovered} stuck publishing tasks`);

  const idle = getNumber(KEYS.idleBrowserReleaseMin) || IDLE_BROWSER_RELEASE_MIN;
  setIdleReleaseMinutes(idle);

  const app = await createServer(deps);
  const port = Number(process.env.PORT ?? DEFAULT_SERVER_PORT);
  await app.listen({ host: SERVER_HOST, port });
  log('info', `server listening on http://${SERVER_HOST}:${port}（只绑本机，§8.4）`);

  // 每个账号一条流水线、一个 tick；跨账号并发由 publishScheduler 收口（ADR-0015）
  deps.runtime.startAll();
  deps.runtime.emitAll();

  const shutdown = async (signal: string): Promise<void> => {
    log('info', `shutdown on ${signal}`);
    deps.runtime.stopAll();
    await releaseAll('shutdown');
    await app.close();
    closeDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('启动失败：', e);
  process.exit(1);
});
