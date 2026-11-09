/**
 * 演示素材种子 —— 把一批本地模拟素材灌进素材池，方便离线体验整条流水线。
 *
 * 约定：
 *  - 纯本地：不联网、不开浏览器、不碰账号登录态，也不建任务 / 改状态；
 *  - 可重复执行：source_item 上有 UNIQUE(account_id, platform_item_id)，第二次跑新增 0 条；
 *  - 只写 source_item / fingerprint 两张表；配置默认值由 seedDefaults() 幂等补齐；
 *  - DATA_DIR 在存储模块导入时就确定，要写到别处请用环境变量（如 DATA_DIR=... npm run seed）。
 */
import { initDb, closeDb } from '../infra/db';
import { seedDefaults } from '../infra/db/repo/config';
import { DEFAULT_ACCOUNT_NAME, ensureAccount } from '../infra/db/repo/account';
import { getSourceItem, insertMany } from '../infra/db/repo/source-item';
import * as fingerprintRepo from '../infra/db/repo/fingerprint';
import { simulatedBatch } from '../modules/crawl/simulated';
import { simhash } from '@shared/simhash';

function main(): void {
  initDb();
  seedDefaults();

  const name = process.env.ACCOUNT_NAME || DEFAULT_ACCOUNT_NAME;
  const acc = ensureAccount(name);
  const { items } = simulatedBatch();

  // 与真实采集同一条入库路径：批量写入后补指纹索引，后续去重才认得这批内容
  const ids = insertMany(acc.id, items, (text) => simhash(text));
  for (const id of ids) {
    const row = getSourceItem(id);
    if (row) fingerprintRepo.insert(row.simhash, 'source_item', id);
  }

  console.log(`演示素材：账号「${acc.name}」，本批 ${items.length} 条，实际新增 ${ids.length} 条`);
  console.log('重复执行不会新增（按平台 ID 去重）；想换一批内容请改 simulated.ts 的批次。');
  console.log(
    '提示：设置页把运行模式设为 simulated，即可离线跑通采集 → 改写 → 配图 → 质检 → 发布。',
  );
  closeDb();
}

try {
  main();
} catch (e) {
  console.error('灌入演示素材失败：', e);
  closeDb();
  process.exit(1);
}
