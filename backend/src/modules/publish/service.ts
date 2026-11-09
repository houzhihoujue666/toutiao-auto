import fs from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from 'playwright';
import { publishSelectors } from '../../config/selectors';
import { getMode, allowRealPublish } from '../../config/runtime';
import { log } from '../../infra/logger';
import { hoverAndClick, stepPause, typeLikeHuman } from '../../infra/playwright/humanize';
import { toutiaoContext } from '../../infra/playwright/session';
import { renderSampleImage } from '../../infra/image/generate';
import { fromRelative, shotFileName, taskShotsDir, toRelative } from '../../infra/storage/paths';
import { FORCE_DECLARATION, MAX_IMAGES_PER_POST } from '@shared/constants';
import { AppError } from '@shared/errors';

import type { PublishInput, PublishResult, Publisher } from '@shared/types';
import { assertNotPublished } from './idempotency';

/**
 * 发布七步 —— §6.7
 * 1 打开发布页 → 2 逐字输入 → 3 传图（≤9）→ 4 话题 → 5 勾「引用AI」
 * → 6 断言「头条首发」未勾选（合规硬闸门，不可配置关闭）→ 7 发布 + 截图留证
 */

/**
 * 头条把编辑中的内容自动存在浏览器本地（草稿箱里查不到，但每次打开发布页都会被恢复）：
 * wtt-mpeditordraft = 正文，wtt-mpformdraft = 图片/话题等表单状态。
 * 不清掉就会和本次内容拼成一篇文章（2026-10-20 实测：编辑器里凭空多出 1128 字旧稿）。
 */
const LOCAL_DRAFT_KEYS = ['wtt-mpeditordraft', 'wtt-mpformdraft'];

/** 编辑器为空时 innerText 仍带这句 placeholder，比对残留/字数时要剔除 */
const EDITOR_PLACEHOLDER = '有什么新鲜事想告诉大家？';

/** 合规硬闸门：检测到「头条首发」被勾选立即中止，无配置出口 */
export function assertFirstPublishUnchecked(isChecked: boolean): void {
  if (isChecked) {
    throw new AppError(
      'FIRST_PUBLISH_CHECK_FAILED',
      '检测到「头条首发」被勾选，已中止发布',
      '这是产品底线，没有开关；请确认页面状态后重试',
    );
  }
}

export class PublishService implements Publisher {
  /** §7.1 的 PublishInput 不含任务号，发布留证需要它，因此由构造注入 */
  constructor(
    private readonly accountName: string,
    private readonly taskId: number,
  ) {}

  async publish(input: PublishInput): Promise<PublishResult> {
    if (input.declaration !== FORCE_DECLARATION) {
      // 类型层面已锁死，这里再兜一道
      throw new AppError(
        'VALIDATION_FAILED',
        `作品声明必须是「${FORCE_DECLARATION}」`,
        '类型层面锁死，无配置出口',
      );
    }
    const taskId = this.taskId;
    assertNotPublished(taskId);

    const isDraft = input.draft === true || !allowRealPublish();
    const mode = getMode();
    const screenshotPath = await this.takeScreenshot(
      mode,
      taskId,
      isDraft ? 'draft' : 'publish-success',
    );

    if (mode === 'simulated') {
      // 模拟模式不碰真实平台；断言逻辑与真实链路同源
      assertFirstPublishUnchecked(false);
      log('info', `publish simulated: draft=${isDraft}`, { taskId, images: input.images.length });
      return {
        url: isDraft ? undefined : `https://www.toutiao.com/w/sim-${taskId}`,
        screenshotPath,
        status: isDraft ? 'draft' : 'success',
        firstPublishChecked: true,
      };
    }

    // 真实发布前不预先判定登录态：AccountService.checkSession 会误判
    //（2026-10-21 实测：浏览器里后台明明已登录，它却报 expired）。
    // 改为打开发布页后按真实页面状态判断，见 doPublishReal 开头。
    return this.publishReal(input, isDraft, screenshotPath, taskId);
  }

