import type { LlmWebAdapter, RewriteInput } from '@shared/types';
import type { AdapterContext } from './types';

/**
 * 本地确定性改写器（runtime.mode = simulated 或 llm.mode = simulated 时用）
 * 目的：不依赖任何外部服务也能把「改写 → 清洗 → 算相似度」跑通并自测。
 * 严格对齐 §6.4 的要求：换叙述顺序、换主语和句式、开头有钩子、结尾有互动、口语化、有自己的观点。
 */

const OPENERS = [
  '这件事我盯了一阵子，越想越觉得没那么简单。',
  '先说结论：很多人其实把重点搞反了。',
  '最近反复遇到同一个问题，干脆一次讲清楚。',
  '有个细节被大多数人忽略了，但它恰恰是关键。',
];

const CONNECTIVES = [
  '说白了，',
  '换个角度看，',
  '老实讲，',
  '我自己的感受是，',
  '这里真正有意思的地方在于，',
];

const COMMENTARY = [
  '我后来专门留意了一下，发现身边几乎每个人都有类似的惯性。',
  '为什么会这样？因为大家习惯看结果，却很少回头看过程里那个不起眼的环节。',
  '这个道理放到别的事情上也成立：真正起作用的，往往不是最显眼的那一步。',
  '我的看法比较直接：与其事后补救，不如一开始就把这个变量控制住。',
  '说起来有点反直觉，但事实就是这样，越省事的做法通常越费事。',
  '如果你也遇到过类似的情况，应该马上就能对上号。',
  '我自己踩过坑之后才明白，很多麻烦其实是可以提前避开的。',
  '这里面没有玄学，就是一层窗户纸，捅破了之后你会发现特别好操作。',
];

const ENDINGS = [
  '你们那边是不是也这样？评论区说说你的经历。',
  '我不知道别人怎么想，至少我踩过这个坑。你呢？',
  '这条建议你认可吗？欢迎来抬杠。',
  '如果你有更好的办法，一定告诉我。',
];

const SYNONYMS: [string, string][] = [
  ['因为', '说到底是由于'],
  ['但是', '不过'],
  ['其实', '老实说'],
  ['觉得', '感觉'],
  ['发现', '意识到'],
  ['原因', '症结'],
  ['往往', '通常'],
  ['建议', '我的建议是'],
  ['不要', '别'],
  ['可以', '不妨'],
  ['很多', '不少'],
  ['问题', '麻烦'],
  ['东西', '玩意儿'],
  ['时间', '功夫'],
  ['开始', '起步'],
  ['地方', '环节'],
  ['真的', '确实'],
  ['容易', '特别容易'],
  ['重要', '要紧'],
  ['方法', '路子'],
  ['情况', '情形'],
  ['最后', '到头来'],
  ['第一', '头一个'],
  ['每天', '天天'],
  ['已经', '早就'],
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return Math.abs(h);
}

function applySynonyms(s: string): string {
  let out = s;
  for (const [a, b] of SYNONYMS) {
    if (a === b) continue;
    out = out.split(a).join(b);
  }
  return out;
}

function reorderClauses(sentence: string): string {
  const parts = sentence
    .split(/[，,；;：:]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return sentence;
  // 先讲观点，再讲事情：把后半句提前
  const reordered = [parts[parts.length - 1], ...parts.slice(0, -1)];
  return `${reordered.join('，')}。`;
}

function transformSentence(sentence: string, idx: number): string {
  const core = sentence.replace(/[。！？!?]$/, '').trim();
  if (!core) return '';
  let out = applySynonyms(core);
  out = reorderClauses(out);
  const connective = idx % 2 === 1 ? CONNECTIVES[(idx + hash(core)) % CONNECTIVES.length]! : '';
  return `${connective}${out}`;
}

export function simulatedRewrite(original: string): string {
  const sentences = original
    .split(/[。！？!?\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const seed = hash(original);
  const opener = OPENERS[seed % OPENERS.length]!;
  const parts = sentences.map((s, i) => transformSentence(s, i)).filter(Boolean);

  // 每段夹一条自己的观点，保证「有自己的见解」且篇幅拉开（相似度自然下降）
  const paragraphs: string[] = [];
  parts.forEach((p, i) => {
    const extra = COMMENTARY[(seed + i * 3) % COMMENTARY.length]!;
    paragraphs.push(`${p}${extra}`);
  });

  const ending = ENDINGS[(seed >> 3) % ENDINGS.length]!;
  return [`${opener}${paragraphs.join('')}`, ending].join('\n\n');
}

export class SimulatedLlmAdapter implements LlmWebAdapter {
  readonly id = 'simulated';

  constructor(private readonly ctx: AdapterContext = { timeoutMs: 120_000 }) {}

  async ensureSession(): Promise<void> {
    // 本地适配器无需会话（也不需要任何账号，零费用）
  }

  async rewrite(input: RewriteInput): Promise<string> {
    void this.ctx;
    return simulatedRewrite(input.originalText);
  }

  async dispose(): Promise<void> {
    // no-op
  }
}
