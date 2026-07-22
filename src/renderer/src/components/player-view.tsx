import {
  KEYBOARD_SLOTS,
  type KeyboardSlot,
  type PlayerViewMode,
  type ProfileId,
  type StatusSnapshot,
} from '../../../shared/types';
import { compactKeyboardActionLabel, keyboardActionLabel } from '../keyboard-action-label';
import {
  KeyboardSettingsButton,
  PlayerViewModeButton,
  SettingsButton,
} from './app-header';
import { PlayerStatus } from './player-status';
import { QuickProfileSwitch } from './quick-profile-switch';

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
  onOpenKeyboardSettings: () => void;
  onOpenSettings: () => void;
  onSelectProfile: (profileId: ProfileId) => void;
  viewMode: PlayerViewMode;
  viewModeChanging: boolean;
  pendingActionSlot: KeyboardSlot | null;
  actionError: string;
  onToggleViewMode: () => void;
  onRunAction: (slot: KeyboardSlot) => void;
};

export function PlayerView({
  status,
  onOpenKeyboardSettings,
  onOpenSettings,
  onSelectProfile,
  viewMode,
  viewModeChanging,
  pendingActionSlot,
  actionError,
  onToggleViewMode,
  onRunAction,
}: PlayerViewProps) {
  const track = status.track;
  const mini = viewMode === 'mini';
  const activeProfile =
    status.keyboardProfileState.profiles[status.keyboardProfileState.activeProfileId];

  return (
    <section
      className={`hero ${mini ? 'mini-player' : ''}`}
      aria-label={mini ? 'XPAD LCD 미니뷰' : undefined}
      aria-labelledby={mini ? undefined : 'current-track-title'}
    >
      <div className="player-toolbar">
        {mini ? (
          <div className="mini-player-actions" role="group" aria-label="현재 프로파일 버튼 동작">
            {KEYBOARD_SLOTS.map((slot) => {
              const action = activeProfile.assignments[slot];
              const label = compactKeyboardActionLabel(action);
              return (
                <button
                  key={slot}
                  type="button"
                  className="mini-player-action"
                  aria-label={`${slotLabel(slot)} 버튼 동작 실행: ${keyboardActionLabel(action)}`}
                  title={`${slotLabel(slot)} 버튼: ${keyboardActionLabel(action)}`}
                  disabled={pendingActionSlot !== null}
                  data-pending={pendingActionSlot === slot || undefined}
                  onClick={() => onRunAction(slot)}
                >
                  {label}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="player-toolbar-primary">
            <PlayerStatus status={status} />
            <span className="player-toolbar-separator" aria-hidden="true" />
            <QuickProfileSwitch status={status} onSelect={onSelectProfile} />
          </div>
        )}
        <div className="player-toolbar-actions">
          <KeyboardSettingsButton onClick={onOpenKeyboardSettings} />
          <SettingsButton onClick={onOpenSettings} />
          <PlayerViewModeButton
            mode={viewMode}
            disabled={viewModeChanging}
            onClick={onToggleViewMode}
          />
        </div>
      </div>
      {mini && actionError && <p className="mini-player-action-error" role="alert">{actionError}</p>}
      <div className={`player-content ${mini ? 'mini-player-content' : ''}`}>
        <div className="lcd-shell">
          {status.previewDataUrl ? (
            <img src={status.previewDataUrl} alt="XPAD LCD 미리보기" />
          ) : (
            <div className="preview-empty">LCD 미리보기 준비 중</div>
          )}
        </div>
        {!mini && (
          <div className="track-info">
            <span className={`badge ${track.service}`}>{SERVICE_NAMES[track.service]}</span>
            <h2 id="current-track-title">{track.title}</h2>
            <p>{track.artist}</p>
            {track.album && <small>{track.album}</small>}
            <div className="playback-state">{PLAYBACK_STATE_NAMES[track.state]}</div>
          </div>
        )}
      </div>
    </section>
  );
}

function slotLabel(slot: KeyboardSlot): string {
  if (slot === 'left') return '왼쪽';
  if (slot === 'center') return '가운데';
  return '오른쪽';
}
