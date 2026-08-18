import { BrowserWindow } from 'electron';
import { PNG } from 'pngjs';
import { LCD_HEIGHT, LCD_WIDTH } from '../device/protocol';

export interface VolumeFeedback {
  volume: number;
}

export const YOUTUBE_VOLUME_ACCENT = '#ef4444';

export function normalizeVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 0;
  return Math.min(100, Math.max(0, Math.round(volume)));
}

/** P1 LCD와 같은 VOLUME 카드를 그리는 브라우저 스크립트. */
export function volumeOverlayDrawSource(): string {
  return `function drawVolumeOverlay(context, volume, accent) {
  const roundedRectPath = (x, y, width, height, radius) => {
    const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
    context.beginPath();
    context.moveTo(x + safeRadius, y);
    context.lineTo(x + width - safeRadius, y);
    context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
    context.lineTo(x + width, y + height - safeRadius);
    context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
    context.lineTo(x + safeRadius, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
    context.lineTo(x, y + safeRadius);
    context.quadraticCurveTo(x, y, x + safeRadius, y);
    context.closePath();
  };
  const fillRoundedRect = (x, y, width, height, radius, color) => {
    if (width <= 0 || height <= 0) return;
    roundedRectPath(x, y, width, height, radius);
    context.fillStyle = color;
    context.fill();
  };
  const setFont = (weight, size) => {
    context.font = weight + ' ' + size + 'px system-ui, -apple-system, "Apple SD Gothic Neo", sans-serif';
  };
  fillRoundedRect(24, 16, 192, 103, 14, 'rgba(5, 7, 10, 0.96)');
  roundedRectPath(25, 17, 190, 101, 13);
  context.strokeStyle = accent;
  context.lineWidth = 2;
  context.stroke();
  context.fillStyle = '#ffffff';
  context.beginPath();
  context.moveTo(47, 58);
  context.lineTo(56, 58);
  context.lineTo(67, 49);
  context.lineTo(67, 77);
  context.lineTo(56, 68);
  context.lineTo(47, 68);
  context.closePath();
  context.fill();
  context.lineCap = 'round';
  if (volume === 0) {
    context.strokeStyle = '#fa2d48';
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(67, 52);
    context.lineTo(83, 78);
    context.stroke();
  } else {
    context.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    context.lineWidth = 2.5;
    context.beginPath();
    context.moveTo(72, 57);
    context.bezierCurveTo(76, 60, 76, 66, 72, 69);
    context.moveTo(77, 52);
    context.bezierCurveTo(85, 59, 85, 69, 77, 75);
    context.stroke();
  }
  context.fillStyle = '#a8b7ca';
  setFont('700', 9);
  context.letterSpacing = '1.4px';
  context.fillText('VOLUME', 94, 48);
  context.letterSpacing = '0px';
  context.textAlign = 'right';
  context.fillStyle = '#ffffff';
  setFont('700', 34);
  context.fillText(String(volume), 177, 82);
  context.fillStyle = '#dbe4ee';
  setFont('600', 15);
  context.fillText('%', 194, 82);
  context.textAlign = 'left';
  fillRoundedRect(48, 98, 144, 7, 3.5, '#334155');
  fillRoundedRect(48, 98, Math.round((144 * volume) / 100), 7, 3.5, accent);
}`;
}

/** 투명 배경 위에 P1과 같은 볼륨 카드를 그려 RGBA를 돌려준다. */
export async function renderVolumeOverlayRgba(
  volume: number,
  accent: string
): Promise<Buffer> {
  const level = normalizeVolume(volume);
  const renderer = new BrowserWindow({
    show: false,
    width: LCD_WIDTH,
    height: LCD_HEIGHT,
    useContentSize: true,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      offscreen: true,
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  try {
    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      html, body { margin: 0; width: ${LCD_WIDTH}px; height: ${LCD_HEIGHT}px; overflow: hidden; background: transparent; }
      canvas { display: block; width: ${LCD_WIDTH}px; height: ${LCD_HEIGHT}px; }
    </style>
  </head>
  <body><canvas id="frame" width="${LCD_WIDTH}" height="${LCD_HEIGHT}"></canvas></body>
</html>`;
    await renderer.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const dataUrl = await renderer.webContents.executeJavaScript(`
(() => {
  ${volumeOverlayDrawSource()}
  const canvas = document.getElementById('frame');
  const context = canvas && canvas.getContext('2d', { alpha: true });
  if (!canvas || !context) throw new Error('볼륨 오버레이 캔버스를 만들지 못했습니다.');
  context.clearRect(0, 0, ${LCD_WIDTH}, ${LCD_HEIGHT});
  drawVolumeOverlay(context, ${level}, ${JSON.stringify(accent)});
  return canvas.toDataURL('image/png');
})()
`);
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) {
      throw new Error('볼륨 오버레이 렌더 형식이 올바르지 않습니다.');
    }
    const png = PNG.sync.read(Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
    if (png.width !== LCD_WIDTH || png.height !== LCD_HEIGHT) {
      throw new Error(`볼륨 오버레이 크기 오류: ${png.width}x${png.height}`);
    }
    return Buffer.from(png.data);
  } finally {
    renderer.destroy();
  }
}

export function blendRgbaOverRgb565(base: Buffer, overlay: Buffer): Buffer {
  const pixels = LCD_WIDTH * LCD_HEIGHT;
  if (base.length < pixels * 2 || overlay.length < pixels * 4) return base;
  const out = Buffer.from(base);
  for (let index = 0; index < pixels; index++) {
    const alpha = overlay[index * 4 + 3];
    if (alpha === 0) continue;
    const sourceR = overlay[index * 4];
    const sourceG = overlay[index * 4 + 1];
    const sourceB = overlay[index * 4 + 2];
    const dest = out.readUInt16LE(index * 2);
    const destR = ((dest >> 11) & 31) << 3;
    const destG = ((dest >> 5) & 63) << 2;
    const destB = (dest & 31) << 3;
    const t = alpha / 255;
    const red = Math.round(destR + (sourceR - destR) * t);
    const green = Math.round(destG + (sourceG - destG) * t);
    const blue = Math.round(destB + (sourceB - destB) * t);
    out.writeUInt16LE(((red >> 3) << 11) | ((green >> 2) << 5) | (blue >> 3), index * 2);
  }
  return out;
}

export function blendRgbaOverPngDataUrl(dataUrl: string, overlay: Buffer): string {
  const comma = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:image/png;base64,') || comma < 0) return dataUrl;
  const png = PNG.sync.read(Buffer.from(dataUrl.slice(comma + 1), 'base64'));
  const pixels = Math.min(png.width * png.height, LCD_WIDTH * LCD_HEIGHT);
  for (let index = 0; index < pixels; index++) {
    const alpha = overlay[index * 4 + 3];
    if (alpha === 0) continue;
    const dest = index * 4;
    const t = alpha / 255;
    png.data[dest] = Math.round(png.data[dest] + (overlay[index * 4] - png.data[dest]) * t);
    png.data[dest + 1] = Math.round(
      png.data[dest + 1] + (overlay[index * 4 + 1] - png.data[dest + 1]) * t
    );
    png.data[dest + 2] = Math.round(
      png.data[dest + 2] + (overlay[index * 4 + 2] - png.data[dest + 2]) * t
    );
    png.data[dest + 3] = 255;
  }
  return `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
}
