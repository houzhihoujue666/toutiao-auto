import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 端到端冒烟 —— §10.2 SMOKE-1~7
 * 关键点：必须在任何业务模块被导入之前设定 DATA_DIR（存储路径在导入时就计算），
 * 因此这里用「顶层 await + 动态 import」替代静态 import。
 * 默认跑在独立目录 data/.smoke 下，每次清空 —— 保证可重复执行且不污染真实数据。
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const keep = process.argv.includes('--keep');
const smokeDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(repoRoot, 'data', '.smoke');

if (!keep) fs.rmSync(smokeDir, { recursive: true, force: true });
fs.mkdirSync(smokeDir, { recursive: true });
process.env.DATA_DIR = smokeDir;

const { initDb, closeDb } = await import('../infra/db');
const { seedDefaults } = await import('../infra/db/repo/config');
const { ensureAccount, DEFAULT_ACCOUNT_NAME } = await import('../infra/db/repo/account');
const { AccountRuntime } = await import('../orchestrator/registry');
const { setConfig, KEYS, getMode } = await import('../config/runtime');
const { defaultCollectOptions } = await import('../modules/crawl/service');
const taskRepo = await import('../infra/db/repo/task');
const rewriteRepo = await import('../infra/db/repo/rewrite');
const recordRepo = await import('../infra/db/repo/publish-record');
const stockRepo = await import('../infra/db/repo/stock-image');
const { validateSelectors } = await import('../config/selectors');
const { hasExif } = await import('../modules/image/dedup');
const { fromRelative } = await import('../infra/storage/paths');
const { log } = await import('../infra/logger');

