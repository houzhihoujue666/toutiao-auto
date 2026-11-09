import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App';
import { renderApp, stubHttp } from './helpers';
import { configFixture, summaryFixture } from './fixtures';
import { LOCKED_CONFIG_ITEMS } from '@shared/constants';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('设置（§3.4：能改的在上半区，锁定项在下半区）', () => {
  it('可调项按类型渲染输入框并可编辑', async () => {
    stubHttp({
      '/api/summary': summaryFixture(),
      '/api/settings': { editable: configFixture(), locked: LOCKED_CONFIG_ITEMS },
      '/api/prompt-templates/default': {
        id: 1,
        name: '默认',
        content: '模板',
        variant: null,
        isDefault: true,
      },
    });
    renderApp(<App />, '/settings');

    await waitFor(() => expect(screen.getByLabelText('相似度闸门')).toBeInTheDocument());
    expect(screen.getByLabelText('相似度闸门')).toHaveValue(0.45);
    expect(screen.getByLabelText('运行模式')).toHaveDisplayValue('simulated');
  });

  it('锁定项只读且标注「锁定」（§9 无配置出口）', async () => {
    stubHttp({
      '/api/summary': summaryFixture(),
      '/api/settings': { editable: configFixture(), locked: LOCKED_CONFIG_ITEMS },
      '/api/prompt-templates/default': {
        id: 1,
        name: '默认',
        content: '模板',
        variant: null,
        isDefault: true,
      },
    });
    renderApp(<App />, '/settings');

    await waitFor(() => expect(screen.getByLabelText('作品声明（发布时勾选）')).toBeInTheDocument());
    const locked = screen.getByLabelText('作品声明（发布时勾选）');
    expect(locked).toBeDisabled();
    expect(locked).toHaveValue('取材网络');
    expect(screen.getAllByText('锁定').length).toBeGreaterThan(0);
  });

  it('改了值才启用「保存修改」，保存后给成功反馈', async () => {
    stubHttp({
      '/api/summary': summaryFixture(),
      '/api/settings': { editable: configFixture(), locked: LOCKED_CONFIG_ITEMS },
      'PUT /api/settings': { saved: { similarityThreshold: '0.4', 'runtime.mode': 'simulated' } },
      '/api/prompt-templates/default': {
        id: 1,
        name: '默认',
        content: '模板',
        variant: null,
        isDefault: true,
      },
    });
    const user = userEvent.setup();
    renderApp(<App />, '/settings');

    await waitFor(() => expect(screen.getByLabelText('相似度闸门')).toBeInTheDocument());
    const saveBtn = screen.getByRole('button', { name: /保存修改/ });
    expect(saveBtn).toBeDisabled();

    await user.clear(screen.getByLabelText('相似度闸门'));
    await user.type(screen.getByLabelText('相似度闸门'), '0.4');
    await waitFor(() => expect(saveBtn).toBeEnabled());

    await user.click(saveBtn);
    await waitFor(() => expect(screen.getByText(/已保存 2 项/)).toBeInTheDocument());
  });

  it('熔断时给出红色提示与人工「恢复」按钮', async () => {
    const open = summaryFixture({
      circuit: { state: 'open', consecutiveFailures: 3, threshold: 3 },
    });
    stubHttp({
      '/api/summary': open,
      '/api/settings': { editable: configFixture(), locked: LOCKED_CONFIG_ITEMS },
      '/api/prompt-templates/default': {
        id: 1,
        name: '默认',
        content: '模板',
        variant: null,
        isDefault: true,
      },
    });
    renderApp(<App />, '/settings');

    await waitFor(() => expect(screen.getByText('账号已熔断')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /恢复（人工）/ })).toBeInTheDocument();
  });

  it('CHG-0005：设置页只保留参数（账号管理/流水线/风险/合规已迁出）', async () => {
    stubHttp({
      '/api/summary': summaryFixture(),
      '/api/settings': { editable: configFixture(), locked: LOCKED_CONFIG_ITEMS },
      '/api/prompt-templates/default': {
        id: 1,
        name: '默认',
        content: '模板',
        variant: null,
        isDefault: true,
      },
    });
    renderApp(<App />, '/settings');

    await waitFor(() => expect(screen.getByLabelText('相似度闸门')).toBeInTheDocument());
    // 参数类内容仍在
    expect(screen.getByText('可调设置')).toBeInTheDocument();
    expect(screen.getByText(/提示词模板/)).toBeInTheDocument();
    expect(screen.getByText('锁定项')).toBeInTheDocument();
    expect(screen.getByText('实现红线')).toBeInTheDocument();
    // 非参数内容已迁出（不再出现在设置页）
    expect(screen.queryByTestId('ps-reviewing')).not.toBeInTheDocument();
    expect(screen.queryByTestId('new-account-name')).not.toBeInTheDocument();
    expect(screen.queryByText('「取材网络」')).not.toBeInTheDocument();
  });
});
