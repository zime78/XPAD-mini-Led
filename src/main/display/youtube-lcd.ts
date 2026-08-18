import { BrowserWindow } from 'electron';
import { PNG } from 'pngjs';
import { LCD_HEIGHT, LCD_WIDTH } from '../device/protocol';
import { encodeRgb565 } from './frame-pipeline';

/** 사용자가 준 샘플: 이예준 피크닉버스킹 녹화. Mix/라디오 ID는 쓰지 않는다. */
export const SAMPLE_YOUTUBE_VIDEO_ID = 'vCFfPqLVp0U';

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const VIEW_WIDTH = LCD_WIDTH;
const VIEW_HEIGHT = LCD_HEIGHT;
/** YouTube가 제공하는 최저 화질부터 고른다. tiny=144p, 없으면 small=240p. */
export const YOUTUBE_QUALITY_PREF = ['tiny', 'small', 'medium'] as const;
/** HID 천장(~5fps)에 맞춰 뽑는다. 더 빨리 뽑으면 오디오만 끊긴다. */
const CAPTURE_INTERVAL_MS = 200;
const FPS_LOG_INTERVAL_MS = 2000;

/** 2초 구간의 횟수·합계를 한 줄 로그로 만든다. */
export function formatFpsLine(
  tag: string,
  seconds: number,
  fields: Record<string, number>
): string {
  const parts = Object.entries(fields).map(([key, value]) =>
    `${key}=${Number.isInteger(value) ? String(value) : value.toFixed(1)}`
  );
  return `[${tag}] window=${seconds.toFixed(1)}s ${parts.join(' ')}`;
}

class IntervalMeter {
  private started = Date.now();
  private frames = 0;
  private videoFrames = 0;
  private pageFrames = 0;
  private dropped = 0;
  private empty = 0;
  private pullMs = 0;
  private encodeMs = 0;

  drop(): void {
    this.dropped += 1;
    this.emit();
  }

  emptyFrame(): void {
    this.empty += 1;
    this.emit();
  }

  ok(source: 'video' | 'page', pullMs: number, encodeMs: number): void {
    this.frames += 1;
    if (source === 'video') this.videoFrames += 1;
    else this.pageFrames += 1;
    this.pullMs += pullMs;
    this.encodeMs += encodeMs;
    this.emit();
  }

  reset(): void {
    this.started = Date.now();
    this.frames = 0;
    this.videoFrames = 0;
    this.pageFrames = 0;
    this.dropped = 0;
    this.empty = 0;
    this.pullMs = 0;
    this.encodeMs = 0;
  }

  private emit(): void {
    const elapsedMs = Date.now() - this.started;
    if (elapsedMs < FPS_LOG_INTERVAL_MS) return;
    const seconds = elapsedMs / 1000;
    const n = Math.max(1, this.frames);
    const line = formatFpsLine('youtube-lcd', seconds, {
      videoFps: this.videoFrames / seconds,
      pageFps: this.pageFrames / seconds,
      dropFps: this.dropped / seconds,
      emptyFps: this.empty / seconds,
      pullMsAvg: this.pullMs / n,
      encodeMsAvg: this.encodeMs / n,
    });
    console.log(line);
    this.reset();
  }
}

export interface YouTubeLcdStartOptions {
  videoId: string;
  onFrame: (rgb565: Buffer) => void;
  onPreview?: (dataUrl: string) => void;
  onStopped?: () => void;
}

