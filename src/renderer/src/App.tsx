import { useEffect, useState } from 'react';
import type { AppConfig, StatusSnapshot } from '../../shared/types';

const SERVICE_NAMES = {
  spotify: 'Spotify',
  'apple-music': 'Apple Music',
  none: '대기 중',
} as const;

export function App() {
  const [status, setStatus] = useState<StatusSnapshot | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [saved, setSaved] = useState<AppConfig | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    void window.xpad.getStatus().then(setStatus);
    void window.xpad.getConfig().then((value) => {
      setConfig(value);
      setSaved(value);
    });
    return window.xpad.onStatusChanged(setStatus);
  }, []);

  if (!status || !config || !saved) return <main>불러오는 중…</main>;
  const dirty = JSON.stringify(config) !== JSON.stringify(saved);
  const track = status.track;
  const knobStatus =
    status.knobFineVolumeState === 'active'
      ? '미세 볼륨 적용됨'
      : status.knobFineVolumeState === 'pending'
        ? '장치 적용 대기 중'
        : status.knobFineVolumeState === 'error'
          ? '설정 오류'
          : '사용 안 함';

  const patch = (change: (draft: AppConfig) => void) => {
    const draft = structuredClone(config);
    change(draft);
    setConfig(draft);
  };

  const save = async () => {
    const next = await window.xpad.setConfig(config);
    setConfig(next);
    setSaved(next);
    setMessage('설정을 저장했습니다.');
    setTimeout(() => setMessage(''), 2500);
  };

  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">PULSAR LAB XPAD MINI</p>
          <h1>Now Playing</h1>
          <p className="subtitle">Spotify와 Apple Music의 현재 곡을 XPAD LCD에 표시합니다.</p>
        </div>
        <button
          className="refresh"
          onClick={() => void window.xpad.refreshNowPlaying().then(setStatus)}
        >
          새로고침
        </button>
      </header>

      <section className="hero">
        <div className="lcd-shell">
          {status.previewDataUrl ? (
            <img src={status.previewDataUrl} alt="XPAD LCD 미리보기" />
          ) : (
            <div className="preview-empty">LCD 미리보기 준비 중</div>
          )}
        </div>
        <div className="track-info">
          <span className={`badge ${track.service}`}>{SERVICE_NAMES[track.service]}</span>
          <h2>{track.title}</h2>
          <p>{track.artist}</p>
          {track.album && <small>{track.album}</small>}
          <div className="playback-state">
            {track.state === 'playing'
              ? '재생 중'
              : track.state === 'paused'
                ? '일시 정지'
                : '재생 대기'}
          </div>
        </div>
      </section>

      <section className="status-grid">
        <StatusCard
          label="USB 장치"
          value={status.deviceConnected ? 'XPAD Mini 연결됨' : '장치를 찾지 못함'}
          tone={status.deviceConnected ? 'ok' : 'bad'}
        />
        <StatusCard
          label="LCD 프로토콜"
          value={status.protocolReady ? 'RAM 스트리밍 준비됨' : '연결 대기 중'}
          tone={status.protocolReady ? 'ok' : 'warn'}
        />
        <StatusCard
          label="XPAD 노브"
          value={knobStatus}
          tone={
            status.knobFineVolumeState === 'active'
              ? 'ok'
              : status.knobFineVolumeState === 'error'
                ? 'bad'
                : 'warn'
          }
        />
      </section>

      {status.monitorError && <p className="error">음악 정보 확인 오류: {status.monitorError}</p>}
      {status.knobFineVolumeError && (
        <p className="error">XPAD 노브 설정 오류: {status.knobFineVolumeError}</p>
      )}

      <section className="settings">
        <h2>표시 설정</h2>
        <label>
          우선 음악 앱
          <select
            value={config.servicePreference}
            onChange={(event) =>
              patch((draft) => {
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
              patch((draft) => {
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
              patch((draft) => {
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
              patch((draft) => {
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
              patch((draft) => {
                draft.launchAtLogin = event.target.checked;
              })
            }
          />
          로그인할 때 자동 실행
        </label>
      </section>

      <section className="settings knob-settings">
        <h2>XPAD 노브 설정</h2>
        <label className="toggle">
          <input
            type="checkbox"
            checked={config.fineVolumeEnabled}
            onChange={(event) =>
              patch((draft) => {
                draft.fineVolumeEnabled = event.target.checked;
              })
            }
          />
          미세 볼륨 조절 사용
        </label>
        <label>
          한 칸 조절 단위
          <select
            value={config.fineVolumeStepPercent}
            disabled={!config.fineVolumeEnabled}
            onChange={(event) =>
              patch((draft) => {
                draft.fineVolumeStepPercent = Number(event.target.value);
              })
            }
          >
            <option value={1}>1%</option>
            <option value={2}>2%</option>
            <option value={3}>3%</option>
            <option value={5}>5%</option>
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

      <p className="safety">
        LCD 프레임과 노브 좌우 임시 매핑은 장치 RAM으로만 전송합니다. Save·펌웨어·LED·플래시 저장 영역은 변경하지 않습니다.
      </p>

      <div className="save-bar">
        <button className="primary" disabled={!dirty} onClick={save}>
          설정 저장
        </button>
        <button disabled={!dirty} onClick={() => setConfig(saved)}>
          되돌리기
        </button>
        {message && <span>{message}</span>}
      </div>
    </main>
  );
}

function StatusCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'ok' | 'warn' | 'bad';
}) {
  return (
    <div className="status-card">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}
