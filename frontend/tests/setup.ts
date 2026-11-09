import '@testing-library/jest-dom/vitest';
import { beforeEach, vi } from 'vitest';

/**
 * jsdom 没有真实 WebSocket；这里换成哑实现，
 * 让 StoreProvider 能挂载而不真的去连后端。
 */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  url: string;
  readyState = 1;
  listeners = new Map<string, Set<(ev: unknown) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, fn: (ev: unknown) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }

  send(): void {
    // 测试里不需要向后端发消息
  }

  close(): void {
    this.readyState = 3;
    for (const fn of this.listeners.get('close') ?? []) fn({});
  }

  /** 测试用：模拟后端推送一条消息 */
  emit(raw: string): void {
    for (const fn of this.listeners.get('message') ?? []) fn({ data: raw });
  }
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
});

export { FakeWebSocket };
