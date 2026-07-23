import type { AppConfig, StatusSnapshot } from '../../../shared/types';
import { DeviceStatusSection } from './device-status-section';
import { DisplaySettingsSection } from './display-settings-section';
import { KnobSettingsSection } from './knob-settings-section';
import type { ConfigPatch } from './settings-types';

type SettingsViewProps = {
  status: StatusSnapshot;
  config: AppConfig;
  dirty: boolean;
  message: string;
  onPatch: ConfigPatch;
  onRefresh: () => Promise<void>;
  onReconnect: () => void;
  onReset: () => void;
  onSave: () => Promise<void>;
};

export function SettingsView({
  status,
  config,
  dirty,
  message,
  onPatch,
  onRefresh,
  onReconnect,
  onReset,
  onSave,
}: SettingsViewProps) {
  const settingsDisabled = !status.deviceConnected || !status.protocolReady;

  return (
    <div className="settings-view">
      <div className="settings-actions">
        <button onClick={() => void onRefresh()}>현재 곡 새로고침</button>
      </div>

      <DeviceStatusSection status={status} onReconnect={onReconnect} />

      {status.monitorError && (
        <p className="error" role="alert">음악 정보 확인 오류: {status.monitorError}</p>
      )}
      {status.knobFineVolumeError && (
        <p className="error" role="alert">
          XPAD 노브 설정 오류: {status.knobFineVolumeError}
        </p>
      )}

      {settingsDisabled && (
        <p className="connection-required" role="alert">
          XPAD Mini 연결과 LCD 프로토콜 준비 후 설정을 변경할 수 있습니다.
        </p>
      )}

      <DisplaySettingsSection
        config={config}
        disabled={settingsDisabled}
        onPatch={onPatch}
      />
      <KnobSettingsSection
        config={config}
        disabled={settingsDisabled}
        onPatch={onPatch}
      />

      <p className="safety">
        LCD 프레임과 노브 좌우 임시 매핑은 장치 RAM으로만 전송합니다.
        Save·펌웨어·LED·플래시 저장 영역은 변경하지 않습니다.
      </p>

      <div className="save-bar">
        <button
          className="primary"
          disabled={settingsDisabled || !dirty}
          onClick={() => void onSave()}
        >
          설정 저장
        </button>
        <button disabled={settingsDisabled || !dirty} onClick={onReset}>
          되돌리기
        </button>
        {message && <span role="status">{message}</span>}
      </div>
    </div>
  );
}
