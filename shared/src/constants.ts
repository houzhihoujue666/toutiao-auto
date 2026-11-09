/**
 * 定案值总表 —— 方案设计文档 v4.0 §9（唯一真源）
 * 机读：代码常量、配置文件、界面显示必须与此表一致；不得在别处另写一套数值。
 */
import type { AppConfigItem } from './types';

/* ───────────────── 限额 ───────────────── */
export const DAILY_PUBLISH_LIMIT = 50; // ★ 条 / 账号 / 天
export const MIN_PUBLISH_INTERVAL_MIN = 15; // ★ 分钟
export const MAX_IMAGES_PER_POST = 9; // ★ 锁定：平台上限
/** 素材原文最短字数：低于此值视为「只有一句话/只有标题」，不进素材池（2026-10-21） */
export const MIN_SOURCE_CONTENT_LEN = 120;

/* ───────────────── 改写 ───────────────── */
export const DEFAULT_LLM_ID = 'deepseek';
/** ADR-0016：默认走「官方 API + 免费模型」，网页版只作离线与兜底；付费路径不许默认打开（继承 ADR-13 精神） */
export const DEFAULT_LLM_MODE = 'api';
/** api 模式默认值：智谱免费档 OpenAI 兼容端点 + 免费模型（2026-11-14 核对官方定价页；可在设置页改成任意兼容服务） */
export const DEFAULT_LLM_API_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
export const DEFAULT_LLM_API_MODEL = 'glm-4.7-flash';
export const REWRITE_TIMEOUT_MS = 120_000; // ★
export const REWRITE_RETRY = 1; // ★ 强化重写次数
export const DEFAULT_WORD_RANGE = '200-300'; // ★
export const PROMPT_TRUNCATE_LENGTH = 1200; // 超长截断，防网页生成超时

/**
 * 设置页「免费模型预设」下拉的唯一真源（ADR-0016）。
 * 这里只放稳定的接口地址与模型 ID，以及中性的服务商名：
 * 免费政策、额度、限流一律写在 docs/30-operations/免费大模型获取指南.md，
 * 哪家政策变了只改那份文档，不用改代码、不用重新发版。
 */
export interface FreeLlmPreset {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  note: string;
}

export const FREE_LLM_PRESETS: FreeLlmPreset[] = [
  {
    id: 'zhipu',
    label: '智谱（免费 · 推荐，已帮你选好）',
    baseUrl: DEFAULT_LLM_API_BASE_URL,
    model: DEFAULT_LLM_API_MODEL,
    note: '改写几百字够用；官网 open.bigmodel.cn',
  },
  {
    id: 'siliconflow',
    label: '硅基流动（备选）',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-7B-Instruct',
    note: '有没有免费型号，看官网「模型广场」',
  },
  {
    id: 'bailian',
    label: '阿里百炼（备选）',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    note: '送的额度会过期，以官网为准',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek（要花钱，默认不选）',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    note: '付费，默认不选；本项目不内置任何钥匙',
  },
];

/* ───────────────── 图片 ───────────────── */
export const DEFAULT_STOCK_PROVIDER = 'commons'; // ★ ADR-12：免注册免 Key
export const LICENSE_WHITELIST = ['CC0', 'Public Domain'] as const; // ★ 锁定
export const DEFAULT_IMAGE_STRATEGY = 'both' as const;

/* ───────────────── 选题黑名单（可调，§3.2） ───────────────── */
/**
 * 每行一类，行内用逗号分隔同义词；命中任一关键词的素材在采集时就丢掉，不进素材池。
 * 界面可改，改完立即生效。
 */
