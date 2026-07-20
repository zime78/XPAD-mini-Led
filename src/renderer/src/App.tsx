import { useEffect, useState } from 'react';
import type {
  AppConfig,
  ClaudeState,
  LedEffect,
  StatusSnapshot,
} from '../../shared/types';

const STATE_COLORS: Record<ClaudeState, string> = {
  idle: '#6b7280',
  working: '#2563eb',
  attention: '#dc2626',
  done: '#16a34a',
};

const EFFECTS: LedEffect[] = ['scan', 'pulse', 'flash', 'steady', 'off'];

export function App() {
  const [status, setStatus] = useState<StatusSnapshot | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [saved, setSaved] = useState<AppConfig | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    void window.xpad.getStatus().then(setStatus);
    void window.xpad.getConfig().then((c) => {
      setConfig(c);
      setSaved(c);
    });
    return window.xpad.onStatusChanged(setStatus);
  }, []);

  if (!status || !config || !saved) return <main>Loading…</main>;

  const dirty = JSON.stringify(config) !== JSON.stringify(saved);

  const save = async () => {
    const next = await window.xpad.setConfig(config);
    setConfig(next);
    setSaved(next);
    setMessage('Settings saved.');
    setTimeout(() => setMessage(''), 3000);
  };

  const installHooks = async () => {
    const { backupPath } = await window.xpad.installHooks();
    setMessage(
      backupPath
        ? `Hooks installed. Previous settings backed up to ${backupPath}`
        : 'Hooks installed into ~/.claude/settings.json'
    );
  };

  const uninstallHooks = async () => {
    await window.xpad.uninstallHooks();
    setMessage('Hooks removed from ~/.claude/settings.json');
  };

  const patch = (fn: (draft: AppConfig) => void) => {
    const draft = structuredClone(config);
    fn(draft);
    setConfig(draft);
  };

  return (
    <main>
      <h1>XPAD Mini × Claude Code</h1>

      <section>
        <h2>Status</h2>
        <div className="status-row">
          <span
            className="state-dot"
            style={{ background: STATE_COLORS[status.aggregateState] }}
          />
          <strong>{status.aggregateState}</strong>
          <span className="sep" />
          <span className={status.deviceConnected ? 'ok' : 'bad'}>
            {status.deviceConnected ? 'XPAD Mini connected' : 'XPAD Mini not found'}
          </span>
          <span className="sep" />
          <span className={status.protocolReady ? 'ok' : 'warn'}>
            {status.protocolReady
              ? 'LED/LCD protocol active'
              : 'LED/LCD protocol not active'}
          </span>
        </div>
        <div className="status-row">
          <span>
            Hook server:{' '}
            {status.hookServerPort
              ? `127.0.0.1:${status.hookServerPort}`
              : 'not running'}
          </span>
          <span className="sep" />
          <span className={status.hooksInstalled ? 'ok' : 'warn'}>
            {status.hooksInstalled
              ? 'Claude Code hooks installed'
              : 'Claude Code hooks not installed'}
          </span>
          {status.hooksInstalled ? (
            <button onClick={uninstallHooks}>Uninstall hooks</button>
          ) : (
            <button onClick={installHooks}>Install hooks</button>
          )}
        </div>
        {status.sessions.length > 0 && (
          <ul className="sessions">
            {status.sessions.map((s) => (
              <li key={s.id}>
                <code>{s.id.slice(0, 8)}</code> — {s.state} ({s.lastEvent})
              </li>
            ))}
          </ul>
        )}
        <div className="button-row">
          {(['working', 'attention', 'done', 'idle'] as ClaudeState[]).map((s) => (
            <button key={s} onClick={() => void window.xpad.simulateState(s)}>
              Simulate {s}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2>LED states</h2>
        {(['working', 'attention', 'done', 'idle'] as ClaudeState[]).map((s) => (
          <div className="state-card" key={s}>
            <span className="state-name">{s}</span>
            <input
              type="color"
              value={config.states[s].color}
              onChange={(e) => patch((d) => (d.states[s].color = e.target.value))}
            />
            <select
              value={config.states[s].effect}
              onChange={(e) =>
                patch((d) => (d.states[s].effect = e.target.value as LedEffect))
              }
            >
              {EFFECTS.map((eff) => (
                <option key={eff} value={eff}>
                  {eff}
                </option>
              ))}
            </select>
          </div>
        ))}
        <label className="inline">
          LED brightness
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={config.ledBrightness}
            onChange={(e) =>
              patch((d) => (d.ledBrightness = Number(e.target.value)))
            }
          />
          {Math.round(config.ledBrightness * 100)}%
        </label>
        <label className="inline">
          “Done” decays to idle after
          <input
            className="short"
            type="number"
            min={0}
            value={config.doneDecaySeconds}
            onChange={(e) =>
              patch((d) => (d.doneDecaySeconds = Number(e.target.value) || 0))
            }
          />
          seconds
        </label>
      </section>

      <section>
        <h2>General</h2>
        <label className="inline">
          Hook server port
          <input
            className="short"
            type="number"
            value={config.port}
            onChange={(e) =>
              patch((d) => (d.port = Number(e.target.value) || 3939))
            }
          />
        </label>
        <label className="inline">
          <input
            type="checkbox"
            checked={config.launchAtLogin}
            onChange={(e) => patch((d) => (d.launchAtLogin = e.target.checked))}
          />
          Launch at login
        </label>
      </section>

      <div className="save-bar">
        <button className="primary" disabled={!dirty} onClick={save}>
          Save
        </button>
        <button disabled={!dirty} onClick={() => setConfig(saved)}>
          Revert
        </button>
        {message && <span className="message-inline">{message}</span>}
      </div>
    </main>
  );
}
