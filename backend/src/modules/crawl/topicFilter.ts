/**
 * 选题黑名单 —— §3.2：不想要的题材在采集阶段就丢掉，不进素材池、不会建任务。
 * 规则来自 app_config['crawl.blockedTopics']：每行一类，行内用逗号分隔同义词。
 */

export interface TopicRule {
  /** 类别标识：取该行第一个关键词，只用于日志与提示 */
  label: string;
  keywords: string[];
}

/** 解析配置文本；空配置返回空数组，表示不过滤 */
export function parseBlockedTopics(raw: string): TopicRule[] {
  const rules: TopicRule[] = [];
  for (const line of raw.split(/[\n;；]/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const keywords = trimmed
      .split(/[,，、|/]/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (keywords.length) rules.push({ label: keywords[0], keywords });
  }
  return rules;
}

/** 命中返回类别标识，未命中返回 null */
export function matchBlockedTopic(text: string, rules: TopicRule[]): string | null {
  if (!rules.length) return null;
  const lower = text.toLowerCase();
  for (const rule of rules) {
    for (const kw of rule.keywords) {
      if (lower.includes(kw)) return rule.label;
    }
  }
  return null;
}
