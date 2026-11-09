import fs from 'node:fs';
import path from 'node:path';
import { getMode } from '../../config/runtime';
import { taskSubDir, toRelative } from '../../infra/storage/paths';
import { renderSampleImage } from '../../infra/image/generate';
import { insertStockImage } from '../../infra/db/repo/stock-image';
import { log } from '../../infra/logger';
import { MAX_IMAGES_PER_POST } from '@shared/constants';
import { AppError } from '@shared/errors';
import type { ImageStrategy, ProcessedImage } from '@shared/types';
import { dedupProcess } from './dedup';
import { downloadAsWebp, extractKeywords, searchStockHits } from './stock';

export interface ImageProcessInput {
  taskId: number;
  /** 原图地址；simulated://n 表示模拟原图 */
  sources: string[];
  strategy: ImageStrategy;
  /** 关键词取自改写后正文 */
  keywords: string[];
  providerId?: string;
  apiKey?: string;
}

export interface ImageProcessOutcome {
  images: ProcessedImage[];
  /** 图库不可用，已降级为只用洗过的原图 */
  degraded: boolean;
}

async function loadSource(src: string): Promise<Buffer> {
  if (src.startsWith('simulated://')) {
    const seed = Number(src.replace('simulated://', '')) || 1;
    // 模拟原图带 EXIF，用来验证洗图后 EXIF 被剥离（ADR-8）
    return renderSampleImage({ seed, withExif: true });
  }
  if (/^https?:\/\//.test(src)) {
    const res = await fetch(src, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`source download failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  return fs.readFileSync(src);
}

export class ImageService {
  async process(input: ImageProcessInput): Promise<ImageProcessOutcome> {
    const target = Math.min(MAX_IMAGES_PER_POST, Math.max(2, input.sources.length || 0));
    const images: ProcessedImage[] = [];
    let degraded = false;

    // ① 洗原图
    if (input.strategy === 'dedup' || input.strategy === 'both') {
      const outDir = taskSubDir(input.taskId, 'out');
      for (let i = 0; i < input.sources.length && images.length < target; i++) {
        const src = input.sources[i]!;
        try {
          const raw = await loadSource(src);
          const out = await dedupProcess(raw);
          const file = path.join(outDir, `out-${i + 1}.webp`);
          fs.writeFileSync(file, out.buffer);
          images.push({
            localPath: toRelative(file),
            provider: 'original',
            width: out.width,
            height: out.height,
          });
        } catch (e) {
          // 单图失败跳过，任务继续（IMAGE_PROCESS_FAILED）
          log('warn', `IMAGE_PROCESS_FAILED: 跳过第 ${i + 1} 张原图`, {
            error: String(e),
            taskId: input.taskId,
          });
        }
      }
    }

    // ② 换图库图（both 时补数量缺口；stock 时主力）
    if (input.strategy === 'stock' || input.strategy === 'both') {
      const need = input.strategy === 'stock' ? target : Math.max(0, target - images.length);
      if (need > 0) {
        try {
          const keywords = input.keywords.length
            ? input.keywords
            : extractKeywords(input.keywords.join(' '));
          const { hits, provider } = await searchStockHits(
            keywords.length ? keywords : ['生活'],
            need,
            input.providerId,
            input.apiKey,
          );
          const stockDir = taskSubDir(input.taskId, 'stock');
          for (const hit of hits) {
            // 占位图（离线生成、无意义）不能当配图发出去：宁可这条不配图
            if (hit.placeholder && getMode() !== 'simulated') {
              log('warn', '跳过离线占位图：不是真实配图，不能对外发布', {
                taskId: input.taskId,
                provider: hit.provider,
              });
              continue;
            }
            const buf = await downloadAsWebp(hit);
            const file = path.join(
              stockDir,
              `stock-${hit.providerId.replace(/[^\w-]/g, '_')}.webp`,
            );
            fs.writeFileSync(file, buf);
            const rel = toRelative(file);
            // 图库图必须记录 page_url 与 license，缺一不可
            insertStockImage({
              taskId: input.taskId,
              provider: hit.provider,
              providerId: hit.providerId,
              pageUrl: hit.pageUrl,
              license: hit.license,
              author: hit.author ?? null,
              localPath: rel,
            });
            images.push({
              localPath: rel,
              provider: hit.provider,
              license: hit.license,
              pageUrl: hit.pageUrl,
              author: hit.author,
            });
          }
          log('info', `stock images fetched: ${hits.length}`, { provider, taskId: input.taskId });
        } catch (e) {
          degraded = true;
          log('warn', 'STOCK_FETCH_FAILED: 降级为只用洗过的原图', {
            error: String(e),
            taskId: input.taskId,
          });
          if (images.length === 0 && input.strategy === 'stock') {
            throw new AppError(
              'STOCK_FETCH_FAILED',
              '图库取不到图，且没有可兜底的原图',
              '把图片策略改成 dedup 或 both',
            );
          }
        }
      }
    }

    return { images: images.slice(0, MAX_IMAGES_PER_POST), degraded };
  }
}
