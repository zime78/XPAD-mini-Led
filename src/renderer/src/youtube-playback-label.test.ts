import { describe, expect, it } from 'vitest';
import type { YoutubePlaybackInfo } from '../../shared/types';
import {
  formatPlaybackClock,
  youtubePlaybackChannel,
  youtubePlaybackProgress,
  youtubePlaybackQueueLabel,
  youtubePlaybackStateLabel,
  youtubePlaybackTimeLabel,
  youtubePlaybackTitle,
} from './youtube-playback-label';

const info: YoutubePlaybackInfo = {
  videoId: 'abcdefghijk',
  title: '피크닉버스킹',
  channel: '이예준',
  state: 'paused',
  duration: 10,
  position: 1,
  signedIn: false,
  adPlaying: false,
  queueIndex: 2,
  queueCount: 5,
};

describe('youtube playback labels', () => {
  it('uses live metadata when present', () => {
    expect(youtubePlaybackTitle(info)).toBe('피크닉버스킹');
    expect(youtubePlaybackChannel(info)).toBe('이예준');
    expect(youtubePlaybackStateLabel(info)).toBe('일시 정지');
    expect(youtubePlaybackQueueLabel(info)).toBe('3 / 5');
    expect(youtubePlaybackTimeLabel(info)).toBe('0:01 / 0:10');
    expect(youtubePlaybackProgress(info)).toBe(10);
    expect(formatPlaybackClock(3723)).toBe('1:02:03');
  });

  it('falls back while metadata is missing', () => {
    expect(youtubePlaybackTitle(null)).toBe('제목 확인 중');
    expect(youtubePlaybackChannel(null)).toBe('채널 확인 중');
    expect(youtubePlaybackStateLabel(null)).toBe('준비 중');
    expect(youtubePlaybackQueueLabel(null)).toBeNull();
    expect(youtubePlaybackTimeLabel(null)).toBeNull();
    expect(youtubePlaybackProgress(null)).toBeNull();
    expect(youtubePlaybackStateLabel({ ...info, adPlaying: true })).toBe('광고');
  });
});
