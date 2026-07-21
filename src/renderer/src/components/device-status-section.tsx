import type { StatusSnapshot } from '../../../shared/types';

export function DeviceStatusSection({ status }: { status: StatusSnapshot }) {
  const knobStatus =
    status.knobFineVolumeState === 'active'
      ? '미세 볼륨 적용됨'
      : status.knobFineVolumeState === 'pending'
        ? '장치 적용 대기 중'
        : status.knobFineVolumeState === 'error'
          ? '설정 오류'
          : '사용 안 함';

  return (
    <section className="status-section" aria-labelledby="device-status-title">
      <h2 id="device-status-title">장치 상태</h2>
      <div className="status-grid">
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
      </div>
    </section>
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
