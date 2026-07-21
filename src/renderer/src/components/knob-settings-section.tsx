import type { AppConfig } from '../../../shared/types';
import type { ConfigPatch } from './settings-types';

type KnobSettingsSectionProps = {
  config: AppConfig;
  onPatch: ConfigPatch;
};

export function KnobSettingsSection({ config, onPatch }: KnobSettingsSectionProps) {
  return (
    <section className="settings-section">
      <h2>XPAD 노브 설정</h2>
      <label className="toggle">
        <input
          type="checkbox"
          checked={config.fineVolumeEnabled}
          onChange={(event) =>
            onPatch((draft) => {
              draft.fineVolumeEnabled = event.target.checked;
            })
          }
        />
        미세 볼륨 조절 사용
      </label>
      <label>
        한 칸당 실제 단계
        <select
          value={config.fineVolumeStepsPerDetent}
          disabled={!config.fineVolumeEnabled}
          onChange={(event) =>
            onPatch((draft) => {
              draft.fineVolumeStepsPerDetent = Number(event.target.value);
            })
          }
        >
          <option value={1}>1</option>
          <option value={2}>2</option>
          <option value={3}>3</option>
          <option value={5}>5</option>
        </select>
      </label>
      <div className="knob-map" aria-label="XPAD 노브 매핑">
        <span><small>왼쪽</small>미세 볼륨 −</span>
        <span><small>클릭</small>Mute 유지</span>
        <span><small>오른쪽</small>미세 볼륨 +</span>
      </div>
      <p className="knob-note">
        XPAD Profile 1의 노브 회전만 앱 실행 중 RAM에서 변경합니다. Mac 키보드 볼륨 키와
        XPAD의 다른 키는 변경하지 않습니다.
      </p>
    </section>
  );
}
