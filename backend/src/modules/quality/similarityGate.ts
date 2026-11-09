import { SIMILARITY_THRESHOLD } from '@shared/constants';
import { computeSimilarity } from '../rewrite/similarity';

/** 相似度闸门 —— ★0.45：超标先强化重写 1 次，仍超标直接拦下 */
export interface GateResult {
  similarity: number;
  ok: boolean;
  threshold: number;
}

export function checkSimilarity(
  original: string,
  rewritten: string,
  threshold = SIMILARITY_THRESHOLD,
): GateResult {
  const similarity = computeSimilarity(original, rewritten);
  return { similarity, ok: similarity <= threshold, threshold };
}
