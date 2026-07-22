type AppHeaderProps = {
  title: string;
  subtitle: string;
  closeLabel: string;
  onClose: () => void;
};

export function AppHeader({ title, subtitle, closeLabel, onClose }: AppHeaderProps) {
  return (
    <header className="app-header">
      <div>
        <h1>{title}</h1>
        <p className="subtitle">{subtitle}</p>
      </div>
      <IconButton label={closeLabel} onClick={onClose}>
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

export function KeyboardSettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <IconButton label="키보드 설정 열기" onClick={onClick}>
      <KeyboardIcon />
    </IconButton>
  );
}

function KeyboardIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 9h.01M11 9h.01M15 9h.01M18 9h.01M7 13h.01M11 13h.01M15 13h3M7 16h10" />
    </svg>
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
