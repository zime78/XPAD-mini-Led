import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { AppConfig, DEFAULT_CONFIG } from '../shared/types';

let cached: AppConfig | null = null;

function configPath(): string {
  return path.join(app.getPath('userData'), 'config.json');
}

/** Pre-gamma-fix default colors; stored configs still using them get upgraded. */
const LEGACY_STATE_COLORS: Record<string, string> = {
  working: '#2563eb',
  attention: '#dc2626',
  done: '#16a34a',
};

/** Pre-0.1.2 default key actions; stored configs still on them get the new defaults. */
const LEGACY_KEY_DEFAULTS: Record<string, { type: string; keys: string }> = {
  left: { type: 'approve', keys: 'Enter' },
  center: { type: 'hotkey', keys: 'Ctrl+Alt+Space' },
  right: { type: 'reject', keys: 'Escape' },
};

export function loadConfig(): AppConfig {
  if (cached) return cached;
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    cached = migrate(mergeConfig(DEFAULT_CONFIG, raw));
  } catch {
    cached = structuredClone(DEFAULT_CONFIG);
  }
  return cached;
}

/** Upgrade old defaults to the new ones; user-picked values stay. */
function migrate(config: AppConfig): AppConfig {
  for (const [state, legacy] of Object.entries(LEGACY_STATE_COLORS)) {
    const style = config.states[state as keyof AppConfig['states']];
    if (style?.color?.toLowerCase() === legacy) {
      style.color = DEFAULT_CONFIG.states[state as keyof AppConfig['states']].color;
    }
  }
  for (const [keyId, legacy] of Object.entries(LEGACY_KEY_DEFAULTS)) {
    const action = config.keys[keyId as keyof AppConfig['keys']];
    if (action?.type === legacy.type && action.keys === legacy.keys) {
      action.keys = DEFAULT_CONFIG.keys[keyId as keyof AppConfig['keys']].keys;
    }
  }
  // Pre-0.1.3 trigger layout (left=F13, center=F14): center now emits F13 so
  // it can serve as a real push-to-talk key.
  const h = config.hotkeys;
  if (h.left === 'F13' && h.center === 'F14' && h.right === 'F15') {
    config.hotkeys = { ...DEFAULT_CONFIG.hotkeys };
  }
  // Pre-0.1.4 push-to-talk default (single F13): dictation apps often refuse
  // single keys; the default is now a modifier combo (platform-dependent).
  const center = config.keys.center;
  if (center.type === 'hotkey' && center.keys === 'F13') {
    config.keys.center = { ...DEFAULT_CONFIG.keys.center };
  }
  return config;
}

export function saveConfig(next: AppConfig): AppConfig {
  cached = mergeConfig(DEFAULT_CONFIG, next);
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cached, null, 2));
  return cached;
}

/** Deep-merge overrides onto defaults so new config fields get defaults automatically. */
function mergeConfig<T>(defaults: T, overrides: unknown): T {
  if (
    typeof defaults !== 'object' ||
    defaults === null ||
    Array.isArray(defaults)
  ) {
    return (overrides === undefined ? defaults : overrides) as T;
  }
  const out: Record<string, unknown> = { ...(defaults as Record<string, unknown>) };
  if (typeof overrides === 'object' && overrides !== null) {
    for (const [k, v] of Object.entries(overrides)) {
      if (k in out) out[k] = mergeConfig(out[k], v);
      else out[k] = v;
    }
  }
  return out as T;
}
