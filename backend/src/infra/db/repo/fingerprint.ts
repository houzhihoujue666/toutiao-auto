import { getDb } from '../index';
import { hamming } from '@shared/simhash';

export interface FingerprintHit {
  id: number;
  simhash: string;
  refType: string;
  refId: number;
  distance: number;
}

export function insert(
  simhashValue: string,
  refType: 'source_item' | 'rewrite_result',
  refId: number,
): void {
  getDb()
    .prepare('INSERT INTO fingerprint (simhash, ref_type, ref_id) VALUES (?, ?, ?)')
    .run(simhashValue, refType, refId);
}

/** 海明距离 ≤ maxDist 视为重复（采集去重用） */
export function findSimilar(simhashValue: string, maxDist: number): FingerprintHit | null {
  const rows = getDb().prepare('SELECT id, simhash, ref_type, ref_id FROM fingerprint').all() as {
    id: number;
    simhash: string;
    ref_type: string;
    ref_id: number;
  }[];
  let best: FingerprintHit | null = null;
  for (const r of rows) {
    const d = hamming(r.simhash, simhashValue);
    if (d <= maxDist && (!best || d < best.distance)) {
      best = { id: r.id, simhash: r.simhash, refType: r.ref_type, refId: r.ref_id, distance: d };
    }
  }
  return best;
}
