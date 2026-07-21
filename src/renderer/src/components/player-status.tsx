import type { ReactNode } from 'react';
import type { StatusSnapshot } from '../../../shared/types';

export function PlayerStatus({ status }: { status: StatusSnapshot }) {
  return (
    <div className="player-device-status" role="status" aria-label="장치 연결 상태" aria-live="polite">
      <StatusIcon label="USB" connected={status.deviceConnected}>
        <UsbIcon />
      </StatusIcon>
      <StatusIcon label="LCD 프로토콜" connected={status.protocolReady}>
        <ProtocolIcon />
      </StatusIcon>
      <StatusIcon label="XPAD 노브" connected={status.knobFineVolumeState === 'active'}>
        <KnobIcon />
      </StatusIcon>
    </div>
  );
}

function StatusIcon({
  label,
  connected,
  children,
}: {
  label: string;
  connected: boolean;
  children: ReactNode;
}) {
  const state = connected ? 'connected' : 'failed';
  const accessibleLabel = `${label} ${connected ? '연결됨' : '연결 실패'}`;

  return (
    <span
      className="player-status-icon"
      role="img"
      aria-label={accessibleLabel}
      title={accessibleLabel}
      data-state={state}
    >
      {children}
      <span className="player-status-mark" aria-hidden="true">
        {connected ? '●' : '×'}
      </span>
    </span>
  );
}

function UsbIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v14M8 7l4-4 4 4M8 13H5v4M16 11h3v4M5 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM19 15v4h-4v-4h4Z" />
    </svg>
  );
}

function ProtocolIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <path d="M8 21h8M12 18v3M7 11h3l2-3 2 6 2-3h2" />
    </svg>
  );
}

function KnobIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 12V7M7.5 18.5h9" />
    </svg>
  );
}