export const DEFAULT_BLOCKED_TOPICS = [
  '企业,公司,集团,财报,股价,上市,CEO,董事长,创始人',
  '医院,医疗,医生,患者,挂号,疾病,诊疗,药品,门诊',
  '乌克兰,俄乌,战争,俄军,炮击,战场,导弹,停火',
  '魏德尔,德国选择党,德国政治',
  '台湾,台海,赖清德,台独,两岸',
  '名人,明星,网红,艺人,八卦,绯闻',
  '政治,领导人,政府,国务院,人大,政协,政治局,钧正平,外交部,使馆,领馆,军人,军队,阅兵,制裁,外交,人民日报,央视,新华社,环球时报,新闻联播',
  '旭日旗,军国主义,侵华,靖国神社,大屠杀,慰安妇,抗战,抗日,731部队',
  '留学,海外学子,移民,绿卡',
  '恐吓,威胁,血腥,恐怖,惊悚,惨剧,尸体,自杀',
  '新冠,疫情,冠状病毒,核酸检测,隔离,方舱',
].join('\n');

export const WEBP_QUALITY = 82; // ★ 锁定
export const MAX_ROTATE_DEG = 1.2; // 洗图轻旋转幅度上界
export const MAX_IMAGES_TO_PROCESS = MAX_IMAGES_PER_POST; // ★ 最多 9 张

/* ───────────────── 质检 ───────────────── */
export const SIMILARITY_THRESHOLD = 0.45; // ★
export const MIN_LENGTH = 50; // ★
export const MAX_LENGTH = 2000; // ★
export const SIMILARITY_STRONGER_TARGET = 0.15; // 强化重写要求 15% 以下

/* ───────────────── 熔断 ───────────────── */
export const CIRCUIT_BREAK_FAILURES = 3; // ★
export const CREDIT_SCORE_ALERT_ON_ANY_DEDUCTION = true; // ★ 锁定

/* ───────────────── 拟人化（★ 锁定：风控相关，防误调） ───────────────── */
export const HUMANIZE = {
  TYPE_CHAR_MS: [40, 120] as const, // ms / 字
  SENTENCE_PAUSE_MS: [300, 600] as const,
  HOVER_BEFORE_CLICK_MS: [200, 500] as const,
  SCROLL_STEP_MS: [150, 400] as const,
  STEP_INTERVAL_MS: [500, 1500] as const,
} as const;

/* ───────────────── 多账号（CHG-0002 / ADR-0015） ───────────────── */
/**
 * 同时在发布的账号数上限（跨账号并发闸门）。
 * ★默认 1 = 「全进程一次只发一条」，与多账号改造前完全等价；调大是显式承担风控风险。
 */
export const DEFAULT_ACCOUNT_CONCURRENCY = 1;
export const MAX_ACCOUNT_CONCURRENCY = 5;

/* ───────────────── 性能与资源 ───────────────── */
export const END_TO_END_BUDGET_MS = 180_000; // ★ 单条 ≤3 分钟
export const CRAWL_BUDGET_MS = 60_000; // ★ 采集 20 条 ≤60 秒
export const IDLE_BROWSER_RELEASE_MIN = 5; // ★
export const CRAWL_DEFAULT_LIMIT = 20;
export const CRAWL_TIME_WINDOW_HOURS = 24; // 超时内容直接丢弃（发旧闻扣 20 分）
export const HEAT_WEIGHTS = { like: 1, comment: 2 } as const; // 热度 = 点赞 + 评论 × 2

/* ───────────────── 一键运行（§E.7） ───────────────── */
export const RUN_DEFAULT_COUNT = 5; // 「一键开始」输入框默认值
export const RUN_MIN_COUNT = 1; // 单次条数下限
export const RUN_MAX_COUNT = DAILY_PUBLISH_LIMIT; // 上限取日上限；填多了按当日剩余额度截断
export const RUN_CRAWL_MAX_ROUNDS = 3; // 素材池不够时最多补采 3 轮

