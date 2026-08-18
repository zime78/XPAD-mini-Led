import { EMPTY_TRACK, type TrackInfo } from '../../shared/types';

/** 표시할 트랙이 없으면 기본 빈 화면을 쓴다. 이전 화면을 남겨 두지 않는다. */
export function resolveDisplayTrack(track: TrackInfo | null | undefined): TrackInfo {
  if (!track) return structuredClone(EMPTY_TRACK);
  if (track.service === 'none' || track.state === 'stopped' || !track.title.trim()) {
    return structuredClone(EMPTY_TRACK);
  }
  return track;
}
