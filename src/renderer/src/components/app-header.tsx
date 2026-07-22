type AppHeaderProps = {
  onCloseSettings: () => void;
};

export function AppHeader({ onCloseSettings }: AppHeaderProps) {
  return (
    <header className="app-header">
      <div>
        <h1>설정</h1>
        <p className="subtitle">장치 상태와 음악 표시 방식을 관리합니다.</p>
      </div>
      <IconButton label="설정 창 닫기" onClick={onCloseSettings}>
        <CloseIcon />
      </IconButton>
    </header>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className="icon-button"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function SettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <IconButton label="설정 열기" onClick={onClick}>
      <SettingsIcon />
    </IconButton>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 8.75A3.25 3.25 0 1 0 12 15.25 3.25 3.25 0 0 0 12 8.75Z" />
      <path d="M19.3 13.5a7.8 7.8 0 0 0 0-3l1.8-1.4-2-3.4-2.2.9a7.4 7.4 0 0 0-2.6-1.5L14 2.75h-4l-.3 2.35a7.4 7.4 0 0 0-2.6 1.5l-2.2-.9-2 3.4 1.8 1.4a7.8 7.8 0 0 0 0 3l-1.8 1.4 2 3.4 2.2-.9a7.4 7.4 0 0 0 2.6 1.5l.3 2.35h4l.3-2.35a7.4 7.4 0 0 0 2.6-1.5l2.2.9 2-3.4-1.8-1.4Z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}
