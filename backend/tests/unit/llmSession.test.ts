import { describe, it, expect } from 'vitest';
import { classifyLlmPage } from '../../src/infra/llm/sessionGuard';
import { deepseekSelectors } from '../../src/config/selectors';

/**
 * 回归护栏：2026-10-16 真实站点实测时踩到的判定错误
 * 现象：任务直接 failed / LLM_SESSION_LOST
 * 根因①：loginWall 写成 'text=登录, [class*="login"], text=手机号' —— 带 text= 前缀时逗号
 *        不是「或」，整串被当成一句文本去匹配，永远命中不到；而 DeepSeek 的 class 是哈希过的，
 *        [class*="login"] 也是 0 个 → 登录墙探测不到，于是落进「会话丢失」分支。
 * 根因②：未登录会直接跳到 /sign_in，URL 本身就是最可靠的判据。
 * 正确口径（§3.5 / ADR-13）：登录墙 → LLM_NEED_LOGIN，**停在 fetched 等人登录**，不重试。
 */
describe('大模型页面判定（§3.5）', () => {
  it('能进输入框 → ready（免登录可用时直接用）', () => {
    expect(
      classifyLlmPage({
        url: deepseekSelectors.chatUrl,
        hasChatInput: true,
        hasLoginWall: true,
      }),
    ).toBe('ready');
  });

  it('登录墙文案命中 → need_login（等人登录，不判失败）', () => {
    expect(
      classifyLlmPage({
        url: deepseekSelectors.chatUrl,
        hasChatInput: false,
        hasLoginWall: true,
      }),
    ).toBe('need_login');
  });

  it('URL 跳到 /sign_in → need_login，哪怕文案选择器失灵', () => {
    expect(
      classifyLlmPage({
        url: 'https://chat.deepseek.com/sign_in',
        hasChatInput: false,
        hasLoginWall: false,
      }),
    ).toBe('need_login');
  });

  it('既没输入框也没登录墙 → 才算会话丢失（转人工）', () => {
    expect(
      classifyLlmPage({
        url: deepseekSelectors.chatUrl,
        hasChatInput: false,
        hasLoginWall: false,
      }),
    ).toBe('lost');
  });
});

describe('登录墙选择器', () => {
  it('不能是「带 text= 前缀再用逗号拼 CSS」的写法', () => {
    // 这种写法整串会被当文本匹配：曾经因此静默失效
    expect(deepseekSelectors.loginWall).not.toMatch(/^text=.*,/);
  });

  it('必须配一个 URL 判据兜底', () => {
    expect(deepseekSelectors.loginUrlHint.length).toBeGreaterThan(1);
  });
});