/* ───────────────── 采集/发布入口 ───────────────── */
/** 热点页=头条热榜接口（2026-10-16 实测：直接返回 JSON，data 数组 50 条；旧路径多一层 /toutiao/ 会多一次跳转） */
export const TOUTIAO_HOT_URL = 'https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc';
export const TOUTIAO_PUBLISH_URL = 'https://mp.toutiao.com/profile_v4/weitoutiao/publish';
export const TOUTIAO_LOGIN_URL = 'https://mp.toutiao.com/';
export const DEEPSEEK_URL = 'https://chat.deepseek.com/';

/* ───────────────── 合规（★ 锁定：无配置出口） ───────────────── */
export const FORCE_DECLARATION = '取材网络' as const;
export const FORBID_FIRST_PUBLISH = false as const;

/* ───────────────── 服务 ───────────────── */
export const SERVER_HOST = '127.0.0.1'; // §8.4：只绑本机
export const DEFAULT_SERVER_PORT = 8787;
export const WEB_DEV_PORT = 5173; // 交付形态：浏览器打开 http://127.0.0.1:5173

/* ───────────────── 设置页可调项（ADR-10：可调项进 app_config，安全项锁死） ───────────────── */
export const APP_CONFIG_DEFS: readonly AppConfigItem[] = [
  {
    key: 'runtime.mode',
    value: 'simulated',
    valueType: 'select',
    label: '运行模式',
    hint: 'simulated 用内置模拟数据源离线跑通全链路；real 用真实 Playwright 适配器（需你本人扫码登录一次）。',
    min: null,
    max: null,
    locked: false,
    options: ['simulated', 'real'],
  },
  {
    key: 'allowRealPublish',
    value: 'false',
    valueType: 'boolean',
    label: '允许真实发布',
    hint: '关闭时真实模式也只走 Dry Run 存草稿；打开后才会真正发出去。',
    min: null,
    max: null,
    locked: false,
  },
  {
    key: 'dailyPublishLimit',
    value: String(DAILY_PUBLISH_LIMIT),
    valueType: 'number',
    label: '每日发布上限',
    hint: '到量后拒绝新任务入队，次日 0 点重置。',
    min: 1,
    max: 50,
    locked: false,
  },
  {
    key: 'minPublishIntervalMin',
    value: String(MIN_PUBLISH_INTERVAL_MIN),
    valueType: 'number',
    label: '最小发布间隔',
    hint: '两条发布之间的间隔，调小会提高风控风险。',
    min: 5,
    max: 120,
    locked: false,
  },
  {
    key: 'similarityThreshold',
    value: String(SIMILARITY_THRESHOLD),
    valueType: 'number',
    label: '相似度闸门',
    hint: '越低越严。超标先自动强化重写 1 次，仍超标就拦下。',
    min: 0.2,
    max: 0.6,
    locked: false,
  },
  {
    key: 'wordRange',
    value: DEFAULT_WORD_RANGE,
    valueType: 'string',
    label: '正文字数区间',
    hint: '填成「200-300」这种格式，会写进提示词的 {{wordRange}} 占位符。',
    min: null,
    max: null,
    locked: false,
  },
  {
    key: 'circuitBreakFailures',
    value: String(CIRCUIT_BREAK_FAILURES),
    valueType: 'number',
    label: '连续失败熔断',
    hint: '连续发布失败到这个次数就停工，必须由人手动恢复。',
    min: 2,
    max: 10,
    locked: false,
  },
  {
    key: 'rewriteTimeoutMs',
    value: String(REWRITE_TIMEOUT_MS),
    valueType: 'number',
    label: '改写等待上限',
    hint: '等大模型生成的最长时间，超时重试 1 次，仍失败就跳过。',
    min: 30_000,
    max: 300_000,
    locked: false,
  },
  {
    key: 'rewriteRetry',
    value: String(REWRITE_RETRY),
    valueType: 'number',
    label: '强化重写次数',
    hint: '相似度不达标时的重写次数，用完还超标就判失败。',
    min: 0,
    max: 3,
    locked: false,
  },
  {
    key: 'llm.mode',
    value: DEFAULT_LLM_MODE,
    valueType: 'select',
    label: '改写方式',
    hint: '选 api = 自动改写（默认，配免费 AI 不花钱）；web = 网页版（旧方式，容易出错，留作兜底）；manual = 自己粘贴改写结果；simulated = 测试用，不真的调 AI。',
    min: null,
    max: null,
    locked: false,
    options: ['web', 'manual', 'api', 'simulated'],
  },
  {
    key: 'llm.api.baseUrl',
    value: DEFAULT_LLM_API_BASE_URL,
    valueType: 'string',
    label: 'API 地址',
    hint: '已经帮你填好，一般不用改；想换一家 AI，用「免费 AI 改写」卡片里的下拉一键切换。',
    min: null,
    max: null,
    locked: false,
  },
  {
    key: 'llm.api.model',
    value: DEFAULT_LLM_API_MODEL,
    valueType: 'string',
    label: 'API 模型名',
    hint: '已经帮你填好，一般不用改；换服务商时照官网写的名字填，填错会提示「模型名不存在」。',
    min: null,
    max: null,
    locked: false,
  },
  {
    key: 'llm.api.key',
    value: '',
    valueType: 'password',
    label: 'API Key',
    hint: '把官网复制到的那串「钥匙」粘在这里；只存在你本机，不会上传、也不会发给别人。怎么申请看「免费 AI 改写」卡片的三步。',
    min: null,
    max: null,
    locked: false,
  },
  {
    key: 'stockProvider',
    value: DEFAULT_STOCK_PROVIDER,
    valueType: 'select',
    label: '默认图库',
    hint: 'commons 免注册免 Key（默认，本机不通会自动降级）；local 为离线自带图源；pexels 需自带免费 Key。',
    min: null,
    max: null,
    locked: false,
    options: ['commons', 'pexels', 'local'],
  },
  {
    key: 'imageStrategy',
    value: DEFAULT_IMAGE_STRATEGY,
    valueType: 'select',
    label: '图片策略',
    hint: 'dedup=只洗原图；stock=只换图库图；both=两者结合（默认）。',
    min: null,
    max: null,
    locked: false,
    options: ['dedup', 'stock', 'both'],
  },
  {
    key: 'crawl.blockedTopics',
    value: DEFAULT_BLOCKED_TOPICS,
    valueType: 'textarea',
    label: '选题黑名单',
    hint: '每行一类，行内用逗号分隔同义词；命中的素材采集时就丢掉，不进素材池。改完立即生效。',
    min: null,
    max: null,
    locked: false,
  },
  {
    key: 'stockApiKey',
    value: '',
    valueType: 'string',
    label: '图库 API Key',
    hint: '只有选用 pexels 时才需要；只存本机 .env，留空即回退免 Key 图源。',
    min: null,
    max: null,
    locked: false,
  },
  {
    key: 'minLength',
    value: String(MIN_LENGTH),
    valueType: 'number',
    label: '正文最少字数',
    hint: '低于这个值直接判不合格。',
    min: 20,
    max: 500,
    locked: false,
  },
  {
    key: 'maxLength',
    value: String(MAX_LENGTH),
    valueType: 'number',
    label: '正文最多字数',
    hint: '超过这个值同样拦下。',
    min: 500,
    max: 2000,
    locked: false,
  },
  {
    key: 'idleBrowserReleaseMin',
    value: String(IDLE_BROWSER_RELEASE_MIN),
    valueType: 'number',
    label: '空闲释放浏览器',
    hint: '空闲多久后关掉浏览器省内存，登录态在硬盘，不用重扫。',
    min: 1,
    max: 30,
    locked: false,
  },
  {
    key: 'accountConcurrencyLimit',
    value: String(DEFAULT_ACCOUNT_CONCURRENCY),
    valueType: 'number',
    label: '同时发布的账号数',
    hint: '多账号时的跨账号并发上限：每个账号内部永远串行（红线 9），这一项管的是「同时有几个账号在发」。调大会提高风控风险，默认 1 与单账号行为一致。',
    min: 1,
    max: MAX_ACCOUNT_CONCURRENCY,
    locked: false,
  },
] as const;