/** RGBA를 LCD 미리보기 PNG data URL로 만든다. */
export function rgbaToPngDataUrl(rgba: Buffer, width: number, height: number): string {
  const png = new PNG({ width, height });
  rgba.copy(png.data, 0, 0, Math.min(png.data.length, rgba.length));
  return `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
}

/**
 * watch/embed/youtu.be URL 또는 11자 ID에서 video ID만 뽑는다.
 * Mix(`RD…`)·재생목록 ID는 거부한다.
 */
export function parseYouTubeVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (VIDEO_ID_PATTERN.test(trimmed)) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '');
  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0] ?? '';
    return VIDEO_ID_PATTERN.test(id) ? id : null;
  }
  if (host !== 'youtube.com' && host !== 'm.youtube.com' && host !== 'music.youtube.com') {
    return null;
  }

  const embedId = url.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})/)?.[1];
  if (embedId) return embedId;

  const watchId = url.searchParams.get('v') ?? '';
  return VIDEO_ID_PATTERN.test(watchId) ? watchId : null;
}

export interface CaptureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const LCD_ASPECT = LCD_WIDTH / LCD_HEIGHT;

/**
 * `<video>` 박스 안에서 실제 픽셀이 그려지는 영역.
 * object-fit:contain 레터박스/필러박스를 뺀다.
 */
export function mediaContentRect(
  box: CaptureRect,
  videoWidth: number,
  videoHeight: number
): CaptureRect {
  if (videoWidth <= 0 || videoHeight <= 0 || box.width <= 0 || box.height <= 0) {
    return box;
  }
  const mediaAspect = videoWidth / videoHeight;
  const boxAspect = box.width / box.height;
  if (boxAspect > mediaAspect) {
    const width = box.height * mediaAspect;
    return {
      x: box.x + (box.width - width) / 2,
      y: box.y,
      width,
      height: box.height,
    };
  }
  const height = box.width / mediaAspect;
  return {
    x: box.x,
    y: box.y + (box.height - height) / 2,
    width: box.width,
    height,
  };
}

/** 원본에서 목표 비율을 덮는 가운데 사각형을 고른다(레터박스 제거). */
export function coverCrop(source: CaptureRect, aspect: number): CaptureRect {
  if (source.width <= 0 || source.height <= 0) return { x: 0, y: 0, width: LCD_WIDTH, height: LCD_HEIGHT };
  const sourceAspect = source.width / source.height;
  if (sourceAspect > aspect) {
    const width = source.height * aspect;
    return {
      x: source.x + (source.width - width) / 2,
      y: source.y,
      width,
      height: source.height,
    };
  }
  const height = source.width / aspect;
  return {
    x: source.x,
    y: source.y + (source.height - height) / 2,
    width: source.width,
    height,
  };
}

/**
 * LCD로 보낼 캡처 영역. 영상이 240×135보다 크면 가운데 240×135만 잘라
 * 리사이즈를 생략하고, 작으면 영상 전체를 잡아 나중에 확대한다.
 */
export function lcdCaptureRect(video: CaptureRect): CaptureRect {
  const cover = coverCrop(video, LCD_ASPECT);
  if (cover.width >= LCD_WIDTH && cover.height >= LCD_HEIGHT) {
    return {
      x: Math.round(cover.x + (cover.width - LCD_WIDTH) / 2),
      y: Math.round(cover.y + (cover.height - LCD_HEIGHT) / 2),
      width: LCD_WIDTH,
      height: LCD_HEIGHT,
    };
  }
  return {
    x: Math.max(0, Math.round(cover.x)),
    y: Math.max(0, Math.round(cover.y)),
    width: Math.max(1, Math.round(cover.width)),
    height: Math.max(1, Math.round(cover.height)),
  };
}

/**
 * `<video>` 디코드 픽셀에서 LCD 비율을 덮는 원본 사각형.
 * 페이지 크롬이 아니라 영상 버퍼 좌표다.
 */
export function videoCoverSourceRect(
  videoWidth: number,
  videoHeight: number,
  destWidth = LCD_WIDTH,
  destHeight = LCD_HEIGHT
): CaptureRect {
  if (videoWidth <= 0 || videoHeight <= 0) {
    return { x: 0, y: 0, width: destWidth, height: destHeight };
  }
  return coverCrop(
    { x: 0, y: 0, width: videoWidth, height: videoHeight },
    destWidth / destHeight
  );
}

/** executeJavaScript가 돌려준 픽셀 배열을 Buffer로 맞춘다. */
export function unwrapPixelBytes(value: unknown): Buffer | null {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (Array.isArray(value)) return Buffer.from(value as number[]);
  if (value && typeof value === 'object' && 'data' in value) {
    const data = (value as { data: unknown }).data;
    if (Buffer.isBuffer(data) || data instanceof Uint8Array || Array.isArray(data)) {
      return Buffer.from(data as ArrayLike<number>);
    }
  }
  if (value && typeof value === 'object' && 'length' in value) {
    const length = Number((value as { length: unknown }).length);
    if (Number.isInteger(length) && length > 0) {
      return Buffer.from(value as ArrayLike<number>);
    }
  }
  return null;
}

/** RGBA 버퍼를 240×135 RGB565-LE로 바꾼다. 크기가 다르면 nearest로 맞춘다. */
export function encodeRgbaToRgb565(rgba: Buffer, width: number, height: number): Buffer {
  const source =
    width === LCD_WIDTH && height === LCD_HEIGHT
      ? rgba
      : scaleRgbaNearest(rgba, width, height, LCD_WIDTH, LCD_HEIGHT);
  const pixels = LCD_WIDTH * LCD_HEIGHT;
  const out = Buffer.alloc(pixels * 2);
  for (let index = 0; index < pixels; index++) {
    const pixel = index * 4;
    const value =
      ((source[pixel] >> 3) << 11) | ((source[pixel + 1] >> 2) << 5) | (source[pixel + 2] >> 3);
    out.writeUInt16LE(value, index * 2);
  }
  return out;
}

function scaleRgbaNearest(
  source: Buffer,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number
): Buffer {
  const dest = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor((y * sourceHeight) / height));
    for (let x = 0; x < width; x++) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor((x * sourceWidth) / width));
      const from = (sourceY * sourceWidth + sourceX) * 4;
      const to = (y * width + x) * 4;
      dest[to] = source[from];
      dest[to + 1] = source[from + 1];
      dest[to + 2] = source[from + 2];
      dest[to + 3] = 255;
    }
  }
  return dest;
}

const VIDEO_RECT_SCRIPT = `
(() => {
  const videos = Array.from(document.querySelectorAll('video'));
  const video = videos
    .filter((item) => item.videoWidth > 0)
    .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0]
    ?? videos[0];
  if (!video) return null;
  const r = video.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return null;
  return {
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
    isolated: video.classList.contains('xpad-lcd-source'),
  };
})();
`;

const TAKE_VIDEO_FRAME_SCRIPT = `
window.__xpadTakeLcdFrame ? window.__xpadTakeLcdFrame() : null
`;

/**
 * 페이지는 영상 픽셀만 짧게 복사한다. RGB565 인코드는 main에서 한다.
 * createImageBitmap/페이지 루프는 쓰지 않는다 — YouTube 음성 스레드를 막는다.
 */
const VIDEO_TAP_SCRIPT = `
(() => {
  const W = ${LCD_WIDTH};
  const H = ${LCD_HEIGHT};
  const destAspect = W / H;
  const pickVideo = () => {
    const videos = Array.from(document.querySelectorAll('video'));
    return videos
      .filter((item) => item.videoWidth > 2 && item.readyState >= 2)
      .sort((a, b) => b.videoWidth * b.videoHeight - a.videoWidth * a.videoHeight)[0]
      ?? videos.find((item) => item.videoWidth > 0)
      ?? null;
  };
  const coverDraw = (ctx, video) => {
    const sw = video.videoWidth;
    const sh = video.videoHeight;
    if (sw < 2 || sh < 2) return false;
    const srcAspect = sw / sh;
    let sx = 0;
    let sy = 0;
    let cw = sw;
    let ch = sh;
    if (srcAspect > destAspect) {
      cw = sh * destAspect;
      sx = (sw - cw) / 2;
    } else {
      ch = sw / destAspect;
      sy = (sh - ch) / 2;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(video, sx, sy, cw, ch, 0, 0, W, H);
    return true;
  };

  if (!window.__xpadLcdTap) {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    canvas.id = 'xpad-lcd-tap';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:fixed;left:-9999px;top:0;width:' + W + 'px;height:' + H + 'px;pointer-events:none;opacity:0;';
    document.documentElement.appendChild(canvas);
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true, willReadFrequently: true });
    window.__xpadLcdTap = { canvas, ctx, frames: 0 };
    window.__xpadTakeLcdFrame = () => {
      const tap = window.__xpadLcdTap;
      const video = pickVideo();
      if (!tap.ctx || !video) return null;
      if (!coverDraw(tap.ctx, video)) return null;
      const image = tap.ctx.getImageData(0, 0, W, H);
      tap.frames += 1;
      return {
        rgba: new Uint8Array(image.data),
        width: W,
        height: H,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
      };
    };
  }

  const tap = window.__xpadLcdTap;
  const video = pickVideo();
  if (!tap.ctx) return { status: 'no-context' };
  if (!video) return { status: 'waiting', isolated: false, encode: 'main-rgb565' };
  return {
    status: 'tapping',
    isolated: video.classList.contains('xpad-lcd-source'),
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
    encode: 'main-rgb565',
    pullOnly: true,
    frames: tap.frames,
  };
})();
`;

/** NativeImage PNG를 240×135 RGB565-LE로 줄인다. */
export function encodeCapturedPng(pngBytes: Buffer): Buffer {
  const source = PNG.sync.read(pngBytes);
  if (source.width === LCD_WIDTH && source.height === LCD_HEIGHT) {
    return encodeRgb565(source).rgb565;
  }
  const scaled = scalePngNearest(source, LCD_WIDTH, LCD_HEIGHT);
  return encodeRgb565(scaled).rgb565;
}

function scalePngNearest(source: PNG, width: number, height: number): PNG {
  const dest = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    const sourceY = Math.min(source.height - 1, Math.floor((y * source.height) / height));
    for (let x = 0; x < width; x++) {
      const sourceX = Math.min(source.width - 1, Math.floor((x * source.width) / width));
      const from = (sourceY * source.width + sourceX) * 4;
      const to = (y * width + x) * 4;
      dest.data[to] = source.data[from];
      dest.data[to + 1] = source.data[from + 1];
      dest.data[to + 2] = source.data[from + 2];
      dest.data[to + 3] = 255;
    }
  }
  return dest;
}

/** 임베드(`/embed`)는 Electron에서 152-4로 거절되는 경우가 있어 공식 watch 페이지를 연다. */
export function watchUrl(videoId: string): string {
  const params = new URLSearchParams({
    v: videoId,
    autoplay: '1',
    vq: YOUTUBE_QUALITY_PREF[0],
  });
  return `https://www.youtube.com/watch?${params.toString()}`;
}

