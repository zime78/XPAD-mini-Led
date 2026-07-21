import type { StatusSnapshot } from '../../../shared/types';
import { SettingsButton } from './app-header';
import { PlayerStatus } from './player-status';

const SERVICE_NAMES = {
  spotify: 'Spotify',
  'apple-music': 'Apple Music',
  none: '대기 중',
} as const;

const PLAYBACK_STATE_NAMES = {
  playing: '재생 중',
  paused: '일시 정지',
  stopped: '재생 대기',
} as const;

type PlayerViewProps = {
  status: StatusSnapshot;
  onOpenSettings: () => void;
};

export function PlayerView({ status, onOpenSettings }: PlayerViewProps) {
  const track = status.track;

  return (
    <section className="hero" aria-labelledby="current-track-title">
      <div className="player-toolbar">
        <PlayerStatus status={status} />
        <SettingsButton onClick={onOpenSettings} />
      </div>
      <div className="player-content">
        <div className="lcd-shell">
          {status.previewDataUrl ? (
            <img src={status.previewDataUrl} alt="XPAD LCD 미리보기" />
          ) : (
            <div className="preview-empty">LCD 미리보기 준비 중</div>
          )}
        </div>
        <div className="track-info">
          <span className={`badge ${track.service}`}>{SERVICE_NAMES[track.service]}</span>
          <h2 id="current-track-title">{track.title}</h2>
          <p>{track.artist}</p>
          {track.album && <small>{track.album}</small>}
          <div className="playback-state">{PLAYBACK_STATE_NAMES[track.state]}</div>
        </div>
      </div>
    </section>
  );
}
