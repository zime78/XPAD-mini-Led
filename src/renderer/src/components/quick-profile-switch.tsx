import {
  KEYBOARD_SLOTS,
  PROFILE_IDS,
  YOUTUBE_PROFILE_ID,
  type KeyboardSlot,
  type ProfileId,
  type StatusSnapshot,
} from '../../../shared/types';
import { compactKeyboardActionLabel } from '../keyboard-action-label';

const SLOT_LABELS: Record<KeyboardSlot, string> = {
  left: '왼쪽',
  center: '가운데',
  right: '오른쪽',
};

const TRANSPORT_LABELS: Record<KeyboardSlot, string> = {
  left: '이전',
  center: '재생/일시정지',
  right: '다음',
};

type QuickProfileSwitchProps = {
  status: StatusSnapshot;
  pendingActionSlot: KeyboardSlot | null;
  onSelect: (profileId: ProfileId) => void;
  onRunAction: (slot: KeyboardSlot) => void;
};

export function QuickProfileSwitch({
  status,
  pendingActionSlot,
  onSelect,
  onRunAction,
}: QuickProfileSwitchProps) {
  const state = status.keyboardProfileState;
  const profile = state.profiles[state.activeProfileId];
  const disabled = !status.deviceConnected || !status.protocolReady || state.switching;
  const youtubeControls =
    status.youtubeLcdActive || state.activeProfileId === YOUTUBE_PROFILE_ID;

  return (
    <section className="quick-profile" aria-label="빠른 프로파일 전환">
      <div className="quick-profile-buttons" role="group" aria-label="프로파일 선택">
        {PROFILE_IDS.map((profileId) => {
          const youtube = profileId === YOUTUBE_PROFILE_ID;
          const active = youtube
            ? status.youtubeLcdActive || profileId === state.activeProfileId
            : profileId === state.activeProfileId && !status.youtubeLcdActive;
          return (
            <button
              key={profileId}
              type="button"
              className={[active ? 'active' : '', youtube ? 'youtube' : ''].filter(Boolean).join(' ')}
              aria-label={`Profile ${profileId}`}
              title={youtube ? 'YouTube LCD (P5 고정)' : `Profile ${profileId}`}
              aria-pressed={active}
              disabled={disabled}
              onClick={() => onSelect(profileId)}
            >
              P{profileId}
              {active && <span className="quick-profile-active-mark" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      <div
        className="quick-profile-assignments"
        aria-label={`Profile ${state.activeProfileId} 등록 키`}
      >
        {KEYBOARD_SLOTS.map((slot) =>
          youtubeControls ? (
            <button
              key={slot}
              type="button"
              className="quick-profile-assignment youtube-transport"
              aria-label={`${SLOT_LABELS[slot]} 버튼 동작 실행: ${TRANSPORT_LABELS[slot]}`}
              title={`${SLOT_LABELS[slot]} 버튼: ${TRANSPORT_LABELS[slot]}`}
              disabled={pendingActionSlot !== null}
              data-pending={pendingActionSlot === slot || undefined}
              onClick={() => onRunAction(slot)}
            >
              <span>{SLOT_LABELS[slot]}</span>
              <strong>{TRANSPORT_LABELS[slot]}</strong>
            </button>
          ) : (
            <div key={slot} className="quick-profile-assignment">
              <span>{SLOT_LABELS[slot]}</span>
              <strong>{compactKeyboardActionLabel(profile.assignments[slot])}</strong>
            </div>
          )
        )}
      </div>
      {state.error && <p className="quick-profile-error" role="alert">{state.error}</p>}
    </section>
  );
}
