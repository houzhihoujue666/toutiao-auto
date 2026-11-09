import type { Page } from 'playwright';
import { crawlSelectors } from '../../config/selectors';
import { parseCountText, parsePublishedAt } from './normalize';
import type { CollectedItem } from '@shared/types';

/** DOM 兜底解析 —— §6.2：旁听取不到时用；DOM 兜底为空 ≠ 没有内容，多半是改版（CRAWL_DOM_EMPTY） */
export async function parseByDom(page: Page): Promise<CollectedItem[]> {
  const items: CollectedItem[] = [];
  const nodes = page.locator(crawlSelectors.feedItem);
  const count = await nodes.count();
  for (let i = 0; i < count; i++) {
    const node = nodes.nth(i);
    try {
      const content =
        (await node
          .locator(crawlSelectors.contentText)
          .first()
          .innerText()
          .catch(() => '')) || '';
      if (!content.trim()) continue;
      const author =
        (await node
          .locator(crawlSelectors.authorName)
          .first()
          .innerText()
          .catch(() => '')) || '未知作者';
      const likeText = await node
        .locator(crawlSelectors.likeCountText)
        .first()
        .innerText()
        .catch(() => '');
      const commentText = await node
        .locator(crawlSelectors.commentCountText)
        .first()
        .innerText()
        .catch(() => '');
      items.push({
        platformItemId:
          (await node.getAttribute('data-id').catch(() => null)) ?? `dom-${i}-${Date.now()}`,
        author: author.trim(),
        content: content.trim(),
        images: [],
        topics: [],
        likeCount: parseCountText(likeText),
        commentCount: parseCountText(commentText),
        publishedAt: parsePublishedAt('') ?? new Date().toISOString(),
      });
    } catch {
      // 单条解析失败跳过，不阻断整批
    }
  }
  return items;
}
