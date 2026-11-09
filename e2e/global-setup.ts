import fs from 'node:fs';
import path from 'node:path';
import { E2E_DATA_DIR } from './playwright.config';

/**
 * 本轮用的是全新数据目录（见 playwright.config），所以这里**只做顺手清理**：
 * 把往轮留下的 .e2e-* 目录尽力删掉，删不掉也不影响本轮（锁着的目录下次再删）。
 */
export default function globalSetup(): void {
  const root = path.dirname(E2E_DATA_DIR);
  const current = path.basename(E2E_DATA_DIR);
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === current || !name.startsWith('.e2e')) continue;
    try {
      fs.rmSync(path.join(root, name), { recursive: true, force: true });
    } catch {
      // 有进程还占着（浏览器/SQLite）就跳过，绝不阻塞测试
    }
  }
  fs.mkdirSync(E2E_DATA_DIR, { recursive: true });
}
