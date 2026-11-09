import type { AppConfigItem, SourceItem, Summary, Task, TaskStatus } from '@shared/types';

export function summaryFixture(overrides: Partial<Summary> = {}): Summary {
  return {
    account: {
      id: 1,
      name: 'toutiao-main',
      userDataDir: 'data/sessions/toutiao-main',
      storageStatePath: 'data/sessions/toutiao-main/storageState.json',
      status: 'logged_in',
      creditScore: 100,
      dailyPublishLimit: 50,
      usedToday: 12,
      lastLoginAt: '2026-10-15 08:42',
      lastPublishAt: null,
      circuit: 'closed',
      consecutiveFailures: 0,
    },
    counts: { reviewing: 5, queue: 1, publishedToday: 12, items: 13, running: 4, failed: 2 },
    quota: { used: 12, limit: 50, remaining: 38 },
    circuit: { state: 'closed', consecutiveFailures: 0, threshold: 3 },
    external: {
      toutiao: { ok: true, label: '已登录' },
      llm: { needLogin: false, label: '本地确定性改写', mode: 'simulated' },
      stock: { ok: true, label: 'Commons（免 Key）', provider: 'commons' },
    },
    runtimeMode: 'simulated',
    allowRealPublish: false,
    lastCrawlAt: new Date().toISOString(),
    lastPublishAt: null,
    minPublishIntervalMinutes: 15,
    nextPublishAt: null,
    // CHG-0002：契约要求 summary 一定带账号列表与当前账号 id
    activeAccountId: 1,
    accounts: [],
    ...overrides,
  };
}

export function taskFixture(id: number, status: TaskStatus): Task {
  return {
    id,
    accountId: 1,
    sourceItemId: 900 + id,
    status,
    promptTemplateId: null,
    imageStrategy: 'both',
    rewriteId: id,
    errorCode: status === 'failed' ? 'SIMILARITY' : null,
    retryCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function sourceFixture(id: number): SourceItem {
  return {
    id,
    accountId: 1,
    platformItemId: `71230000${id}`,
    author: '城市观察日记',
    content: '早上七点的菜市场已经很热闹了，卖菜的大姐说今年大白菜比去年便宜三成。',
    images: [],
    topics: ['生活'],
    likeCount: 12400,
    commentCount: 862,
    publishedAt: new Date().toISOString(),
    simhash: 'a3f19c2b',
    fetchedAt: new Date().toISOString(),
    taskId: null,
  };
}

export function configFixture(): AppConfigItem[] {
  return [
    {
      key: 'similarityThreshold',
      value: '0.45',
      valueType: 'number',
      label: '相似度闸门',
      hint: '越低越严',
      min: 0.2,
      max: 0.6,
      locked: false,
    },
    {
      key: 'runtime.mode',
      value: 'simulated',
      valueType: 'select',
      label: '运行模式',
      hint: 'simulated / real',
      min: null,
      max: null,
      locked: false,
      options: ['simulated', 'real'],
    },
  ];
}
