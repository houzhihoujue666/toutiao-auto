import sharp from 'sharp';

/**
 * 二维码图像（仅用于界面示意 / 模拟模式）
 * 红线：真实二维码只经本地 WebSocket 推给页面，不落盘、不写日志（§8.4）
 */

function qrSvg(seed: number): string {
  const N = 25;
  const unit = 8;
  const pad = 8;
  let s = seed || 1;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (s >> 16) & 0xff;
  };
  let cells = '';
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (rnd() > 148) {
        cells += `<rect x="${pad + x * unit}" y="${pad + y * unit}" width="${unit}" height="${unit}"/>`;
      }
    }
  }
  const origins: [number, number][] = [
    [0, 0],
    [N - 7, 0],
    [0, N - 7],
  ];
  for (let fy = 0; fy < 7; fy++) {
    for (let fx = 0; fx < 7; fx++) {
      const on =
        fy === 0 || fy === 6 || fx === 0 || fx === 6 || (fy > 1 && fy < 5 && fx > 1 && fx < 5);
      if (!on) continue;
      for (const [ox, oy] of origins) {
        cells += `<rect x="${pad + (ox + fx) * unit}" y="${pad + (oy + fy) * unit}" width="${unit}" height="${unit}"/>`;
      }
    }
  }
  const size = pad * 2 + N * unit;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect width="100%" height="100%" fill="#fff"/>
    <g fill="#16202B">${cells}</g>
  </svg>`;
}

export async function renderQrPng(seed: number): Promise<Buffer> {
  return sharp(Buffer.from(qrSvg(seed)))
    .png()
    .toBuffer();
}
