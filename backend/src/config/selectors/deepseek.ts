import { z } from 'zod';
import { DEEPSEEK_URL } from '@shared/constants';

/** 大模型网页选择器 —— ADR-13：站点禁止自动化或出现风控时切 manual / api */
export const deepseekSelectorsSchema = z.object({
  chatUrl: z.string().min(1),
  chatInput: z.string().min(1),
  sendButton: z.string().min(1),
  stopGenerating: z.string().min(1),
  responseBlock: z.string().min(1),
  regenerate: z.string().min(1),
  loginWall: z.string().min(1),
  loginUrlHint: z.string().min(1),
});

export const deepseekSelectors = {
  chatUrl: DEEPSEEK_URL,
  chatInput: 'textarea, [contenteditable="true"]',
  sendButton: '[class*="send"], button[aria-label*="发送"]',
  stopGenerating: '[class*="stop"], button[aria-label*="停止"]',
  responseBlock: '[class*="message"], [class*="markdown"], [class*="answer"]',
  regenerate: 'text=重新生成',
  /**
   * 登录墙文案（2026-10-16 实测：未登录时站点跳 /sign_in，按钮文案是「登录 / 密码登录 / 发送验证码」，
   * class 是哈希过的，所以不能用 [class*="login"]）。
   * 注意：一个字符串里混用 text= 前缀和 CSS 逗号是错的 —— 整串会被当文本匹配（踩过这个坑），
   * 要「或」就用 :is() + :text()。
   */
  loginWall: ':is(:text("登录"), :text("手机号"), :text("发送验证码"))',
  /** 更可靠的判据：未登录会被直接跳到登录页 */
  loginUrlHint: '/sign_in',
} as const;