/** 锁定项：界面只展示不允许编辑（§9「锁定」列） */
export const LOCKED_CONFIG_ITEMS: readonly AppConfigItem[] = [
  {
    key: 'maxImagesPerPost',
    value: String(MAX_IMAGES_PER_POST),
    valueType: 'number',
    label: '单条最多图片',
    hint: '平台上限，改了也没用。',
    min: null,
    max: null,
    locked: true,
  },
  {
    key: 'stockLicenseWhitelist',
    value: LICENSE_WHITELIST.join(' / '),
    valueType: 'string',
    label: '图库许可白名单',
    hint: '§8.5：NC / ND / SA / BY 一律不用，无配置出口。',
    min: null,
    max: null,
    locked: true,
  },
  {
    key: 'webpQuality',
    value: String(WEBP_QUALITY),
    valueType: 'number',
    label: 'webp 质量',
    hint: '重编码参数，与去 EXIF 绑定。',
    min: null,
    max: null,
    locked: true,
  },
  {
    key: 'typeIntervalMs',
    value: `${HUMANIZE.TYPE_CHAR_MS[0]} - ${HUMANIZE.TYPE_CHAR_MS[1]}`,
    valueType: 'string',
    label: '逐字输入',
    hint: 'ms / 字（句间 300 - 600），风控相关，防误调。',
    min: null,
    max: null,
    locked: true,
  },
  {
    key: 'hoverBeforeClickMs',
    value: `${HUMANIZE.HOVER_BEFORE_CLICK_MS[0]} - ${HUMANIZE.HOVER_BEFORE_CLICK_MS[1]}`,
    valueType: 'string',
    label: '点击前悬停',
    hint: 'ms，风控相关。',
    min: null,
    max: null,
    locked: true,
  },
  {
    key: 'scrollStepMs',
    value: `${HUMANIZE.SCROLL_STEP_MS[0]} - ${HUMANIZE.SCROLL_STEP_MS[1]}`,
    valueType: 'string',
    label: '滚动步长',
    hint: 'ms，随机步长，风控相关。',
    min: null,
    max: null,
    locked: true,
  },
  {
    key: 'stepIntervalMs',
    value: `${HUMANIZE.STEP_INTERVAL_MS[0]} - ${HUMANIZE.STEP_INTERVAL_MS[1]}`,
    valueType: 'string',
    label: '步骤间隔',
    hint: 'ms，风控相关。',
    min: null,
    max: null,
    locked: true,
  },
  {
    key: 'endToEndBudget',
    value: '3 分钟',
    valueType: 'string',
    label: '端到端预算',
    hint: '单条 ≤3 分钟。',
    min: null,
    max: null,
    locked: true,
  },
  {
    key: 'crawlBudget',
    value: '60 秒',
    valueType: 'string',
    label: '采集预算',
    hint: '采集 20 条 ≤60 秒。',
    min: null,
    max: null,
    locked: true,
  },
  {
    key: 'forceDeclaration',
    value: FORCE_DECLARATION,
    valueType: 'string',
    label: '作品声明（发布时勾选）',
    hint: '类型层面锁死：发布时只勾这项，其余声明与「头条首发」都不勾，代码断言，无配置出口。',
    min: null,
    max: null,
    locked: true,
  },
  {
    key: 'forbidFirstPublish',
    value: 'false',
    valueType: 'boolean',
    label: '禁止「头条首发」',
    hint: '§8.3：发布前断言未勾选，无配置出口。',
    min: null,
    max: null,
    locked: true,
  },
] as const;

export function configDef(key: string): AppConfigItem | undefined {
  return [...APP_CONFIG_DEFS, ...LOCKED_CONFIG_ITEMS].find((d) => d.key === key);
}
