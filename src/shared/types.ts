export type MusicService = 'spotify' | 'apple-music' | 'none';

export type ServicePreference = 'automatic' | Exclude<MusicService, 'none'>;

export type PlaybackState = 'playing' | 'paused' | 'stopped';

export type KnobFineVolumeState = 'disabled' | 'pending' | 'active' | 'error';

export type PlayerViewMode = 'expanded' | 'mini';

export const PROFILE_IDS = [1, 2, 3, 4, 5] as const;
export type ProfileId = (typeof PROFILE_IDS)[number];
export const EDITABLE_PROFILE_IDS = [2, 3, 4, 5] as const satisfies readonly ProfileId[];

export const KEYBOARD_SLOTS = ['left', 'center', 'right'] as const;
export type KeyboardSlot = (typeof KEYBOARD_SLOTS)[number];

export const KEYBOARD_KEY_CODES = [
  'KeyA',
  'KeyB',
  'KeyC',
  'KeyD',
  'KeyE',
  'KeyF',
  'KeyG',
  'KeyH',
  'KeyI',
  'KeyJ',
  'KeyK',
  'KeyL',
  'KeyM',
  'KeyN',
  'KeyO',
  'KeyP',
  'KeyQ',
  'KeyR',
  'KeyS',
  'KeyT',
  'KeyU',
  'KeyV',
  'KeyW',
  'KeyX',
  'KeyY',
  'KeyZ',
  'Digit0',
  'Digit1',
  'Digit2',
  'Digit3',
  'Digit4',
  'Digit5',
  'Digit6',
  'Digit7',
  'Digit8',
  'Digit9',
  'Minus',
  'Equal',
  'BracketLeft',
  'BracketRight',
  'Backslash',
  'Semicolon',
  'Quote',
  'Backquote',
  'Comma',
  'Period',
  'Slash',
  'Space',
  'Enter',
  'Tab',
  'Escape',
  'Backspace',
  'Delete',
  'CapsLock',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12',
  'F13',
  'F14',
  'F15',
  'F16',
  'F17',
  'F18',
  'F21',
  'F22',
  'F23',
  'F24',
  'MediaTrackPrevious',
  'MediaPlayPause',
  'MediaTrackNext',
] as const;
export type KeyboardKeyCode = (typeof KEYBOARD_KEY_CODES)[number];

export const MEDIA_KEY_CODES = [
  'MediaTrackPrevious',
  'MediaPlayPause',
  'MediaTrackNext',
] as const satisfies readonly KeyboardKeyCode[];
export type MediaKeyCode = (typeof MEDIA_KEY_CODES)[number];

export type KeyboardAction =
  | { type: 'key'; keyCode: KeyboardKeyCode }
  | { type: 'launch-app'; appName: string; appPath: string }
  | { type: 'unsupported'; description: string };

export interface KeyboardProfileSettings {
  id: ProfileId;
  assignments: Record<KeyboardSlot, KeyboardAction>;
}

export interface KeyboardSettings {
  enabled: boolean;
  activeProfileId: ProfileId;
  profiles: Record<ProfileId, KeyboardProfileSettings>;
}

export interface KeyboardDeviceSnapshot {
  activeProfileId: ProfileId;
  profiles: Record<ProfileId, KeyboardProfileSettings>;
}

export interface KeyboardProfileState extends KeyboardDeviceSnapshot {
  switching: boolean;
  error: string | null;
}

export interface KeyboardSettingsBackup {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  createdAt: string;
  enabled: boolean;
  activeProfileId: ProfileId;
  profiles: Record<ProfileId, KeyboardProfileSettings>;
}

export interface KeyboardBackupInput {
  name: string;
  description: string;
  settings: KeyboardSettings;
}

export interface KeyboardBackupList {
  items: KeyboardSettingsBackup[];
  maxItems: number;
  warning: string | null;
}

export interface ApplicationSelection {
  appName: string;
  appPath: string;
  iconDataUrl: string;
}

export type KeyboardShortcutState = 'disabled' | 'active' | 'error';

export interface KeyboardRuntimeStatus {
  shortcutState: KeyboardShortcutState;
  shortcutError: string | null;
  deviceApplySupported: false;
  deviceApplyReason: string;
}

export interface KeyboardSettingsSaveResult {
  settings: KeyboardSettings;
  runtimeStatus: KeyboardRuntimeStatus;
}

export interface KeyboardActionResult {
  ok: boolean;
  error: string | null;
}

export interface KnobKeymapBackup {
  left: string;
  right: string;
}

export interface TrackInfo {
  service: MusicService;
  state: PlaybackState;
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  position: number;
  artworkDataUrl?: string;
}

export interface AppConfig {
  servicePreference: ServicePreference;
  pollIntervalMs: number;
  showArtwork: boolean;
  showProgress: boolean;
  fineVolumeEnabled: boolean;
  fineVolumeStepsPerDetent: number;
  knobKeymapBackup?: KnobKeymapBackup;
  keyboardSettings: KeyboardSettings;
  launchAtLogin: boolean;
}

export interface StatusSnapshot {
  deviceConnected: boolean;
  protocolReady: boolean;
  track: TrackInfo;
  monitorError: string | null;
  previewDataUrl: string | null;
  knobFineVolumeState: KnobFineVolumeState;
  knobFineVolumeError: string | null;
  keyboardProfileState: KeyboardProfileState;
}

export const EMPTY_TRACK: TrackInfo = {
  service: 'none',
  state: 'stopped',
  id: '',
  title: '재생 중인 음악 없음',
  artist: 'Spotify 또는 Apple Music을 재생하세요',
  album: '',
  duration: 0,
  position: 0,
};

export function createFixedProfileOne(): KeyboardProfileSettings {
  return {
    id: 1,
    assignments: {
      left: { type: 'key', keyCode: 'MediaTrackPrevious' },
      center: { type: 'key', keyCode: 'MediaPlayPause' },
      right: { type: 'key', keyCode: 'MediaTrackNext' },
    },
  };
}

export function createDefaultKeyboardSettings(): KeyboardSettings {
  const createProfile = (id: ProfileId): KeyboardProfileSettings => ({
    id,
    assignments: {
      left: { type: 'key', keyCode: 'KeyQ' },
      center: { type: 'key', keyCode: 'KeyW' },
      right: { type: 'key', keyCode: 'KeyE' },
    },
  });
  return {
    enabled: false,
    activeProfileId: 1,
    profiles: {
      1: createFixedProfileOne(),
      2: createProfile(2),
      3: createProfile(3),
      4: createProfile(4),
      5: createProfile(5),
    },
  };
}

export const DEFAULT_CONFIG: AppConfig = {
  servicePreference: 'automatic',
  pollIntervalMs: 1500,
  showArtwork: true,
  showProgress: true,
  fineVolumeEnabled: true,
  fineVolumeStepsPerDetent: 1,
  keyboardSettings: createDefaultKeyboardSettings(),
  launchAtLogin: false,
};
