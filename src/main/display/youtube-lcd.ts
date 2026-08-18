import { BrowserWindow, session } from 'electron';
import { PNG } from 'pngjs';
import {
  DEFAULT_YOUTUBE_VIDEO_ID,
  EMPTY_YOUTUBE_ACCOUNT,
  type PlaybackState,
  type YoutubeAccountState,
  type YoutubePlaybackInfo,
} from '../../shared/types';
import { LCD_HEIGHT, LCD_WIDTH } from '../device/protocol';
import { encodeRgb565 } from './frame-pipeline';

/** 사용자가 준 샘플: 이예준 피크닉버스킹 녹화. Mix/라디오 ID는 쓰지 않는다. */
export const SAMPLE_YOUTUBE_VIDEO_ID = DEFAULT_YOUTUBE_VIDEO_ID;
export const YOUTUBE_SESSION_PARTITION = 'persist:youtube-lcd';
const YOUTUBE_LOGIN_COOKIE_NAMES = [
  'SAPISID',
  'LOGIN_INFO',
  '__Secure-1PSID',
  '__Secure-3PSID',
] as const;

/** Electron 고유 표식만 빼고, 실제 Chromium 버전은 유지한다. 가짜 Chrome 131을 쓰지 않는다. */
export function youtubeSessionUserAgent(raw: string): string {
  return raw.replace(/\sElectron\/[\w.+-]+/g, '').replace(/\sXPAD[^\s]*/g, '').trim();
}

export function youtubeLoginCookiesPresent(names: readonly string[]): boolean {
  return names.some((name) =>
    YOUTUBE_LOGIN_COOKIE_NAMES.includes(name as (typeof YOUTUBE_LOGIN_COOKIE_NAMES)[number])
  );
}

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const VIEW_WIDTH = LCD_WIDTH;
const VIEW_HEIGHT = LCD_HEIGHT;
/** YouTube가 제공하는 최저 화질부터 고른다. tiny=144p, 없으면 small=240p. */
export const YOUTUBE_QUALITY_PREF = ['tiny', 'small', 'medium'] as const;
/** LCD 창만 탭한다. 소리 창에서는 뽑지 않는다. HID ~5fps. */
const CAPTURE_INTERVAL_MS = 200;
const LCD_SYNC_DRIFT_SEC = 1.5;
const FPS_LOG_INTERVAL_MS = 2000;
/** 제목·상태는 캡처보다 드물게 읽는다. 음성 스레드를 건드리지 않게 1초. */
const INFO_INTERVAL_MS = 1000;
/** 허용 화질이거나 이미 고정한 unknown이면 다시 setPlaybackQuality 하지 않는다. */
export function shouldApplyYoutubeQuality(input: {
  current: string | null | undefined;
  chosen: string | null | undefined;
  pref: readonly string[];
  alreadyPinned: boolean;
}): boolean {
  const current = input.current ?? '';
  const chosen = input.chosen ?? '';
  const { pref, alreadyPinned } = input;
  if (!chosen) return false;
  if (current && (pref.includes(current) || current === chosen)) return false;
  if ((current === 'unknown' || current === 'auto') && alreadyPinned) return false;
  if (!alreadyPinned) return true;
  return Boolean(current && current !== 'unknown' && current !== 'auto' && !pref.includes(current));
}

/** mute이거나 체감될 만큼 작을 때만 HTML 볼륨을 되돌린다. 1과의 미세 오차는 무시한다. */
export function shouldResetYoutubeVolume(muted: boolean, volume: number): boolean {
  return muted || !Number.isFinite(volume) || volume < 0.99;
}

/** 재생 중에는 캡처 주기마다 뽑는다. 숨은 창의 rVFC는 거의 안 불린다. 일시정지일 때만 dirty로 생략한다. */
export function shouldPullYoutubeLcdFrame(
  dirty: boolean,
  hasRvfc: boolean,
  playing: boolean
): boolean {
  if (playing) return true;
  return hasRvfc ? dirty : true;
}

export interface YoutubeAudioSnapshot {
  volume: number | null;
  muted: boolean | null;
  quality: string | null;
  adPlaying: boolean;
  qualityApplied: boolean;
  volumeReset: boolean;
}

