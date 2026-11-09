import { z } from 'zod';
import { TOUTIAO_HOT_URL } from '@shared/constants';

/** 热点页选择器 —— ADR-1 旁听接口优先，DOM 解析兜底 */
export const crawlSelectorsSchema = z.object({
  hotUrl: z.string().min(1),
  trendingUrlPrefix: z.string().min(1),
  feedApiPattern: z.string().min(1),
  feedItem: z.string().min(1),
  authorName: z.string().min(1),
  contentText: z.string().min(1),
  likeCountText: z.string().min(1),
  commentCountText: z.string().min(1),
  scrollContainer: z.string().min(1),
});

export const crawlSelectors = {
  /** 热榜：只提供「话题标题 + ClusterIdStr」，没有正文（2026-10-19 确认） */
  hotUrl: TOUTIAO_HOT_URL,
  /**
   * 话题聚合页：完整微头条正文在这里。
   * 2026-10-19 实测：/trending/?cluster_id=xxx 会被重定向回首页，必须用路径形式 /trending/{id}/。
   */
  trendingUrlPrefix: 'https://www.toutiao.com/trending/',
  /**
   * 旁听用：话题聚合页加载微头条列表的接口（只匹配，不拦截，红线 3）。
   * 注意：热榜接口 URL 是 /hot-event/hot-board/，**不含** /api/；话题页 feed 接口是 /api/pc/list/feed。
   */
  feedApiPattern: '/api/pc/list/feed',
  feedItem: '[class*="feed-item"], [class*="article-item"], .toutiao-item, li[data-id]',
  authorName: '[class*="author"], [class*="source"], .name',
  contentText: '[class*="title"], [class*="content"], .txt',
  likeCountText: '[class*="like"], [class*="digg"]',
  commentCountText: '[class*="comment"]',
  scrollContainer: 'body',
} as const;
