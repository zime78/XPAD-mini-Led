import { useEffect, useState } from 'react';
import type { AppConfig, StatusSnapshot } from '../../shared/types';
import { AppHeader } from './components/app-header';
import { PlayerView } from './components/player-view';
import { SettingsView } from './components/settings-view';

type AppView = 'player' | 'settings';

export function App() {
  const [status, setStatus] = useState<StatusSnapshot | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [saved, setSaved] = useState<AppConfig | null>(null);
  const [message, setMessage] = useState('');
  const [view, setView] = useState<AppView>('player');

  useEffect(() => {
    void window.xpad.getStatus().then(setStatus);
    void window.xpad.getConfig().then((value) => {
      setConfig(value);
      setSaved(value);
    });
    return window.xpad.onStatusChanged(setStatus);
  }, []);

  if (!status || !config || !saved) {
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
    <main className={`app-shell ${view === 'player' ? 'player-screen' : 'settings-screen'}`}>
      {view === 'settings' && (
        <AppHeader onCloseSettings={() => setView('player')} />
      )}
      {view === 'player' ? (
        <PlayerView status={status} onOpenSettings={() => setView('settings')} />
      ) : (
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
      )}
    </main>
  );
}
