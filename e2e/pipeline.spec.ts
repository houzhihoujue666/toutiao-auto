import { test, expect, type Page } from '@playwright/test';

/**
 * MVP 验收口径 4「全链路跑通」的浏览器证据（§E.7 新流程）：
 * 启动主界面点账号「发布」→ 自动跑完「采集 → 改写 → 配图 → 质检 → 发布」→ 已发布留证 → 额度耗尽拒绝
 */

async function waitForNoToastBlocking(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle').catch(() => undefined);
}

test.describe('微头条流水线控制台', () => {
  test('启动主界面：集中展示账号状态，每账号独立「发布」入口', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '启动' })).toBeVisible();
    // 账号卡片与每账号发布按钮
    await expect(page.getByTestId('launcher-account-1')).toBeVisible();
    await expect(page.getByTestId('publish-1')).toBeVisible();
    await expect(page.getByTestId('publish-1')).toContainText('发布');
    // 状态一目了然：在线/离线/异常
    await expect(page.getByTestId('status-1')).toBeVisible();
  });

  test('设置页只保留参数，账号状态集中到启动页', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { level: 1, name: '设置' })).toBeVisible();
    // 参数类内容仍在
    await expect(page.getByText('可调设置')).toBeVisible();
    await expect(page.getByText('实现红线')).toBeVisible();
    // 非参数内容已迁出设置页
    await expect(page.getByTestId('ps-reviewing')).toHaveCount(0);
    await expect(page.getByTestId('new-account-name')).toHaveCount(0);
    await expect(page.getByText('「取材网络」')).toHaveCount(0);

    // 账号状态 / 发布入口在启动页
    await page.goto('/');
    await expect(page.getByTestId('launcher-account-1')).toBeVisible();
    await expect(page.getByTestId('publish-1')).toBeVisible();
    await expect(page.getByTestId('status-1')).toBeVisible();
  });

  // 先跑全链路，它会把 lastPublishAt 置为刚刚；后续再点发布的用例必须考虑 15 分钟间隔
  test('全链路：填条数 → 点某账号「发布」→ 自动发布 → 已发布留证', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('run-count-1').fill('2');
    await page.getByTestId('publish-1').click();

    // 一次点击跑完采集到发布，中途不需要任何人工确认（§E.7）
    await expect(page.getByText(/发布已启动：/)).toBeVisible({ timeout: 90_000 });

    await page.goto('/list/published');
    await expect(page.locator('table.tbl tbody tr').first()).toBeVisible({ timeout: 90_000 });
  });

  test('素材池被一键发布吃光后，空态给出下一步而不是白屏', async ({ page }) => {
    await page.goto('/list/items');
    // §E.7：一键发布会自己补采并立即建任务，素材池因此被清空是预期行为。
    // 全链路用例已经跑完，这里直接验证空态即可。
    await expect(page.getByText('素材池是空的')).toBeVisible({ timeout: 30_000 });
  });

  test('设置页：锁定项无出口，越界值保存会被后端拒绝', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { level: 1, name: '设置' })).toBeVisible();

    const locked = page.getByLabel('作品声明（发布时勾选）');
    await expect(locked).toBeDisabled();
    await expect(locked).toHaveValue('取材网络');

    // 越界：把相似度闸门改成 0.9（> max 0.6）
    const input = page.getByLabel('相似度闸门');
    await input.fill('0.9');
    await page.getByRole('button', { name: /保存修改/ }).click();
    await expect(page.getByText(/保存失败|超出/)).toBeVisible({ timeout: 20_000 });
  });

  test('实时日志抽屉能打开且显示脱敏说明', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /实时日志/ }).click();
    await expect(page.getByRole('heading', { name: '实时日志' })).toBeVisible();
    await expect(page.getByText('redact')).toBeVisible();
    await page.getByRole('button', { name: '关闭日志' }).click();
    await expect(page.getByRole('heading', { name: '实时日志' })).toBeHidden();
  });

  // CHG-0005：账号管理收口到启动页，行内即可新建 / 切换
  test('多账号：启动页新建账号 → 显示 → 行内切换为当前', async ({ page }) => {
    const name = `toutiao-e2e-${Date.now() % 100000}`;
    await page.goto('/');
    await page.getByTestId('new-account-name').fill(name);
    await page.getByTestId('add-account').click();
    await expect(page.getByText(`账号「${name}」已创建`)).toBeVisible({ timeout: 20_000 });

    const row = page.locator('[data-testid^="launcher-account-"]', { hasText: name });
    await expect(row).toBeVisible({ timeout: 20_000 });

    await row.getByRole('button', { name: /切换/ }).click();
    await expect(row.getByText('当前')).toBeVisible({ timeout: 20_000 });
  });

  // 后端侧的拒绝由集成测试覆盖（返回 400 QUOTA_EXHAUSTED）；这里验前端「点不动」这一层
  test('当日额度用完：按钮变「今日已发完」且点不动', async ({ page }) => {
    await page.route('**/api/summary', async (route) => {
      const res = await route.fetch();
      const json = (await res.json()) as { data: { quota: unknown; accounts: unknown[] } };
      json.data.quota = { used: 50, limit: 50, remaining: 0 };
      await route.fulfill({ response: res, json });
    });

    await page.goto('/');
    await expect(page.getByTestId('publish-1')).toContainText('今日已发完', { timeout: 30_000 });
    await expect(page.getByTestId('publish-1')).toBeDisabled();
    await expect(page.getByTestId('run-count-1')).toBeDisabled();
  });
});
