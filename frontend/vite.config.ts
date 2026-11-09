import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const BACKEND = process.env.BACKEND_ORIGIN ?? 'http://127.0.0.1:8787';
const WEB_PORT = Number(process.env.WEB_PORT ?? 5173);

/**
 * 交付形态：浏览器打开 http://127.0.0.1:5173
 * 后端只绑 127.0.0.1:8787（§8.4），这里做同源代理，页面不用管跨域。
 * WEB_PORT / BACKEND_ORIGIN 可覆盖：端到端测试用别的一套端口，避免和你正在跑的实例互相污染。
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared/src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: WEB_PORT,
    strictPort: true,
    proxy: {
      '/api': { target: BACKEND, changeOrigin: true },
      '/ws': { target: BACKEND, ws: true, changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
  },
});
