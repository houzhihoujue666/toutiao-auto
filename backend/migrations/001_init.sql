-- 建表基线：方案设计文档 v4.0 §5.2
-- 说明：account 额外增加 used_today / circuit / consecutive_failures / last_publish_at
--       （§3.4 工作台要求展示「今日已发」与熔断状态，§8.2 要求限速与熔断），
--       publish_record 额外增加 first_publish_confirmed（首发核验留证，§2.3 验收口径 6）。

CREATE TABLE account (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT    NOT NULL UNIQUE,
  user_data_dir       TEXT    NOT NULL,            -- 独立浏览器目录（ADR-4）
  storage_state_path  TEXT,
  status              TEXT    NOT NULL DEFAULT 'logged_out', -- logged_in|logged_out|expired
  credit_score        INTEGER,
  daily_publish_limit INTEGER NOT NULL DEFAULT 50, -- ★ dailyPublishLimit
  used_today          INTEGER NOT NULL DEFAULT 0,  -- 当日已发条数
  quota_date          TEXT,                        -- used_today 归属日期，跨天重置
  last_publish_at     TEXT,                        -- 最小发布间隔依据（★15 分钟）
  circuit             TEXT    NOT NULL DEFAULT 'closed',      -- closed|open，熔断不许自动恢复
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_login_at       TEXT,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE source_item (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id        INTEGER REFERENCES account(id),
  platform_item_id  TEXT    NOT NULL,              -- 平台侧唯一 ID，去重用
  author            TEXT,
  content           TEXT    NOT NULL,
  images            TEXT    NOT NULL DEFAULT '[]', -- JSON 数组：原图地址
  topics            TEXT    NOT NULL DEFAULT '[]', -- JSON 数组：话题
  like_count        INTEGER NOT NULL DEFAULT 0,
  comment_count     INTEGER NOT NULL DEFAULT 0,
  published_at      TEXT,                          -- 判时效用
  simhash           TEXT    NOT NULL,
  fetched_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_id, platform_item_id)
);
CREATE INDEX idx_source_simhash   ON source_item(simhash);
CREATE INDEX idx_source_published ON source_item(published_at);

CREATE TABLE task (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id          INTEGER NOT NULL REFERENCES account(id),
  source_item_id      INTEGER NOT NULL REFERENCES source_item(id),
  status              TEXT    NOT NULL DEFAULT 'pending',
  prompt_template_id  INTEGER REFERENCES prompt_template(id),
  image_strategy      TEXT    NOT NULL DEFAULT 'both',   -- dedup|stock|both
  rewrite_id          INTEGER REFERENCES rewrite_result(id),
  error_code          TEXT,                              -- 见附录 D
  retry_count         INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_task_status ON task(status);

CREATE TABLE rewrite_result (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id        INTEGER NOT NULL REFERENCES task(id),
  original_text  TEXT    NOT NULL,
  rewritten_text TEXT    NOT NULL,
  similarity     REAL    NOT NULL DEFAULT 1.0,   -- 越低越好，闸门 ★0.45
  quality_flags  TEXT    NOT NULL DEFAULT '[]',  -- JSON：质检标记
  images         TEXT    NOT NULL DEFAULT '[]',  -- JSON：处理后图片相对路径
  simhash        TEXT,                           -- 改写稿指纹（防与历史自撞）
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE publish_record (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id         INTEGER NOT NULL REFERENCES task(id),
  published_url   TEXT,
  screenshot_path TEXT,
  status          TEXT    NOT NULL DEFAULT 'success', -- success|draft|failed
  first_publish_confirmed INTEGER NOT NULL DEFAULT 0, -- 「头条首发」核验结果：1=确认未勾选
  published_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_publish_task ON publish_record(task_id);

CREATE TABLE prompt_template (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  content    TEXT    NOT NULL,   -- 含 {{originalText}} / {{wordRange}} 等占位符
  variant    TEXT,               -- A/B 分组标签（后置功能）
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE task_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    INTEGER REFERENCES task(id),
  level      TEXT    NOT NULL,              -- debug|info|warn|error
  message    TEXT    NOT NULL,
  context    TEXT    NOT NULL DEFAULT '{}', -- JSON，已脱敏
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_log_task ON task_log(task_id, created_at);

CREATE TABLE fingerprint (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  simhash    TEXT    NOT NULL,
  ref_type   TEXT    NOT NULL,              -- source_item|rewrite_result
  ref_id     INTEGER NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_fp_simhash ON fingerprint(simhash);

CREATE TABLE stock_image (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id       INTEGER REFERENCES task(id),
  provider      TEXT    NOT NULL,           -- commons|pexels|local（commons / local 免 Key）
  provider_id   TEXT    NOT NULL,
  page_url      TEXT,                       -- 素材详情页（保留来源）
  license       TEXT    NOT NULL,           -- 只允许 CC0 / Public Domain（§6.5 白名单）
  author        TEXT,                       -- 许可要求署名时填，便于留证
  local_path    TEXT    NOT NULL,           -- 相对路径
  downloaded_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 界面可调的定案值（ADR-10）：只存 §9 中标注「可调」的键，安全项不进这张表
CREATE TABLE app_config (
  key        TEXT    PRIMARY KEY,          -- 如 dailyPublishLimit / similarityThreshold
  value      TEXT    NOT NULL,             -- 统一存字符串，读出后按类型解析
  value_type TEXT    NOT NULL,             -- number|string|boolean
  label      TEXT    NOT NULL,             -- 设置页显示名（人话）
  hint       TEXT,                         -- 设置页说明（人话）
  min        REAL, max REAL,               -- 数字项的取值范围，界面与后端双重校验
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
