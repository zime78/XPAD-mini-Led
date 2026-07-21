import type { AppConfig } from '../../../shared/types';
import type { ConfigPatch } from './settings-types';

type DisplaySettingsSectionProps = {
  config: AppConfig;
  onPatch: ConfigPatch;
};

export function DisplaySettingsSection({ config, onPatch }: DisplaySettingsSectionProps) {
  return (
    <section className="settings-section">
      <h2>표시 설정</h2>
      <label>
        우선 음악 앱
        <select
          value={config.servicePreference}
          onChange={(event) =>
            onPatch((draft) => {
              draft.servicePreference = event.target.value as AppConfig['servicePreference'];
            })
          }
        >
          <option value="automatic">자동 선택</option>
          <option value="spotify">Spotify 우선</option>
          <option value="apple-music">Apple Music 우선</option>
        </select>
      </label>
      <label>
        확인 주기
        <select
          value={config.pollIntervalMs}
          onChange={(event) =>
            onPatch((draft) => {
              draft.pollIntervalMs = Number(event.target.value);
            })
          }
        >
          <option value={1000}>1초</option>
          <option value={1500}>1.5초</option>
          <option value={2500}>2.5초</option>
          <option value={5000}>5초</option>
        </select>
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={config.showArtwork}
          onChange={(event) =>
            onPatch((draft) => {
              draft.showArtwork = event.target.checked;
            })
          }
        />
        앨범아트 표시
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={config.showProgress}
          onChange={(event) =>
            onPatch((draft) => {
              draft.showProgress = event.target.checked;
            })
          }
        />
        재생 진행률 표시
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={config.launchAtLogin}
          onChange={(event) =>
            onPatch((draft) => {
              draft.launchAtLogin = event.target.checked;
            })
          }
        />
        로그인할 때 자동 실행
      </label>
    </section>
  );
}
