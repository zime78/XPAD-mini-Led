import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {
  AppConfig,
  DEFAULT_CONFIG,
  EDITABLE_PROFILE_IDS,
  KeyboardKeymapBackup,
  KEYBOARD_SLOTS,
  KnobKeymapBackup,
} from '../shared/types';
import { normalizeKeyboardSettings } from './keyboard-settings';

const KEY_INFO_BASE64_LENGTH = 76;

let cached: AppConfig | null = null;

function configPath(): string {
  return path.join(app.getPath('userData'), 'config.json');
}

export function loadConfig(): AppConfig {
  if (cached) return cached;
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), 'utf8')) as Partial<AppConfig>;
    // 이전 퍼센트/증감값은 의미가 달라 실제 단계 설정으로 승계하지 않는다.
    cached = normalize({ ...DEFAULT_CONFIG, ...raw });
  } catch {
    cached = structuredClone(DEFAULT_CONFIG);
  }
  return cached;
}

export function saveConfig(next: AppConfig): AppConfig {
  cached = normalize(next);
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cached, null, 2));
  return cached;
}

function normalize(config: AppConfig): AppConfig {
  const preference = ['automatic', 'spotify', 'apple-music'].includes(
    config.servicePreference
  )
    ? config.servicePreference
    : DEFAULT_CONFIG.servicePreference;
  const knobKeymapBackup = normalizeKnobKeymapBackup(config.knobKeymapBackup);
  const keyboardKeymapBackup = normalizeKeyboardKeymapBackup(config.keyboardKeymapBackup);
  return {
    servicePreference: preference,
    pollIntervalMs: Math.min(10_000, Math.max(750, Number(config.pollIntervalMs) || 1500)),
    showArtwork: Boolean(config.showArtwork),
    showProgress: Boolean(config.showProgress),
    fineVolumeEnabled: Boolean(config.fineVolumeEnabled),
    fineVolumeStepsPerDetent: Math.min(
      5,
      Math.max(1, Math.round(Number(config.fineVolumeStepsPerDetent) || 1))
    ),
    ...(knobKeymapBackup ? { knobKeymapBackup } : {}),
    ...(keyboardKeymapBackup ? { keyboardKeymapBackup } : {}),
    keyboardSettings: normalizeKeyboardSettings(config.keyboardSettings),
    launchAtLogin: Boolean(config.launchAtLogin),
  };
}

function normalizeKeyboardKeymapBackup(
  backup: KeyboardKeymapBackup | undefined
): KeyboardKeymapBackup | undefined {
  if (!backup || typeof backup !== 'object' || !backup.profiles) return undefined;
  const profiles = {} as KeyboardKeymapBackup['profiles'];
  for (const profileId of EDITABLE_PROFILE_IDS) {
    const source = backup.profiles[profileId];
    if (!source) return undefined;
    const entries = {} as Record<(typeof KEYBOARD_SLOTS)[number], string>;
    for (const slot of KEYBOARD_SLOTS) {
      if (!isKeyInfoBase64(source[slot])) return undefined;
      entries[slot] = source[slot];
    }
    profiles[profileId] = entries;
  }
  return { profiles };
}

function normalizeKnobKeymapBackup(
  backup: KnobKeymapBackup | undefined
): KnobKeymapBackup | undefined {
  if (!backup) return undefined;
  if (!isKeyInfoBase64(backup.left) || !isKeyInfoBase64(backup.right)) return undefined;
  return { left: backup.left, right: backup.right };
}

function isKeyInfoBase64(value: unknown): value is string {
  if (typeof value !== 'string' || value.length !== KEY_INFO_BASE64_LENGTH) return false;
  try {
    return Buffer.from(value, 'base64').length === 56;
  } catch {
    return false;
  }
}
