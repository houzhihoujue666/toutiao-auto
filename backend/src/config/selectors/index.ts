import { z } from 'zod';
import { authSelectors, authSelectorsSchema } from './toutiao.auth';
import { crawlSelectors, crawlSelectorsSchema } from './toutiao.crawl';
import { publishSelectors, publishSelectorsSchema } from './toutiao.publish';
import { deepseekSelectors, deepseekSelectorsSchema } from './deepseek';
import { AppError } from '@shared/errors';

/**
 * 选择器集中管理 —— §7.4
 * 代码评审必查项：业务代码里不得出现裸选择器字符串；配置用 zod 定义结构，启动时校验，缺必填项直接启动失败。
 */
export const selectorsSchema = z.object({
  auth: authSelectorsSchema,
  crawl: crawlSelectorsSchema,
  publish: publishSelectorsSchema,
  deepseek: deepseekSelectorsSchema,
});

export const selectors = {
  auth: authSelectors,
  crawl: crawlSelectors,
  publish: publishSelectors,
  deepseek: deepseekSelectors,
} as const;

export type SelectorGroup = keyof typeof selectors;
export type SelectorKeyOf<G extends SelectorGroup> = keyof (typeof selectors)[G] & string;

/** 启动时校验；失败即停止启动（不静默降级，否则改版无从发现） */
export function validateSelectors(): void {
  const r = selectorsSchema.safeParse(selectors);
  if (!r.success) {
    throw new AppError(
      'SELECTOR_TIMEOUT',
      `选择器配置校验失败：${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      '请只改 config/selectors/，然后跑 npm run selftest',
    );
  }
}

/** 自检脚本用：列出全部选择器条目 */
export function selectorEntries(): { group: string; key: string; value: string }[] {
  const out: { group: string; key: string; value: string }[] = [];
  for (const [g, obj] of Object.entries(selectors)) {
    for (const [k, v] of Object.entries(obj as Record<string, string>)) {
      out.push({ group: g, key: k, value: v });
    }
  }
  return out;
}

export { authSelectors, crawlSelectors, publishSelectors, deepseekSelectors };
