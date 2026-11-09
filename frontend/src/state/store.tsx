import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  Summary,
  TaskStatus,
  AccountStatus,
  AccountOverview,
  CircuitState,
} from '@shared/types';
import { activateAccount, fetchSummary } from '../lib/api';

/**
 * 全局状态 —— §7.3：界面不轮询，订阅 WebSocket 单向推送；抽屉日志、告警、二维码都来自这里。
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type ToastKind = 'info' | 'ok' | 'warn' | 'bad';

export interface LogEntry {
  id: string;
  ts: string;
  level: LogLevel;
  taskId: number | null;
  message: string;
}

export interface AlertItem {
  id: string;
  ts: string;
  level: LogLevel;
  code: string;
  message: string;
}

export interface ToastItem {
  id: string;
  kind: ToastKind;
  text: string;
  hint?: string;
}

interface StoreValue {
  summary: Summary | null;
  connected: boolean;
  logs: LogEntry[];
  alerts: AlertItem[];
  toasts: ToastItem[];
  /** CHG-0003 修复：二维码按账号 id 区分，支持多账号同时登录 */
  qr: Record<number, { name: string; image: string }>;
  /**
   * 后端推送引起的「流水线变了」计数。明细页把它放进 effect 依赖里，
   * 这样任务推进到下一状态时列表会自动重取，而不是停在打开页面那一刻的快照上。
   */
  version: number;
  /** CHG-0002：全部账号概览（看板 / 顶栏切换 / 设置页共用一份） */
  accounts: AccountOverview[];
  /** 当前账号 id（后端持久化在 app_config.activeAccountId） */
  activeId: number;
  /**
   * summary 是否已经拉过一轮（成功或失败都算）。
   * CHG-0002：明细页要等这一步完成才知道「当前是哪个账号」，否则会在挂载后再多拉一次列表。
   */
  summaryLoaded: boolean;
  refresh: () => Promise<void>;
  notify: (kind: ToastKind, text: string, hint?: string) => void;
  dismissToast: (id: string) => void;
  /** 清除全部待登录二维码（手动关闭） */
  clearQr: () => void;
  /** 只关掉某个账号的二维码（该账号登录成功或用户手动取消） */
  dismissQr: (accountId: number) => void;
  /** 切换当前账号：成功后重取看板，各页面跟着变 */
  switchAccount: (id: number) => Promise<void>;
  /** 登录态推送（二维码扫码完成后由 WS 推来） */
  applyStatus: (payload: {
    id: number;
    status: AccountStatus;
    creditScore: number | null;
    circuit: CircuitState;
  }) => void;
}

const StoreContext = createContext<StoreValue | null>(null);

const MAX_LOGS = 400;
const MAX_ALERTS = 40;

let seq = 0;
const nextId = (prefix: string): string => `${prefix}-${Date.now()}-${(seq += 1)}`;