/** executeJavaScript가 준 오디오/화질 원시값을 진단 스냅샷으로 맞춘다. */
export function mapYoutubeAudioSnapshot(raw: unknown): YoutubeAudioSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as {
    volume?: unknown;
    muted?: unknown;
    quality?: unknown;
    adPlaying?: unknown;
    qualityApplied?: unknown;
    volumeReset?: unknown;
  };
  const volume = source.volume == null ? null : Number(source.volume);
  return {
    volume: volume != null && Number.isFinite(volume) ? volume : null,
    muted: typeof source.muted === 'boolean' ? source.muted : null,
    quality: typeof source.quality === 'string' && source.quality ? source.quality : null,
    adPlaying: Boolean(source.adPlaying),
    qualityApplied: Boolean(source.qualityApplied),
    volumeReset: Boolean(source.volumeReset),
  };
}

/** 전환 로그용. qualityApplied/volumeReset 일회 플래그는 비교하지 않는다. */
export function sameYoutubeAudioSnapshot(
  left: YoutubeAudioSnapshot | null,
  right: YoutubeAudioSnapshot | null
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.volume === right.volume &&
    left.muted === right.muted &&
    left.quality === right.quality &&
    left.adPlaying === right.adPlaying
  );
}

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

export type YoutubePlayerSnapshot = Omit<YoutubePlaybackInfo, 'queueIndex' | 'queueCount'>;

export interface YouTubeLcdStartOptions {
  videoId: string;
  onFrame: (rgb565: Buffer) => void;
  onPreview?: (dataUrl: string) => void;
  onStopped?: () => void;
  onInfo?: (info: YoutubePlayerSnapshot) => void;
  onEnded?: () => void;
  onAudioChange?: (snapshot: YoutubeAudioSnapshot) => void;
}

