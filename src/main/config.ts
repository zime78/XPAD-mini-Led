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

/** Upgrade old default state colors to the new saturated ones; user-picked colors stay. */
function migrate(config: AppConfig): AppConfig {
  for (const [state, legacy] of Object.entries(LEGACY_STATE_COLORS)) {
    const style = config.states[state as keyof AppConfig['states']];
    if (style?.color?.toLowerCase() === legacy) {
      style.color = DEFAULT_CONFIG.states[state as keyof AppConfig['states']].color;
    }
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
