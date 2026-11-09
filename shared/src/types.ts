/**
 * 核心类型契约 —— 方案设计文档 v4.0 §7.1
 * 机读：类型先落地，各方围绕合同并行开发；换实现时主流程不动。
 */

/* ───────────────── 任务状态（前后端共用同一份） ───────────────── */
export type TaskStatus =
  'pending' | 'fetched' | 'rewritten' | 'reviewing' | 'publishing' | 'published' | 'failed';

export const TASK_STATUSES: readonly TaskStatus[] = [
  'pending',
  'fetched',
  'rewritten',
  'reviewing',
  'publishing',
  'published',
  'failed',
] as const;

/* ───────────────── 运行模式（v4.1 新增，见方案 §3.6） ───────────────── */
/** simulated = 内置模拟数据源/模拟浏览器，离线可跑通全链路；real = 真实 Playwright 适配器 */
export type RuntimeMode = 'simulated' | 'real';
/** web = 网页版自动化；manual = 人工粘贴兜底；api = 付费 API（默认关）；simulated = 本地确定性改写 */
export type LlmMode = 'web' | 'manual' | 'api' | 'simulated';

/* ───────────────── 大模型适配器 ───────────────── */
export interface LlmWebAdapter {
  readonly id: string; // 'deepseek' | 'simulated' | ...
  ensureSession(): Promise<void>;
  rewrite(input: RewriteInput): Promise<string>; // 提示词进，生成文本出
  dispose(): Promise<void>;
}

export interface RewriteInput {
  template: string;
  originalText: string;
  maxLength?: number;
}

/* ───────────────── 图片：策略可切换，图库可插拔 ───────────────── */
export type ImageStrategy = 'dedup' | 'stock' | 'both';
export type StockProviderId = 'commons' | 'pexels' | 'local';

export interface ImageSource {
  /** 原图地址或本地文件路径 */
  url?: string;
  /** 原图字节（用 Uint8Array 而不是 Buffer，让 shared 不依赖 Node 类型） */
  buffer?: Uint8Array;
}

export interface ImageOption {
  taskId: number;
  strategy: ImageStrategy;
  /** 图库检索关键词（取自改写后正文） */
  keywords: string[];
  count: number;
}

export interface ProcessedImage {
  /** 相对路径（红线：数据库只存路径） */
  localPath: string;
  provider: 'original' | StockProviderId;
  license?: string;
  pageUrl?: string;
  author?: string;
  width?: number;
  height?: number;
}

export interface StockHit {
  provider: StockProviderId;
  providerId: string;
  pageUrl: string;
  license: string;
  author?: string;
  url: string;
  /** true = 离线生成的占位图（不是真实配图），真实模式下不得对外发布 */
  placeholder?: boolean;
}

export interface ImageProcessor {
  process(src: ImageSource[], opt: ImageOption): Promise<ProcessedImage[]>;
}

export interface StockProvider {
  readonly id: StockProviderId;
  needsApiKey(): boolean; // 只有 commons / local 返回 false
  search(keywords: string[], count: number): Promise<StockHit[]>;
}

/* ───────────────── 质检：阈值 ★0.45 ───────────────── */
export interface QualityReport {
  lengthOk: boolean;
  noSensitiveWord: boolean;
  similarity: number;
  similarityOk: boolean;
  readable: boolean;
  flags: string[]; // ['SENSITIVE:xxx','LOW_READABILITY']
  /** 硬指标是否全过（长度 + 敏感词 + 相似度） */
  passed: boolean;
  length: number;
}

export interface QualityChecker {
  check(original: string, rewritten: string): Promise<QualityReport>;
}

/* ───────────────── 采集 ───────────────── */
export interface CollectedItem {
  platformItemId: string;
  author: string;
  content: string;
  images: string[];
  topics: string[];
  likeCount: number;
  commentCount: number;
  publishedAt: string; // ISO
}

