import { z } from 'zod';
import { TOUTIAO_PUBLISH_URL } from '@shared/constants';

/** 发布页选择器 —— §7.4 */
export const publishSelectorsSchema = z.object({
  publishUrl: z.string().min(1),
  editor: z.string().min(1),
  imageButton: z.string().min(1),
  imageInput: z.string().min(1),
  imageConfirm: z.string().min(1),
  topicInput: z.string().min(1),
  topicSuggestion: z.string().min(1),
  declarationEntry: z.string().min(1),
  declarationNetwork: z.string().min(1),
  firstPublishCheckbox: z.string().min(1),
  submit: z.string().min(1),
  successFlag: z.string().min(1),
  draftBoxEntry: z.string().min(1),
  popupClose: z.string().min(1),
});

export const publishSelectors = {
  publishUrl: TOUTIAO_PUBLISH_URL,
  editor: '[contenteditable="true"]',
  imageButton: 'text=图片',
  imageInput: 'input[type="file"]',
  imageConfirm: 'text=确定',
  topicInput: '[placeholder*="话题"]',
  topicSuggestion: '[class*="suggest"] li, [class*="suggestion"] li',
  declarationEntry: 'text=作品声明',
  declarationNetwork: 'text=取材网络',
  firstPublishCheckbox: '[type="checkbox"][aria-label*="首发"]', // 仅用于断言未选中
  // 提交按钮必须是 button 且文本恰好是「发布」：用 text=发布 会匹配到菜单/说明文字，点了没反应
  submit: 'role=button[name="发布"]',
  // 成功信号：文案可能变（发布成功/提交成功/已发布…），也可能直接跳转离开 /publish，
  // 所以 service 里做多信号判定，这个选择器只作兜底参考
  successFlag: 'text=发布成功',
  draftBoxEntry: 'text=草稿箱',
  popupClose: '.modal-close, .dialog-close, [class*="close"]',
} as const;
