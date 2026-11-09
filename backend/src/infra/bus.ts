import type { AccountStatus, CircuitState, TaskLog, TaskStatus } from '@shared/types';

/**
 * 事件总线 —— §4.2：界面不轮询，订阅 WebSocket 收推送
 * 推送前必须脱敏（cookie / token / phone / password / qr → [REDACTED]）
 */

export type BusEvent =
  | {
      type: 'log';
      payload: {
        level: TaskLog['level'];
        taskId: number | null;
        message: string;
        context?: Record<string, unknown>;
      };
    }
  | {
      type: 'qr';
      // CHG-0003：二维码按账号区分，支持多账号同时登录
      payload: { accountId: number; name: string; image: string };
    }
  | {
      type: 'account';
      // CHG-0002：多账号后每条推送必须标明属于哪个账号
      payload: {
        id: number;
        status: AccountStatus;
        creditScore: number | null;
        circuit: CircuitState;
      };
    }
  | {
      type: 'task';
      payload: {
        taskId: number;
        from: TaskStatus | null;
        to: TaskStatus;
        errorCode?: string | null;
      };
    }
  | { type: 'pipeline'; payload: Record<string, number> }
  | { type: 'alert'; payload: { level: TaskLog['level']; code: string; message: string } };

type Listener = (e: BusEvent & { ts: string }) => void;

const listeners = new Set<Listener>();

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function publish(e: BusEvent): void {
  const full = { ...e, ts: new Date().toISOString() };
  for (const l of listeners) {
    try {
      l(full);
    } catch {
      /* 订阅者异常不影响主流程 */
    }
  }
}

export function publishAlert(level: TaskLog['level'], code: string, message: string): void {
  publish({ type: 'alert', payload: { level, code, message } });
}
