import { useEffect, useState } from 'react';
import type {
  AppConfig,
  ClaudeState,
  KeyActionType,
  KeyId,
  LedEffect,
  StatusSnapshot,
} from '../../shared/types';

const STATE_COLORS: Record<ClaudeState, string> = {
  idle: '#6b7280',
  working: '#2563eb',
  attention: '#dc2626',
  done: '#16a34a',
};

const KEY_LABELS: Record<KeyId, string> = {
  left: 'Left key',
  center: 'Center key',
  right: 'Right key',
};

const ACTION_LABELS: Record<KeyActionType, string> = {
  approve: 'Approve (send key to terminal)',
  reject: 'Reject (send key to terminal)',
  hotkey: 'Send hotkey (no focus guard)',
  command: 'Run command',
  none: 'Pass through (do nothing)',
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
        <h2>Keys</h2>
        {(['left', 'center', 'right'] as KeyId[]).map((keyId) => {
          const action = config.keys[keyId];
          return (
            <div className="key-card" key={keyId}>
              <div className="key-card-head">
                <strong>{KEY_LABELS[keyId]}</strong>
                <label>
                  emits
                  <input
                    className="short"
                    value={config.hotkeys[keyId]}
                    onChange={(e) =>
                      patch((d) => (d.hotkeys[keyId] = e.target.value))
                    }
                  />
                </label>
              </div>
              <div className="key-card-body">
                <select
                  value={action.type}
                  onChange={(e) =>
                    patch(
                      (d) =>
                        (d.keys[keyId].type = e.target.value as KeyActionType)
                    )
                  }
                >
                  {Object.entries(ACTION_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                {(action.type === 'approve' ||
                  action.type === 'reject' ||
                  action.type === 'hotkey') && (
                  <label>
                    keys
                    <input
                      value={action.keys ?? ''}
                      placeholder="e.g. y, n, F13, Ctrl+Alt+Space"
                      onChange={(e) =>
                        patch((d) => (d.keys[keyId].keys = e.target.value))
                      }
                    />
                  </label>
                )}
                {action.type === 'command' && (
                  <label>
                    command
                    <input
                      value={action.command ?? ''}
                      placeholder="shell command"
                      onChange={(e) =>
                        patch((d) => (d.keys[keyId].command = e.target.value))
                      }
                    />
                  </label>
                )}
              </div>
            </div>
          );
        })}
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
        <h2>Keystroke guard</h2>
        <label className="inline">
          <input
            type="checkbox"
            checked={config.guardEnabled}
            onChange={(e) => patch((d) => (d.guardEnabled = e.target.checked))}
          />
          Only send Approve/Reject when the focused app matches the allowlist
        </label>
        <textarea
          rows={6}
          value={config.processAllowlist.join('\n')}
          onChange={(e) =>
            patch(
              (d) =>
                (d.processAllowlist = e.target.value
                  .split('\n')
                  .map((l) => l.trim())
                  .filter(Boolean))
            )
          }
        />
        <p className="hint">
          One entry per line, matched as a lowercase substring of the focused
          process name (e.g. “windowsterminal”, “iterm”).
        </p>
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