export interface CollectOptions {
  /** 时间窗：超过该小时数的内容直接丢弃（发旧闻扣 20 分） */
  timeWindowHours: number;
  limit: number;
  /** 热度权重：默认 点赞 + 评论 × 2 */
  heatWeights: { like: number; comment: number };
}

export interface CollectResult {
  items: CollectedItem[];
  /** 命中时间窗并被丢弃的条数 */
  staleCount: number;
  /** 命中选题黑名单被丢弃的条数 */
  blockedCount: number;
  /** 指纹去重掉的条数 */
  dedupedCount: number;
  /** 实际入库条数 */
  insertedCount: number;
  elapsedMs: number;
}

/* ───────────────── 一键运行（§E.7：填条数 → 采集到发布全自动） ───────────────── */
export interface RunResult {
  /** 用户填的条数 */
  requested: number;
  /** 实际受理条数 = min(count, 当日剩余额度) */
  accepted: number;
  /** 启动前剩余额度 */
  remaining: number;
  /** 本次补采入库条数 */
  crawled: number;
  /** 本次新建任务数 */
  created: number;
  /** 已进入发布队列条数 */
  enqueued: number;
  taskIds: number[];
  /** 给界面直接展示的中文结论 */
  message: string;
}

export interface Crawler {
  collect(opt: CollectOptions): Promise<CollectResult>;
}

/* ───────────────── 发布：declaration 类型层面锁死 ───────────────── */
export interface PublishInput {
  text: string;
  images: string[]; // 相对路径
  topic?: string; // 不含 #
  declaration: '取材网络';
  draft?: boolean;
}

export interface PublishResult {
  url?: string;
  screenshotPath: string;
  status: 'success' | 'draft';
  firstPublishChecked: boolean;
}

export interface Publisher {
  publish(input: PublishInput): Promise<PublishResult>;
}

/* ───────────────── 数据库实体 ───────────────── */
export type AccountStatus = 'logged_in' | 'logged_out' | 'expired';
export type CircuitState = 'closed' | 'open';

export interface Account {
  id: number;
  name: string;
  userDataDir: string;
  storageStatePath: string | null;
  status: AccountStatus;
  creditScore: number | null;
  dailyPublishLimit: number;
  usedToday: number;
  lastLoginAt: string | null;
  /** 最小发布间隔依据（★15 分钟） */
  lastPublishAt: string | null;
  circuit: CircuitState;
  consecutiveFailures: number;
}

/**
 * 账号概览 —— CHG-0002 多账号：账号列表里每条都要能直接显示「还剩多少额度 / 队列积压多少」，
 * 避免前端为了画列表再逐个拉详情。
 */
export interface AccountOverview extends Account {
  /** 当日剩余额度 = max(0, limit - usedToday) */
  remaining: number;
  /** 该账号自己的发布队列长度（不是全局队列） */
  queueDepth: number;
  reviewing: number;
  failed: number;
  /** 今日（按 updated_at 落在当天）失败的任务数 */
  failedToday: number;
  /** 该账号正在发布中的任务数（CHG-0003：用于「发布中禁用一键发布」判据） */
  publishing: number;
}

export interface SourceItem {
  id: number;
  accountId: number;
  platformItemId: string;
  author: string;
  content: string;
  images: string[];
  topics: string[];
  likeCount: number;
  commentCount: number;
  publishedAt: string | null;
  simhash: string;
  fetchedAt: string;
  taskId: number | null;
}

