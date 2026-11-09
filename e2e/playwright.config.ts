import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

/**
 * 浏览器端端到端：真起后端 + 前端，用真实 UI 跑一遍
 * 采集 → 生成任务 → 复核 → 通过并发布
 *
 * 隔离：后端跑在 data/.e2e-<runId> 下（绝对路径，避免 npm workspace 改变 cwd）。
 * 每轮都用**全新**目录，所以不依赖「删除上一轮数据」这一步能成功 —— 否则上一轮发布过，
 * 这一轮会撞 ★15 分钟最小间隔（设计行为，不是 bug）。旧目录由 globalSetup 顺手清理。
 */
// 配置文件已搬进 e2e/，Playwright 的 testDir 与相对路径都以**配置文件所在目录**为基准，
// 所以凡是"仓库根"的东西都要显式算出来，别再写相对路径
const REPO_ROOT = path.resolve(import.meta.dirname, '..');

const RUN_ID = process.env.E2E_RUN_ID ?? String(Date.now());
export const E2E_DATA_DIR = path.resolve(REPO_ROOT, `data/.e2e-${RUN_ID}`);

/**
 * 端到端用**独立端口**（后端 8797 / 前端 5273），和你平时开发用的 8787/5173 完全隔离：
 * 否则只要开发实例开着，Playwright 就会复用它（reuseExistingServer），
 * 于是「真模式 + 已有数据」会把测试跑成一团乱麻。
 */
const E2E_BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT ?? 8797);
const E2E_WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5273);
const E2E_BACKEND_ORIGIN = `http://127.0.0.1:${E2E_BACKEND_PORT}`;
const E2E_BASE_URL = `http://127.0.0.1:${E2E_WEB_PORT}`;

export default defineConfig({
  testDir: '.',
  globalSetup: './global-setup.ts',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['line']],
  use: {
    baseURL: E2E_BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run start --workspace @tou/backend',
      // cwd 默认是配置文件所在目录（e2e/），这里必须指回仓库根，否则 workspace 命令跑不起来
      cwd: REPO_ROOT,
      url: `${E2E_BACKEND_ORIGIN}/api/health`,
      // 端口专属，不需要也不应该复用别人起的服务
      reuseExistingServer: false,
      timeout: 60_000,
      env: { DATA_DIR: E2E_DATA_DIR, PORT: String(E2E_BACKEND_PORT) },
    },
    {
      command: 'npm run dev:frontend',
      cwd: REPO_ROOT,
      url: E2E_BASE_URL,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { BACKEND_ORIGIN: E2E_BACKEND_ORIGIN, WEB_PORT: String(E2E_WEB_PORT) },
    },
  ],
});
