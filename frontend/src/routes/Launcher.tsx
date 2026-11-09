import { useState } from 'react';
import { Icon } from '../components/Icon';
import { ManualRewriteDialog } from '../components/ManualRewriteDialog';
import { useStore } from '../state/store';
import {
  checkLogin,
  createAccount,
  fetchTasks,
  removeAccount,
  resetLogin,
  resumeCircuit,
  runOnce,
  startLogin,
} from '../lib/api';
import { RUN_DEFAULT_COUNT, RUN_MAX_COUNT, RUN_MIN_COUNT } from '@shared/constants';
import type { AccountOverview, Task } from '@shared/types';

/** 毫秒时间戳 → 「x 分钟前 / x 小时前 / x 天前」 */
function ago(iso: string | null): string {
  if (!iso) return '从未发布';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '从未发布';
  const mins = Math.round((Date.now() - t) / 60_000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}

/** 账号主状态：在线 / 离线 / 异常（熔断或登录失效） */
function statusInfo(a: AccountOverview): { label: string; tone: 'ok' | 'warn' | 'bad' } {
  if (a.circuit === 'open') return { label: '异常 · 已熔断', tone: 'bad' };
  if (a.status === 'expired') return { label: '异常 · 登录失效', tone: 'bad' };
  if (a.status === 'logged_out') return { label: '离线', tone: 'warn' };
  return { label: '在线', tone: 'ok' };
}

/**
 * 统一启动主界面（CHG-0004 + CHG-0005）：账号信息全收口到这里。
 * 每行一个账号：数据看板 / 状态 / 登录 / 发布条数 / 发布 / 切换 / 删除。
 * 与发布无关的内容已迁出：头部只留标题+日志，设置页只留参数。
 */
export function Launcher(): React.ReactNode {
  const { summary, accounts, activeId, switchAccount, notify, refresh } = useStore();
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [running, setRunning] = useState<Record<number, boolean>>({});
  const [dialogTasks, setDialogTasks] = useState<Task[]>([]);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const isManual = summary?.external.llm.mode === 'manual';
  const intervalMin = summary?.minPublishIntervalMinutes ?? 15;

  const countOf = (id: number): number => counts[id] ?? RUN_DEFAULT_COUNT;
  const setCount = (id: number, v: number): void =>
    setCounts((c) => ({ ...c, [id]: Number.isFinite(v) ? v : RUN_DEFAULT_COUNT }));

  const publishBusy = (a: AccountOverview): boolean =>
    a.queueDepth > 0 || a.reviewing > 0 || a.publishing > 0;

  const onPublish = async (acc: AccountOverview) => {
    if (publishBusy(acc) || acc.circuit === 'open') return;
    if (acc.status !== 'logged_in') {
      notify('warn', '账号未登录', '先在行内点「扫码登录」再发布');
      return;
    }
    if (acc.lastPublishAt) {
      const elapsedMs = Date.now() - new Date(acc.lastPublishAt).getTime();
      const intervalMs = intervalMin * 60_000;
      if (elapsedMs < intervalMs) {
        const waitMin = Math.max(1, Math.ceil((intervalMs - elapsedMs) / 60_000));
        notify('warn', `距上次发布不足 ${intervalMin} 分钟`, `请 ${waitMin} 分钟后重试`);
        return;
      }
    }

    const count = Math.min(Math.max(countOf(acc.id), RUN_MIN_COUNT), RUN_MAX_COUNT);
    setRunning((r) => ({ ...r, [acc.id]: true }));
    try {
      const r = await runOnce(count, acc.id);
      notify(
        'ok',
        `「${acc.name}」发布已启动：${r.message}`,
        `受理 ${r.accepted} 条 · 补采 ${r.crawled} 条 · 入队 ${r.enqueued} 条`,
      );
      if (isManual) {
        const list = await fetchTasks('fetched', acc.id).catch(() => [] as Task[]);
        if (list.length > 0) setDialogTasks(list);
      }
    } catch (e) {
      const msg = (e as Error).message;
      const quotaOut = msg.includes('今日已全部发完');
      notify(quotaOut ? 'warn' : 'bad', quotaOut ? '今日已全部发完' : '启动失败', msg);
    } finally {
      setRunning((r) => ({ ...r, [acc.id]: false }));
      await refresh();
    }
  };

  const onLogin = (id: number) =>
    void startLogin(id).catch((e: unknown) => notify('bad', '扫码失败', (e as Error).message));
  const onCheck = (acc: AccountOverview) =>
    void checkLogin(acc.id)
      .then((r) => {
        notify('info', `「${acc.name}」登录态：${r.status}`);
        return refresh();
      })
      .catch((e: unknown) => notify('bad', '检查失败', (e as Error).message));
  const onReset = (acc: AccountOverview) =>
    void resetLogin(acc.id)
      .then(() => {
        notify('warn', `已清除「${acc.name}」的浏览器登录态`);
        return refresh();
      })
      .catch((e: unknown) => notify('bad', '重置失败', (e as Error).message));
  const onResume = (acc: AccountOverview) =>
    void resumeCircuit(acc.id)
      .then(() => {
        notify('ok', `「${acc.name}」已恢复，队列继续`);
        return refresh();
      })
      .catch((e: unknown) => notify('bad', '恢复失败', (e as Error).message));

  const onSwitch = (acc: AccountOverview) =>
    void switchAccount(acc.id).catch((e: unknown) => notify('bad', '切换失败', (e as Error).message));
  const onAddAccount = async () => {
    const name = newName.trim();
    if (!name) {
      notify('bad', '账号名不能为空', '填一个你自己分得清的名字');
      return;
    }
    setBusy(true);
    try {
      await createAccount(name);
      setNewName('');
      notify('ok', `账号「${name}」已创建`, '点行内「扫码登录」就能用');
      await refresh();
    } catch (e) {
      notify('bad', '新建账号失败', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const onRemoveAccount = async (acc: AccountOverview) => {
    if (!window.confirm(`删除账号「${acc.name}」？没有产出过任务的账号才能删。`)) return;
    setBusy(true);
    try {
      const r = await removeAccount(acc.id);
      notify('warn', `账号「${acc.name}」已删除`, `清掉 ${r.sourcesRemoved} 条素材`);
      await refresh();
    } catch (e) {
      notify('bad', '删除账号失败', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onDialogDone = (): void => {
    setDialogTasks([]);
    void refresh();
  };

  return (
    <main className="view">
      <div className="lacct-head">
        <div>
          <h2 className="lacct-title">账号状态</h2>
          <p className="lacct-sub">每行一个账号：状态、数据看板、登录与发布都在这里；其余配置在「设置」页。</p>
        </div>
        {accounts.length > 1 && <span className="badge badge-teal">{accounts.length} 个账号</span>}
      </div>

      <div className="card" style={{ marginTop: 8 }}>
        <div className="card-h" style={{ paddingBottom: 0, borderBottom: 'none' }}>
          <h3>新建账号</h3>
          <span className="sub">每个头条账号独立浏览器会话，需各自扫码一次</span>
          <span className="spacer" />
          <div className="row" style={{ margin: 0 }}>
            <input
              placeholder="新账号名，如 toutiao-二号"
              value={newName}
              aria-label="新账号名"
              data-testid="new-account-name"
              onChange={(e) => setNewName(e.target.value)}
            />
            <button
              className="btn btn-sm btn-primary"
              disabled={busy}
              data-testid="add-account"
              onClick={() => void onAddAccount()}
            >
              <Icon name="i-account" />
              新建账号
            </button>
          </div>
        </div>
      </div>

      <div className="lacct-tbl-wrap" style={{ marginTop: 16 }}>
        <table className="tbl lacct-tbl" data-testid="launcher-table">
          <thead>
            <tr>
              <th>账号</th>
              <th>状态</th>
              <th>数据看板</th>
              <th>登录</th>
              <th>发布条数</th>
              <th>发布</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => {
              const s = statusInfo(a);
              const exhausted = a.remaining <= 0;
              const isBusy = publishBusy(a);
              const disabled =
                isBusy || a.status !== 'logged_in' || a.circuit === 'open' || exhausted || running[a.id];
              const isOn = a.id === activeId;
              return (
                <tr key={a.id} data-testid={`launcher-account-${a.id}`}>
                  <td>
                    <div className="lacct-name">
                      <b>{a.name}</b>
                      {isOn && <span className="badge badge-teal">当前</span>}
                    </div>
                  </td>
                  <td>
                    <span className={`status status-${s.tone}`} data-testid={`status-${a.id}`}>
                      {s.label}
                    </span>
                  </td>
                  <td>
                    <div className="lacct-dash">
                      <span>
                        今日 <b>{a.usedToday}</b>/{a.dailyPublishLimit}
                      </span>
                      <span>
                        剩余 <b>{a.remaining}</b>
                      </span>
                      <span>
                        信用 <b>{a.creditScore ?? '—'}</b>
                      </span>
                      <span>
                        队列 <b>{a.queueDepth}</b>
                      </span>
                      <span>
                        发布中 <b>{a.publishing}</b>
                      </span>
                      <span>
                        待质检 <b>{a.reviewing}</b>
                      </span>
                      <span className={a.failed > 0 ? 'txt-bad' : ''}>
                        失败 <b>{a.failed}</b>
                      </span>
                      <span className={a.failedToday > 0 ? 'txt-bad' : ''}>
                        今日失败 <b>{a.failedToday}</b>
                      </span>
                      <span className="lacct-last">最后发布 {ago(a.lastPublishAt)}</span>
                    </div>
                  </td>
                  <td>
                    {a.status === 'logged_in' ? (
                      <button
                        className="btn btn-sm"
                        data-testid={`check-${a.id}`}
                        onClick={() => void onCheck(a)}
                      >
                        检查登录态
                      </button>
                    ) : (
                      <button
                        className="btn btn-sm btn-primary"
                        data-testid={`login-${a.id}`}
                        onClick={() => void onLogin(a.id)}
                      >
                        <Icon name="i-refresh" />
                        扫码登录
                      </button>
                    )}
                  </td>
                  <td>
                    <input
                      type="number"
                      className="lacct-count"
                      min={RUN_MIN_COUNT}
                      max={RUN_MAX_COUNT}
                      value={countOf(a.id)}
                      aria-label={`${a.name} 发布条数`}
                      data-testid={`run-count-${a.id}`}
                      disabled={disabled}
                      onChange={(e) => setCount(a.id, Number(e.target.value))}
                    />
                  </td>
                  <td>
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={disabled}
                      data-testid={`publish-${a.id}`}
                      title={
                        isBusy
                          ? '发布进行中，无需重复点击'
                          : a.status !== 'logged_in'
                            ? '账号未登录，先点「扫码登录」再发布'
                            : a.circuit === 'open'
                              ? '账号已熔断，请先恢复'
                              : exhausted
                                ? '今日已全部发完，次日 0 点重置'
                                : '按条数自动跑完采集 → 改写 → 配图 → 质检 → 发布'
                      }
                      onClick={() => void onPublish(a)}
                    >
                      <Icon name="i-bolt" />
                      {running[a.id] ? '发布中…' : exhausted ? '今日已发完' : '发布'}
                    </button>
                    {a.circuit === 'open' && (
                      <button
                        className="btn btn-sm btn-amber"
                        style={{ marginTop: 6 }}
                        data-testid={`resume-${a.id}`}
                        onClick={() => void onResume(a)}
                      >
                        恢复（人工）
                      </button>
                    )}
                  </td>
                  <td>
                    <div className="lacct-ops">
                      {isOn ? (
                        <span className="badge badge-teal">当前</span>
                      ) : (
                        <button
                          className="btn btn-sm"
                          data-testid={`switch-${a.id}`}
                          onClick={() => void onSwitch(a)}
                        >
                          切换
                        </button>
                      )}
                      {a.status === 'logged_in' && (
                        <button
                          className="btn btn-sm"
                          data-testid={`reset-${a.id}`}
                          onClick={() => void onReset(a)}
                        >
                          退出登录
                        </button>
                      )}
                      <button
                        className="btn btn-sm btn-danger"
                        data-testid={`delete-${a.id}`}
                        onClick={() => void onRemoveAccount(a)}
                      >
                        <Icon name="i-trash" />
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {accounts.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <div className="empty">加载中…</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {dialogTasks.length > 0 && (
        <ManualRewriteDialog
          tasks={dialogTasks}
          onClose={() => setDialogTasks([])}
          onDone={onDialogDone}
        />
      )}
    </main>
  );
}
