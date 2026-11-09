import { textSimilarity } from '@shared/simhash';
import { SIMILARITY_THRESHOLD } from '@shared/constants';

/** 相似度计算 —— §6.6：SimHash 海明距离归一化 + 编辑距离复核 */
export function computeSimilarity(original: string, rewritten: string): number {
  return textSimilarity(original, rewritten);
}

export function isSimilarityOk(similarity: number, threshold = SIMILARITY_THRESHOLD): boolean {
  return similarity <= threshold;
}
