import * as taskRepo from '../infra/db/repo/task';
import { publish } from '../infra/bus';
import { log } from '../infra/logger';
import { AppError } from '@shared/errors';
import type { TaskStatus } from '@shared/types';

/**
 * 状态机 —— §4.1：七态流转，数据库是唯一进度来源（ADR-7）
 * 红线：先落库再改状态
 */

export const TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ['fetched', 'failed'],
  fetched: ['rewritten', 'failed'],
  rewritten: ['reviewing', 'failed'],
  reviewing: ['publishing', 'failed'],
  publishing: ['published', 'failed'],
  published: [],
  failed: ['pending'],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransition(from, to)) {
    throw new AppError(
      'VALIDATION_FAILED',
      `不允许的状态流转：${from} → ${to}`,
      '检查任务当前状态；失败任务需要先点「重试」',
    );
  }
}

/** 迁移状态：先校验，再落库，再推送 */
export function moveTask(
  taskId: number,
  to: TaskStatus,
  errorCode: string | null = null,
): TaskStatus {
  const task = taskRepo.getTask(taskId);
  if (!task) throw new AppError('NOT_FOUND', `任务 #${taskId} 不存在`, '刷新列表后重试');
  const from = task.status;
  if (from === to) return to;
  assertTransition(from, to);
  taskRepo.updateStatus(taskId, to, errorCode);
  log('info', `task ${taskId} status -> ${to}`, { from, errorCode });
  publish({ type: 'task', payload: { taskId, from, to, errorCode } });
  return to;
}