/** RGBA를 LCD 미리보기 PNG data URL로 만든다. */
export function rgbaToPngDataUrl(rgba: Buffer, width: number, height: number): string {
  const png = new PNG({ width, height });
  rgba.copy(png.data, 0, 0, Math.min(png.data.length, rgba.length));
  return `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
}

/** 기기로 보낸 RGB565와 같은 픽셀로 미리보기 PNG를 만든다. */
export function rgb565ToPngDataUrl(
  rgb565: Buffer,
  width = LCD_WIDTH,
  height = LCD_HEIGHT
): string {
  const png = new PNG({ width, height });
  const pixels = width * height;
  for (let index = 0; index < pixels; index++) {
    const value = rgb565.readUInt16LE(index * 2);
    const red = (value >> 11) & 31;
    const green = (value >> 5) & 63;
    const blue = value & 31;
    const pixel = index * 4;
    png.data[pixel] = (red << 3) | (red >> 2);
    png.data[pixel + 1] = (green << 2) | (green >> 4);
    png.data[pixel + 2] = (blue << 3) | (blue >> 2);
    png.data[pixel + 3] = 255;
  }
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

/** YouTube IFrame/watch playerState를 앱 PlaybackState로 바꾼다. */
export function youtubePlayerStateToPlayback(playerState: number): PlaybackState {
  if (playerState === 1 || playerState === 3) return 'playing';
  if (playerState === 2 || playerState === 5) return 'paused';
  return 'stopped';
}

function cleanYoutubeTitle(title: string): string {
  const trimmed = title.replace(/\s*-\s*YouTube\s*$/i, '').trim();
  if (!trimmed || trimmed.toLowerCase() === 'youtube') return '';
  return trimmed;
}

/** executeJavaScript가 준 원시 메타를 상태 스냅샷으로 맞춘다. */
export function mapYoutubePlayerInfo(raw: unknown): YoutubePlayerSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as {
    videoId?: unknown;
    title?: unknown;
    channel?: unknown;
    playerState?: unknown;
    duration?: unknown;
    position?: unknown;
    signedIn?: unknown;
    adPlaying?: unknown;
  };
  const videoId = typeof source.videoId === 'string' ? source.videoId.trim() : '';
  const title = cleanYoutubeTitle(typeof source.title === 'string' ? source.title : '');
  const channel = typeof source.channel === 'string' ? source.channel.trim() : '';
  const playerState = Number(source.playerState);
  return {
    videoId: VIDEO_ID_PATTERN.test(videoId) ? videoId : '',
    title,
    channel,
    state: Number.isFinite(playerState) ? youtubePlayerStateToPlayback(playerState) : 'stopped',
    duration: Math.max(0, Number(source.duration) || 0),
    position: Math.max(0, Number(source.position) || 0),
    signedIn: Boolean(source.signedIn),
    adPlaying: Boolean(source.adPlaying),
  };
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
    window.__xpadLcdDirty = true;
    window.__xpadTakeLcdFrame = () => {
      const tap = window.__xpadLcdTap;
      const video = pickVideo();
      if (!tap.ctx || !video) return null;
      const hasRvfc = typeof video.requestVideoFrameCallback === 'function';
      const playing = !video.paused && !video.ended;
      if (!playing && hasRvfc && !window.__xpadLcdDirty) return { skipped: true };
      if (!coverDraw(tap.ctx, video)) return null;
      window.__xpadLcdDirty = false;
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

  const bindRvfc = (video) => {
    if (!video || video.__xpadRvfc) return;
    if (typeof video.requestVideoFrameCallback !== 'function') return;
    video.__xpadRvfc = true;
    const tick = () => {
      window.__xpadLcdDirty = true;
      try { video.requestVideoFrameCallback(tick); } catch (error) {}
    };
    video.requestVideoFrameCallback(tick);
  };

  const tap = window.__xpadLcdTap;
  const video = pickVideo();
  bindRvfc(video);
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
    rvfc: typeof video.requestVideoFrameCallback === 'function',
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

export type YoutubePrepareRole = 'audio' | 'lcd';

/** 소리 창은 재생만, LCD 창은 음소거 후 화질만 맞춘다. */
export function preparePlayerScript(
  wantPlay: boolean,
  role: YoutubePrepareRole = 'audio'
): string {
  return `
(() => {
  const wantPlay = ${wantPlay ? 'true' : 'false'};
  const lcd = ${role === 'lcd' ? 'true' : 'false'};
  const videos = Array.from(document.querySelectorAll('video'));
  const video = videos
    .filter((item) => item.videoWidth > 0)
    .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0]
    ?? videos[0];
  if (video && lcd) {
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
  const adPlaying = Boolean(
    player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'))
  );
  let quality = null;
  let qualityApplied = false;
  if (player && lcd) {
    const data = typeof player.getVideoData === 'function' ? player.getVideoData() : {};
    const videoId = data && data.video_id ? String(data.video_id) : '';
    if (window.__xpadPinnedVideoId !== videoId) {
      window.__xpadQualityPinned = false;
      window.__xpadPinnedVideoId = videoId;
    }
    const levels = typeof player.getAvailableQualityLevels === 'function'
      ? player.getAvailableQualityLevels()
      : [];
    const chosen = pref.find((item) => levels.includes(item))
      ?? (levels.length ? levels[levels.length - 1] : pref[0]);
    const current = typeof player.getPlaybackQuality === 'function'
      ? player.getPlaybackQuality()
      : null;
    quality = current || chosen;
    const pinned = Boolean(window.__xpadQualityPinned);
    const allowed = current && (pref.includes(current) || current === chosen);
    const unknownHold = pinned && (current === 'unknown' || current === 'auto');
    const tooHigh = current && current !== 'unknown' && current !== 'auto' && !pref.includes(current);
    const apply = Boolean(chosen) && !allowed && !unknownHold && (!pinned || tooHigh);
    if (allowed) window.__xpadQualityPinned = true;
    if (apply) {
      try {
        if (typeof player.setPlaybackQualityRange === 'function') {
          player.setPlaybackQualityRange(chosen, chosen);
        }
        if (typeof player.setPlaybackQuality === 'function') {
          player.setPlaybackQuality(chosen);
        }
        qualityApplied = true;
        window.__xpadQualityPinned = true;
        quality = typeof player.getPlaybackQuality === 'function'
          ? player.getPlaybackQuality()
          : chosen;
      } catch (error) {
        quality = 'error';
      }
    }
  }
  let volumeReset = false;
  if (video) {
    if (lcd) {
      if (!video.muted || video.volume !== 0) {
        video.muted = true;
        video.volume = 0;
        volumeReset = true;
      }
    } else if (video.muted || !(video.volume >= 0.99)) {
      video.muted = false;
      video.volume = 1;
      volumeReset = true;
    }
    if (wantPlay && video.paused && !video.ended) {
      video.play?.().catch(() => {});
    }
    return {
      status: video.paused ? 'paused' : 'playing',
      quality,
      isolated: lcd,
      volume: video.volume,
      muted: video.muted,
      qualityApplied,
      volumeReset,
      adPlaying,
    };
  }
  if (wantPlay) {
    const play = document.querySelector('button.ytp-large-play-button, button[aria-label*="재생"], button[aria-label*="Play"]');
    if (play instanceof HTMLElement) play.click();
  }
  return {
    status: 'waiting',
    quality,
    isolated: false,
    volume: null,
    muted: null,
    qualityApplied,
    volumeReset: false,
    adPlaying,
  };
})();
`;
}

/** LCD 창 재생 위치를 소리 창에 맞출 때 쓴다. */
export function seekPlayerScript(seconds: number): string {
  const time = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return `
(() => {
  const seconds = ${time};
  const player = document.getElementById('movie_player');
  if (player && typeof player.seekTo === 'function') {
    player.seekTo(seconds, true);
    return { status: 'seeked' };
  }
  const video = document.querySelector('video');
  if (!video) return { status: 'missing' };
  video.currentTime = seconds;
  return { status: 'seeked' };
})();
`;
}

const READ_PLAYER_INFO_SCRIPT = `
(() => {
  const player = document.getElementById('movie_player');
  const video = document.querySelector('video.xpad-lcd-source')
    || Array.from(document.querySelectorAll('video')).find((item) => item.videoWidth > 0)
    || document.querySelector('video');
  const data = player && typeof player.getVideoData === 'function' ? player.getVideoData() : {};
  const playerState = player && typeof player.getPlayerState === 'function'
    ? player.getPlayerState()
    : (video ? (video.paused ? 2 : 1) : -1);
  const duration = player && typeof player.getDuration === 'function'
    ? player.getDuration()
    : (video && Number.isFinite(video.duration) ? video.duration : 0);
  const position = player && typeof player.getCurrentTime === 'function'
    ? player.getCurrentTime()
    : (video ? video.currentTime : 0);
  const adPlaying = Boolean(
    player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'))
  );
  const signedIn = /(?:^|;\\s*)(?:__Secure-)?(?:SAPISID|SID|LOGIN_INFO)=/.test(document.cookie);
  const quality = player && typeof player.getPlaybackQuality === 'function'
    ? player.getPlaybackQuality()
    : null;
  return {
    videoId: data && data.video_id ? String(data.video_id) : '',
    title: data && data.title ? String(data.title) : (document.title || ''),
    channel: data && data.author ? String(data.author) : '',
    playerState,
    duration,
    position,
    signedIn,
    adPlaying,
    volume: video ? video.volume : null,
    muted: video ? video.muted : null,
    quality,
  };
})();
`;

const CONTROL_PLAY_PAUSE_SCRIPT = `
(() => {
  const player = document.getElementById('movie_player');
  if (player && typeof player.getPlayerState === 'function') {
    const state = player.getPlayerState();
    if (state === 1 || state === 3) {
      if (typeof player.pauseVideo === 'function') player.pauseVideo();
      return { status: 'paused' };
    }
    if (typeof player.playVideo === 'function') player.playVideo();
    return { status: 'playing' };
  }
  const video = document.querySelector('video');
  if (!video) return { status: 'missing' };
  if (video.paused) {
    void video.play();
    return { status: 'playing' };
  }
  video.pause();
  return { status: 'paused' };
})();
`;

const SKIP_AD_SCRIPT = `
(() => {
  const player = document.getElementById('movie_player');
  if (!player || !(player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'))) {
    return { skipped: false };
  }
  const skip = document.querySelector(
    '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, button.ytp-skip-ad-button, .ytp-ad-skip-button-container button'
  );
  if (skip instanceof HTMLElement) {
    skip.click();
    return { skipped: true };
  }
  return { skipped: false };
})();
`;

function loadVideoScript(videoId: string): string {
  return `
(() => {
  const player = document.getElementById('movie_player');
  if (player && typeof player.loadVideoById === 'function') {
    player.loadVideoById(${JSON.stringify(videoId)});
    return { status: 'loaded' };
  }
  return { status: 'missing' };
})();
`;
}

function youtubeSession() {
  return session.fromPartition(YOUTUBE_SESSION_PARTITION);
}

export function applyYoutubeSessionUserAgent(): string {
  const ses = youtubeSession();
  const agent = youtubeSessionUserAgent(ses.getUserAgent());
  ses.setUserAgent(agent);
  return agent;
}

export function hardenYoutubeSession(): void {
  const ses = youtubeSession();
  applyYoutubeSessionUserAgent();
  ses.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
}

export async function readYoutubeAccountState(): Promise<YoutubeAccountState> {
  const cookies = await youtubeSession().cookies.get({ domain: '.youtube.com' });
  const signedIn = youtubeLoginCookiesPresent(cookies.map((cookie) => cookie.name));
  return {
    signedIn,
    label: signedIn ? '연결됨 (이 앱 세션)' : EMPTY_YOUTUBE_ACCOUNT.label,
  };
}

/** 쿠키만 보지 않고 youtube.com이 로그인 상태로 열리는지 확인한다. */
export async function confirmYoutubeAccountState(): Promise<YoutubeAccountState> {
  const cookieState = await readYoutubeAccountState();
  if (!cookieState.signedIn) return cookieState;
  hardenYoutubeSession();
  const probe = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: {
      partition: YOUTUBE_SESSION_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  try {
    probe.webContents.setUserAgent(applyYoutubeSessionUserAgent());
    await probe.loadURL('https://www.youtube.com/', {
      extraHeaders: 'Referer: https://www.youtube.com/\r\n',
    });
    const url = probe.webContents.getURL();
    const onAccounts = url.includes('accounts.google.com');
    if (onAccounts) {
      return { signedIn: false, label: EMPTY_YOUTUBE_ACCOUNT.label };
    }
    return { signedIn: true, label: '연결됨 (YouTube에서 확인)' };
  } catch {
    return cookieState;
  } finally {
    if (!probe.isDestroyed()) probe.destroy();
  }
}

export async function clearYoutubeSession(): Promise<void> {
  await session.fromPartition(YOUTUBE_SESSION_PARTITION).clearStorageData();
}

function createHiddenWatchWindow(title: string): BrowserWindow {
  const window = new BrowserWindow({
    title,
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
      partition: YOUTUBE_SESSION_PARTITION,
    },
  });
  window.setMenuBarVisibility(false);
  window.webContents.setUserAgent(applyYoutubeSessionUserAgent());
  window.webContents.setBackgroundThrottling(false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  return window;
}

function loadWatchPage(window: BrowserWindow, videoId: string): Promise<void> {
  return window.loadURL(watchUrl(videoId), {
    extraHeaders: 'Referer: https://www.youtube.com/\r\n',
    httpReferrer: 'https://www.youtube.com/',
  });
}

/**
 * 같은 로그인 세션으로 창을 둘로 나눈다.
 * 소리 창은 픽셀을 안 뜯고, LCD 창은 음소거 후 장만 뽑는다.
 */
export class YouTubeLcdPlayer {
  private audioWindow: BrowserWindow | null = null;
  private lcdWindow: BrowserWindow | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private playTimer: ReturnType<typeof setInterval> | null = null;
  private infoTimer: ReturnType<typeof setInterval> | null = null;
  private onStopped: (() => void) | null = null;
  private onEnded: (() => void) | null = null;
  private currentVideoId = '';
  private lastEndedVideoId: string | null = null;
  private userPaused = false;
  private signInWindow: BrowserWindow | null = null;
  private capturing = false;
  private lastLoggedQuality: string | null = null;
  private lastLoggedTap: string | null = null;
  private lastAudio: YoutubeAudioSnapshot | null = null;
  private onAudioChange: ((snapshot: YoutubeAudioSnapshot) => void) | null = null;
  private readonly meter = new IntervalMeter();

  get active(): boolean {
    return this.audioWindow !== null && !this.audioWindow.isDestroyed();
  }

  start(options: YouTubeLcdStartOptions): void {
    this.stop({ silent: true });
    this.onStopped = options.onStopped ?? null;
    this.onEnded = options.onEnded ?? null;
    this.onAudioChange = options.onAudioChange ?? null;
    this.currentVideoId = options.videoId;
    this.lastAudio = null;
    this.lastEndedVideoId = null;
    this.userPaused = false;

    hardenYoutubeSession();
    const audio = createHiddenWatchWindow('XPAD YouTube Audio');
    const lcd = createHiddenWatchWindow('XPAD YouTube LCD');
    this.audioWindow = audio;
    this.lcdWindow = lcd;
    console.log(
      `[youtube-lcd] start video=${options.videoId} url=${watchUrl(options.videoId)} source=split-audio-lcd encode=main-rgb565 captureIntervalMs=${CAPTURE_INTERVAL_MS} lcd=${LCD_WIDTH}x${LCD_HEIGHT}`
    );

    const handleClosed = () => {
      if (this.audioWindow !== audio && this.lcdWindow !== lcd) return;
      this.clearTimer();
      this.destroyWatchWindows();
      const stopped = this.onStopped;
      this.onStopped = null;
      stopped?.();
    };
    audio.on('closed', handleClosed);
    lcd.on('closed', handleClosed);

    const prepareAudio = () => {
      if (this.audioWindow !== audio || audio.isDestroyed()) return;
      void audio.webContents
        .executeJavaScript(preparePlayerScript(!this.userPaused, 'audio'))
        .then((result) => {
          this.noteAudio(result);
        })
        .catch(() => undefined);
    };
    const prepareLcd = () => {
      if (this.lcdWindow !== lcd || lcd.isDestroyed()) return;
      void lcd.webContents
        .executeJavaScript(preparePlayerScript(!this.userPaused, 'lcd'))
        .then((result) => {
          const info = result as { status?: string; quality?: string | null } | null;
          if (info?.status === 'playing' || info?.status === 'paused') {
            const quality = info.quality ?? 'unknown';
            if (quality !== this.lastLoggedQuality) {
              this.lastLoggedQuality = quality;
              console.log(`[youtube-lcd] lcd quality=${quality}`);
            }
            void this.installVideoTap(lcd);
          }
        })
        .catch(() => undefined);
    };

    audio.webContents.on('did-finish-load', () => {
      if (this.audioWindow !== audio || audio.isDestroyed()) return;
      prepareAudio();
      if (!this.infoTimer && options.onInfo) {
        const emitInfo = () => {
          void this.readInfo(audio, options.onInfo);
        };
        emitInfo();
        this.infoTimer = setInterval(emitInfo, INFO_INTERVAL_MS);
      }
    });
    lcd.webContents.on('did-finish-load', () => {
      if (this.lcdWindow !== lcd || lcd.isDestroyed()) return;
      prepareLcd();
      if (!this.timer) {
        this.timer = setInterval(() => {
          void this.capture(lcd, options.onFrame, options.onPreview);
        }, CAPTURE_INTERVAL_MS);
      }
    });
    this.playTimer = setInterval(() => {
      prepareAudio();
      prepareLcd();
    }, 2000);

    void loadWatchPage(audio, options.videoId);
    void loadWatchPage(lcd, options.videoId);
  }

  async controlPlayPause(): Promise<void> {
    const audio = this.requireAudioWindow();
    const result = (await audio.webContents.executeJavaScript(CONTROL_PLAY_PAUSE_SCRIPT)) as {
      status?: string;
    } | null;
    if (result?.status === 'missing') {
      throw new Error('YouTube 재생기를 찾지 못했습니다.');
    }
    this.userPaused = result?.status === 'paused';
    const lcd = this.lcdWindow;
    if (lcd && !lcd.isDestroyed()) {
      try {
        await lcd.webContents.executeJavaScript(CONTROL_PLAY_PAUSE_SCRIPT);
      } catch {
        // 소리 창 상태가 우선이다.
      }
    }
  }

  async load(videoId: string): Promise<void> {
    const audio = this.requireAudioWindow();
    this.currentVideoId = videoId;
    this.lastEndedVideoId = null;
    this.userPaused = false;
    this.lastAudio = null;
    await Promise.all([
      this.loadOnWindow(audio, videoId),
      this.lcdWindow && !this.lcdWindow.isDestroyed()
        ? this.loadOnWindow(this.lcdWindow, videoId)
        : Promise.resolve(),
    ]);
  }

  private async loadOnWindow(window: BrowserWindow, videoId: string): Promise<void> {
    try {
      const result = (await window.webContents.executeJavaScript(loadVideoScript(videoId))) as {
        status?: string;
      } | null;
      if (result?.status === 'loaded') return;
    } catch {
      // watch 페이지 재로드로 폴백한다.
    }
    await loadWatchPage(window, videoId);
  }

  async openSignInWindow(): Promise<YoutubeAccountState> {
    if (this.signInWindow && !this.signInWindow.isDestroyed()) {
      this.signInWindow.show();
      this.signInWindow.focus();
      return readYoutubeAccountState();
    }
    try {
      await this.audioWindow?.webContents.executeJavaScript(CONTROL_PLAY_PAUSE_SCRIPT);
    } catch {
      // 로그인 창을 여는 것이 우선이다.
    }
    hardenYoutubeSession();
    const login = new BrowserWindow({
      title: 'YouTube 계정 연결',
      width: 960,
      height: 720,
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        partition: YOUTUBE_SESSION_PARTITION,
      },
    });
    this.signInWindow = login;
    login.webContents.setUserAgent(applyYoutubeSessionUserAgent());
    login.webContents.setWindowOpenHandler(({ url }) => {
      try {
        const host = new URL(url).hostname;
        const allowed =
          host === 'youtube.com' ||
          host.endsWith('.youtube.com') ||
          host === 'google.com' ||
          host.endsWith('.google.com') ||
          host.endsWith('.google.co.kr') ||
          host.endsWith('.gstatic.com') ||
          host.endsWith('.googleusercontent.com');
        if (!allowed) return { action: 'deny' as const };
        return {
          action: 'allow' as const,
          overrideBrowserWindowOptions: {
            webPreferences: {
              partition: YOUTUBE_SESSION_PARTITION,
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: true,
              webSecurity: true,
            },
          },
        };
      } catch {
        return { action: 'deny' as const };
      }
    });
    await login.loadURL(
      'https://accounts.google.com/ServiceLogin?service=youtube&continue=https://www.youtube.com/'
    );
    await new Promise<void>((resolve) => {
      login.once('closed', () => resolve());
    });
    this.signInWindow = null;
    return confirmYoutubeAccountState();
  }

  stop(options: { silent?: boolean } = {}): void {
    this.clearTimer();
    this.onEnded = null;
    this.lastEndedVideoId = null;
    this.userPaused = false;
    this.currentVideoId = '';
    if (this.signInWindow && !this.signInWindow.isDestroyed()) {
      this.signInWindow.destroy();
    }
    this.signInWindow = null;
    if (options.silent) this.onStopped = null;
    const stopped = this.onStopped;
    this.onStopped = null;
    this.destroyWatchWindows();
    if (!options.silent) stopped?.();
  }

  private destroyWatchWindows(): void {
    const audio = this.audioWindow;
    const lcd = this.lcdWindow;
    this.audioWindow = null;
    this.lcdWindow = null;
    for (const window of [audio, lcd]) {
      if (window && !window.isDestroyed()) {
        window.removeAllListeners('closed');
        window.destroy();
      }
    }
  }

  private clearTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.playTimer) clearInterval(this.playTimer);
    this.playTimer = null;
    if (this.infoTimer) clearInterval(this.infoTimer);
    this.infoTimer = null;
    this.capturing = false;
    this.lastLoggedQuality = null;
    this.lastLoggedTap = null;
    this.lastAudio = null;
    this.onAudioChange = null;
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
      if ('skipped' in pulled) {
        return;
      }
      const pullMs = Date.now() - started;
      const encodeStarted = Date.now();
      const rgb565 = encodeRgbaToRgb565(pulled.rgba, pulled.width, pulled.height);
      onFrame(rgb565);
      onPreview?.(rgb565ToPngDataUrl(rgb565));
      this.meter.ok('video', pullMs, Date.now() - encodeStarted);
    } catch (error) {
      console.error('[youtube-lcd] capture failed', error);
      this.meter.drop();
    } finally {
      this.capturing = false;
    }
  }

  private requireAudioWindow(): BrowserWindow {
    const window = this.audioWindow;
    if (!window || window.isDestroyed()) {
      throw new Error('YouTube 재생 창이 없습니다.');
    }
    return window;
  }

  private async readInfo(
    window: BrowserWindow,
    onInfo?: (info: YoutubePlayerSnapshot) => void
  ): Promise<void> {
    if (window.isDestroyed()) return;
    try {
      await window.webContents.executeJavaScript(SKIP_AD_SCRIPT);
      const raw = await window.webContents.executeJavaScript(READ_PLAYER_INFO_SCRIPT);
      const info = mapYoutubePlayerInfo(raw);
      this.noteAudio(raw);
      if (info) {
        onInfo?.(info);
        void this.syncLcdClock(info.position);
      }
      const playerState = Number((raw as { playerState?: unknown } | null)?.playerState);
      if (
        playerState === 0 &&
        info?.videoId &&
        info.videoId === this.currentVideoId &&
        this.lastEndedVideoId !== info.videoId
      ) {
        this.lastEndedVideoId = info.videoId;
        this.onEnded?.();
      }
    } catch {
      // 다음 주기에서 다시 읽는다.
    }
  }

  private async pullVideoFrame(
    window: BrowserWindow
  ): Promise<{ rgba: Buffer; width: number; height: number } | { skipped: true } | null> {
    const raw = (await window.webContents.executeJavaScript(TAKE_VIDEO_FRAME_SCRIPT)) as {
      rgba?: unknown;
      width?: number;
      height?: number;
      skipped?: unknown;
    } | null;
    if (raw?.skipped) return { skipped: true };
    const rgba = unwrapPixelBytes(raw?.rgba);
    const width = Number(raw?.width ?? 0);
    const height = Number(raw?.height ?? 0);
    if (!rgba || width < 1 || height < 1 || rgba.length < width * height * 4) return null;
    return { rgba, width, height };
  }

  /** 화질·볼륨·광고가 바뀌었거나 이번에 강제 적용했으면 진단 콜백만 호출한다. */
  private noteAudio(raw: unknown): void {
    const snapshot = mapYoutubeAudioSnapshot(raw);
    if (!snapshot) return;
    const changed = !sameYoutubeAudioSnapshot(this.lastAudio, snapshot);
    if (!changed && !snapshot.qualityApplied && !snapshot.volumeReset) return;
    this.lastAudio = snapshot;
    if (snapshot.qualityApplied || snapshot.volumeReset) {
      console.log(
        `[youtube-lcd] audio quality=${snapshot.quality ?? 'none'} volume=${snapshot.volume ?? -1} muted=${snapshot.muted} ad=${snapshot.adPlaying} qualityApplied=${snapshot.qualityApplied} volumeReset=${snapshot.volumeReset}`
      );
    }
    this.onAudioChange?.(snapshot);
  }

  /** 소리 창 시각과 LCD 창이 1.5초 이상 벌어지면 LCD만 맞춘다. */
  private async syncLcdClock(position: number): Promise<void> {
    const lcd = this.lcdWindow;
    if (!lcd || lcd.isDestroyed() || !Number.isFinite(position)) return;
    try {
      await lcd.webContents.executeJavaScript(SKIP_AD_SCRIPT);
      const raw = await lcd.webContents.executeJavaScript(READ_PLAYER_INFO_SCRIPT);
      const lcdInfo = mapYoutubePlayerInfo(raw);
      if (!lcdInfo) return;
      if (Math.abs(lcdInfo.position - position) <= LCD_SYNC_DRIFT_SEC) return;
      await lcd.webContents.executeJavaScript(seekPlayerScript(position));
    } catch {
      // 다음 정보 주기에서 다시 맞춘다.
    }
  }
}
