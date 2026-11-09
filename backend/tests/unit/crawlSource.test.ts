import { describe, it, expect } from 'vitest';
import { crawlSelectors } from '../../src/config/selectors';
import { extractCandidates } from '../../src/modules/crawl/listener';
import { normalizeList, stripHtml } from '../../src/modules/crawl/normalize';

/**
 * 回归护栏：2026-10-16 真实站点实测时踩到的静默失效
 * 现象：runtime.mode = real 下点「开始采集」报 CRAWL_DOM_EMPTY
 * 根因：hotUrl 指向热榜 JSON 接口（URL 里没有 /api/），而 feedApiPattern 是 '/api/'，
 *       于是旁听 0 条、DOM 又解析不了 JSON —— 页面其实 200 正常返回了 50 条热点。
 * 教训：选择器配置必须自洽，否则失败是「静默」的。
 *
 * 2026-10-19 架构升级：热榜只有标题没有正文；微头条正文在话题聚合页
 * /trending/{cluster_id}/（旁听 /api/pc/list/feed）。
 */
describe('采集选择器自洽（防止旁听规则匹配不到目标页）', () => {
  it('热榜只当「话题 id 来源」：hotUrl 指向 hot-board 接口', () => {
    expect(crawlSelectors.hotUrl).toContain('hot-board');
  });

  it('话题页走路径形式（?cluster_id= 会被重定向回首页，2026-10-19 实测）', () => {
    expect(crawlSelectors.trendingUrlPrefix).toContain('/trending/');
    expect(crawlSelectors.trendingUrlPrefix.endsWith('/')).toBe(true);
    expect(crawlSelectors.trendingUrlPrefix).not.toContain('?');
  });

  it('feedApiPattern 打在话题页微头条列表接口上（不是笼统的 /api/）', () => {
    expect(crawlSelectors.feedApiPattern).toContain('/api/pc/list/feed');
  });
});

/**
 * 真实热榜响应（2026-10-16 实测抓取，字段名照抄）
 * ClusterId 是 JS 装不下的长整型：实测接口里 ClusterId 会失真（…29951 → …30000），
 * 所以必须优先取 ClusterIdStr 字符串 —— 这里刻意复刻这个陷阱。
 */
const CLUSTER_BASE = '7696031230827429951';
const clusterIdStr = (i: number): string => String(BigInt(CLUSTER_BASE) + BigInt(i));

/** 够长的正文（新规则：去空白 < 120 字视为「只有一句话」，不进素材池） */
const LONG_BODY =
  '汇源集团说白了还是让人给算计了，商标让人给抢了，这事儿说来话长，' +
  '涉及品牌授权、渠道分成、经销体系等一系列问题，双方各执一词，外界很难看清全貌。' +
  '有知情人透露，早在几年前双方就签过一份补充协议，条款写得含含糊糊，' +
  '如今争执起来，谁也拿不出能让对方服气的证据，只能交给法院慢慢理。';

function hotBoardPayload(count: number, withBody = false) {
  return {
    data: Array.from({ length: count }, (_, i) => ({
      ClusterId: Number(clusterIdStr(i)),
      ClusterIdStr: clusterIdStr(i),
      Title: `第 ${i + 1} 条热点事件标题`,
      ...(withBody ? { content: LONG_BODY } : {}),
      LabelUrl: '',
      Label: '',
      Url: `https://www.toutiao.com/trending/${clusterIdStr(i)}/?category_name=topic_innerflow`,
      HotValue: 14_778_811 - i,
      QueryWord: `第 ${i + 1} 条热点事件标题`,
      InterestCategory: ['international'],
      Image: {
        uri: 'tos-cn-i-qvj2lq49k0/7147bb263d0046938e649f64ab38280e',
        url: 'https://p3-sign.toutiaoimg.com/tos-cn-i-qvj2lq49k0/x~tplv-obj:360:240.jpg',
      },
    })),
    fixed_top_data: [],
    status: 'success',
  };
}

describe('热榜接口归一化', () => {
  it('能从 data 数组里挖出候选（§6.2 第 1 步）', () => {
    const candidates = extractCandidates(hotBoardPayload(50));
    expect(candidates).toHaveLength(50);
  });

  it('有正文时：ClusterIdStr → 平台ID、HotValue → 热度、Image.url → 配图', () => {
    const [item] = normalizeList(extractCandidates(hotBoardPayload(1, true)) as unknown[]);
    expect(item.content).toBe(LONG_BODY);
    // 必须精确：取 ClusterId 会因 JS 浮点精度变成 …30000
    expect(item.platformItemId).toBe(CLUSTER_BASE);
    expect(item.likeCount).toBe(14_778_811);
    expect(item.images).toEqual([
      'https://p3-sign.toutiaoimg.com/tos-cn-i-qvj2lq49k0/x~tplv-obj:360:240.jpg',
    ]);
    expect(item.topics).toEqual(['international']);
  });

  /** 2026-10-21 回归：热榜条目只有标题没有正文，之前用 title 兜底 → 素材池里全是「一句话」 */
  it('只有标题没有正文 → 直接丢弃，标题绝不充当原文', () => {
    const items = normalizeList(extractCandidates(hotBoardPayload(50)) as unknown[]);
    expect(items).toHaveLength(0);
  });

  it('正文太短（一句话）→ 丢弃', () => {
    const payload = {
      data: [{ id: 'x1', content: '何以中国当惊世界殊', user: { name: 'a' } }],
    };
    expect(normalizeList(extractCandidates(payload) as unknown[])).toHaveLength(0);
  });

  it('热榜没有发布时间 → 视为当下（热点天然在时间窗内）', () => {
    const now = new Date('2026-10-16T10:00:00.000Z');
    const [item] = normalizeList(extractCandidates(hotBoardPayload(1, true)) as unknown[], now);
    expect(item.publishedAt).toBe(now.toISOString());
  });
});