export interface Task {
  id: number;
  accountId: number;
  sourceItemId: number;
  status: TaskStatus;
  promptTemplateId: number | null;
  imageStrategy: ImageStrategy;
  rewriteId: number | null;
  errorCode: string | null;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface RewriteResult {
  id: number;
  taskId: number;
  originalText: string;
  rewrittenText: string;
  similarity: number;
  qualityFlags: string[];
  images: string[];
  simhash: string | null;
  createdAt: string;
}

export interface PublishRecord {
  id: number;
  taskId: number;
  publishedUrl: string | null;
  screenshotPath: string | null;
  status: 'success' | 'draft' | 'failed';
  firstPublishConfirmed: boolean;
  publishedAt: string;
}

export interface PromptTemplate {
  id: number;
  name: string;
  content: string;
  variant: string | null;
  isDefault: boolean;
}

export interface TaskLog {
  id: number;
  taskId: number | null;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  context: Record<string, unknown>;
  createdAt: string;
}

export interface StockImageRow {
  id: number;
  taskId: number | null;
  provider: string;
  providerId: string;
  pageUrl: string | null;
  license: string;
  author: string | null;
  localPath: string;
}

export interface AppConfigItem {
  key: string;
  value: string;
  valueType: 'number' | 'string' | 'password' | 'boolean' | 'select' | 'textarea';
  label: string;
  hint: string;
  min: number | null;
  max: number | null;
  locked: boolean;
  options?: string[];
}

/* ───────────────── 工作台看板 ───────────────── */
export interface Summary {
  account: Account;
  /** 全部账号概览（含当前账号），CHG-0002 */
  accounts: AccountOverview[];
  /** 当前操作的目标账号 id（持久化在 app_config.activeAccountId） */
  activeAccountId: number;
  counts: {
    reviewing: number;
    queue: number;
    publishedToday: number;
    items: number;
    running: number;
    failed: number;
  };
  quota: { used: number; limit: number; remaining: number };
  circuit: { state: CircuitState; consecutiveFailures: number; threshold: number };
  external: {
    toutiao: { ok: boolean; label: string };
    llm: { needLogin: boolean; label: string; mode: string };
    stock: { ok: boolean; label: string; provider: string };
  };
  runtimeMode: RuntimeMode;
  allowRealPublish: boolean;
  lastCrawlAt: string | null;
  /** 最近一次成功发布的时间（ISO 字符串），用于前端计算是否满足最小发布间隔 */
  lastPublishAt: string | null;
  /** 当前最小发布间隔（分钟），前端用来判断能否一键开始 */
  minPublishIntervalMinutes: number;
  /** 队列里下一条最早可发时间（ISO）；队列为空时为 null，用于界面倒计时提示 */
  nextPublishAt: string | null;
}

/* ───────────────── 接口统一返回 ───────────────── */
export interface ApiOk<T> {
  ok: true;
  data: T;
}
export interface ApiErr {
  ok: false;
  error: { code: string; message: string; hint: string };
}
export type ApiResult<T> = ApiOk<T> | ApiErr;

export function ok<T>(data: T): ApiOk<T> {
  return { ok: true, data };
}
export function err(code: string, message: string, hint: string): ApiErr {
  return { ok: false, error: { code, message, hint } };
}

/* ───────────────── WebSocket 推送（§7.3） ───────────────── */
export type WsMessage =
  | {
      type: 'log';
      ts: string;
      payload: {
        level: TaskLog['level'];
        taskId: number | null;
        message: string;
        context?: Record<string, unknown>;
      };
    }
  | {
      type: 'qr';
      ts: string;
      /** CHG-0003：二维码按账号区分，支持多账号同时登录（与 infra/bus.ts 保持一致） */
      payload: { accountId: number; name: string; image: string };
    }
  | {
      type: 'account';
      ts: string;
      /** CHG-0002：多账号后必须知道这条推送属于哪个账号 */
      payload: { id: number; status: AccountStatus; creditScore: number | null; circuit: CircuitState };
    }
  | {
      type: 'task';
      ts: string;
      payload: {
        taskId: number;
        from: TaskStatus | null;
        to: TaskStatus;
        errorCode?: string | null;
      };
    }
  | { type: 'pipeline'; ts: string; payload: Record<string, number> }
  | {
      type: 'alert';
      ts: string;
      payload: { level: TaskLog['level']; code: string; message: string };
    };