export function StoreProvider({ children }: { children: ReactNode }): ReactNode {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [connected, setConnected] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [qr, setQr] = useState<Record<number, { name: string; image: string }>>({});
  const [summaryLoaded, setSummaryLoaded] = useState(false);
  const [version, setVersion] = useState(0);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSummary(await fetchSummary());
    } catch {
      // 后端没起来时保持上一次数据，由连接状态体现
    } finally {
      // CHG-0002：success / fail 都算「已经知道当前账号是谁了」，子页面据此才去拉列表
      setSummaryLoaded(true);
    }
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      setVersion((v) => v + 1);
      void refresh();
    }, 250);
  }, [refresh]);

  const dismissToast = useCallback((id: string) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback(
    (kind: ToastKind, text: string, hint?: string) => {
      const id = nextId('toast');
      setToasts((list) => [...list, { id, kind, text, hint }].slice(-4));
      setTimeout(() => dismissToast(id), kind === 'bad' ? 8000 : 4500);
    },
    [dismissToast],
  );

  const clearQr = useCallback(() => setQr({}), []);
  const dismissQr = useCallback(
    (accountId: number) => setQr((prev) => {
      const next = { ...prev };
      delete next[accountId];
      return next;
    }),
    [],
  );

  /**
   * 登录态推送（CHG-0002）。
   * 推送带账号 id：是当前账号就更新看板里的 account，同时更新账号列表里那一条，
   * 这样「另一个账号扫码完成」也能在列表上看到状态变化，不会被误当成当前账号。
   */
  const applyStatus = useCallback<StoreValue['applyStatus']>((payload) => {
    setSummary((prev) => {
      if (!prev) return prev;
      const accounts = prev.accounts.map((a) =>
        a.id === payload.id
          ? {
              ...a,
              status: payload.status,
              creditScore: payload.creditScore,
              circuit: payload.circuit,
            }
          : a,
      );
      // 只有「这条推送正是当前账号」时，才更新看板上那个大 account 面板
      const account =
        prev.activeAccountId === payload.id
          ? {
              ...prev.account,
              status: payload.status,
              creditScore: payload.creditScore,
              circuit: payload.circuit,
            }
          : prev.account;
      return { ...prev, accounts, account };
    });
  }, []);

  const switchAccount = useCallback(
    async (id: number) => {
      try {
        await activateAccount(id);
        await refresh();
        notify('info', '已切换账号', '看板、素材池与任务列表都跟着切过去了');
      } catch (e) {
        notify('bad', '切换账号失败', (e as Error).message);
      }
    },
    [notify, refresh],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${scheme}://${window.location.host}/ws`);
    ws.addEventListener('open', () => setConnected(true));
    ws.addEventListener('close', () => setConnected(false));
    ws.addEventListener('error', () => setConnected(false));
    ws.addEventListener('message', (ev) => {
      let msg: {
        type: string;
        ts?: string;
        payload: Record<string, unknown>;
      };
      try {
        msg = JSON.parse(String(ev.data)) as typeof msg;
      } catch {
        return;
      }
      const ts = msg.ts ?? new Date().toISOString();
      switch (msg.type) {
        case 'log': {
          const p = msg.payload as { level?: LogLevel; taskId?: number | null; message?: string };
          setLogs((list) =>
            [
              {
                id: nextId('log'),
                ts,
                level: p.level ?? 'info',
                taskId: p.taskId ?? null,
                message: p.message ?? '',
              },
              ...list,
            ].slice(0, MAX_LOGS),
          );
          break;
        }
        case 'alert': {
          const p = msg.payload as { level?: LogLevel; code?: string; message?: string };
          setAlerts((list) =>
            [
              {
                id: nextId('alert'),
                ts,
                level: p.level ?? 'warn',
                code: p.code ?? '',
                message: p.message ?? '',
              },
              ...list,
            ].slice(0, MAX_ALERTS),
          );
          notify(
            p.level === 'error' ? 'bad' : p.level === 'warn' ? 'warn' : 'ok',
            p.message ?? '发生异常',
            p.code ? `错误码 ${p.code}` : undefined,
          );
          break;
        }
        case 'qr':
          // CHG-0003 修复：二维码按账号区分，支持多账号同时登录
          setQr((prev) => ({
            ...prev,
            [Number(msg.payload.accountId)]: {
              name: String(msg.payload.name ?? ''),
              image: String(msg.payload.image ?? ''),
            },
          }));
          break;
        case 'account': {
          const p = msg.payload as {
            id: number;
            status: AccountStatus;
            creditScore: number | null;
            circuit: CircuitState;
          };
          applyStatus(p);
          if (p.status === 'logged_in') {
            // 只清掉「这个账号」的二维码，不要误伤正在登录的其他账号
            dismissQr(p.id);
            notify('ok', '登录成功，会话已存到本机');
          }
          scheduleRefresh();
          break;
        }
        case 'task': {
          const p = msg.payload as { to: TaskStatus };
          if (p.to === 'published') notify('ok', `任务已发布成功`);
          scheduleRefresh();
          break;
        }
        case 'pipeline':
          scheduleRefresh();
          break;
        default:
          break;
      }
    });
    return () => {
      ws.close();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [applyStatus, notify, scheduleRefresh]);

  const value = useMemo<StoreValue>(
    () => ({
      summary,
      connected,
      logs,
      alerts,
      toasts,
      qr,
      version,
      accounts: summary?.accounts ?? [],
      activeId: summary?.activeAccountId ?? 0,
      summaryLoaded,
      refresh,
      notify,
      dismissToast,
      clearQr,
      dismissQr,
      switchAccount,
      applyStatus,
    }),
    [
      summary,
      connected,
      logs,
      alerts,
      toasts,
      qr,
      version,
      summaryLoaded,
      refresh,
      notify,
      dismissToast,
      clearQr,
      dismissQr,
      switchAccount,
      applyStatus,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const v = useContext(StoreContext);
  if (!v) throw new Error('useStore 必须在 StoreProvider 内使用');
  return v;
}
