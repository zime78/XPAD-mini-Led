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
  nextYoutubeCaptureIntervalMs,
  youtubeLcdSendIntervalMs,
  youtubeHidIgnoreRatio,
  CAPTURE_INTERVAL_DEFAULT_MS,
  CAPTURE_INTERVAL_MIN_MS,
  CAPTURE_INTERVAL_MAX_MS,
  rgb565ToPngDataUrl,
  rgbaToPngDataUrl,
  lcdCaptureRect,
  mapYoutubeAudioSnapshot,
  mapYoutubePlayerInfo,
  parseYouTubeVideoId,
  preparePlayerScript,
  STOP_MEDIA_SCRIPT,
  seekPlayerScript,
  shouldApplyYoutubeQuality,
  shouldPullYoutubeLcdFrame,
  shouldResetYoutubeVolume,
  nextYoutubePinnedVolume,
  shouldClampYoutubeVolumeUp,
  shouldSeekYoutubeLcdClock,
  youtubeLcdClockTarget,
  youtubeLoginCookiesPresent,
  YOUTUBE_QUALITY_PREF,
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

describe('shouldApplyYoutubeQuality', () => {
  const pref = YOUTUBE_QUALITY_PREF;

  it('pins once when quality is still unknown', () => {
    expect(
      shouldApplyYoutubeQuality({
        current: 'unknown',
        chosen: 'tiny',
        pref,
        alreadyPinned: false,
      })
    ).toBe(true);
    expect(
      shouldApplyYoutubeQuality({
        current: 'unknown',
        chosen: 'tiny',
        pref,
        alreadyPinned: true,
      })
    ).toBe(false);
  });

  it('does not reapply an allowed or already chosen level', () => {
    expect(
      shouldApplyYoutubeQuality({
        current: 'tiny',
        chosen: 'tiny',
        pref,
        alreadyPinned: true,
      })
    ).toBe(false);
    expect(
      shouldApplyYoutubeQuality({
        current: 'small',
        chosen: 'tiny',
        pref,
        alreadyPinned: true,
      })
    ).toBe(false);
  });

  it('pulls a high level back down to the preferred floor', () => {
    expect(
      shouldApplyYoutubeQuality({
        current: 'hd1080',
        chosen: 'tiny',
        pref,
        alreadyPinned: true,
      })
    ).toBe(true);
  });
});

describe('youtubeLcdClockTarget', () => {
  it('leads the audio clock by the last HID draw time', () => {
    expect(youtubeLcdClockTarget(10, 100)).toBeCloseTo(10.1);
    expect(youtubeLcdClockTarget(10, null)).toBeCloseTo(10.1);
  });
});

describe('shouldSeekYoutubeLcdClock', () => {
  it('seeks when the lcd window is off the audio clock plus HID lead', () => {
    expect(
      shouldSeekYoutubeLcdClock({
        audioPosition: 10,
        lcdPosition: 10,
        audioAd: false,
        lcdAd: false,
        hidDrawMs: 100,
      })
    ).toBe(true);
    expect(
      shouldSeekYoutubeLcdClock({
        audioPosition: 10,
        lcdPosition: 10.1,
        audioAd: false,
        lcdAd: false,
        hidDrawMs: 100,
      })
    ).toBe(false);
  });

  it('does not fight different ad timing', () => {
    expect(
      shouldSeekYoutubeLcdClock({
        audioPosition: 10,
        lcdPosition: 12,
        audioAd: true,
        lcdAd: false,
      })
    ).toBe(false);
    expect(
      shouldSeekYoutubeLcdClock({
        audioPosition: 10,
        lcdPosition: 12,
        audioAd: false,
        lcdAd: true,
      })
    ).toBe(false);
  });
});

