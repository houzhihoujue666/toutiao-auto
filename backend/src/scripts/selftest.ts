import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import { selectorEntries, validateSelectors } from '../config/selectors';
import { getMode } from '../config/runtime';
import { initDb } from '../infra/db';
import { seedDefaults } from '../infra/db/repo/config';
import { dataRoot } from '../infra/storage/paths';
import { log } from '../infra/logger';

/**
 * 选择器自检 —— §10.2：逐个 waitForSelector（5 秒），输出命中清单 + 失败截图，有失效则退出码非 0
 * 平台改版后先跑它，能定位是哪个元素找不到了。
 */

/** 这些元素要等动作后才出现，超时不算失效，只作提示 */
const TRANSIENT = new Set([
  'successFlag',
  'stopGenerating',
  'regenerate',
  'imageConfirm',
  'topicSuggestion',
  'imageInput',
  'declarationEntry',
  'declarationAi',
  'loggedInFlag',
]);

interface Result {
  group: string;
  key: string;
  hit: boolean;
  ms: number;
  transient: boolean;
}

async function checkOnPage(
  page: Page,
  url: string,
  selector: string,
): Promise<{ hit: boolean; ms: number }> {
  const started = Date.now();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForSelector(selector, { timeout: 5000, state: 'attached' });
    return { hit: true, ms: Date.now() - started };
  } catch {
    return { hit: false, ms: Date.now() - started };
  }
}

async function main(): Promise<number> {
  initDb();
  seedDefaults();
  validateSelectors();

  const entries = selectorEntries();
  const mode = getMode();
  console.log(`\n选择器自检 · 共 ${entries.length} 项 · 运行模式 ${mode}\n`);

  if (mode === 'simulated') {
    // 模拟模式不碰真实站点：只做静态结构与格式校验
    let bad = 0;
    for (const e of entries) {
      const looksOk = e.value.trim().length > 0;
      if (!looksOk) bad++;
      console.log(`  ${looksOk ? '✔' : '✘'}  ${e.group}.${e.key}`);
    }
    console.log(
      `\n模拟模式只做静态校验（不访问真实站点）。要逐个元素实测请先切到 real 模式并扫码登录。`,
    );
    return bad > 0 ? 1 : 0;
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const results: Result[] = [];
  const shotDir = path.join(dataRoot(), 'shots', 'selftest');
  fs.mkdirSync(shotDir, { recursive: true });

  const urls: Record<string, string> = {
    auth: 'https://mp.toutiao.com/',
    crawl: 'https://www.toutiao.com/',
    publish: 'https://mp.toutiao.com/profile_v4/weitoutiao/publish',
    deepseek: 'https://chat.deepseek.com/',
  };

  for (const e of entries) {
    const url = urls[e.group] ?? 'https://www.toutiao.com/';
    const r = await checkOnPage(page, url, e.value);
    const transient = TRANSIENT.has(e.key);
    results.push({ ...e, ...r, transient });
    if (!r.hit && !transient) {
      const file = path.join(shotDir, `${e.group}-${e.key}.png`);
      await page.screenshot({ path: file, fullPage: false }).catch(() => undefined);
      console.log(`  ✘  ${e.group}.${e.key} 超时 5000ms → 截图 ${file}`);
    } else {
      console.log(
        `  ${r.hit ? '✔' : '·'}  ${e.group}.${e.key} ${r.ms}ms${transient ? '（动作后才出现，不计失效）' : ''}`,
      );
    }
  }

  await browser.close();

  const hardMiss = results.filter((r) => !r.hit && !r.transient);
  console.log(
    `\n命中 ${results.filter((r) => r.hit).length}/${results.length} · 硬失效 ${hardMiss.length}`,
  );
  if (hardMiss.length) {
    console.log(`\n多半是平台改版。请只改 config/selectors/，不要在业务代码里补选择器。`);
    log('error', `selftest failed: ${hardMiss.map((r) => `${r.group}.${r.key}`).join(', ')}`);
    return 1;
  }
  return 0;
}

void main().then((code) => process.exit(code));