const PREPARE_PLAYER_SCRIPT = `
(() => {
  const videos = Array.from(document.querySelectorAll('video'));
  const video = videos
    .filter((item) => item.videoWidth > 0)
    .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0]
    ?? videos[0];
  if (video) {
    if (!document.getElementById('xpad-video-only')) {
      const style = document.createElement('style');
      style.id = 'xpad-video-only';
      style.textContent = \`
        html, body { background:#000 !important; overflow:hidden !important; }
        body * { visibility:hidden !important; }
        video.xpad-lcd-source { visibility:visible !important; }
        video.xpad-lcd-source {
          position:fixed !important;
          inset:0 !important;
          width:100vw !important;
          height:100vh !important;
          object-fit:cover !important;
          z-index:2147483647 !important;
          pointer-events:none !important;
        }
      \`;
      document.documentElement.appendChild(style);
    }
    for (const other of videos) other.classList.remove('xpad-lcd-source');
    video.classList.add('xpad-lcd-source');
  }
  const player = document.getElementById('movie_player');
  const pref = ${JSON.stringify(YOUTUBE_QUALITY_PREF)};
  let quality = null;
  if (player) {
    const levels = typeof player.getAvailableQualityLevels === 'function'
      ? player.getAvailableQualityLevels()
      : [];
    const chosen = pref.find((item) => levels.includes(item))
      ?? (levels.length ? levels[levels.length - 1] : pref[0]);
    try {
      if (typeof player.setPlaybackQualityRange === 'function') {
        player.setPlaybackQualityRange(chosen, chosen);
      }
      if (typeof player.setPlaybackQuality === 'function') {
        player.setPlaybackQuality(chosen);
      }
      quality = typeof player.getPlaybackQuality === 'function'
        ? player.getPlaybackQuality()
        : chosen;
    } catch (error) {
      quality = 'error';
    }
  }
  if (video) {
    video.muted = false;
    video.volume = 1;
    video.play?.().catch(() => {});
    return { status: 'playing', quality, isolated: true };
  }
  const play = document.querySelector('button.ytp-large-play-button, button[aria-label*="재생"], button[aria-label*="Play"]');
  if (play instanceof HTMLElement) play.click();
  return { status: 'waiting', quality, isolated: false };
})();
`;

