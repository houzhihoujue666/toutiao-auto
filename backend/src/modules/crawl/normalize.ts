import { MIN_SOURCE_CONTENT_LEN } from '@shared/constants';
import type { CollectedItem } from '@shared/types';

/**
 * 字段归一化 —— §6.2 要点 2：数量文本（「12.4万」→ 124000）、时间格式统一 ISO
 */

export function parseCountText(input: unknown): number {
  if (typeof input === 'number' && Number.isFinite(input)) return Math.trunc(input);
  if (typeof input !== 'string') return 0;
  const s = input.trim().replace(/,/g, '');
  if (!s) return 0;
  const m = /^(-?\d+(?:\.\d+)?)\s*(亿|万|w|W|k|K)?$/.exec(s);
  if (!m) {
    const digits = s.replace(/[^\d]/g, '');
    return digits ? Number(digits) : 0;
  }
  const n = Number(m[1]);
  const unit = m[2];
  const factor =
    unit === '亿'
      ? 1e8
      : unit === '万' || unit === 'w' || unit === 'W'
        ? 1e4
        : unit === 'k' || unit === 'K'
          ? 1e3
          : 1;
  return Math.trunc(n * factor);
}

export function parsePublishedAt(input: unknown, now = new Date()): string | null {
  if (typeof input === 'number' && Number.isFinite(input)) {
    // 秒级或毫秒级时间戳
    const ms = input > 1e12 ? input : input * 1000;
    return new Date(ms).toISOString();
  }
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (!s) return null;

  const abs = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (abs) {
    return new Date(
      Number(abs[1]),
      Number(abs[2]) - 1,
      Number(abs[3]),
      Number(abs[4] ?? 0),
      Number(abs[5] ?? 0),
      Number(abs[6] ?? 0),
    ).toISOString();
  }
  const md = /^(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/.exec(s);
  if (md) {
    const y = now.getFullYear();
    const d = new Date(y, Number(md[1]) - 1, Number(md[2]), Number(md[3]), Number(md[4]));
    // 跨年：若解析结果比 now 晚一天以上，视为去年
    if (d.getTime() - now.getTime() > 24 * 3600 * 1000) d.setFullYear(y - 1);
    return d.toISOString();
  }
  const rel = /^(\d+)\s*(秒|分钟|小时|天)前/.exec(s);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2];
    const ms =
      unit === '天'
        ? n * 86400e3
        : unit === '小时'
          ? n * 3600e3
          : unit === '分钟'
            ? n * 60e3
            : n * 1000;
    return new Date(now.getTime() - ms).toISOString();
  }
  const d2 = new Date(s);
  return Number.isNaN(d2.getTime()) ? null : d2.toISOString();
}

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return '';
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number {
  for (const k of keys) {
    const v = obj[k];
    if (v != null) {
      const n = parseCountText(v);
      if (n > 0) return n;
    }
  }
  return 0;
}

/** 平台真实的图片字段（2026-10-21 实测话题页 feed：图在 raw_data 里，且是 url_list 嵌套） */
const IMAGE_KEYS = [
  'origin_image_list', // 原图，画质最好
  'large_image_list',
  'ugc_cut_image_list',
  'detail_cover_list',
  'thumb_image_list',
  'images',
  'image_list',
  'thumbnails',
  'Image',
];

/** 把任意嵌套结构里的图片地址挖出来：[{url}] / [{url_list:[{url}]}] / ["http…"] 都支持 */
function collectImageUrls(v: unknown, depth = 0): string[] {
  if (!v || depth > 4) return [];
  if (typeof v === 'string') return /^https?:\/\//.test(v.trim()) ? [v.trim()] : [];
  if (Array.isArray(v)) {
    const out: string[] = [];
    for (const x of v) out.push(...collectImageUrls(x, depth + 1));
    return out;
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const k of ['url', 'name']) {
      const s = o[k];
      if (typeof s === 'string' && /^https?:\/\//.test(s.trim())) return [s.trim()];
    }
    for (const k of ['url_list', 'urls', 'image_list', 'thumbnails']) {
      const nested = collectImageUrls(o[k], depth + 1);
      if (nested.length) return nested;
    }
  }
  return [];
}

/** 图片：从任意嵌套结构里取 HTTP 地址 */
function pickImageUrls(obj: Record<string, unknown>, keys: string[]): string[] {
  for (const k of keys) {
    const out = collectImageUrls(obj[k]);
    if (out.length) return out;
  }
  return [];
}