async function main(): Promise<number> {
  validateSelectors();
  initDb();
  seedDefaults();
  const name = process.env.ACCOUNT_NAME || DEFAULT_ACCOUNT_NAME;
  const acc = ensureAccount(name);
  const mode = getMode();
  console.log(`\n端到端冒烟 · 运行模式 ${mode} · 账号 ${acc.name} · 数据目录 ${smokeDir}\n`);

  // CHG-0002：走账号运行时登记册 —— 与线上同一条实例化路径，顺带验证登记册在模拟模式下可用
  const runtime = new AccountRuntime();
  runtime.setActive(acc.id);
  const crawler = runtime.crawler(acc);
  // §E.7：编排层持有采集器，才能「一键开始」时自动补素材
  const pipeline = runtime.pipeline(acc);

  // SMOKE-2 采集：一次 ≥10 条；重复采集 0 新增
  const first = await crawler.collect(defaultCollectOptions());
  console.log(
    `SMOKE-2 采集：返回 ${first.items.length} / 去重 ${first.dedupedCount} / 入库 ${first.insertedCount} / 耗时 ${first.elapsedMs}ms`,
  );
  const second = await crawler.collect(defaultCollectOptions());
  console.log(
    `SMOKE-2 重复采集：返回 ${second.items.length} / 去重 ${second.dedupedCount} / 入库 ${second.insertedCount}`,
  );
  if (first.insertedCount < 10) {
    console.error('✘ 首次采集入库不足 10 条');
    return 1;
  }
  if (second.items.length !== 0) {
    console.error(`✘ 重复采集应 0 条新增，实际返回 ${second.items.length} 条`);
    return 1;
  }

  // SMOKE-3/4 一键运行：改写 → 配图 → 质检 → 自动放行（§E.7）
  if (mode === 'simulated') {
    setConfig(KEYS.allowRealPublish, 'true');
    console.log('  模拟模式：临时打开 allowRealPublish，验证「一键开始」真把内容发出去');
  }
  const run = await pipeline.runOnce(3);
  console.log(`\nSMOKE-3/4 一键运行：${run.message}`);
  console.log(
    `  受理 ${run.accepted} 条 · 补采 ${run.crawled} 条 · 建任务 ${run.created} 条 · 入队 ${run.enqueued} 条`,
  );
  if (run.created === 0) {
    console.error('✘ 一键开始没有建出任何任务');
    return 1;
  }
  if (run.enqueued === 0) {
    console.error('✘ 质检通过后没有自动放行入队（§E.7）');
    return 1;
  }
  const tasks = run.taskIds.map((id) => taskRepo.getTask(id)!).filter(Boolean);
  for (const t of tasks) {
    const cur = taskRepo.getTask(t.id)!;
    const rw = rewriteRepo.getRewriteByTask(t.id);
    console.log(
      `  任务 #${t.id} 状态=${cur.status} 相似度=${rw?.similarity?.toFixed(2) ?? '—'} 图片=${rw?.images.length ?? 0} 张`,
    );
    if (rw && rw.images.length === 0) {
      console.error(`✘ 任务 #${t.id} 没有配图`);
      return 1;
    }
  }

  // SMOKE-4 去 EXIF + 图库留证
  const someTask = tasks[0];
  if (someTask) {
    const rw = rewriteRepo.getRewriteByTask(someTask.id);
    for (const rel of rw?.images ?? []) {
      const abs = fromRelative(rel);
      if (!fs.existsSync(abs)) {
        console.error(`✘ 图片文件不存在：${rel}`);
        return 1;
      }
      const exif = await hasExif(fs.readFileSync(abs));
      console.log(`  去 EXIF 校验 ${rel} → ${exif ? '仍有 EXIF ✘' : '无 EXIF ✔'}`);
      if (exif) return 1;
    }
    const stock = stockRepo.listByTask(someTask.id);
    for (const s of stock) {
      console.log(
        `  图库留证 ${s.provider}/${s.providerId} 许可=${s.license} 来源=${s.pageUrl ?? '—'}`,
      );
      if (!s.pageUrl || !s.license) {
        console.error('✘ 图库图缺少来源页或许可');
        return 1;
      }
    }
  }

  // SMOKE-6 闸门：被放行（已入队 / 已发布）的任务，相似度必须低于 ★0.45
  const released = [
    ...taskRepo.listTasks('publishing', 100),
    ...taskRepo.listTasks('published', 100),
  ];
  console.log(`\nSMOKE-6 自动放行 ${released.length} 条`);
  for (const t of released) {
    const rw = rewriteRepo.getRewriteByTask(t.id);
    const sim = rw?.similarity ?? 1;
    console.log(
      `  任务 #${t.id} 相似度=${sim.toFixed(3)} ${sim < SIM_GATE ? '通过闸门 ✔' : '超阈值 ✘'}`,
    );
    if (sim >= SIM_GATE) {
      console.error(`✘ 相似度 ${sim.toFixed(3)} 超过闸门 ${SIM_GATE}，不应被放行`);
      return 1;
    }
  }

  // SMOKE-5 发布（§E.7：无需人工点确认，自动放行后由队列按 ★15 分钟间隔发出）
  const target =
    released.find((t) => taskRepo.getTask(t.id)!.status === 'published') ?? released[0];
  if (!target) {
    console.error('✘ 没有已放行的任务，无法验证发布');
    return 1;
  }
  const deadline = Date.now() + 60_000;
  while (
    ['reviewing', 'publishing'].includes(taskRepo.getTask(target.id)!.status) &&
    Date.now() < deadline
  ) {
    await new Promise((r) => setTimeout(r, 100));
  }
  const after = taskRepo.getTask(target.id)!;
  const rec = recordRepo.getRecordByTask(target.id);
  console.log(
    `\nSMOKE-5 发布：任务 #${target.id} 状态=${after.status} URL=${rec?.publishedUrl ?? '—'} 截图=${rec?.screenshotPath ?? '—'} 首发断言通过=${rec?.firstPublishConfirmed ? '✔' : '✘'}`,
  );
  if (after.status !== 'published' || !rec?.screenshotPath) {
    console.error('✘ 发布未成功或缺少留证');
    return 1;
  }

  console.log('\nSMOKE-7 熔断：阈值 3 次且必须人工恢复，由集成测试覆盖');
  console.log('\n全部冒烟步骤完成 ✔');
  log('info', 'smoke passed');
  closeDb();
  return 0;
}

const SIM_GATE = 0.45; // ★相似度阈值（§9）

void main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
