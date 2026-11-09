import sharp from 'sharp';
import { WEBP_QUALITY, MAX_ROTATE_DEG } from '@shared/constants';

/**
 * 洗原图 —— §6.5 / ADR-8
 * autoOrient → resize/rotate/flip（幅度受配置约束）→ modulate 微调 → 转 webp 重编码
 * → toBuffer()（默认剥离全部元数据 / EXIF），不额外引入 exiftool
 */

export interface DedupResult {
  buffer: Buffer;
  width: number;
  height: number;
}

function smallRandomAngle(): number {
  const sign = Math.random() < 0.5 ? -1 : 1;
  return sign * (Math.random() * MAX_ROTATE_DEG);
}

export async function dedupProcess(src: Buffer): Promise<DedupResult> {
  const out = await sharp(src)
    .autoOrient()
    .rotate(smallRandomAngle(), { background: '#ffffff' })
    .modulate({ brightness: 1.02, saturation: 1.05 })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer({ resolveWithObject: true });

  return { buffer: out.data, width: out.info.width, height: out.info.height };
}

/** 校验：输出图应当不含 EXIF（ADR-8） */
export async function hasExif(buffer: Buffer): Promise<boolean> {
  const meta = await sharp(buffer).metadata();
  return Boolean(meta.exif && Buffer.from(meta.exif).length > 0);
}
