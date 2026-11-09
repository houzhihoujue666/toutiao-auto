import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App';
import { renderApp, stubHttp } from './helpers';
import { summaryFixture } from './fixtures';
import type { AccountOverview } from '@shared/types';

afterEach(() => {
  vi.unstubAllGlobals();
});

function accountOverview(id: number, name: string, status = 'logged_in', failedToday = 0) {
  return {
    id,
    name,
    userDataDir: `data/sessions/${name}`,
    storageStatePath: null,
    status,
    creditScore: 100,
    dailyPublishLimit: 50,
    usedToday: 3,
    lastLoginAt: null,
    lastPublishAt: null,
    circuit: 'closed',
    consecutiveFailures: 0,
    remaining: 47,
    queueDepth: 0,
    reviewing: 0,
    failed: 0,
    failedToday,
    publishing: 0,
  } as AccountOverview;
}

function multiSummary(activeId = 1) {
  return summaryFixture({
    activeAccountId: activeId,
    accounts: [accountOverview(1, 'toutiao-main'), accountOverview(2, 'toutiao-second', 'logged_out')],
  });
}

const runResult = {
  requested: 5,
  accepted: 5,
  remaining: 38,
  crawled: 3,
  created: 5,
  enqueued: 5,
  taskIds: [1, 2, 3, 4, 5],
  message: '已启动 5 条，其中 5 条进入发布队列，按 15 分钟间隔依次发出',
};

