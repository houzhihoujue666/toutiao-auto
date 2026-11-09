/** 错误码表 —— 方案设计文档 v4.0 附录 D（唯一出处） */

export type ErrorCode =
  | 'DUPLICATE'
  | 'CRAWL_DOM_EMPTY'
  | 'LOGIN_UNKNOWN'
  | 'LOGIN_EXPIRED'
  | 'SELECTOR_TIMEOUT'
  | 'ALREADY_LOGGED_IN' // CHG-0003：已登录账号重复扫码
  | 'LLM_NEED_LOGIN'
  | 'LLM_SESSION_LOST'
  | 'LLM_TIMEOUT'
  | 'LLM_EMPTY'
  | 'PROMPT_MISSING_INPUT'
  | 'LENGTH'
  | 'SENSITIVE'
  | 'SIMILARITY'
  | 'LOW_READABILITY'
  | 'IMAGE_PROCESS_FAILED'
  | 'STOCK_FETCH_FAILED'
  | 'FIRST_PUBLISH_CHECK_FAILED'
  | 'PUBLISH_FAILED'
  | 'RATE_LIMITED'
  | 'QUOTA_EXHAUSTED'
  | 'CIRCUIT_OPEN'
  | 'DB_WRITE_FAILED'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'ACCOUNT_EXISTS' // CHG-0002：同名账号
  | 'INTERNAL';

export interface ErrorSpec {
  code: ErrorCode;
  phase: string;
  text: string;
  handle: string;
}

export const ERROR_SPECS: readonly ErrorSpec[] = [
  {
    code: 'DUPLICATE',
    phase: '采集',
    text: '指纹重复，内容与已有素材撞车',
    handle: '任务置 failed，不入库',
  },
  {
    code: 'CRAWL_DOM_EMPTY',
    phase: '采集',
    text: '旁听与 DOM 兜底都取不到内容',
    handle: '告警，多半是平台改版，跑 pnpm selftest',
  },
  {
    code: 'LOGIN_UNKNOWN',
    phase: '登录',
    text: '登录后跳转异常',
    handle: '截图 + 转人工，不静默重试',
  },
  {
    code: 'LOGIN_EXPIRED',
    phase: '任意',
    text: '使用过程中掉登录',
    handle: '账号置 expired，暂停任务并告警，需人工扫码',
  },
  {
    code: 'SELECTOR_TIMEOUT',
    phase: '页面',
    text: '选择器超时找不到元素',
    handle: '截图并暂停告警；试 1 次即停',
  },
  {
    code: 'LLM_NEED_LOGIN',
    phase: '改写',
    text: '大模型站点出现登录墙，当前没有可用会话',
    handle: '停在 fetched 等人登录，不重试、不代填账号',
  },
  {
    code: 'LLM_SESSION_LOST',
    phase: '改写',
    text: '大模型网页要求登录或被风控',
    handle: '转人工，不盲目重试',
  },
  {
    code: 'LLM_TIMEOUT',
    phase: '改写',
    text: '生成超时（>120 秒）',
    handle: '重试 1 次；连续 2 次熔断该适配器',
  },
  {
    code: 'LLM_EMPTY',
    phase: '改写',
    text: '返回空或全是客套话',
    handle: '判失败；在重试额度内换提示词再试',
  },
  {
    code: 'PROMPT_MISSING_INPUT',
    phase: '改写',
    text: '提示词缺少必填占位符（如原文为空）',
    handle: '直接报错，不许调模型',
  },
  { code: 'LENGTH', phase: '质检', text: '字数不在 50~2000 之间', handle: '直接失败' },
  { code: 'SENSITIVE', phase: '质检', text: '命中敏感词', handle: '直接失败' },
  { code: 'SIMILARITY', phase: '质检', text: '相似度 > 0.45', handle: '强化重写 1 次；仍超标拦截' },
  {
    code: 'LOW_READABILITY',
    phase: '质检',
    text: '可读性启发式不达标',
    handle: '只标记告警，交人工判断',
  },
  {
    code: 'IMAGE_PROCESS_FAILED',
    phase: '图片',
    text: 'sharp 处理失败',
    handle: '跳过该图，任务继续',
  },
  {
    code: 'STOCK_FETCH_FAILED',
    phase: '图片',
    text: '图库检索或下载失败 / Key 失效被限流',
    handle: '降级为只用洗过的原图',
  },
  {
    code: 'FIRST_PUBLISH_CHECK_FAILED',
    phase: '发布',
    text: '检测到「头条首发」被勾选',
    handle: '立即中止发布，红色告警',
  },
  { code: 'PUBLISH_FAILED', phase: '发布', text: '无成功标志', handle: '截图并重试 +1，3 次熔断' },
  {
    code: 'RATE_LIMITED',
    phase: '编排',
    text: '触发限速（间隔 / 日上限）',
    handle: '延后执行并告警',
  },
  {
    code: 'QUOTA_EXHAUSTED',
    phase: '编排',
    text: '当日发布额度已耗尽',
    handle: '不建任何任务，界面提示「今日已全部发完」，次日 0 点自动重置',
  },
  { code: 'CIRCUIT_OPEN', phase: '编排', text: '熔断已开启', handle: '停工，必须人工点「恢复」' },
  {
    code: 'DB_WRITE_FAILED',
    phase: '任意',
    text: '写库事务异常',
    handle: '中止当前任务，保留之前状态',
  },
  { code: 'NOT_FOUND', phase: '接口', text: '找不到对应资源', handle: '检查 ID 是否正确' },
  {
    code: 'VALIDATION_FAILED',
    phase: '接口',
    text: '入参校验不通过',
    handle: '按取值范围修正后重试',
  },
  { code: 'INTERNAL', phase: '任意', text: '未预期的内部错误', handle: '查看服务端日志' },
  {
    code: 'ACCOUNT_EXISTS',
    phase: '账号',
    text: '同名账号已存在',
    handle: '换一个账号名，或直接在列表里切换到那个账号',
  },
] as const;

const SPEC_MAP = new Map<string, ErrorSpec>(ERROR_SPECS.map((s) => [s.code, s]));

export function errorSpec(code: string): ErrorSpec | undefined {
  return SPEC_MAP.get(code);
}

export function errorHint(code: string): string {
  return SPEC_MAP.get(code)?.handle ?? '查看服务端日志';
}

export function errorText(code: string): string {
  return SPEC_MAP.get(code)?.text ?? '未预期的内部错误';
}

/** 红线：错误一律抛 AppError(code, message)，message 说人话 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly hint: string;

  constructor(code: ErrorCode, message?: string, hint?: string) {
    super(message ?? errorText(code));
    this.name = 'AppError';
    this.code = code;
    this.hint = hint ?? errorHint(code);
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
