import type {
  ApiResult,
  AccountOverview,
  CollectResult,
  RunResult,
  SourceItem,
  Summary,
  Task,
  AppConfigItem,
  PromptTemplate,
  RewriteResult,
  PublishRecord,
  StockImageRow,
  TaskStatus,
} from '@shared/types';

/**
 * 后端接口封装 —— §7.1 契约：统一 { ok, data } / { ok:false, error } 信封
 * 错误一律抛成带「原因 + 下一步」的 Error，页面直接显示即可（§7.5 错误提示口径）
 */

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => null)) as ApiResult<T> | null;
  if (!body) throw new Error(`后端没有返回可解析的结果（${path}）`);
  if (!body.ok) {
    const { code, message, hint } = body.error;
    throw new Error(`${message}（${code}）${hint ? ` · 下一步：${hint}` : ''}`);
  }
  return body.data;
}

const get = <T>(path: string): Promise<T> => request<T>(path);

const post = <T>(path: string, body?: unknown): Promise<T> =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

const put = <T>(path: string, body?: unknown): Promise<T> =>
  request<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) });

const patch = <T>(path: string, body?: unknown): Promise<T> =>
  request<T>(path, {
    method: 'PATCH',
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const del = <T>(path: string): Promise<T> => request<T>(path, { method: 'DELETE' });

/**
 * 账号维度入参 —— CHG-0002：所有「属于某个账号」的接口都支持传 accountId，
 * 不传后端就按当前账号处理。
 */
type Scoped = number | undefined;

function scopedQuery(accountId: Scoped): string {
  return accountId && accountId > 0 ? `?accountId=${accountId}` : '';
}

/* ───────────── 账号（CHG-0002） ───────────── */
export interface AccountsResult {
  accounts: AccountOverview[];
  activeId: number;
}
export const fetchAccounts = (): Promise<AccountsResult> => get<AccountsResult>('/api/accounts');
export const createAccount = (name: string): Promise<AccountsResult> =>
  post<AccountsResult>('/api/accounts', { name });
export const activateAccount = (id: number): Promise<AccountsResult> =>
  post<AccountsResult>(`/api/accounts/${id}/activate`);
export const removeAccount = (
  id: number,
): Promise<{ deleted: boolean; sessionDir: string; sourcesRemoved: number; activeId: number }> =>
  del<{ deleted: boolean; sessionDir: string; sourcesRemoved: number; activeId: number }>(
    `/api/accounts/${id}`,
  );

/* ───────────── 看板 ───────────── */
export const fetchSummary = (accountId?: number): Promise<Summary> =>
  get<Summary>(`/api/summary${scopedQuery(accountId)}`);

/* ───────────── 一键运行（§E.7） ───────────── */
export const runOnce = (count: number, accountId?: Scoped): Promise<RunResult> =>
  post<RunResult>('/api/run', { count, accountId });

/* ───────────── 采集 ───────────── */
export const startCrawl = (accountId?: Scoped): Promise<CollectResult> =>
  post<CollectResult>('/api/crawl', { accountId });

export interface ItemsResult {
  items: SourceItem[];
  total: number;
  lastCrawlAt: string | null;
  accountId: number;
}
export const fetchItems = (accountId?: Scoped): Promise<ItemsResult> =>
  get<ItemsResult>(`/api/items${scopedQuery(accountId)}`);

/* ───────────── 任务 ───────────── */
export const createTasks = (
  sourceIds: number[],
  accountId?: Scoped,
): Promise<{ created: number; tasks: Task[]; accountId: number }> =>
  post<{ created: number; tasks: Task[]; accountId: number }>('/api/tasks', { sourceIds, accountId });

/** CHG-0002：任务列表按账号过滤（不传 = 当前账号） */
export const fetchTasks = (status?: string, accountId?: Scoped): Promise<Task[]> => {
  const params = new URLSearchParams();
  if (status && status !== 'all') params.set('status', status);
  if (accountId && accountId > 0) params.set('accountId', String(accountId));
  const qs = params.toString();
  return get<{ tasks: Task[] }>(`/api/tasks${qs ? `?${qs}` : ''}`).then((r) => r.tasks);
};

export interface TaskDetail {
  task: Task;
  source: SourceItem | null;
  rewrite: RewriteResult | null;
  record: PublishRecord | null;
  stock: StockImageRow[];
  prompt: string;
  queue: { taskId: number; position: number; etaMs: number } | null;
  threshold: number;
}
export const fetchTaskDetail = (id: number): Promise<TaskDetail> =>
  get<TaskDetail>(`/api/tasks/${id}`);

export const publishTask = (id: number): Promise<{ taskId: number; status: TaskStatus }> =>
  post<{ taskId: number; status: TaskStatus }>(`/api/tasks/${id}/publish`);

export const discardTask = (id: number): Promise<{ taskId: number; status: TaskStatus }> =>
  post<{ taskId: number; status: TaskStatus }>(`/api/tasks/${id}/discard`);

export const retryTask = (id: number): Promise<{ taskId: number; status: TaskStatus }> =>
  post<{ taskId: number; status: TaskStatus }>(`/api/tasks/${id}/retry`);

export const deleteTask = (id: number): Promise<{ taskId: number; deleted: boolean }> =>
  del<{ taskId: number; deleted: boolean }>(`/api/tasks/${id}`);

export const saveRewrite = (
  id: number,
  rewrittenText: string,
): Promise<{ id: number; rewrittenText: string }> =>
  patch<{ id: number; rewrittenText: string }>(`/api/tasks/${id}/rewrite`, { rewrittenText });

/* ───────────── 登录与熔断（CHG-0002：作用于指定账号，默认当前账号） ───────────── */
export const startLogin = (accountId?: Scoped): Promise<{ qr: string; accountId: number }> =>
  post<{ qr: string; accountId: number }>('/api/account/login/start', { accountId });
export const checkLogin = (
  accountId?: Scoped,
): Promise<{ status: string; creditScore: number | null; accountId: number }> =>
  post<{ status: string; creditScore: number | null; accountId: number }>(
    '/api/account/login/check',
    { accountId },
  );
export const resetLogin = (accountId?: Scoped): Promise<unknown> =>
  post<unknown>('/api/account/login/reset', { accountId });
export const resumeCircuit = (accountId?: Scoped): Promise<unknown> =>
  post<unknown>('/api/account/circuit/resume', { accountId });
export const loginLlm = (): Promise<{ mode: string; message: string }> =>
  post<{ mode: string; message: string }>('/api/llm/login');
export const testLlm = (): Promise<{ model: string; ms: number; sample: string }> =>
  post<{ model: string; ms: number; sample: string }>('/api/llm/test');

/* ───────────── 设置 ───────────── */
export interface SettingsResult {
  editable: AppConfigItem[];
  locked: AppConfigItem[];
}
export const fetchSettings = (): Promise<SettingsResult> => get<SettingsResult>('/api/settings');
export const saveSettings = (
  values: Record<string, string>,
): Promise<{ saved: Record<string, string> }> =>
  put<{ saved: Record<string, string> }>('/api/settings', { values });

/* ───────────── 提示词模板 ───────────── */
export const fetchPromptTemplate = (): Promise<PromptTemplate> =>
  get<PromptTemplate>('/api/prompt-templates/default');
export const savePromptTemplate = (content: string): Promise<{ id: number; content: string }> =>
  put<{ id: number; content: string }>('/api/prompt-templates/default', { content });