/**
 * 공식 YouTube watch 페이지를 띄운다. 음성은 이 창에서 끊기지 않게 재생하고,
 * 영상만 240×135 RGB565로 맞춰 HID로 보낸다. 창 전체 캡처는 쓰지 않는다.
 */
export class YouTubeLcdPlayer {
  private window: BrowserWindow | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private playTimer: ReturnType<typeof setInterval> | null = null;
  private onStopped: (() => void) | null = null;
  private capturing = false;
  private lastLoggedQuality: string | null = null;
  private lastLoggedTap: string | null = null;
  private readonly meter = new IntervalMeter();

  get active(): boolean {
    return this.window !== null && !this.window.isDestroyed();
  }

  start(options: YouTubeLcdStartOptions): void {
    this.stop({ silent: true });
    this.onStopped = options.onStopped ?? null;

    const window = new BrowserWindow({
      title: 'XPAD YouTube LCD',
      width: VIEW_WIDTH,
      height: VIEW_HEIGHT,
      useContentSize: true,
      show: false,
      skipTaskbar: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      backgroundColor: '#000000',
      autoHideMenuBar: true,
      webPreferences: {
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        webSecurity: true,
        autoplayPolicy: 'no-user-gesture-required',
        partition: 'persist:youtube-lcd',
      },
    });
    this.window = window;
    window.webContents.setBackgroundThrottling(false);
    console.log(
      `[youtube-lcd] start video=${options.videoId} url=${watchUrl(options.videoId)} source=video-element encode=main-rgb565 hwdecode=on pace=device captureIntervalMs=${CAPTURE_INTERVAL_MS} lcd=${LCD_WIDTH}x${LCD_HEIGHT}`
    );
    window.setMenuBarVisibility(false);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    );

