import { hasSuccessRecord } from '../../infra/db/repo/publish-record';
import { AppError } from '@shared/errors';

/**
 * 发布幂等 —— §4.3 / 红线 7
 * 进入 published 前先查 publish_record 是否已有成功记录；有则跳过，绝不重复发。
 */

export function alreadyPublished(taskId: number): boolean {
  return hasSuccessRecord(taskId);
}

export function assertNotPublished(taskId: number): void {
  if (alreadyPublished(taskId)) {
    throw new AppError(
      'PUBLISH_FAILED',
      `任务 #${taskId} 已经发布成功过，拒绝重复发布`,
      '这是一条保护：重复发布不可逆。若确需重发，请新建任务',
    );
  }
}
