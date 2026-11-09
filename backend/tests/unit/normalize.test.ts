import { describe, it, expect } from 'vitest';
import {
  parseCountText,
  parsePublishedAt,
  normalizeItem,
  heatOf,
} from '../../src/modules/crawl/normalize';
import { HEAT_WEIGHTS, CRAWL_TIME_WINDOW_HOURS } from '@shared/constants';
import type { CollectedItem } from '@shared/types';

describe('数量文本解析（§6.2）', () => {
  it('「12.4万」→ 124000', () => {
    expect(parseCountText('12.4万')).toBe(124_000);
  });

  it('支持亿 / w / k 与千分位', () => {
    expect(parseCountText('1.2亿')).toBe(120_000_000);
    expect(parseCountText('3w')).toBe(30_000);
    expect(parseCountText('2k')).toBe(2000);
    expect(parseCountText('1,234')).toBe(1234);
  });

  it('纯数字与脏数据', () => {
    expect(parseCountText(520)).toBe(520);
    expect(parseCountText('')).toBe(0);
    expect(parseCountText(null)).toBe(0);
    expect(parseCountText('赞 88')).toBe(88);
  });
});

describe('发布时间解析', () => {
  const now = new Date('2026-10-15T12:00:00.000Z');

  it('相对时间', () => {
    expect(parsePublishedAt('3小时前', now)).toBe('2026-10-15T09:00:00.000Z');
    expect(parsePublishedAt('30分钟前', now)).toBe('2026-10-15T11:30:00.000Z');
    expect(parsePublishedAt('2天前', now)).toBe('2026-10-13T12:00:00.000Z');
  });

  it('绝对时间', () => {
    expect(parsePublishedAt('2026-10-12 10:15:30', now)?.startsWith('2026-10-12')).toBe(true);
    expect(parsePublishedAt('10-12 09:30', now)?.startsWith('2026-10-12')).toBe(true);
  });

  it('时间戳（秒 / 毫秒）', () => {
    expect(parsePublishedAt(1_797_000_000, now)).toBe(new Date(1_797_000_000_000).toISOString());
    expect(parsePublishedAt(1_797_000_000_000, now)).toBe(
      new Date(1_797_000_000_000).toISOString(),
    );
  });

  it('24 小时时间窗过滤：超时内容被丢弃（发旧闻扣 20 分）', () => {
    const cutoff = now.getTime() - CRAWL_TIME_WINDOW_HOURS * 3600_000;
    const old = parsePublishedAt('2026-10-01 08:00', now)!;
    expect(Date.parse(old)).toBeLessThan(cutoff);
  });
});

describe('字段归一化', () => {
  it('兼容平台返回的多种字段名', () => {
    const item = normalizeItem(
      {
        item_id: '7123456789',
        content:
          '国产大模型这周又更新了，参数规模、上下文长度、推理成本三件事一起抬，' +
          '开发者最直接的感受是同样一句话的调用费用又降了一截，' +
          '但真正的分水岭不在榜单名次，而在谁能把长文本稳定地跑在便宜卡上。' +
          '有团队做过对比，同样一份两万字的合同丢进去，有的模型能从头到尾不掉链子，' +
          '有的到一万五千字就开始丢条款，最后输出的摘要看着漂亮，关键责任条款却漏了。',
        media_name: '数码小报告',
        like_count: '12.4万',
        comment_count: '356',
        publish_time: '3小时前',
        image_list: [{ url: 'https://img.example.com/a.jpg' }],
      },
      new Date('2026-10-15T12:00:00.000Z'),
    )!;
    expect(item.platformItemId).toBe('7123456789');
    expect(item.author).toBe('数码小报告');
    expect(item.likeCount).toBe(124_000);
    expect(item.commentCount).toBe(356);
    expect(item.images).toEqual(['https://img.example.com/a.jpg']);
  });

  /** 2026-10-21 回归：只有标题的条目不再当素材（否则原文就是一句话） */
  it('只有 title 没有 content → 归一为 null', () => {
    expect(normalizeItem({ item_id: 'x', title: '何以中国当惊世界殊' })).toBeNull();
  });

  it('没有正文的对象被丢弃', () => {
    expect(normalizeItem({ item_id: '1' })).toBeNull();
    expect(normalizeItem('x')).toBeNull();
  });
});

describe('热度排序', () => {
  it('热度 = 点赞 + 评论 × 2', () => {
    const item = {
      likeCount: 100,
      commentCount: 10,
    } as CollectedItem;
    expect(heatOf(item, HEAT_WEIGHTS)).toBe(120);
  });
});
