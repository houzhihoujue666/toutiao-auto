import { crawlSelectors } from '../../config/selectors';
import { getMode, getString, KEYS } from '../../config/runtime';
import { log } from '../../infra/logger';
import { humanScroll } from '../../infra/playwright/humanize';
import { toutiaoContext } from '../../infra/playwright/session';
import { insertMany, allSimhashes, getSourceItem } from '../../infra/db/repo/source-item';
import { getAccountByName, DEFAULT_ACCOUNT_NAME } from '../../infra/db/repo/account';
import * as fingerprintRepo from '../../infra/db/repo/fingerprint';
import { hamming, simhash } from '@shared/simhash';
import {
  CRAWL_TIME_WINDOW_HOURS,
  HEAT_WEIGHTS,
  CRAWL_DEFAULT_LIMIT,
  MIN_SOURCE_CONTENT_LEN,
} from '@shared/constants';
import { AppError } from '@shared/errors';
import type { CollectedItem, CollectOptions, CollectResult, Crawler } from '@shared/types';
import type { Page } from 'playwright';
import { attachFeedListener } from './listener';
import { heatOf } from './normalize';
import { simulatedBatch } from './simulated';
import { matchBlockedTopic, parseBlockedTopics } from './topicFilter';

/** 指纹去重阈值（实现参数，非 §9 定案值）：海明距离 ≤3 视为同一内容 */
export const DEDUP_HAMMING_DIST = 3;

/** 实现参数：打开多少个热榜话题页 */
const TRENDING_CLUSTER_COUNT = 4;

let lastCrawlAt: string | null = null;
export function getLastCrawlAt(): string | null {
  return lastCrawlAt;
}

export class CrawlService implements Crawler {
  constructor(private readonly accountName: string) {}

  async collect(opt: CollectOptions): Promise<CollectResult> {
    const started = Date.now();
    const mode = getMode();
    const fetched = mode === 'simulated' ? simulatedBatch().items : await this.collectReal();

    if (!fetched.length) {
      log('warn', 'CRAWL_DOM_EMPTY: 旁听与 DOM 兜底都取不到内容', { mode });
      throw new AppError(
        'CRAWL_DOM_EMPTY',
        '采集没有取到任何内容，多半是平台改版了',
        '请跑 npm run selftest 定位失效的选择器，只改 config/selectors/',
      );
    }

    // ① 时间窗过滤（发旧闻扣 20 分）：这是唯一的内容过滤，不挑领域不挑类型（ADR-11）
    const cutoff = Date.now() - opt.timeWindowHours * 3600_000;
    const fresh = fetched.filter((it) => {
      const t = Date.parse(it.publishedAt);
      return Number.isFinite(t) ? t >= cutoff : true;
    });
    const staleCount = fetched.length - fresh.length;

    // ①-2 选题黑名单（§3.2 可调）：命中的题材直接丢掉，不进素材池、不会建任务
    const blockedRules = parseBlockedTopics(getString(KEYS.blockedTopics) ?? '');
    const blockedHits: string[] = [];
    const allowed = fresh.filter((it) => {
      const haystack = [it.content, it.author, ...it.topics].join(' ');
      const hit = matchBlockedTopic(haystack, blockedRules);
      if (hit) {
        blockedHits.push(hit);
        return false;
      }
      return true;
    });
    const blockedCount = fresh.length - allowed.length;
    if (blockedCount > 0) {
      log('info', `选题黑名单命中 ${blockedCount} 条，已丢弃`, {
        hits: blockedHits.slice(0, 20),
      });
    }

    // ② 热度排序：默认 点赞 + 评论 × 2
    const sorted = [...allowed].sort(
      (a, b) => heatOf(b, opt.heatWeights) - heatOf(a, opt.heatWeights),
    );

    // ③ SimHash 去重（海明距离）+ 指纹表查重
    const existing = allSimhashes().map((r) => r.simhash);
    const keep: CollectedItem[] = [];
    let dedupedCount = 0;
    const seenInBatch = new Set<string>();
    for (const it of sorted) {
      const hash = simhash(it.content);
      if (seenInBatch.has(hash)) {
        dedupedCount++;
        continue;
      }
      const hit =
        existing.some((h) => hamming(h, hash) <= DEDUP_HAMMING_DIST) ||
        fingerprintRepo.findSimilar(hash, DEDUP_HAMMING_DIST) !== null;
      if (hit) {
        dedupedCount++;
        continue;
      }
      seenInBatch.add(hash);
      keep.push(it);
    }

    // ④ 事务批量入库（先落库再改状态）
    const limited = keep.slice(0, opt.limit);
    const accountId = this.resolveAccountId();
    const ids = insertMany(accountId, limited, (t) => simhash(t));
    const insertedCount = ids.length;
    for (const id of ids) {
      const row = getSourceItem(id);
      if (row) fingerprintRepo.insert(row.simhash, 'source_item', id);
    }

    lastCrawlAt = new Date().toISOString();
    const elapsedMs = Date.now() - started;
    log(
      'info',
      `crawl done: ${fetched.length} fetched / ${blockedCount} blocked / ${dedupedCount} deduped / ${insertedCount} inserted`,
      {
        elapsedMs,
        mode,
        staleCount,
        blockedCount,
      },
    );
    return {
      items: limited,
      staleCount,
      blockedCount,
      dedupedCount,
      insertedCount,
      elapsedMs,
    };
  }

