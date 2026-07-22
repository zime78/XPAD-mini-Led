import path from 'node:path';
import {
  createFixedProfileOne,
  createDefaultKeyboardSettings,
  EDITABLE_PROFILE_IDS,
  KeyboardAction,
  KeyboardDeviceSnapshot,
  KEYBOARD_KEY_CODES,
  KEYBOARD_SLOTS,
  KeyboardProfileSettings,
  KeyboardSettings,
  PROFILE_IDS,
  ProfileId,
} from '../shared/types';

const APP_SHORTCUT_KEYS = {
  left: 'F16',
  center: 'F17',
  right: 'F18',
} as const;

export function mergeKeyboardDeviceSnapshot(
  localSettings: KeyboardSettings,
  snapshot: KeyboardDeviceSnapshot
): KeyboardSettings {
  const local = normalizeKeyboardSettings(localSettings);
  const profiles = structuredClone(snapshot.profiles);
  profiles[1] = createFixedProfileOne();

  for (const profileId of EDITABLE_PROFILE_IDS) {
    for (const slot of KEYBOARD_SLOTS) {
      const localAction = local.profiles[profileId].assignments[slot];
      const deviceAction = profiles[profileId].assignments[slot];
      if (
        localAction.type === 'launch-app' &&
        deviceAction.type === 'key' &&
        deviceAction.keyCode === APP_SHORTCUT_KEYS[slot]
      ) {
        profiles[profileId].assignments[slot] = localAction;
      }
    }
  }

  return {
    enabled: local.enabled,
    activeProfileId: snapshot.activeProfileId,
    profiles,
  };
}

export function normalizeKeyboardSettings(value: unknown): KeyboardSettings {
  const defaults = createDefaultKeyboardSettings();
  if (!isRecord(value)) return defaults;

  const activeProfileId = isProfileId(value.activeProfileId)
    ? value.activeProfileId
    : defaults.activeProfileId;
  const sourceProfiles = isRecord(value.profiles) ? value.profiles : {};
  const profiles = {} as Record<ProfileId, KeyboardProfileSettings>;

  for (const id of PROFILE_IDS) {
    if (id === 1) {
      profiles[id] = createFixedProfileOne();
      continue;
    }
    const source = isRecord(sourceProfiles[id]) ? sourceProfiles[id] : {};
    const assignments = isRecord(source.assignments) ? source.assignments : {};
    const fallback = defaults.profiles[id].assignments;
    profiles[id] = {
      id,
      assignments: {
        left: normalizeKeyboardAction(assignments.left, fallback.left),
        center: normalizeKeyboardAction(assignments.center, fallback.center),
        right: normalizeKeyboardAction(assignments.right, fallback.right),
      },
    };
  }

  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : defaults.enabled,
    activeProfileId,
    profiles,
  };
}

export function normalizeKeyboardAction(
  value: unknown,
  fallback: KeyboardAction
): KeyboardAction {
  return parseKeyboardAction(value) ?? structuredClone(fallback);
}

export function parseKeyboardAction(value: unknown): KeyboardAction | null {
  if (!isRecord(value)) return null;
  if (
    value.type === 'key' &&
    typeof value.keyCode === 'string' &&
    KEYBOARD_KEY_CODES.includes(value.keyCode as (typeof KEYBOARD_KEY_CODES)[number])
  ) {
    return {
      type: 'key',
      keyCode: value.keyCode as (typeof KEYBOARD_KEY_CODES)[number],
    };
  }
  // 1차 배포판의 미디어 전용 설정과 사용자 백업을 새 키 동작 형식으로 승계한다.
  if (
    value.type === 'media' &&
    (value.command === 'previous' ||
      value.command === 'play-pause' ||
      value.command === 'next')
  ) {
    const legacyKeyCode = {
      previous: 'MediaTrackPrevious',
      'play-pause': 'MediaPlayPause',
      next: 'MediaTrackNext',
    } as const;
    return { type: 'key', keyCode: legacyKeyCode[value.command] };
  }
  if (
    value.type === 'launch-app' &&
    typeof value.appName === 'string' &&
    value.appName.trim().length > 0 &&
    value.appName.trim().length <= 100 &&
    typeof value.appPath === 'string' &&
    isLaunchableAppPath(value.appPath)
  ) {
    return {
      type: 'launch-app',
      appName: value.appName.trim(),
      appPath: value.appPath,
    };
  }
  if (
    value.type === 'unsupported' &&
    typeof value.description === 'string' &&
    value.description.trim().length > 0 &&
    value.description.trim().length <= 200
  ) {
    return { type: 'unsupported', description: value.description.trim() };
  }
  return null;
}

export function normalizeBackupText(
  value: unknown,
  maxLength: number,
  required: boolean
): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (required && normalized.length === 0) {
    throw new Error('백업 이름을 입력하세요.');
  }
  if (normalized.length > maxLength) {
    throw new Error(`입력은 ${maxLength}자 이하여야 합니다.`);
  }
  return normalized;
}

export function isLaunchableAppPath(appPath: string): boolean {
  return path.isAbsolute(appPath) && appPath.toLowerCase().endsWith('.app');
}

function isProfileId(value: unknown): value is ProfileId {
  return typeof value === 'number' && PROFILE_IDS.includes(value as ProfileId);
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
