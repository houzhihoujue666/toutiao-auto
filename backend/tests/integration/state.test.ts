import { describe, it, expect } from 'vitest';
import { useFreshDb } from '../helpers/setup';
import {
  moveTask,
  canTransition,
  assertTransition,
  TRANSITIONS,
} from '../../src/orchestrator/stateMachine';
import { ensureAccount } from '../../src/infra/db/repo/account';
import { insertMany } from '../../src/infra/db/repo/source-item';
import * as taskRepo from '../../src/infra/db/repo/task';
import { AppError, isAppError } from '@shared/errors';
import { simhash } from '@shared/simhash';

describe('任务状态机（§4.1 七态）', () => {
  useFreshDb();

  it('正向链路 pending → published 全部允许', () => {
    expect(canTransition('pending', 'fetched')).toBe(true);
    expect(canTransition('fetched', 'rewritten')).toBe(true);
    expect(canTransition('rewritten', 'reviewing')).toBe(true);
    expect(canTransition('reviewing', 'publishing')).toBe(true);
    expect(canTransition('publishing', 'published')).toBe(true);
  });

  it('working 态都可以转 failed；published 是终态', () => {
    for (const s of ['pending', 'fetched', 'rewritten', 'reviewing', 'publishing'] as const) {
      expect(canTransition(s, 'failed')).toBe(true);
    }
    expect(TRANSITIONS['published']).toEqual([]);
    expect(canTransition('published', 'reviewing')).toBe(false);
  });

  it('非法流转直接报错（例如 published → publishing）', () => {
    expect(() => assertTransition('published', 'publishing')).toThrow(AppError);
  });

  it('只允许 failed → pending 的重入（重试）', () => {
    expect(canTransition('failed', 'pending')).toBe(true);
    expect(canTransition('failed', 'reviewing')).toBe(false);
  });

  it('moveTask 真的写库并推送状态', () => {
    const acc = ensureAccount('toutiao-main');
    const [sourceId] = insertMany(
      acc.id,
      [
        {
          platformItemId: 'test-1',
          author: 'tester',
          content: '一条用于测试的素材正文，长度足够通过质检下限。',
          images: [],
          topics: [],
          likeCount: 1,
          commentCount: 0,
          publishedAt: new Date().toISOString(),
        },
      ],
      (t) => simhash(t),
    );
    const task = taskRepo.createTask(acc.id, sourceId!);
    expect(task.status).toBe('pending');
    moveTask(task.id, 'fetched');
    expect(taskRepo.getTask(task.id)!.status).toBe('fetched');
  });

  it('任务不存在 → NOT_FOUND', () => {
    try {
      moveTask(9999, 'fetched');
      expect.unreachable();
    } catch (e) {
      expect(isAppError(e)).toBe(true);
      expect((e as AppError).code).toBe('NOT_FOUND');
    }
  });
});
