import { z } from 'zod';
import { TOUTIAO_LOGIN_URL } from '@shared/constants';

/** 登录页选择器 —— §7.4：业务代码零裸选择器，平台改版只改这里 */
export const authSelectorsSchema = z.object({
  loginUrl: z.string().min(1),
  qrcode: z.string().min(1),
  loggedInFlag: z.string().min(1),
  creditScore: z.string().min(1),
});

export const authSelectors = {
  loginUrl: TOUTIAO_LOGIN_URL,
  qrcode: '.login-qrcode, .qrcode-img, [class*="qrcode"] img, canvas.qrcode',
  loggedInFlag: '.user-info, .avatar, [class*="user-info"], .mp-username',
  creditScore: '[class*="credit"], [class*="score"]',
} as const;
