import { BrowserWindow } from 'electron';
import { PNG } from 'pngjs';
import { AppConfig, TrackInfo } from '../../shared/types';
import { LCD_HEIGHT, LCD_WIDTH } from '../device/protocol';
import { renderVolumeOverlay, type VolumeFeedback } from './volume-overlay';

export interface RenderedFrame {
  rgb565: Buffer;
  previewDataUrl: string;
}

export async function renderTrackFrame(
  track: TrackInfo,
  config: AppConfig,
  volumeFeedback: VolumeFeedback | null = null
): Promise<RenderedFrame> {
  const artwork = config.showArtwork ? track.artworkDataUrl : undefined;
  const accent = track.service === 'spotify' ? '#1ed760' : '#fa2d48';
  const serviceLabel =
    track.service === 'spotify'
      ? 'SPOTIFY'
      : track.service === 'apple-music'
        ? 'APPLE MUSIC'
        : 'NOW PLAYING';
  const left = artwork ? 122 : 14;
  const textWidth = artwork ? 104 : 212;
  const titleLines = wrapText(track.title, artwork ? 10 : 20, 2);
  const artist = truncate(track.artist, artwork ? 14 : 28);
  const album = truncate(track.album, artwork ? 15 : 30);
  const progress =
    config.showProgress && track.duration > 0
      ? Math.min(1, Math.max(0, track.position / track.duration))
      : 0;
  const progressWidth = Math.round(textWidth * progress);
  const icon = track.state === 'playing' ? '▶' : track.state === 'paused' ? 'Ⅱ' : '■';

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${LCD_WIDTH}" height="${LCD_HEIGHT}" viewBox="0 0 ${LCD_WIDTH} ${LCD_HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#151b24"/>
      <stop offset="1" stop-color="#07090d"/>
    </linearGradient>
    <clipPath id="cover"><rect x="6" y="6" width="110" height="123" rx="10"/></clipPath>
  </defs>
  <rect width="240" height="135" fill="url(#bg)"/>
  ${artwork ? `<image href="${artwork}" x="6" y="6" width="110" height="123" preserveAspectRatio="xMidYMid slice" clip-path="url(#cover)"/>` : ''}
  <text x="${left}" y="18" font-family="Apple SD Gothic Neo, Arial Unicode MS, sans-serif" font-size="8" font-weight="700" letter-spacing="0.8" fill="${accent}">${serviceLabel}</text>
  <text x="${left}" y="40" font-family="Apple SD Gothic Neo, Arial Unicode MS, sans-serif" font-size="17" font-weight="700" fill="#ffffff">
    ${titleLines.map((line, index) => `<tspan x="${left}" dy="${index === 0 ? 0 : 20}">${escapeXml(line)}</tspan>`).join('')}
  </text>
  <text x="${left}" y="87" font-family="Apple SD Gothic Neo, Arial Unicode MS, sans-serif" font-size="11" font-weight="600" fill="#cbd5e1">${escapeXml(artist)}</text>
  <text x="${left}" y="103" font-family="Apple SD Gothic Neo, Arial Unicode MS, sans-serif" font-size="9" fill="#718096">${escapeXml(album)}</text>
  <text x="${left}" y="123" font-family="Arial Unicode MS, sans-serif" font-size="11" fill="${accent}">${icon}</text>
  <rect x="${left + 17}" y="116" width="${Math.max(0, textWidth - 17)}" height="5" rx="2.5" fill="#263141"/>
  <rect x="${left + 17}" y="116" width="${Math.max(0, progressWidth - 17)}" height="5" rx="2.5" fill="${accent}"/>
  ${renderVolumeOverlay(volumeFeedback, accent)}
</svg>`;

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      html, body { margin: 0; width: ${LCD_WIDTH}px; height: ${LCD_HEIGHT}px; overflow: hidden; background: #07090d; }
      svg { display: block; }
    </style>
  </head>
  <body>${svg}</body>
</html>`;
  const renderer = new BrowserWindow({
    show: false,
    width: LCD_WIDTH,
    height: LCD_HEIGHT,
    useContentSize: true,
    webPreferences: {
      offscreen: true,
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  let image: Electron.NativeImage;
  try {
    await renderer.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await renderer.webContents.executeJavaScript(`Promise.all([
      document.fonts.ready,
      ...Array.from(document.images).map((element) =>
        element.complete
          ? Promise.resolve()
          : new Promise((resolve) => {
              element.addEventListener('load', resolve, { once: true });
              element.addEventListener('error', resolve, { once: true });
            })
      )
    ])`);
    image = await captureFrame(renderer);
  } finally {
    renderer.destroy();
  }
  if (image.isEmpty()) throw new Error('LCD 오프스크린 렌더링에 실패했습니다.');
  const png = PNG.sync.read(
    image.resize({ width: LCD_WIDTH, height: LCD_HEIGHT, quality: 'best' }).toPNG()
  );
  if (png.width !== LCD_WIDTH || png.height !== LCD_HEIGHT) {
    throw new Error(`LCD 프레임 크기 오류: ${png.width}x${png.height}`);
  }
  const rgb565 = Buffer.alloc(LCD_WIDTH * LCD_HEIGHT * 2);
  for (let index = 0; index < LCD_WIDTH * LCD_HEIGHT; index++) {
    const pixel = index * 4;
    const value =
      ((png.data[pixel] >> 3) << 11) |
      ((png.data[pixel + 1] >> 2) << 5) |
      (png.data[pixel + 2] >> 3);
    rgb565.writeUInt16LE(value, index * 2);
  }
  return {
    rgb565,
    previewDataUrl: `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`,
  };
}

async function captureFrame(renderer: BrowserWindow): Promise<Electron.NativeImage> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await delay(50);
      const image = await renderer.webContents.capturePage({
        x: 0,
        y: 0,
        width: LCD_WIDTH,
        height: LCD_HEIGHT,
      });
      if (!image.isEmpty()) return image;
      lastError = new Error('LCD 오프스크린 캡처 결과가 비어 있습니다.');
    } catch (error) {
      lastError = error;
    }
    renderer.webContents.invalidate();
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('LCD 오프스크린 렌더링에 실패했습니다.');
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function wrapText(value: string, maxCharacters: number, maxLines: number): string[] {
  const chars = Array.from(value.trim());
  const lines: string[] = [];
  while (chars.length > 0 && lines.length < maxLines) {
    const remainingLines = maxLines - lines.length;
    const take = remainingLines === 1 ? chars.length : Math.min(maxCharacters, chars.length);
    let line = chars.splice(0, take).join('');
    if (remainingLines === 1 && Array.from(line).length > maxCharacters) {
      line = `${Array.from(line).slice(0, Math.max(1, maxCharacters - 1)).join('')}…`;
    }
    lines.push(line);
  }
  return lines.length > 0 ? lines : [''];
}

function truncate(value: string, maxCharacters: number): string {
  const chars = Array.from(value || '');
  return chars.length <= maxCharacters
    ? value
    : `${chars.slice(0, Math.max(1, maxCharacters - 1)).join('')}…`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
