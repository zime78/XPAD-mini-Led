import { useState } from 'react';
import {
  KEYBOARD_SLOTS,
  YOUTUBE_PROFILE_ID,
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
import {
  youtubePlaybackChannel,
  youtubePlaybackProgress,
  youtubePlaybackQueueLabel,
  youtubePlaybackStateLabel,
  youtubePlaybackTimeLabel,
  youtubePlaybackTitle,
} from '../youtube-playback-label';
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
  onReconnect: () => void;
  onAddYoutube: (input: string) => Promise<void>;
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
  onReconnect,
  onAddYoutube,
}: PlayerViewProps) {
  const track = status.track;
  const mini = viewMode === 'mini';
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState('');
  const [addMessage, setAddMessage] = useState('');
  const youtubeTitle = youtubePlaybackTitle(status.youtubePlayback);
  const youtubeQueue = youtubePlaybackQueueLabel(status.youtubePlayback);
  const youtubeTime = youtubePlaybackTimeLabel(status.youtubePlayback);
  const youtubeProgress = youtubePlaybackProgress(status.youtubePlayback);
  const activeProfile =
    status.keyboardProfileState.profiles[status.keyboardProfileState.activeProfileId];
  const showYoutubeAdd =
    status.youtubeLcdActive ||
    status.keyboardProfileState.activeProfileId === YOUTUBE_PROFILE_ID;

  const submitYoutubeAdd = async () => {
    const input = addDraft.trim();
    if (!input || addBusy) return;
    setAddBusy(true);
    setAddError('');
    setAddMessage('');
    try {
      await onAddYoutube(input);
      setAddDraft('');
      setAdding(false);
      setAddMessage('목록에 추가했습니다.');
      setTimeout(() => setAddMessage(''), 2000);
    } catch (error) {
      setAddError(error instanceof Error ? error.message : String(error));
    } finally {
      setAddBusy(false);
    }
  };

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
            {!status.deviceConnected && (
              <button
                type="button"
                className="reconnect-button"
                onClick={onReconnect}
                title="XPAD Mini 다시 연결"
                aria-label="XPAD Mini 다시 연결"
              >
                다시 연결
              </button>
            )}
            <span className="player-toolbar-separator" aria-hidden="true" />
            <QuickProfileSwitch
              status={status}
              pendingActionSlot={pendingActionSlot}
              onSelect={onSelectProfile}
              onRunAction={onRunAction}
            />
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
      {actionError && (
        <p className={mini ? 'mini-player-action-error' : 'quick-profile-error'} role="alert">
          {actionError}
        </p>
      )}
      <div className={`player-content ${mini ? 'mini-player-content' : ''}`}>
        <div className={`lcd-shell ${status.youtubeLcdActive ? 'youtube' : ''}`}>
          {status.previewDataUrl ? (
            <img
              src={status.previewDataUrl}
              alt={status.youtubeLcdActive ? 'YouTube LCD 미리보기' : 'XPAD LCD 미리보기'}
            />
          ) : (
            <div className="preview-empty">
              {status.youtubeLcdActive ? 'YouTube 준비 중' : 'LCD 미리보기 준비 중'}
            </div>
          )}
        </div>
        {!mini && (
          <div className="track-info">
            {status.youtubeLcdActive ? (
              <>
                <div className="youtube-badge-row">
                  <span className="badge youtube">YouTube</span>
                  {showYoutubeAdd && (
                    <button
                      type="button"
                      className="youtube-add-toggle"
                      aria-expanded={adding}
                      onClick={() => {
                        setAdding((open) => !open);
                        setAddError('');
                      }}
                    >
                      {adding ? '닫기' : '목록 추가'}
                    </button>
                  )}
                </div>
                {adding && (
                  <form
                    className="youtube-add-inline"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submitYoutubeAdd();
                    }}
                  >
                    <input
                      value={addDraft}
                      disabled={addBusy}
                      autoFocus
                      placeholder="YouTube URL 또는 ID"
                      aria-label="YouTube URL 또는 ID"
                      onChange={(event) => setAddDraft(event.target.value)}
                    />
                    <button type="submit" disabled={addBusy || !addDraft.trim()}>
                      추가
                    </button>
                  </form>
                )}
                {addError && (
                  <p className="youtube-add-error" role="alert">
                    {addError}
                  </p>
                )}
                {addMessage && (
                  <p className="youtube-add-message" role="status">
                    {addMessage}
                  </p>
                )}
                <h2 id="current-track-title">{youtubeTitle}</h2>
                <p>{youtubePlaybackChannel(status.youtubePlayback)}</p>
                {youtubeQueue && <small>{youtubeQueue}</small>}
                {youtubeTime && (
                  <div className="youtube-progress">
                    {youtubeProgress !== null && (
                      <div
                        className="youtube-progress-bar"
                        role="progressbar"
                        aria-label="재생 위치"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(youtubeProgress)}
                      >
                        <span style={{ width: `${youtubeProgress}%` }} />
                      </div>
                    )}
                    <small>{youtubeTime}</small>
                  </div>
                )}
                <div className="playback-state">
                  {youtubePlaybackStateLabel(status.youtubePlayback)}
                </div>
                <VolumeFeedback percent={status.volumePercent} />
              </>
            ) : (
              <>
                <span className={`badge ${track.service}`}>{SERVICE_NAMES[track.service]}</span>
                <h2 id="current-track-title">{track.title}</h2>
                <p>{track.artist}</p>
                {track.album && <small>{track.album}</small>}
                <div className="playback-state">{PLAYBACK_STATE_NAMES[track.state]}</div>
                <VolumeFeedback percent={status.volumePercent} />
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function VolumeFeedback({ percent }: { percent: number | null }) {
  if (percent === null) return null;
  return (
    <div className="volume-feedback" role="status" aria-label={`볼륨 ${percent}%`}>
      <span>볼륨 {percent}%</span>
      <div className="volume-feedback-bar" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function slotLabel(slot: KeyboardSlot): string {
  if (slot === 'left') return '왼쪽';
  if (slot === 'center') return '가운데';
  return '오른쪽';
}
