import { useEffect, useState } from 'react';
import type { AppConfig, StatusSnapshot } from '../../shared/types';
import { AppHeader } from './components/app-header';
import { PlayerView } from './components/player-view';
import { SettingsView } from './components/settings-view';

type AppView = 'player' | 'settings';

function windowView(): AppView {
  return new URLSearchParams(window.location.search).get('view') === 'settings'
    ? 'settings'
    : 'player';
}

export function App() {
  const view = windowView();
  const [status, setStatus] = useState<StatusSnapshot | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [saved, setSaved] = useState<AppConfig | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    void window.xpad.getStatus().then(setStatus);
    if (view === 'settings') {
      void window.xpad.getConfig().then((value) => {
        setConfig(value);
        setSaved(value);
      });
    }
    return window.xpad.onStatusChanged(setStatus);
  }, [view]);

  if (!status) {
    return <main className="loading-screen">불러오는 중…</main>;
  }

  if (view === 'player') {
    return (
      <main className="app-shell player-screen">
        <PlayerView
          status={status}
          onOpenSettings={() => void window.xpad.openSettingsWindow()}
        />
      </main>
    );
  }

  if (!config || !saved) {
    return <main className="loading-screen">불러오는 중…</main>;
  }

  const dirty = JSON.stringify(config) !== JSON.stringify(saved);

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

  const refresh = async () => {
    setStatus(await window.xpad.refreshNowPlaying());
  };

  return (
    <main className="app-shell settings-screen">
      <AppHeader onCloseSettings={() => void window.xpad.closeSettingsWindow()} />
      <SettingsView
        status={status}
        config={config}
        dirty={dirty}
        message={message}
        onPatch={patch}
        onRefresh={refresh}
        onReset={() => setConfig(saved)}
        onSave={save}
      />
    </main>
  );
}
