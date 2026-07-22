import { useEffect, useState } from 'react';
import type {
  AppConfig,
  KeyboardSlot,
  PlayerViewMode,
  ProfileId,
  StatusSnapshot,
} from '../../shared/types';
import { AppHeader } from './components/app-header';
import { KeyboardSettingsView } from './components/keyboard-settings-view';
import { PlayerView } from './components/player-view';
import { SettingsView } from './components/settings-view';

type AppView = 'player' | 'settings' | 'keyboard';

function windowView(): AppView {
  const view = new URLSearchParams(window.location.search).get('view');
  return view === 'settings' || view === 'keyboard' ? view : 'player';
}

export function App() {
  const view = windowView();
  const [status, setStatus] = useState<StatusSnapshot | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [saved, setSaved] = useState<AppConfig | null>(null);
  const [message, setMessage] = useState('');
  const [playerViewMode, setPlayerViewMode] = useState<PlayerViewMode>('expanded');
  const [viewModeChanging, setViewModeChanging] = useState(false);
  const [pendingActionSlot, setPendingActionSlot] = useState<KeyboardSlot | null>(null);
  const [playerActionError, setPlayerActionError] = useState('');

  useEffect(() => {
    document.title =
      view === 'keyboard'
        ? 'XPAD Mini 키보드 설정'
        : view === 'settings'
          ? 'XPAD Mini Now Playing 설정'
          : 'XPAD Mini Now Playing';
  }, [view]);

  useEffect(() => {
    void window.xpad.getStatus().then(setStatus);
    if (view === 'player') {
      void window.xpad.getPlayerViewMode().then(setPlayerViewMode);
    }
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
    const selectProfile = async (profileId: ProfileId) => {
      setStatus(await window.xpad.switchKeyboardProfile(profileId));
    };
    const togglePlayerViewMode = async () => {
      if (viewModeChanging) return;
      setViewModeChanging(true);
      setPlayerActionError('');
      try {
        const next = playerViewMode === 'expanded' ? 'mini' : 'expanded';
        setPlayerViewMode(await window.xpad.setPlayerViewMode(next));
      } catch (error) {
        setPlayerActionError(errorMessage(error));
      } finally {
        setViewModeChanging(false);
      }
    };
    const runPlayerAction = async (slot: KeyboardSlot) => {
      if (pendingActionSlot) return;
      setPendingActionSlot(slot);
      setPlayerActionError('');
      try {
        const result = await window.xpad.runPlayerAction(slot);
        if (!result.ok) setPlayerActionError(result.error ?? '버튼 동작을 실행하지 못했습니다.');
      } catch (error) {
        setPlayerActionError(errorMessage(error));
      } finally {
        setPendingActionSlot(null);
      }
    };
    return (
      <main className="app-shell player-screen">
        <PlayerView
          status={status}
          onOpenKeyboardSettings={() => void window.xpad.openKeyboardSettingsWindow()}
          onOpenSettings={() => void window.xpad.openSettingsWindow()}
          onSelectProfile={(profileId) => void selectProfile(profileId)}
          viewMode={playerViewMode}
          viewModeChanging={viewModeChanging}
          pendingActionSlot={pendingActionSlot}
          actionError={playerActionError}
          onToggleViewMode={() => void togglePlayerViewMode()}
          onRunAction={(slot) => void runPlayerAction(slot)}
        />
      </main>
    );
  }

  if (view === 'keyboard') {
    return (
      <KeyboardSettingsView
        status={status}
        onClose={() => void window.xpad.closeKeyboardSettingsWindow()}
      />
    );
  }

  if (!config || !saved) {
    return <main className="loading-screen">불러오는 중…</main>;
  }

  const dirty = JSON.stringify(config) !== JSON.stringify(saved);
  const settingsDisabled = !status.deviceConnected || !status.protocolReady;

  const patch = (change: (draft: AppConfig) => void) => {
    if (settingsDisabled) return;
    const draft = structuredClone(config);
    change(draft);
    setConfig(draft);
  };

  const save = async () => {
    if (settingsDisabled) return;
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
      <AppHeader
        title="설정"
        subtitle="장치 상태와 음악 표시 방식을 관리합니다."
        closeLabel="설정 창 닫기"
        onClose={() => void window.xpad.closeSettingsWindow()}
      />
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