    window.on('closed', () => {
      this.clearTimer();
      this.window = null;
      const stopped = this.onStopped;
      this.onStopped = null;
      stopped?.();
    });

    void window.loadURL(watchUrl(options.videoId), {
      extraHeaders: 'Referer: https://www.youtube.com/\r\n',
      httpReferrer: 'https://www.youtube.com/',
    });

    const prepare = () => {
      if (this.window !== window || window.isDestroyed()) return;
      void window.webContents
        .executeJavaScript(PREPARE_PLAYER_SCRIPT)
        .then((result) => {
          const info = result as { status?: string; quality?: string | null } | null;
          if (info?.status === 'playing') {
            const quality = info.quality ?? 'unknown';
            if (quality !== this.lastLoggedQuality) {
              this.lastLoggedQuality = quality;
              console.log(`[youtube-lcd] playback quality=${quality}`);
            }
            void this.installVideoTap(window);
          }
        })
        .catch(() => undefined);
    };

    window.webContents.on('did-finish-load', () => {
      if (this.window !== window || window.isDestroyed()) return;
      prepare();
      if (!this.timer) {
        this.timer = setInterval(() => {
          void this.capture(window, options.onFrame, options.onPreview);
        }, CAPTURE_INTERVAL_MS);
      }
    });
    this.playTimer = setInterval(prepare, 2000);
  }

  stop(options: { silent?: boolean } = {}): void {
    this.clearTimer();
    const window = this.window;
    this.window = null;
    if (options.silent) this.onStopped = null;
    const stopped = this.onStopped;
    this.onStopped = null;
    if (window && !window.isDestroyed()) {
      window.removeAllListeners('closed');
      window.destroy();
    }
    if (!options.silent) stopped?.();
  }

  private clearTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.playTimer) clearInterval(this.playTimer);
    this.playTimer = null;
    this.capturing = false;
    this.lastLoggedQuality = null;
    this.lastLoggedTap = null;
    this.meter.reset();
  }

  private async installVideoTap(window: BrowserWindow): Promise<void> {
    try {
      const info = (await window.webContents.executeJavaScript(VIDEO_TAP_SCRIPT)) as {
        status?: string;
        videoWidth?: number;
        videoHeight?: number;
        usingRvfC?: boolean;
      } | null;
      const summary = `${info?.status ?? 'none'} ${info?.videoWidth ?? 0}x${info?.videoHeight ?? 0} encode=main-rgb565`;
      if (summary !== this.lastLoggedTap) {
        this.lastLoggedTap = summary;
        console.log(`[youtube-lcd] video tap ${summary}`);
      }
    } catch {
      // 다음 prepare에서 다시 붙인다.
    }
  }

  private async capture(
    window: BrowserWindow,
    onFrame: (rgb565: Buffer) => void,
    onPreview?: (dataUrl: string) => void
  ): Promise<void> {
    if (this.capturing || window.isDestroyed()) {
      this.meter.drop();
      return;
    }
    this.capturing = true;
    const started = Date.now();
    try {
      const pulled = await this.pullVideoFrame(window);
      if (!pulled) {
        this.meter.emptyFrame();
        return;
      }
      const pullMs = Date.now() - started;
      const encodeStarted = Date.now();
      onFrame(encodeRgbaToRgb565(pulled.rgba, pulled.width, pulled.height));
      onPreview?.(rgbaToPngDataUrl(pulled.rgba, pulled.width, pulled.height));
      this.meter.ok('video', pullMs, Date.now() - encodeStarted);
    } catch (error) {
      console.error('[youtube-lcd] capture failed', error);
      this.meter.drop();
    } finally {
      this.capturing = false;
    }
  }

  private async pullVideoFrame(
    window: BrowserWindow
  ): Promise<{ rgba: Buffer; width: number; height: number } | null> {
    const raw = (await window.webContents.executeJavaScript(TAKE_VIDEO_FRAME_SCRIPT)) as {
      rgba?: unknown;
      width?: number;
      height?: number;
    } | null;
    const rgba = unwrapPixelBytes(raw?.rgba);
    const width = Number(raw?.width ?? 0);
    const height = Number(raw?.height ?? 0);
    if (!rgba || width < 1 || height < 1 || rgba.length < width * height * 4) return null;
    return { rgba, width, height };
  }
}
