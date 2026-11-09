/**
 * 改写结果清洗 —— §6.3：去 Markdown 标记、去客套话、压空行
 */

const POLITE_PREFIXES = [
  '以下是改写结果',
  '改写结果如下',
  '以下是根据要求改写的文章',
  '当然，以下是',
  '好的，以下是',
  '这是改写后的内容',
  '希望对你有帮助',
  '如有需要请告诉我',
  '如果你还有其他要求',
];

export function cleanRewritten(raw: string): string {
  let text = raw.trim();

  // 去掉包裹的代码块
  text = text.replace(/^```[a-zA-Z]*\n?/g, '').replace(/```$/g, '');

  // 去 Markdown 标题与列表编号
  text = text
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s*/, '')
        .replace(/^\s*[-*+]\s+/, '')
        .replace(/^\s*\d+[.、)]\s*/, ''),
    )
    .join('\n');

  // 去客套话整句
  const lines = text
    .split('\n')
    .filter((line) => !POLITE_PREFIXES.some((p) => line.trim().startsWith(p)));

  text = lines.join('\n');

  // 去粗体/斜体/引用标记
  text = text.replace(/\*\*/g, '').replace(/^>\s?/gm, '');

  // 压空行
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  return text;
}

/** 空或全是客套话 → LLM_EMPTY */
export function isEmptyOutput(raw: string): boolean {
  const cleaned = cleanRewritten(raw);
  if (!cleaned) return true;
  const meaningful = cleaned.replace(/[\s\p{P}\p{S}]/gu, '');
  return meaningful.length < 10;
}