  private async takeScreenshot(mode: string, taskId: number, prefix: string): Promise<string> {
    const dir = taskShotsDir(taskId || 0);
    const file = path.join(dir, shotFileName(prefix));
    if (mode === 'simulated') {
      const buf = await renderSampleImage({
        seed: taskId || 1,
        width: 1280,
        height: 800,
        withExif: false,
      });
      fs.writeFileSync(file, buf);
    }
    return toRelative(file);
  }

  private async publishReal(
    input: PublishInput,
    isDraft: boolean,
    screenshotRel: string,
    taskId: number,
  ): Promise<PublishResult> {
    const ctx = await toutiaoContext(this.accountName);
    // 每次发布都开新页面：复用旧 tab 会带上上一次的编辑器状态
    //（头条发布页把内容自动存在浏览器本地，同 URL 再导航也不一定重置），
    // 2026-10-20 实测两篇改写稿就是这样叠进同一个编辑器的。
    const page: Page = await ctx.newPage();
    try {
      return await this.doPublishReal(page, input, isDraft, screenshotRel, taskId);
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  /** 填话题：找不到输入框就跳过（话题不是必填，不能卡死整篇） */
  private async tryFillTopic(page: Page, topic: string, taskId: number): Promise<boolean> {
    const clean = topic.replace(/^#/, '');
    const box = page.locator(publishSelectors.topicInput).first();
    try {
      await box.fill(clean, { timeout: 8_000 });
      return true;
    } catch {
      // 可能要先点「话题」入口，输入框才渲染出来
      const opened = await page
        .locator('text=话题')
        .first()
        .click({ timeout: 5_000 })
        .then(() => true)
        .catch(() => false);
      if (opened) {
        await page.waitForTimeout(1_000);
        try {
          await box.fill(clean, { timeout: 8_000 });
          return true;
        } catch {
          /* 还是填不上，跳过 */
        }
      }
    }
    log('warn', 'publish: 话题输入框没找到，跳过话题（不影响发布）', { taskId, topic: clean });
    return false;
  }

  /**
   * 点「发布」按钮：优先用 role 精确匹配；匹配不到就退化成「页面上文本最短的那个含『发布』的 button」
   * （主提交按钮通常就是纯「发布」两字，而菜单项往往是「发布视频」「定时发布」这种长文本）
   */
  private async clickSubmit(page: Page, taskId: number): Promise<void> {
    const byRole = page.locator(publishSelectors.submit).first();
    if ((await byRole.count().catch(() => 0)) > 0) {
      await hoverAndClick(page, publishSelectors.submit);
      return;
    }
    const pick = (await page
      .evaluate(
        `(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          let best = -1, bestLen = 999;
          btns.forEach((b, i) => {
            const t = (b.innerText || '').trim();
            if (t.includes('发布') && t.length < bestLen) { bestLen = t.length; best = i; }
          });
          return { best, bestLen, total: btns.length };
        })()`,
      )
      .catch(() => ({ best: -1, bestLen: 999, total: 0 }))) as {
      best: number;
      bestLen: number;
      total: number;
    };
    log('warn', 'publish: role 选择器没匹配到发布按钮，走兜底', { taskId, pick });
    if (pick.best >= 0 && pick.bestLen <= 8) {
      const btn = page.locator('button').nth(pick.best);
      await btn.hover({ timeout: 10_000 });
      await stepPause();
      await btn.click({ timeout: 10_000 });
      return;
    }
    throw new AppError('PUBLISH_FAILED', '找不到「发布」按钮', '页面结构可能变了，看截图确认');
  }

  /**
   * 等发布结果：多信号判定
   * 单靠一句「发布成功」太脆——头条可能换文案，也可能直接跳转离开发布页。
   * 命中任一即成功：① 出现成功类文案 ② URL 不再停留在 /publish（已跳转）
   * 顺带处理提交后可能出现的二次确认弹窗。
   */
  private async waitPublishSuccess(
    page: Page,
    taskId: number,
    timeoutMs = 30_000,
  ): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    let snap = { url: '', text: '' };
    let confirmed = false;
    while (Date.now() < deadline) {
      snap = (await page
        .evaluate(
          `(() => ({ url: location.href, text: (document.body.innerText || '').slice(0, 1500) }))()`,
        )
        .catch(() => snap)) as { url: string; text: string };

      if (/发布成功|提交成功|已发布|发布已完成/.test(snap.text)) return '成功文案';
      if (snap.url && !snap.url.includes('/publish')) return `已跳转 ${snap.url}`;

      // 提交后可能弹二次确认（含「发布」字样的确定按钮），点一次
      if (!confirmed && /确认|确定/.test(snap.text) && /发布/.test(snap.text)) {
        const clicked = await page
          .locator('button:has-text("确定"), button:has-text("确认")')
          .first()
          .click({ timeout: 3_000 })
          .then(() => true)
          .catch(() => false);
        if (clicked) {
          confirmed = true;
          log('info', 'publish: 点了发布后的二次确认', { taskId });
        }
      }
      await page.waitForTimeout(1_000);
    }
    throw new Error(`超时未等到发布结果 | url=${snap.url} | 页面文本=${snap.text.slice(0, 300)}`);
  }

  /** 包一层：中间步骤失败时截图留证再抛（之前失败无截图，排查全靠猜） */
  private async withEvidence<T>(
    page: Page,
    screenshotRel: string,
    step: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      await page
        .screenshot({ path: fromRelative(screenshotRel), fullPage: true })
        .catch(() => undefined);
      log('error', `publish: ${step} 失败，已截图`, { error: String(e).slice(0, 300) });
      throw e;
    }
  }

  /**
   * 页面上已勾选的 checkbox 各自的「选项名」
   * 取祖先链上最短的那段文本（第一个 ≤20 字的），否则会拿到整个声明面板的一长串文字，
   * 导致无法判断到底勾了哪一项（2026-10-21 实测踩坑）。
   */
  private async checkedBoxesText(page: Page): Promise<string[]> {
    return (await page
      .evaluate(
        `(() => {
          const out = [];
          for (const cb of document.querySelectorAll('input[type=checkbox]:checked')) {
            let el = cb.parentElement, text = '';
            for (let i = 0; i < 4 && el; i++) {
              const t = (el.innerText || '').trim();
              if (t) { text = t; if (t.length <= 20) break; }
              el = el.parentElement;
            }
            out.push(text.replace(/\\s+/g, ' ').slice(0, 40));
          }
          return out;
        })()`,
      )
      .catch(() => [] as string[])) as string[];
  }

  /** 编辑器正文（剔除 placeholder，空编辑器 innerText 会带上「有什么新鲜事想告诉大家？」） */
  private async editorText(editorLocator: Locator): Promise<string> {
    const raw = await editorLocator.innerText().catch(() => '');
    return raw.split(EDITOR_PLACEHOLDER).join('').replace(/\s/g, '');
  }

  /** 删掉浏览器本地草稿：头条打开发布页时会把它恢复到编辑器，从而和本次内容拼接 */
  private async clearLocalDraft(page: Page, taskId: number): Promise<void> {
    const removed = (await page
      .evaluate(
        `(() => {
          let n = 0;
          const keys = ${JSON.stringify(LOCAL_DRAFT_KEYS)};
          for (const k of keys) {
            if (localStorage.getItem(k) !== null) { localStorage.removeItem(k); n++; }
          }
          return n;
        })()`,
      )
      .catch(() => 0)) as number;
    if (removed > 0) {
      log('warn', 'publish: 清掉浏览器本地草稿（否则头条会恢复它，两篇内容拼接）', {
        taskId,
        removed,
      });
    }
  }

  /**
   * 清空编辑器（上次残留 / 本地草稿恢复），最多 3 轮；清不干净直接报错，
   * 宁可不发也不能把两篇内容拼在一起发出去。
   */
  private async clearEditor(page: Page, taskId: number): Promise<void> {
    const editorLocator = page.locator(publishSelectors.editor).first();
    for (let i = 1; i <= 3; i++) {
      const pre = await this.editorText(editorLocator);
      if (!pre) return;
      log('warn', `publish: 编辑器有残留内容（第 ${i} 次清理）`, {
        taskId,
        preLen: pre.length,
        preview: pre.slice(0, 30),
      });
      await editorLocator.click().catch(() => undefined);
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Delete');
      // keyboard 兜不住时直接清 DOM（头条编辑器是 ProseMirror 的 contenteditable）
      await editorLocator
        .evaluate((el) => {
          el.innerHTML = '';
          el.dispatchEvent(new InputEvent('input', { bubbles: true }));
        })
        .catch(() => undefined);
      await page.waitForTimeout(600);
    }
    const rest = await this.editorText(editorLocator);
    if (rest) {
      await page
        .screenshot({
          path: fromRelative(path.join(taskShotsDir(taskId || 0), shotFileName('dirty-editor'))),
          fullPage: true,
        })
        .catch(() => undefined);
      throw new AppError(
        'PUBLISH_FAILED',
        `编辑器残留 ${rest.length} 字清不掉，已中止发布`,
        '避免两篇内容拼接；请去发布页手动清空后再试',
      );
    }
  }

  private async doPublishReal(
    page: Page,
    input: PublishInput,
    isDraft: boolean,
    screenshotRel: string,
    taskId: number,
  ): Promise<PublishResult> {
    // ① 打开发布页 → 清掉浏览器本地草稿 → 重载（否则头条把旧稿恢复进编辑器，两篇拼接）
    await page.goto(publishSelectors.publishUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await this.clearLocalDraft(page, taskId);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    // 重载后页面可能又把表单状态写回去，再清一次
    await this.clearLocalDraft(page, taskId);

    // 登录态按真实页面判断（checkSession 会误判，2026-10-21 实测）：
    // 被踢到登录页就没有编辑器，早点失败好过跑满 3 分钟才发现
    if (/login|passport/i.test(page.url())) {
      throw new AppError(
        'LOGIN_EXPIRED',
        '打开发布页被跳转到登录页，已中止发布',
        '去设置页「扫码登录」重新扫码，账号区显示「已登录」后再发布',
      );
    }

    await page
      .locator(publishSelectors.popupClose)
      .first()
      .click({ timeout: 5000 })
      .catch(() => undefined);
    await stepPause();

    // ①-2 兜底清空：本地草稿恢复是异步的，等它完成再清一遍再填。
    //     typeLikeHuman 是逐字追加，只要编辑器不干净就必然拼接。
    const editorLocator = page.locator(publishSelectors.editor).first();
    await editorLocator.waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForTimeout(2_500);
    await this.clearEditor(page, taskId);

    // ② 逐字输入正文（★40~120 ms/字）
    await typeLikeHuman(page, publishSelectors.editor, input.text);

    // ②-2 拼接防线：输入完成后编辑器字数必须和本次内容相当，超 50% 判定混入了别的内容
    const typed = await this.editorText(editorLocator);
    const expected = input.text.replace(/\s/g, '');
    if (expected.length > 0 && typed.length > expected.length * 1.5) {
      await page
        .screenshot({ path: fromRelative(screenshotRel), fullPage: true })
        .catch(() => undefined);
      log('error', 'publish: 编辑器字数异常（疑似两篇内容拼接），已中止发布', {
        taskId,
        expected: expected.length,
        actual: typed.length,
      });
      throw new AppError(
        'PUBLISH_FAILED',
        `编辑器 ${typed.length} 字远超本次内容 ${expected.length} 字，疑似拼接，已中止发布`,
        '已截图留证；去发布页手动清理或检查浏览器本地残留',
      );
    }

    // ③~⑥ 每一步失败都截图留证再抛（之前失败无截图，排查全靠猜）
    await this.withEvidence(page, screenshotRel, '传图', async () => {
      for (const rel of input.images.slice(0, MAX_IMAGES_PER_POST)) {
        const abs = path.isAbsolute(rel) ? rel : fromRelative(rel);
        // 先点「图片」按钮弹出上传面板，再塞文件：直接对隐藏 input 塞往往不触发上传
        await page
          .locator(publishSelectors.imageButton)
          .first()
          .click({ timeout: 5_000 })
          .catch(() => undefined);
        await page.waitForTimeout(800);
        await page
          .locator(publishSelectors.imageInput)
          .first()
          .setInputFiles(abs, { timeout: 15_000 })
          .catch((e) => {
            log('warn', 'publish: setInputFiles 失败，跳过这张图', {
              taskId,
              img: rel,
              error: String(e).slice(0, 150),
            });
          });
        await stepPause();
        await page
          .locator(publishSelectors.imageConfirm)
          .first()
          .click({ timeout: 5000 })
          .catch(() => undefined);
        await stepPause();
      }
    });

    // ④ 输入话题（不带 #）并从建议里选
    // 话题不是必填项：填不上就跳过，绝不能因为话题把整篇卡死
    //（2026-10-21 实测：`[placeholder*="话题"]` 找不到 → fill 超时 → 整篇发布失败）
    const topic = input.topic;
    if (topic) {
      const filled = await this.tryFillTopic(page, topic, taskId);
      if (filled) {
        await stepPause();
        await page
          .locator(publishSelectors.topicSuggestion)
          .first()
          .click({ timeout: 5000 })
          .catch(() => undefined);
      }
    }

    // ⑤ 作品声明：只勾「取材网络」，其余都不勾（用户要求，2026-10-20）
    await this.withEvidence(page, screenshotRel, '展开作品声明', () =>
      hoverAndClick(page, publishSelectors.declarationEntry),
    );
    await stepPause();
    await this.withEvidence(page, screenshotRel, '勾选「取材网络」', () =>
      hoverAndClick(page, publishSelectors.declarationNetwork),
    );
    await stepPause();

    // ⑥ 合规断言：勾选状态必须符合要求（不可配置关闭）
    const checked = await this.checkedBoxesText(page);
    log('info', 'publish: 当前勾选的声明', { taskId, checked });
    const firstPublish = await page
      .locator(publishSelectors.firstPublishCheckbox)
      .first()
      .isChecked()
      .catch(() => false);
    assertFirstPublishUnchecked(firstPublish);
    if (checked.length > 0) {
      // 只看声明相关的勾选项：「取材网络」必须勾，其他声明一个都不能勾。
      // 页面自带的无关勾选（如默认开启的「配乐」）不算违规，不参与判定。
      const declared = checked.filter((t) =>
        /取材网络|引用站内|引用AI|个人观点|虚构演绎|投资观点|健康医疗/.test(t),
      );
      const onlyNetwork =
        declared.length > 0 && declared.every((t) => t.includes(FORCE_DECLARATION));
      if (!onlyNetwork) {
        await page
          .screenshot({ path: fromRelative(screenshotRel), fullPage: true })
          .catch(() => undefined);
        throw new AppError(
          'PUBLISH_FAILED',
          `作品声明勾选异常（期望只勾「${FORCE_DECLARATION}」，实际：${checked.join(' / ')}），已中止发布`,
          '已截图留证；请检查声明区勾选状态',
        );
      }
    }

    // ⑦ 发布 / 存草稿 → 等成功标志 → 整页截图
    if (isDraft) {
      await hoverAndClick(page, publishSelectors.draftBoxEntry);
      await page.waitForTimeout(2000);
      await page
        .screenshot({ path: fromRelative(screenshotRel), fullPage: true })
        .catch(() => undefined);
      log('info', 'publish draft saved', { taskId });
      return { screenshotPath: screenshotRel, status: 'draft', firstPublishChecked: true };
    }

    await this.withEvidence(page, screenshotRel, '点「发布」', () =>
      this.clickSubmit(page, taskId),
    );
    let why = '';
    try {
      why = await this.waitPublishSuccess(page, taskId);
    } catch (e) {
      // 失败也要截图留证：这一步最常见的坑是「内容其实发出去了，但成功提示文案变了」
      await page
        .screenshot({ path: fromRelative(screenshotRel), fullPage: true })
        .catch(() => undefined);
      log('error', '点发布后没等到发布结果，已截图留证', {
        taskId,
        url: page.url(),
        detail: String(e).slice(0, 800),
      });
      throw new AppError(
        'PUBLISH_FAILED',
        `点「发布」后 30 秒内没有出现发布结果，已截图留证（${String(e).slice(0, 120)}）`,
        '去看截图确认内容是否已提交；若已提交请勿重复发布',
      );
    }
    log('info', `publish: 发布成功信号=${why}`, { taskId });
    await page.screenshot({ path: fromRelative(screenshotRel), fullPage: true });

    const url = page.url();
    log('info', `publish success: ${url}`, { taskId });
    return { url, screenshotPath: screenshotRel, status: 'success', firstPublishChecked: true };
  }
}