describe('shouldResetYoutubeVolume', () => {
  it('resets only when the element is muted or at zero', () => {
    expect(shouldResetYoutubeVolume(false, 1)).toBe(false);
    expect(shouldResetYoutubeVolume(false, 0.995)).toBe(false);
    expect(shouldResetYoutubeVolume(false, 0.45551219141001703)).toBe(false);
    expect(shouldResetYoutubeVolume(true, 1)).toBe(true);
    expect(shouldResetYoutubeVolume(false, 0)).toBe(true);
    expect(shouldResetYoutubeVolume(false, Number.NaN)).toBe(true);
  });
});

describe('youtube volume pin', () => {
  it('lowers the pin when loudness is quieter and clamps later increases', () => {
    expect(nextYoutubePinnedVolume(null, 1)).toBe(1);
    expect(nextYoutubePinnedVolume(1, 0.45551219141001703)).toBe(0.45551219141001703);
    expect(nextYoutubePinnedVolume(0.45551219141001703, 0.7753539433595975)).toBe(
      0.45551219141001703
    );
    expect(nextYoutubePinnedVolume(0.45551219141001703, 0)).toBe(0.45551219141001703);
    expect(shouldClampYoutubeVolumeUp(0.45551219141001703, 0.7753539433595975)).toBe(true);
    expect(shouldClampYoutubeVolumeUp(0.45551219141001703, 0.45551219141001703)).toBe(false);
    expect(shouldClampYoutubeVolumeUp(null, 0.7753539433595975)).toBe(false);
  });
});

describe('shouldPullYoutubeLcdFrame', () => {
  it('always pulls while playing even if the hidden window starves rVFC', () => {
    expect(shouldPullYoutubeLcdFrame(false, true, true)).toBe(true);
    expect(shouldPullYoutubeLcdFrame(false, true, false)).toBe(false);
    expect(shouldPullYoutubeLcdFrame(true, true, false)).toBe(true);
    expect(shouldPullYoutubeLcdFrame(false, false, false)).toBe(true);
  });
});

describe('rgb565ToPngDataUrl', () => {
  it('round-trips a red LCD pixel from the same RGB565 buffer', () => {
    const rgba = Buffer.alloc(240 * 135 * 4, 0);
    rgba.set([255, 0, 0, 255], 0);
    const rgb565 = encodeRgbaToRgb565(rgba, 240, 135);
    const url = rgb565ToPngDataUrl(rgb565);
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
    const png = PNG.sync.read(Buffer.from(url.slice('data:image/png;base64,'.length), 'base64'));
    expect(png.width).toBe(240);
    expect(png.height).toBe(135);
    expect(png.data[0]).toBe(255);
    expect(png.data[1]).toBe(0);
    expect(png.data[2]).toBe(0);
  });
});

