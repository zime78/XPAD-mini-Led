import type { YoutubePlaybackInfo } from '../../shared/types';

export function youtubePlaybackTitle(info: YoutubePlaybackInfo | null): string {
  if (info?.title.trim()) return info.title;
  return '제목 확인 중';
}

export function youtubePlaybackChannel(info: YoutubePlaybackInfo | null): string {
  if (info?.channel.trim()) return info.channel;
  return '채널 확인 중';
}

export function youtubePlaybackStateLabel(info: YoutubePlaybackInfo | null): string {
  if (!info) return '준비 중';
  if (info.adPlaying) return '광고';
  if (info.state === 'playing') return '재생 중';
  if (info.state === 'paused') return '일시 정지';
  return '재생 대기';
}

export function youtubePlaybackQueueLabel(info: YoutubePlaybackInfo | null): string | null {
  if (!info || info.queueCount < 1 || info.queueIndex < 0) return null;
  return `${info.queueIndex + 1} / ${info.queueCount}`;
}

export function formatPlaybackClock(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

export function youtubePlaybackTimeLabel(info: YoutubePlaybackInfo | null): string | null {
  if (!info || (info.duration <= 0 && info.position <= 0)) return null;
  if (info.duration <= 0) return formatPlaybackClock(info.position);
  return `${formatPlaybackClock(info.position)} / ${formatPlaybackClock(info.duration)}`;
}

export function youtubeLcdDelayLabel(delayMs: number | null | undefined): string | null {
  if (delayMs == null || !Number.isFinite(delayMs) || delayMs < 0) return null;
  return `${Math.round(delayMs)}ms`;
}

export function youtubePlaybackProgress(info: YoutubePlaybackInfo | null): number | null {
  if (!info || info.duration <= 0) return null;
  return Math.min(100, Math.max(0, (info.position / info.duration) * 100));
}

/** 진행 바 클릭 비율(0–1)을 초로 바꾼다. */
export function seekRatioToSeconds(ratio: number, duration: number): number | null {
  if (!Number.isFinite(ratio) || !Number.isFinite(duration) || duration <= 0) return null;
  return Math.min(duration, Math.max(0, ratio * duration));
}

/** 진행 바 위 포인터 X로 이동할 초를 구한다. */
export function seekSecondsFromClientX(
  clientX: number,
  barLeft: number,
  barWidth: number,
  duration: number
): number | null {
  const ratio = barWidth > 0 ? (clientX - barLeft) / barWidth : 0;
  return seekRatioToSeconds(ratio, duration);
}
