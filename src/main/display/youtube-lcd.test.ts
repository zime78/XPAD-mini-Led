import { PNG } from 'pngjs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: class {},
  session: {
    fromPartition: () => ({
      getUserAgent: () =>
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Electron/43.1.1',
      setUserAgent: () => undefined,
      setPermissionRequestHandler: () => undefined,
      cookies: { get: async () => [] },
      clearStorageData: async () => undefined,
    }),
  },
}));
import {
  coverCrop,
  encodeCapturedPng,
  encodeRgbaToRgb565,
  formatFpsLine,
  rgbaToPngDataUrl,
  lcdCaptureRect,
  mapYoutubePlayerInfo,
  parseYouTubeVideoId,
  preparePlayerScript,
  youtubeLoginCookiesPresent,
  youtubeSessionUserAgent,
  SAMPLE_YOUTUBE_VIDEO_ID,
  unwrapPixelBytes,
  videoCoverSourceRect,
  watchUrl,
  youtubePlayerStateToPlayback,
} from './youtube-lcd';

describe('youtubeSessionUserAgent', () => {
  it('keeps the real Chrome version and drops the Electron token', () => {
    expect(
      youtubeSessionUserAgent(
        'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36 Electron/43.1.1'
      )
    ).toBe('Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36');
  });
});

describe('youtubeLoginCookiesPresent', () => {
  it('requires a real YouTube login cookie name', () => {
    expect(youtubeLoginCookiesPresent(['PREF', 'VISITOR_INFO1_LIVE'])).toBe(false);
    expect(youtubeLoginCookiesPresent(['PREF', 'SAPISID'])).toBe(true);
  });
});

describe('parseYouTubeVideoId', () => {
  it('accepts the sample watch URL including Mix query params', () => {
    expect(
      parseYouTubeVideoId(
        'https://www.youtube.com/watch?v=vCFfPqLVp0U&list=RDvCFfPqLVp0U&start_radio=1'
      )
    ).toBe(SAMPLE_YOUTUBE_VIDEO_ID);
  });

  it('accepts a bare 11-character id', () => {
    expect(parseYouTubeVideoId(SAMPLE_YOUTUBE_VIDEO_ID)).toBe(SAMPLE_YOUTUBE_VIDEO_ID);
  });

  it('accepts embed and youtu.be urls', () => {
    expect(parseYouTubeVideoId('https://www.youtube.com/embed/vCFfPqLVp0U')).toBe(
      SAMPLE_YOUTUBE_VIDEO_ID
    );
    expect(parseYouTubeVideoId('https://youtu.be/vCFfPqLVp0U')).toBe(
      SAMPLE_YOUTUBE_VIDEO_ID
    );
  });

  it('rejects Mix playlist ids and empty input', () => {
    expect(parseYouTubeVideoId('RDvCFfPqLVp0U')).toBeNull();
    expect(parseYouTubeVideoId('')).toBeNull();
    expect(parseYouTubeVideoId('https://example.com/watch?v=vCFfPqLVp0U')).toBeNull();
  });
});

describe('coverCrop and lcdCaptureRect', () => {
  it('keeps a 16:9 source and takes the center 240x135', () => {
    const cover = coverCrop({ x: 0, y: 0, width: 256, height: 144 }, 240 / 135);
    expect(cover.width).toBeCloseTo(256);
    expect(cover.height).toBeCloseTo(144);
    expect(lcdCaptureRect({ x: 0, y: 0, width: 256, height: 144 })).toEqual({
      x: 8,
      y: 5,
      width: 240,
      height: 135,
    });
  });

  it('crops letterboxed sides on a wider frame', () => {
    const cover = coverCrop({ x: 0, y: 0, width: 400, height: 135 }, 240 / 135);
    expect(cover.width).toBeCloseTo(240);
    expect(cover.height).toBeCloseTo(135);
    expect(cover.x).toBeCloseTo(80);
  });
});

describe('mapYoutubePlayerInfo', () => {
  it('maps player state, strips the YouTube suffix, and flags ads', () => {
    expect(youtubePlayerStateToPlayback(1)).toBe('playing');
    expect(youtubePlayerStateToPlayback(2)).toBe('paused');
    expect(youtubePlayerStateToPlayback(0)).toBe('stopped');
    expect(
      mapYoutubePlayerInfo({
        videoId: SAMPLE_YOUTUBE_VIDEO_ID,
        title: '피크닉버스킹 - YouTube',
        channel: '이예준',
        playerState: 1,
        duration: 180.4,
        position: 12.2,
        signedIn: true,
        adPlaying: true,
      })
    ).toEqual({
      videoId: SAMPLE_YOUTUBE_VIDEO_ID,
      title: '피크닉버스킹',
      channel: '이예준',
      state: 'playing',
      duration: 180.4,
      position: 12.2,
      signedIn: true,
      adPlaying: true,
    });
  });

  it('returns an empty snapshot for junk input instead of throwing', () => {
    expect(mapYoutubePlayerInfo(null)).toBeNull();
    expect(mapYoutubePlayerInfo({ title: 'YouTube', playerState: 'x' })?.title).toBe('');
    expect(mapYoutubePlayerInfo({ title: 'YouTube', playerState: 'x' })?.state).toBe('stopped');
  });
});