describe('mapYoutubeAudioSnapshot', () => {
  it('keeps volume numbers and ad/quality flags for diagnostics', () => {
    expect(
      mapYoutubeAudioSnapshot({
        volume: 0.5,
        muted: true,
        quality: 'tiny',
        adPlaying: true,
        qualityApplied: true,
        volumeReset: false,
      })
    ).toEqual({
      volume: 0.5,
      muted: true,
      quality: 'tiny',
      adPlaying: true,
      qualityApplied: true,
      volumeReset: false,
    });
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

  it('keeps the audio window free of quality pinning and pixel isolation', () => {
    const audio = preparePlayerScript(true, 'audio');
    expect(audio).toContain('const lcd = false');
    expect(audio).toContain('if (video && lcd)');
    expect(audio).toContain('if (player && lcd)');
    expect(audio).toContain('if (video.muted)');
    expect(audio).toContain('vol <= 0');
    expect(audio).toContain('__xpadPinnedVolume');
    expect(audio).toContain('vol > pinned');
    expect(audio).not.toContain('video.volume >= 0.99');
  });

  it('mutes the lcd window and pins tiny quality there only', () => {
    const lcd = preparePlayerScript(true, 'lcd');
    expect(lcd).toContain('const lcd = true');
    expect(lcd).toContain('__xpadQualityPinned');
    expect(lcd).toContain('media.muted = true');
    expect(lcd).toContain('media.volume = 0');
    expect(lcd).toContain("querySelectorAll('video, audio')");
    expect(lcd).not.toContain('player.mute()');
    expect(lcd).not.toContain('setVolume(0)');
    expect(lcd).toContain('xpad-video-only');
  });
});

describe('seekPlayerScript', () => {
  it('seeks the watch player to a clamped time', () => {
    expect(seekPlayerScript(12.4)).toContain('const seconds = 12.4');
    expect(seekPlayerScript(12.4)).toContain('seekTo');
  });
});

describe('watchUrl', () => {
  it('uses the official watch page instead of /embed', () => {
    expect(watchUrl(SAMPLE_YOUTUBE_VIDEO_ID)).toBe(
      `https://www.youtube.com/watch?v=${SAMPLE_YOUTUBE_VIDEO_ID}&autoplay=1&vq=tiny`
    );
  });
});

describe('STOP_MEDIA_SCRIPT', () => {
  it('pauses media and stops the watch player before a track change', () => {
    expect(STOP_MEDIA_SCRIPT).toContain('media.pause()');
    expect(STOP_MEDIA_SCRIPT).toContain('stopVideo');
    expect(STOP_MEDIA_SCRIPT).not.toContain('loadVideoById');
  });
});

describe('formatFpsLine', () => {
  it('prints a single log line with window and fields', () => {
    expect(formatFpsLine('youtube-lcd', 2, { captureFps: 6.5, captureMsAvg: 40 })).toBe(
      '[youtube-lcd] window=2.0s captureFps=6.5 captureMsAvg=40'
    );
  });
});

describe('nextYoutubeCaptureIntervalMs', () => {
  it('uses the default until HID has a measured draw time', () => {
    expect(nextYoutubeCaptureIntervalMs(null)).toBe(CAPTURE_INTERVAL_DEFAULT_MS);
    expect(nextYoutubeCaptureIntervalMs(undefined)).toBe(CAPTURE_INTERVAL_DEFAULT_MS);
    expect(nextYoutubeCaptureIntervalMs(0)).toBe(CAPTURE_INTERVAL_DEFAULT_MS);
  });

  it('captures at 55% of HID time so one extra frame is waiting', () => {
    expect(nextYoutubeCaptureIntervalMs(100)).toBe(55);
    expect(nextYoutubeCaptureIntervalMs(95)).toBe(52);
    expect(nextYoutubeCaptureIntervalMs(80)).toBe(44);
  });

  it('stays inside the 40–100ms band', () => {
    expect(nextYoutubeCaptureIntervalMs(50)).toBe(CAPTURE_INTERVAL_MIN_MS);
    expect(nextYoutubeCaptureIntervalMs(200)).toBe(CAPTURE_INTERVAL_MAX_MS);
  });
});

describe('youtubeHidIgnoreRatio', () => {
  it('is about 45% when capture is 1.8× HID', () => {
    expect(youtubeHidIgnoreRatio(18.2, 100)).toBeCloseTo(0.45, 2);
  });

  it('is near zero when capture matches HID', () => {
    expect(youtubeHidIgnoreRatio(10, 100)).toBeCloseTo(0, 2);
  });

  it('is ~96% at the 1ms experiment rate', () => {
    expect(youtubeHidIgnoreRatio(240, 100)).toBeCloseTo(0.958, 2);
  });
});

describe('youtubeLcdSendIntervalMs', () => {
  it('rounds the last HID draw time', () => {
    expect(youtubeLcdSendIntervalMs(97)).toBe(97);
    expect(youtubeLcdSendIntervalMs(96.6)).toBe(97);
  });

  it('is empty until HID has sent a frame', () => {
    expect(youtubeLcdSendIntervalMs(null)).toBeNull();
    expect(youtubeLcdSendIntervalMs(0)).toBeNull();
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
