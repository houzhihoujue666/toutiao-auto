/**
 * 可读性启发式 —— §6.6：只标记告警，交人工判断（规则判不准，误杀成本高）
 * 维度：句长分布、异常符号比例、机翻特征（重复字比例、助词密度）
 */
export interface ReadabilityResult {
  readable: boolean;
  reasons: string[];
}

export function checkReadability(text: string): ReadabilityResult {
  const reasons: string[] = [];
  const clean = text.replace(/\s/g, '');
  if (!clean) return { readable: false, reasons: ['空文本'] };

  const sentences = text
    .split(/[。！？!?\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const avgLen = sentences.length ? clean.length / sentences.length : clean.length;
  if (avgLen > 80) reasons.push(`句长偏长（平均 ${Math.round(avgLen)} 字）`);
  if (avgLen < 6 && sentences.length > 1) reasons.push(`句长过短（平均 ${Math.round(avgLen)} 字）`);

  const symbols = (clean.match(/[^\u4e00-\u9fa5a-zA-Z0-9]/g) ?? []).length;
  const symbolRatio = symbols / clean.length;
  if (symbolRatio > 0.2) reasons.push(`异常符号比例偏高（${(symbolRatio * 100).toFixed(0)}%）`);

  const freq = new Map<string, number>();
  for (const ch of clean) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  const maxFreq = Math.max(...freq.values());
  if (maxFreq / clean.length > 0.12) reasons.push('单字重复率过高（疑似机翻或灌水）');

  const deCount = (clean.match(/的/g) ?? []).length;
  if (deCount / clean.length > 0.08) reasons.push('助词「的」密度过高（疑似机翻）');

  return { readable: reasons.length === 0, reasons };
}
