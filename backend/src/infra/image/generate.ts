import sharp from 'sharp';

/** 生成确定性样例图（离线图源 / 模拟原图用），可带 EXIF 以便验证「输出图无 EXIF」 */

export interface SampleImageOptions {
  seed: number;
  width?: number;
  height?: number;
  /** 是否写入 EXIF（用于验证 ADR-8：sharp toBuffer 默认剥离元数据） */
  withExif?: boolean;
}

export async function renderSampleImage(opts: SampleImageOptions): Promise<Buffer> {
  const width = opts.width ?? 960;
  const height = opts.height ?? 640;
  const s = Math.abs(opts.seed) + 1;
  const hue = (s * 47) % 360;
  const r = Math.round(90 + ((s * 31) % 120));
  const g = Math.round(90 + ((s * 17) % 120));
  const b = Math.round(90 + ((s * 11) % 120));
  void hue;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="rgb(${r},${g},${b})"/>
        <stop offset="100%" stop-color="rgb(${Math.round(r / 2)},${Math.round(g / 2)},${Math.round(b / 2)})"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <circle cx="${width * 0.7}" cy="${height * 0.35}" r="${Math.min(width, height) * 0.18}" fill="rgba(255,255,255,.22)"/>
    <circle cx="${width * 0.3}" cy="${height * 0.72}" r="${Math.min(width, height) * 0.12}" fill="rgba(255,255,255,.16)"/>
    <text x="40" y="${height - 40}" font-family="sans-serif" font-size="28" fill="rgba(255,255,255,.85)">sample-${s}</text>
  </svg>`;

  const img = sharp(Buffer.from(svg)).resize(width, height);
  if (opts.withExif) {
    img.withMetadata({
      exif: { IFD0: { Copyright: 'sample', ImageDescription: 'simulated source image' } },
    });
  }
  return img.png().toBuffer();
}