/**
 * 话题页 feed 归一化（2026-10-19 实测 /api/pc/list/feed 字段）
 * 微头条正文在 content（可能是 HTML），作者在嵌套 user.name，热度在 digg_count / comment_count。
 */
const trendingFeedPayload = {
  has_more: true,
  message: 'success',
  data: [
    {
      id: '1879453740040200',
      content: `汇源集团说白了<br>还是让人给算计了，<span>@某人</span> ${LONG_BODY}#汇源# #商标#`,
      digg_count: 16,
      comment_count: 30,
      behot_time: 1_792_394_799,
      user: { name: '凳子爱娱乐', user_id: '2744010431805815' },
      raw_data: Buffer.from(
        JSON.stringify({
          origin_image_list: [
            {
              uri: 'tos-cn-i-ezhpy3drpa/aaa',
              url: 'https://p3-sign.toutiaoimg.com/aaa~tplv-obj.jpeg',
            },
          ],
          thumb_image_list: [
            {
              url_list: [{ url: 'https://p3-sign.toutiaoimg.com/bbb~tplv-tt-post:400:400.jpeg' }],
            },
          ],
        }),
      ).toString('base64'),
    },
    {
      id: '1879453740040201',
      content: '太短',
      digg_count: 0,
      comment_count: 0,
      user: { name: 'x' },
    },
  ],
  next: { max_be_hot_time: 0 },
  offset: 0,
};

describe('话题页微头条 feed 归一化', () => {
  it('data 数组能被挖出候选', () => {
    expect(extractCandidates(trendingFeedPayload)).toHaveLength(2);
  });

  it('content 是 HTML → 拍平成纯文本；作者取嵌套 user.name；热度取 digg/comment', () => {
    const [item] = normalizeList(extractCandidates(trendingFeedPayload) as unknown[]);
    expect(item.content).toContain('汇源集团说白了');
    expect(item.content).toContain('商标让人给抢了');
    expect(item.content).not.toContain('<span>');
    // 话题标签与 @提及要洗掉，否则正文末尾挂一串 #xxx#
    expect(item.content).not.toContain('#汇源#');
    expect(item.content).not.toContain('@某人');
    expect(item.author).toBe('凳子爱娱乐');
    expect(item.likeCount).toBe(16);
    expect(item.commentCount).toBe(30);
    expect(item.platformItemId).toBe('1879453740040200');
  });

  it('raw_data 里的原图能取到（origin_image_list.url）', () => {
    const [item] = normalizeList(extractCandidates(trendingFeedPayload) as unknown[]);
    expect(item.images).toContain('https://p3-sign.toutiaoimg.com/aaa~tplv-obj.jpeg');
  });

  it('url_list 嵌套的缩略图也能取到（thumb_image_list[].url_list[].url）', () => {
    const payload = {
      data: [
        {
          id: 'y1',
          content: LONG_BODY,
          raw_data: Buffer.from(
            JSON.stringify({
              thumb_image_list: [
                { url_list: [{ url: 'https://p3-sign.toutiaoimg.com/ccc.jpeg' }] },
              ],
            }),
          ).toString('base64'),
        },
      ],
    };
    const [item] = normalizeList(extractCandidates(payload) as unknown[]);
    expect(item.images).toEqual(['https://p3-sign.toutiaoimg.com/ccc.jpeg']);
  });

  it('正文不足 120 字 → 丢弃（不进素材池）', () => {
    const items = normalizeList(extractCandidates(trendingFeedPayload) as unknown[]);
    expect(items).toHaveLength(1);
    expect(items[0]!.content.replace(/\s/g, '').length).toBeGreaterThanOrEqual(120);
  });

  it('秒级时间戳 → ISO 时间', () => {
    const [item] = normalizeList(extractCandidates(trendingFeedPayload) as unknown[]);
    expect(item.publishedAt).toBe(new Date(1_792_394_799 * 1000).toISOString());
  });
});

describe('stripHtml', () => {
  it('<br> 转换行、去标签、解实体', () => {
    expect(stripHtml('a<br>b<span>x</span>c&amp;d')).toBe('a\nbxc&d');
  });
  it('</p> 与 </div> 转换行（开标签直接去掉）', () => {
    expect(stripHtml('一<p>二</p>三<div>四</div>')).toBe('一二\n三四');
  });
  it('纯文本原样返回', () => {
    expect(stripHtml('普通文字')).toBe('普通文字');
  });
});
