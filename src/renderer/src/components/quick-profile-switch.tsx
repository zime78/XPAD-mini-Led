import {
  KEYBOARD_SLOTS,
  PROFILE_IDS,
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

type QuickProfileSwitchProps = {
  status: StatusSnapshot;
  onSelect: (profileId: ProfileId) => void;
};

export function QuickProfileSwitch({ status, onSelect }: QuickProfileSwitchProps) {
  const state = status.keyboardProfileState;
  const profile = state.profiles[state.activeProfileId];
  const disabled = !status.deviceConnected || !status.protocolReady || state.switching;

  return (
    <section className="quick-profile" aria-label="빠른 프로파일 전환">
      <div className="quick-profile-buttons" role="group" aria-label="프로파일 선택">
        {PROFILE_IDS.map((profileId) => {
          const active = profileId === state.activeProfileId;
          return (
            <button
              key={profileId}
              type="button"
              className={active ? 'active' : ''}
              aria-label={`Profile ${profileId}`}
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
        {KEYBOARD_SLOTS.map((slot) => (
          <div key={slot} className="quick-profile-assignment">
            <span>{SLOT_LABELS[slot]}</span>
            <strong>{compactKeyboardActionLabel(profile.assignments[slot])}</strong>
          </div>
        ))}
      </div>
      {state.error && <p className="quick-profile-error" role="alert">{state.error}</p>}
    </section>
  );
}
