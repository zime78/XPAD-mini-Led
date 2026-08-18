import { BrowserWindow } from 'electron';
import { PNG } from 'pngjs';
import { AppConfig, TrackInfo } from '../../shared/types';
import { LCD_HEIGHT, LCD_WIDTH } from '../device/protocol';
import {
  applyRgb565OrderedDither,
  encodeRgb565,
} from './frame-pipeline';
import { fitTextBlock } from './text-layout';
import {
  normalizeVolume,
  volumeOverlayDrawSource,
  type VolumeFeedback,
} from './volume-overlay';

export interface RenderedFrame {
  rgb565: Buffer;
  previewDataUrl: string;
}

interface CanvasFramePayload {
  width: number;
  height: number;
  artwork: string | null;
  accent: string;
  serviceLabel: string;
  title: string;
  artist: string;
  album: string;
  progress: number;
  showProgress: boolean;
  state: TrackInfo['state'];
  volume: number | null;
}

export async function renderTrackFrame(
  track: TrackInfo,
  config: AppConfig,
  volumeFeedback: VolumeFeedback | null = null
): Promise<RenderedFrame> {
  const payload: CanvasFramePayload = {
    width: LCD_WIDTH,
    height: LCD_HEIGHT,
    artwork: config.showArtwork ? track.artworkDataUrl || null : null,
    accent: track.service === 'spotify' ? '#1ed760' : '#fa2d48',
    serviceLabel:
      track.service === 'spotify'
        ? 'SPOTIFY'
        : track.service === 'apple-music'
          ? 'APPLE MUSIC'
          : 'NOW PLAYING',
    title: track.title,
    artist: track.artist,
    album: track.album,
    progress:
      track.duration > 0
        ? Math.min(1, Math.max(0, track.position / track.duration))
        : 0,
    showProgress: config.showProgress,
    state: track.state,
    volume: volumeFeedback ? normalizeVolume(volumeFeedback.volume) : null,
  };

  const renderer = new BrowserWindow({
    show: false,
    width: LCD_WIDTH,
    height: LCD_HEIGHT,
    useContentSize: true,
    backgroundColor: '#07090d',
    webPreferences: {
      offscreen: true,
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  let sourcePng: PNG;
  try {
    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      html, body { margin: 0; width: ${LCD_WIDTH}px; height: ${LCD_HEIGHT}px; overflow: hidden; background: #07090d; }
      canvas { display: block; width: ${LCD_WIDTH}px; height: ${LCD_HEIGHT}px; }
    </style>
  </head>
  <body><canvas id="frame" width="${LCD_WIDTH}" height="${LCD_HEIGHT}"></canvas></body>
</html>`;
    await renderer.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const dataUrl = await renderer.webContents.executeJavaScript(
      createCanvasRenderScript(payload)
    );
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) {
      throw new Error('LCD Canvas 렌더링 결과 형식이 올바르지 않습니다.');
    }
    sourcePng = PNG.sync.read(Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
  } finally {
    renderer.destroy();
  }

  if (sourcePng.width !== LCD_WIDTH || sourcePng.height !== LCD_HEIGHT) {
    throw new Error(`LCD 프레임 크기 오류: ${sourcePng.width}x${sourcePng.height}`);
  }
  const encoded = encodeRgb565(sourcePng);
  return {
    rgb565: encoded.rgb565,
    previewDataUrl: `data:image/png;base64,${encoded.previewPng.toString('base64')}`,
  };
}

function createCanvasRenderScript(payload: CanvasFramePayload): string {
  const serializedPayload = JSON.stringify(payload)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');

  return `
(async () => {
  const payload = ${serializedPayload};
  const fitTextBlock = ${fitTextBlock.toString()};
  const applyRgb565OrderedDither = ${applyRgb565OrderedDither.toString()};
  const canvas = document.getElementById('frame');
  const context = canvas && canvas.getContext('2d', { alpha: false });
  if (!canvas || !context) throw new Error('LCD Canvas 컨텍스트를 만들 수 없습니다.');

  await document.fonts.ready;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.textBaseline = 'alphabetic';
  context.textRendering = 'optimizeLegibility';
  context.fontKerning = 'normal';

  const fontFamily = 'system-ui, -apple-system, "Apple SD Gothic Neo", sans-serif';
  const setFont = (weight, size) => {
    context.font = weight + ' ' + size + 'px ' + fontFamily;
  };
  const roundedRectPath = (x, y, width, height, radius) => {
    const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
    context.beginPath();
    context.moveTo(x + safeRadius, y);
    context.lineTo(x + width - safeRadius, y);
    context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
    context.lineTo(x + width, y + height - safeRadius);
    context.quadraticCurveTo(
      x + width,
      y + height,
      x + width - safeRadius,
      y + height
    );
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
  const loadImage = (source) =>
    new Promise((resolve) => {
      if (!source) {
        resolve(null);
        return;
      }
      const image = new Image();
      image.addEventListener('load', () => resolve(image), { once: true });
      image.addEventListener('error', () => resolve(null), { once: true });
      image.src = source;
    });

  const artworkImage = await loadImage(payload.artwork);
  const background = context.createLinearGradient(0, 0, payload.width, payload.height);
  background.addColorStop(0, '#151b24');
  background.addColorStop(1, '#07090d');
  context.fillStyle = background;
  context.fillRect(0, 0, payload.width, payload.height);

  const artwork = { x: 8, y: 8, width: 96, height: 96, radius: 9 };
  if (artworkImage) {
    const sourceWidth = artworkImage.naturalWidth || artworkImage.width;
    const sourceHeight = artworkImage.naturalHeight || artworkImage.height;
    const scale = Math.max(artwork.width / sourceWidth, artwork.height / sourceHeight);
    const cropWidth = artwork.width / scale;
    const cropHeight = artwork.height / scale;
    const cropX = (sourceWidth - cropWidth) / 2;
    const cropY = (sourceHeight - cropHeight) / 2;
    context.save();
    roundedRectPath(artwork.x, artwork.y, artwork.width, artwork.height, artwork.radius);
    context.clip();
    context.drawImage(
      artworkImage,
      cropX,
      cropY,
      cropWidth,
      cropHeight,
      artwork.x,
      artwork.y,
      artwork.width,
      artwork.height
    );
    context.restore();
  }

  const basePixels = context.getImageData(0, 0, payload.width, payload.height);
  applyRgb565OrderedDither(basePixels.data, payload.width, payload.height);
  context.putImageData(basePixels, 0, 0);

  if (artworkImage) {
    roundedRectPath(artwork.x, artwork.y, artwork.width, artwork.height, artwork.radius);
    context.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    context.lineWidth = 1;
    context.stroke();
  }

  const left = artworkImage ? 112 : 12;
  const textWidth = payload.width - left - 8;
  context.fillStyle = payload.accent;
  setFont('700', 10);
  context.letterSpacing = '0.8px';
  context.fillText(payload.serviceLabel, left, 18, textWidth);
  context.letterSpacing = '0px';

  const titleLayout = fitTextBlock(
    payload.title,
    textWidth,
    15,
    19,
    2,
    (value, fontSize) => {
      setFont('700', fontSize);
      return context.measureText(value).width;
    }
  );
  context.fillStyle = '#ffffff';
  setFont('700', titleLayout.fontSize);
  const titleLineHeight = titleLayout.fontSize + 2;
  const titleBaseline = 27 + titleLayout.fontSize;
  titleLayout.lines.forEach((line, index) => {
    context.fillText(line, left, titleBaseline + index * titleLineHeight, textWidth);
  });

  const artistLayout = fitTextBlock(
    payload.artist,
    textWidth,
    12,
    12,
    1,
    (value, fontSize) => {
      setFont('600', fontSize);
      return context.measureText(value).width;
    }
  );
  context.fillStyle = '#dbe4ee';
  setFont('600', 12);
  context.fillText(artistLayout.lines[0], left, 89, textWidth);

  const albumLayout = fitTextBlock(
    payload.album,
    textWidth,
    10,
    10,
    1,
    (value, fontSize) => {
      setFont('500', fontSize);
      return context.measureText(value).width;
    }
  );
  context.fillStyle = '#94a3b8';
  setFont('500', 10);
  context.fillText(albumLayout.lines[0], left, 105, textWidth);

  context.fillStyle = payload.accent;
  if (payload.state === 'playing') {
    context.beginPath();
    context.moveTo(9, 116);
    context.lineTo(9, 126);
    context.lineTo(17, 121);
    context.closePath();
    context.fill();
  } else if (payload.state === 'paused') {
    context.fillRect(9, 116, 3, 10);
    context.fillRect(15, 116, 3, 10);
  } else {
    context.fillRect(9, 117, 9, 9);
  }

  const progressX = 25;
  const progressY = 119;
  const progressWidth = payload.width - progressX - 8;
  fillRoundedRect(progressX, progressY, progressWidth, 6, 3, '#334155');
  if (payload.showProgress) {
    fillRoundedRect(
      progressX,
      progressY,
      Math.round(progressWidth * payload.progress),
      6,
      3,
      payload.accent
    );
  }

  ${volumeOverlayDrawSource()}
  if (payload.volume !== null) {
    drawVolumeOverlay(context, payload.volume, payload.accent);
  }

  return canvas.toDataURL('image/png');
})()`;
}