describe('统一启动主界面（CHG-0004：合并工作台 + 账号页）', () => {
  it('启动默认进入主界面，渲染账号卡片，不再有工作台的「一键开始」', async () => {
    stubHttp({ '/api/summary': multiSummary(), '/api/settings': { editable: [], locked: [] } });
    renderApp(<App />, '/');

    await waitFor(() => expect(screen.getByTestId('launcher-account-1')).toBeInTheDocument());
    // 旧工作台控件已废弃
    expect(screen.queryByTestId('run-start')).not.toBeInTheDocument();
    expect(screen.queryByTestId('wb-account')).not.toBeInTheDocument();
    // 两个账号都展示
    expect(screen.getByTestId('launcher-account-2')).toBeInTheDocument();
  });

  it('账号看板展示「今日失败」条数', async () => {
    stubHttp({
      '/api/summary': summaryFixture({
        activeAccountId: 1,
        accounts: [
          { ...accountOverview(1, 'toutiao-main'), failedToday: 2 },
          accountOverview(2, 'toutiao-second', 'logged_out'),
        ],
      }),
      '/api/settings': { editable: [], locked: [] },
    });
    renderApp(<App />, '/');
    const card1 = await screen.findByTestId('launcher-account-1');
    await waitFor(() => expect(within(card1).getByText(/今日失败/)).toBeInTheDocument());
    // 数值来自后端 overviewOf 的 failedToday 字段（<b>2</b> 在卡片内唯一）
    expect(within(card1).getByText('2')).toBeInTheDocument();
  });

  it('每张卡片展示状态、配额与近期发布情况', async () => {
    stubHttp({ '/api/summary': multiSummary(), '/api/settings': { editable: [], locked: [] } });
    renderApp(<App />, '/');

    await waitFor(() => expect(screen.getByTestId('status-1')).toBeInTheDocument());
    // 在线 / 离线 状态一目了然
    expect(screen.getByTestId('status-1')).toHaveTextContent('在线');
    expect(screen.getByTestId('status-2')).toHaveTextContent('离线');
    // 配额与近期发布（含新增的「今日失败」指标）
    const card1 = screen.getByTestId('launcher-account-1');
    expect(within(card1).getByText(/今日 /)).toBeInTheDocument();
    expect(within(card1).getByText(/今日失败/)).toBeInTheDocument();
    expect(within(card1).getByText(/最后发布/)).toBeInTheDocument();
    expect(within(card1).getByText(/从未发布/)).toBeInTheDocument();
    // 当前账号标记（账号名旁 + 操作列都会标注）
    expect(within(card1).getAllByText('当前').length).toBeGreaterThan(0);
  });

  it('点某账号「发布」只触发该账号的 runOnce，并提示受理结果', async () => {
    stubHttp({
      '/api/summary': multiSummary(),
      '/api/settings': { editable: [], locked: [] },
      'POST /api/run': runResult,
    });
    const user = userEvent.setup();
    renderApp(<App />, '/');

    await waitFor(() => expect(screen.getByTestId('publish-1')).toBeEnabled());
    await user.click(screen.getByTestId('publish-1'));

    await waitFor(() =>
      expect(screen.getByText(/发布已启动：已启动 5 条/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/受理 5 条 · 补采 3 条 · 入队 5 条/)).toBeInTheDocument();
  });

  it('发布中的账号（有待发布队列）「发布」按钮禁用', async () => {
    stubHttp({
      '/api/summary': () =>
        summaryFixture({
          activeAccountId: 1,
          accounts: [
            { ...accountOverview(1, 'toutiao-main'), queueDepth: 1, reviewing: 0, publishing: 0 },
            { ...accountOverview(2, 'toutiao-second'), queueDepth: 0, reviewing: 0, publishing: 0 },
          ],
        }),
      '/api/settings': { editable: [], locked: [] },
    });
    renderApp(<App />, '/');
    await waitFor(() => expect(screen.getByTestId('publish-1')).toBeInTheDocument());
    expect(screen.getByTestId('publish-1')).toBeDisabled();
    expect(screen.getByTestId('publish-2')).toBeEnabled();
  });

  it('当日额度耗尽：按钮变「今日已发完」且点不动', async () => {
    stubHttp({
      '/api/summary': () =>
        summaryFixture({
          activeAccountId: 1,
          accounts: [
            {
              ...accountOverview(1, 'toutiao-main'),
              usedToday: 50,
              remaining: 0,
              queueDepth: 0,
            },
          ],
        }),
      '/api/settings': { editable: [], locked: [] },
    });
    renderApp(<App />, '/');
    await waitFor(() => expect(screen.getByTestId('publish-1')).toBeInTheDocument());
    const btn = screen.getByTestId('publish-1');
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent('今日已发完');
  });

  it('距上次发布不足最小间隔时点击「发布」，前端直接拦截并不调接口', async () => {
    stubHttp({
      '/api/summary': () =>
        summaryFixture({
          activeAccountId: 1,
          minPublishIntervalMinutes: 15,
          accounts: [
            {
              ...accountOverview(1, 'toutiao-main'),
              lastPublishAt: new Date(Date.now() - 3 * 60_000).toISOString(),
            },
          ],
        }),
      '/api/settings': { editable: [], locked: [] },
      'POST /api/run': runResult,
    });
    const user = userEvent.setup();
    renderApp(<App />, '/');
    await waitFor(() => expect(screen.getByTestId('publish-1')).toBeEnabled());

    await user.click(screen.getByTestId('publish-1'));
    await waitFor(() => expect(screen.getByText('距上次发布不足 15 分钟')).toBeInTheDocument());
    // 不应出现成功提示（接口未被调用）
    expect(screen.queryByText(/发布已启动/)).not.toBeInTheDocument();
  });

  it('未登录账号显示「扫码登录」而非「发布」', async () => {
    stubHttp({
      '/api/summary': () =>
        summaryFixture({
          activeAccountId: 2,
          accounts: [accountOverview(2, 'toutiao-second', 'logged_out')],
        }),
      '/api/settings': { editable: [], locked: [] },
    });
    renderApp(<App />, '/');
    await waitFor(() => expect(screen.getByTestId('login-2')).toBeInTheDocument());
    expect(screen.getByTestId('login-2')).toHaveTextContent('扫码登录');
    // 未登录账号仍展示「发布」按钮，但禁用（需先扫码登录）
    const publishBtn = screen.getByTestId('publish-2');
    expect(publishBtn).toBeInTheDocument();
    expect(publishBtn).toBeDisabled();
  });

  it('账号熔断时显示人工「恢复」按钮', async () => {
    stubHttp({
      '/api/summary': () =>
        summaryFixture({
          activeAccountId: 1,
          accounts: [
            { ...accountOverview(1, 'toutiao-main'), circuit: 'open', consecutiveFailures: 3 },
          ],
        }),
      '/api/settings': { editable: [], locked: [] },
    });
    renderApp(<App />, '/');
    await waitFor(() => expect(screen.getByTestId('resume-1')).toBeInTheDocument());
    expect(screen.getByTestId('resume-1')).toHaveTextContent('恢复（人工）');
    // 发布按钮保留但禁用
    expect(screen.getByTestId('publish-1')).toBeDisabled();
  });

  it('CHG-0005：账号管理（新建/删除/切换/检查/退出）收口到启动页', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    stubHttp({
      '/api/summary': summaryFixture({
        activeAccountId: 1,
        accounts: [accountOverview(1, 'toutiao-main'), accountOverview(2, 'toutiao-second')],
      }),
      '/api/settings': { editable: [], locked: [] },
      'POST /api/accounts': { activeId: 1 },
      'DELETE /api/accounts/2': {
        ok: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: '账号「toutiao-second」已经产生过任务，不允许删除',
          hint: '已发布的内容必须留证',
        },
      },
      'POST /api/accounts/2/activate': { activeId: 2 },
      'POST /api/account/login/check': { status: 'logged_in', creditScore: 100, accountId: 2 },
      'POST /api/account/login/reset': { ok: true },
    });
    const user = userEvent.setup();
    renderApp(<App />, '/');

    await waitFor(() => expect(screen.getByTestId('launcher-account-2')).toBeInTheDocument());

    // 新建账号
    await user.type(screen.getByTestId('new-account-name'), 'toutiao-third');
    await user.click(screen.getByTestId('add-account'));
    await waitFor(() => expect(screen.getByText('账号「toutiao-third」已创建')).toBeInTheDocument());

    // 删除被拒，原因说清楚
    await user.click(
      within(screen.getByTestId('launcher-account-2')).getByRole('button', { name: /删除/ }),
    );
    await waitFor(() => expect(screen.getByText('删除账号失败')).toBeInTheDocument());
    expect(screen.getByText(/已经产生过任务/)).toBeInTheDocument();

    // 切换当前账号
    await user.click(
      within(screen.getByTestId('launcher-account-2')).getByRole('button', { name: /切换/ }),
    );
    await waitFor(() => expect(screen.getByText('已切换账号')).toBeInTheDocument());

    // 检查登录态
    await user.click(
      within(screen.getByTestId('launcher-account-2')).getByRole('button', { name: /检查登录态/ }),
    );
    await waitFor(() => expect(screen.getByText(/登录态：logged_in/)).toBeInTheDocument());

    // 退出登录
    await user.click(
      within(screen.getByTestId('launcher-account-2')).getByRole('button', { name: /退出登录/ }),
    );
    await waitFor(() =>
      expect(screen.getByText(/已清除「toutiao-second」的浏览器登录态/)).toBeInTheDocument(),
    );

    confirmSpy.mockRestore();
  });
});