describe('preparePlayerScript', () => {
  it('does not force play when the user paused', () => {
    const paused = preparePlayerScript(false);
    const playing = preparePlayerScript(true);
    expect(paused).toContain('const wantPlay = false');
    expect(playing).toContain('const wantPlay = true');
    expect(paused).toContain('if (wantPlay && video.paused && !video.ended)');
  });
});

describe('watchUrl', () => {
  it('uses the official watch page instead of /embed', () => {
    expect(watchUrl(SAMPLE_YOUTUBE_VIDEO_ID)).toBe(
      `https://www.youtube.com/watch?v=${SAMPLE_YOUTUBE_VIDEO_ID}&autoplay=1&vq=tiny`
    );
  });
});

describe('formatFpsLine', () => {
  it('prints a single log line with window and fields', () => {
    expect(formatFpsLine('youtube-lcd', 2, { captureFps: 6.5, captureMsAvg: 40 })).toBe(
      '[youtube-lcd] window=2.0s captureFps=6.5 captureMsAvg=40'
    );
  });
});

describe('encodeCapturedPng', () => {
  it('scales a captured frame to 240x135 RGB565', () => {
    const png = new PNG({ width: 4, height: 2 });
    png.data.fill(0);
    png.data.set([255, 0, 0, 255], 0);
    const frame = encodeCapturedPng(PNG.sync.write(png));
    expect(frame.length).toBe(240 * 135 * 2);
    expect(frame.readUInt16LE(0)).toBe(0xf800);
  });
});

describe('videoCoverSourceRect', () => {
  it('keeps a 16:9 decode buffer and only recenters', () => {
    const rect = videoCoverSourceRect(1920, 1080);
    expect(rect.width).toBeCloseTo(1920);
    expect(rect.height).toBeCloseTo(1080);
    expect(rect.x).toBeCloseTo(0);
    expect(rect.y).toBeCloseTo(0);
  });

  it('crops letterboxed sides from a wider decode buffer', () => {
    const rect = videoCoverSourceRect(1920, 800);
    expect(rect.height).toBeCloseTo(800);
    expect(rect.width).toBeCloseTo((800 * 240) / 135);
    expect(rect.x).toBeCloseTo((1920 - rect.width) / 2);
  });
});

describe('encodeRgbaToRgb565', () => {
  it('encodes a same-size red pixel without PNG', () => {
    const rgba = Buffer.alloc(240 * 135 * 4, 0);
    rgba.set([255, 0, 0, 255], 0);
    const frame = encodeRgbaToRgb565(rgba, 240, 135);
    expect(frame.length).toBe(240 * 135 * 2);
    expect(frame.readUInt16LE(0)).toBe(0xf800);
  });

  it('scales a tiny RGBA buffer to the LCD', () => {
    const rgba = Buffer.from([0, 255, 0, 255, 0, 0, 255, 255]);
    const frame = encodeRgbaToRgb565(rgba, 2, 1);
    expect(frame.length).toBe(240 * 135 * 2);
    expect(frame.readUInt16LE(0)).toBe(0x07e0);
  });
});

describe('rgbaToPngDataUrl', () => {
  it('writes a PNG data URL from RGBA', () => {
    const rgba = Buffer.alloc(4, 0);
    rgba.set([255, 0, 0, 255]);
    const url = rgbaToPngDataUrl(rgba, 1, 1);
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
    const png = PNG.sync.read(Buffer.from(url.slice('data:image/png;base64,'.length), 'base64'));
    expect(png.width).toBe(1);
    expect(png.data[0]).toBe(255);
  });
});

describe('unwrapPixelBytes', () => {
  it('accepts Uint8Array, Buffer, number[], and {data}', () => {
    const bytes = [255, 0, 0, 255];
    expect(unwrapPixelBytes(Buffer.from(bytes))?.equals(Buffer.from(bytes))).toBe(true);
    expect(unwrapPixelBytes(Uint8Array.from(bytes))?.equals(Buffer.from(bytes))).toBe(true);
    expect(unwrapPixelBytes(bytes)?.equals(Buffer.from(bytes))).toBe(true);
    expect(unwrapPixelBytes({ data: bytes })?.equals(Buffer.from(bytes))).toBe(true);
    expect(unwrapPixelBytes(null)).toBeNull();
  });
});