/** 普通字符串数组（话题/标签）：不做 URL 过滤 */
function pickStringArray(obj: Record<string, unknown>, keys: string[]): string[] {
  for (const k of keys) {
    const v = obj[k];
    if (Array.isArray(v)) {
      const out = v
        .map((x) => {
          if (typeof x === 'string') return x;
          if (x && typeof x === 'object') {
            const o = x as Record<string, unknown>;
            return String(o['url'] ?? o['name'] ?? '');
          }
          return '';
        })
        .filter(Boolean);
      if (out.length) return out;
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const url = (v as Record<string, unknown>)['url'];
      if (typeof url === 'string' && url.trim()) return [url.trim()];
    }
  }
  return [];
}

/** 微头条正文可能是 HTML 片段（<br>、mention span 等），入库前拍平成纯文本 */
export function stripHtml(input: string): string {
  return input
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 洗掉微头条正文里的噪声：话题标签串、@提及、营销话术
 * 不洗的话正文末尾会拖一串「#三峡# #长江# …」和「视频来源🎥 @xxx 点击关注👉」，
 * 既不像原文，也不是一句话能概括的正文（2026-10-21）。
 */
export function cleanContent(input: string): string {
  return (
    input
      .replace(/#[^#\s]{1,30}#?/g, '')
      .replace(/@[^\s@#,，。]{2,30}/g, '')
      .replace(/视频来源[^\n]*/g, '')
      .replace(/点击关注[^\n]*/g, '')
      .replace(/👉/g, '')
      // 平台常把被清掉的表情/图片留成空括号：【】 [ ] （）
      .replace(/【\s*】|\[\s*\]|（\s*）/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/ ?\n ?/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/**
 * 话题页 feed（/api/pc/list/feed）：正文不在顶层，而是藏在 base64 的 raw_data 里
 * （2026-10-19 实测：顶层只有 id/digg_count/behot_time 等，content/user/publish_time 都在 raw_data）。
 * 解开后合并：顶层字段优先（id 等），inner 补充正文与作者。
 */
function unwrapRawData(o: Record<string, unknown>): Record<string, unknown> {
  const raw = o['raw_data'];
  if (typeof raw !== 'string' || raw.length < 8) return o;
  try {
    const inner = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as Record<
      string,
      unknown
    >;
    const innerContent =
      typeof inner['content'] === 'string' && (inner['content'] as string).trim()
        ? inner['content']
        : undefined;
    return { ...inner, ...o, ...(innerContent ? { content: innerContent } : {}) };
  } catch {
    return o;
  }
}

/** 把平台返回的任意 JSON 结构归一成 CollectedItem */
export function normalizeItem(raw: unknown, now = new Date()): CollectedItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = unwrapRawData(raw as Record<string, unknown>);
  // 只取真正的正文字段：绝不用 title/QueryWord 兜底
  //（2026-10-21 踩坑：feed 里没正文的条目会回退成话题标题，
  //  于是素材池里出现「何以中国当惊世界殊」这种一句话原文）
  const content = cleanContent(
    stripHtml(pickString(o, ['content', 'abstract', 'text', 'desc', 'description'])),
  );
  const bodyLen = content.replace(/\s/g, '').length;
  if (bodyLen < MIN_SOURCE_CONTENT_LEN) return null;
  const id = pickString(o, [
    'platformItemId',
    'item_id',
    'ClusterIdStr',
    'ClusterId',
    'groupId',
    'group_id',
    'id',
    'url',
    'Url',
  ]);
  // 话题页 feed 的作者在嵌套的 user 对象里；热榜/其他接口是平级字段
  const user = o['user'];
  const author =
    pickString(o, ['author', 'source', 'media_name', 'user_name', 'nickname']) ||
    (user && typeof user === 'object'
      ? pickString(user as Record<string, unknown>, ['name', 'nickname', 'screen_name'])
      : '') ||
    '未知作者';
  return {
    platformItemId: id || `sim-${Math.abs(hashCode(content)).toString(36)}`,
    author,
    content,
    images: pickImageUrls(o, IMAGE_KEYS),
    topics: pickStringArray(o, ['topics', 'tags', 'labels', 'InterestCategory']),
    // 热榜没有点赞概念，用 HotValue（热度值）占位，以便统一热度排序与界面展示
    likeCount: pickNumber(o, ['like_count', 'digg_count', 'likeCount', 'praise_count', 'HotValue']),
    commentCount: pickNumber(o, ['comment_count', 'commentCount', 'reply_count']),
    publishedAt:
      parsePublishedAt(
        o['published_at'] ?? o['publish_time'] ?? o['publishTime'] ?? o['behot_time'],
        now,
      ) ?? now.toISOString(),
  };
}

export function normalizeList(raw: unknown, now = new Date()): CollectedItem[] {
  const arr = Array.isArray(raw) ? raw : [];
  return arr.map((x) => normalizeItem(x, now)).filter((x): x is CollectedItem => Boolean(x));
}

export function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

export function heatOf(item: CollectedItem, weights: { like: number; comment: number }): number {
  return item.likeCount * weights.like + item.commentCount * weights.comment;
}
