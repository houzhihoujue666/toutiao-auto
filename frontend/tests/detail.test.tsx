import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App';
import { renderApp, stubHttp } from './helpers';
import { sourceFixture, summaryFixture, taskFixture } from './fixtures';
import { FakeWebSocket } from './setup';

afterEach(() => {
  vi.unstubAllGlobals();
});

const taskId = 1041;
const detail = {
  task: taskFixture(taskId, 'reviewing'),
  source: sourceFixture(901),
  rewrite: {
    id: taskId,
    taskId,
    originalText: '原文',
    rewrittenText: '改写稿正文，足够长以通过展示',
    similarity: 0.28,
    qualityFlags: [],
    images: ['media/1041/out-1.webp'],
    simhash: null,
    createdAt: new Date().toISOString(),
  },
  record: null,
  stock: [],
  prompt: 'prompt',
  queue: null,
  threshold: 0.45,
};

describe('明细（/list/:type）', () => {
  it('WS 推来流水线变化后，当前列表自动刷新（不必手点「刷新」）', async () => {
    let taskCalls = 0;
    stubHttp({
      '/api/summary': summaryFixture(),
      '/api/tasks?status=reviewing': () => {
        taskCalls += 1;
        // 第一次拉取时任务还在改写中，之后才有任务进复核
        return { tasks: taskCalls > 1 ? [taskFixture(taskId, 'reviewing')] : [] };
      },
    });
    renderApp(<App />, '/list/reviewing');
    await waitFor(() => expect(screen.getByText('没有符合条件的任务')).toBeInTheDocument());

    const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
    act(() => {
      ws.emit(JSON.stringify({ type: 'pipeline', payload: {} }));
    });

    await waitFor(() => expect(screen.getByText(`#${taskId}`)).toBeInTheDocument(), {
      timeout: 3000,
    });
  });

  it('素材池为空时给空态而不是空白表格', async () => {
    stubHttp({
      '/api/summary': summaryFixture(),
      '/api/items': { items: [], total: 0, lastCrawlAt: null },
    });
    renderApp(<App />, '/list/items');
    await waitFor(() => expect(screen.getByText('素材池是空的')).toBeInTheDocument());
  });

  it('勾选素材后生成任务，并跳到待复核', async () => {
    stubHttp({
      '/api/summary': summaryFixture(),
      '/api/items': {
        items: [sourceFixture(901), sourceFixture(902)],
        total: 2,
        lastCrawlAt: null,
      },
      'POST /api/tasks': {
        created: 2,
        tasks: [taskFixture(1, 'reviewing'), taskFixture(2, 'reviewing')],
      },
      '/api/tasks?status=reviewing': { tasks: [taskFixture(1, 'reviewing')] },
    });
    const user = userEvent.setup();
    renderApp(<App />, '/list/items');

    await waitFor(() => expect(screen.getByLabelText('选择素材 901')).toBeInTheDocument());
    await user.click(screen.getByLabelText('选择素材 901'));
    await user.click(screen.getByRole('button', { name: /生成任务（1）/ }));

    await waitFor(() => expect(screen.getByText(/已生成 2 个任务/)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('#1')).toBeInTheDocument());
  });

  it('待复核列表点「复核」打开并排面板，显示相似度与配图', async () => {
    stubHttp({
      '/api/summary': summaryFixture(),
      '/api/tasks?status=reviewing': { tasks: [taskFixture(taskId, 'reviewing')] },
      '/api/tasks/': detail,
    });
    const user = userEvent.setup();
    renderApp(<App />, '/list/reviewing');

    await waitFor(() => expect(screen.getByText(`#${taskId}`)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '复核' }));

    await waitFor(() => expect(screen.getByTestId('review-pane')).toBeInTheDocument());
    const pane = screen.getByTestId('review-pane');
    expect(within(pane).getByText('原文')).toBeInTheDocument();
    expect(within(pane).getByText('0.28')).toBeInTheDocument();
    expect(within(pane).getByText('改写稿（可直接编辑）')).toBeInTheDocument();
    expect(within(pane).getByRole('button', { name: /通过并发布/ })).toBeEnabled();
  });

  it('相似度超闸门时「通过并发布」被禁用并说明原因（§2.3 验收口径 5）', async () => {
    stubHttp({
      '/api/summary': summaryFixture(),
      '/api/tasks?status=reviewing': { tasks: [taskFixture(taskId, 'reviewing')] },
      '/api/tasks/': { ...detail, rewrite: { ...detail.rewrite, similarity: 0.72 } },
    });
    const user = userEvent.setup();
    renderApp(<App />, '/list/reviewing');

    await waitFor(() => expect(screen.getByText(`#${taskId}`)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '复核' }));

    await waitFor(() => expect(screen.getByTestId('review-pane')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /通过并发布/ })).toBeDisabled();
    expect(screen.getByText(/相似度 0.72 超闸门 0.45/)).toBeInTheDocument();
  });

  it('失败列表显示失败原因，点「删除」二次确认后走 DELETE 并刷新列表', async () => {
    let failedCalls = 0;
    stubHttp({
      '/api/summary': summaryFixture(),
      '/api/tasks?status=failed': () => {
        failedCalls += 1;
        return { tasks: failedCalls > 1 ? [] : [taskFixture(1032, 'failed')] };
      },
      // 详情里的 task.id 要和列表一致，相似度才会挂到这一行上
      '/api/tasks/': () => ({ ...detail, task: taskFixture(1032, 'failed') }),
      'DELETE /api/tasks/1032': { taskId: 1032, deleted: true },
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    renderApp(<App />, '/list/failed');

    // 相似度 0.28 + 错误码 SIMILARITY → 原因写成人话，不再是看不懂的英文码
    expect(await screen.findByText(/相似度 0\.28 超过 0\.45 闸门/)).toBeInTheDocument();
    expect(screen.getByText('SIMILARITY')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /删除/ }));
    await waitFor(() => expect(screen.getByText(/已删除/)).toBeInTheDocument());
    expect(confirmSpy).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('失败任务可以点「重试」', async () => {
    stubHttp({
      '/api/summary': summaryFixture(),
      '/api/tasks?status=failed': { tasks: [taskFixture(1032, 'failed')] },
      '/api/tasks/': detail,
    });
    const user = userEvent.setup();
    renderApp(<App />, '/list/failed');

    await waitFor(() => expect(screen.getByText('#1032')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /重试/ }));
    await waitFor(() => expect(screen.getByText(/已重试/)).toBeInTheDocument());
  });
});
