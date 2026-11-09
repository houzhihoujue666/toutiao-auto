/**
 * 发布队列 —— §4.3：同一账号严格串行，同一时刻只允许一个任务处于 publishing
 * CHG-0002：这里**不再导出进程级单例**。多账号下共享一个队列会让「A 的发布把 B 堵死」，
 * 也会让「同账号串行」退化成「全进程串行」，两者都不是我们想要的 —— 每个 Pipeline 实例持有自己的队列。
 */
export interface QueueItem {
  taskId: number;
  enqueuedAt: number;
}

export class PublishQueue {
  private items: QueueItem[] = [];
  private busy = false;

  enqueue(taskId: number): void {
    if (this.items.some((i) => i.taskId === taskId)) return;
    this.items.push({ taskId, enqueuedAt: Date.now() });
  }

  peek(): number | undefined {
    return this.items[0]?.taskId;
  }

  remove(taskId: number): void {
    this.items = this.items.filter((i) => i.taskId !== taskId);
  }

  position(taskId: number): number {
    const idx = this.items.findIndex((i) => i.taskId === taskId);
    return idx < 0 ? -1 : idx + 1;
  }

  /** 预计发出时间：按最小间隔顺延 */
  eta(taskId: number, intervalMin: number): number {
    const pos = this.position(taskId);
    if (pos <= 0) return 0;
    return pos * intervalMin * 60_000;
  }

  size(): number {
    return this.items.length;
  }

  list(): QueueItem[] {
    return [...this.items];
  }

  tryLock(): boolean {
    if (this.busy) return false;
    this.busy = true;
    return true;
  }

  unlock(): void {
    this.busy = false;
  }

  isBusy(): boolean {
    return this.busy;
  }
}
