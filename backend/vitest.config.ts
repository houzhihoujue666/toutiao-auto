import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared/src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    pool: 'forks',
    // 测试写文件统一落在 data/.test，不污染真实数据目录
    env: {
      DATA_DIR: fileURLToPath(new URL('../data/.test', import.meta.url)),
    },
  },
});