  private resolveAccountId(): number {
    const acc = getAccountByName(this.accountName || DEFAULT_ACCOUNT_NAME);
    if (!acc) throw new AppError('LOGIN_EXPIRED', '账号不存在，请先登录', '在设置页扫码登录');
    return acc.id;
  }

  /**
   * 真实采集（2026-10-19 重写）：
   * 热榜接口只有「话题标题」，没有正文 —— 用户要的是完整微头条。
   * 微头条正文在话题聚合页 /trending/{cluster_id}/，页面通过 /api/pc/list/feed 加载列表。
   * 流程：热榜拿 cluster_id → 逐个打开话题页 → 旁听 feed 接口 → 归一入库。
   */
  private async collectReal(): Promise<CollectedItem[]> {
    const ctx = await toutiaoContext(this.accountName);
    const page = ctx.pages()[0] ?? (await ctx.newPage());

    // ① 热榜拿话题（id + 标题）
    const clusters = await this.fetchClusterIds(page);
    if (!clusters.length) {
      log('warn', '热榜没取到 cluster_id，无法进入话题页', { hotUrl: crawlSelectors.hotUrl });
      return [];
    }

    // ② 每个话题页取几条，凑够采集预算
    const clusterCount = Math.min(TRENDING_CLUSTER_COUNT, clusters.length);
    const perCluster = Math.max(2, Math.ceil(CRAWL_DEFAULT_LIMIT / clusterCount));
    const items: CollectedItem[] = [];
    const seen = new Set<string>();
    for (const { id, title } of clusters.slice(0, clusterCount)) {
      const got = await this.collectFromTrending(page, id, title, perCluster);
      for (const it of got) {
        if (seen.has(it.platformItemId)) continue;
        seen.add(it.platformItemId);
        items.push(it);
      }
    }
    return items;
  }

  /** 打开热榜接口拿 cluster_id 列表（主文档就是 JSON，直接读响应） */
  private async fetchClusterIds(page: Page): Promise<Array<{ id: string; title: string }>> {
    const resp = await page.goto(crawlSelectors.hotUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    const json = (await resp?.json().catch(() => null)) as {
      data?: Array<{ ClusterIdStr?: string; Title?: string }>;
    } | null;
    return (json?.data ?? [])
      .map((d) => ({ id: d.ClusterIdStr ?? '', title: d.Title ?? '' }))
      .filter((d) => d.id);
  }

  /** 打开单个话题聚合页，旁听微头条 feed 接口 */
  private async collectFromTrending(
    page: Page,
    clusterId: string,
    clusterTitle: string,
    want: number,
  ): Promise<CollectedItem[]> {
    const listener = attachFeedListener(page, crawlSelectors.feedApiPattern);
    try {
      // 主动等 feed 接口的第一响应（最多 20 秒），比固定 sleep 可靠
      const feedWait = page
        .waitForResponse((r) => r.url().includes(crawlSelectors.feedApiPattern), {
          timeout: 20_000,
        })
        .catch(() => null);
      await page.goto(crawlSelectors.trendingUrlPrefix + clusterId + '/', {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
      const feedHit = await feedWait;
      if (feedHit) await page.waitForTimeout(2_000);
      await humanScroll(page, 3);
      await page.waitForTimeout(1_500);
      log('info', `话题页加载完成：${clusterTitle}`, {
        clusterId,
        url: page.url().slice(0, 80),
        feedHit: Boolean(feedHit),
        seenApis: listener.seenUrls().slice(0, 5),
      });
    } catch (e) {
      log('warn', `话题页打开失败，跳过：${clusterId}`, { error: String(e).slice(0, 200) });
      listener.stop();
      return [];
    }
    const raw = listener.drain();
    listener.stop();
    // 太短的（一句话/只有话题标题）在 normalize 阶段已丢弃，这里再兜一道
    const items = raw
      .filter((it) => it.content.replace(/\s/g, '').length >= MIN_SOURCE_CONTENT_LEN)
      .slice(0, want);
    // 把话题标题写进 topics：选题黑名单要按话题名过滤
    if (clusterTitle) for (const it of items) it.topics = [...it.topics, clusterTitle];
    log('info', `话题「${clusterTitle}」取到 ${items.length} 条微头条`, { clusterId });
    return items;
  }
}

export function defaultCollectOptions(): CollectOptions {
  return {
    timeWindowHours: CRAWL_TIME_WINDOW_HOURS,
    limit: CRAWL_DEFAULT_LIMIT,
    heatWeights: { like: HEAT_WEIGHTS.like, comment: HEAT_WEIGHTS.comment },
  };
}
