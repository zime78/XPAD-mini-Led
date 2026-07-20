export type ClaudeState = 'idle' | 'working' | 'attention' | 'done';

export type LedEffect = 'scan' | 'pulse' | 'flash' | 'steady' | 'off';

export interface StateStyle {
  color: string; // hex, e.g. "#2563eb"
  effect: LedEffect;
}

export type KeyId = 'left' | 'center' | 'right';

export type KeyActionType = 'approve' | 'reject' | 'hotkey' | 'command' | 'none';

export interface KeyActionConfig {
  type: KeyActionType;
  /** For approve/reject/hotkey: key sequence to synthesize, e.g. "Enter", "Escape", "Ctrl+Alt+Space" */
  keys?: string;
  /** For command: shell command to run */
  command?: string;
}

export interface AppConfig {
  /** Port for the Claude Code hook server */
  port: number;
  /** Which physical accelerator each pad key emits (after device remap) */
  hotkeys: Record<KeyId, string>;
  /** What each pad key does */
  keys: Record<KeyId, KeyActionConfig>;
  /** LED style per Claude state */
  states: Record<ClaudeState, StateStyle>;
  /** Seconds the "done" state lingers before decaying to idle */
  doneDecaySeconds: number;
  /** Global LED brightness, 0.1-1, applied before gamma */
  ledBrightness: number;
  /** Only synthesize keystrokes when the focused process matches one of these (lowercase substrings) */
  processAllowlist: string[];
  guardEnabled: boolean;
  launchAtLogin: boolean;
}

/** Which physical key currently carries which semantic action. */
export interface KeyRoles {
  approve?: KeyId;
  reject?: KeyId;
  dictation?: KeyId;
}

export function deriveKeyRoles(keys: AppConfig['keys']): KeyRoles {
  const roles: KeyRoles = {};
  for (const keyId of ['left', 'center', 'right'] as KeyId[]) {
    const type = keys[keyId].type;
    if (type === 'approve' && roles.approve === undefined) roles.approve = keyId;
    else if (type === 'reject' && roles.reject === undefined) roles.reject = keyId;
    else if (type === 'hotkey' && roles.dictation === undefined) roles.dictation = keyId;
  }
  return roles;
}

export interface SessionSnapshot {
  id: string;
  state: ClaudeState;
  lastEvent: string;
  updatedAt: number;
}

export interface StatusSnapshot {
  aggregateState: ClaudeState;
  sessions: SessionSnapshot[];
  deviceConnected: boolean;
  protocolReady: boolean;
  hookServerPort: number | null;
  hooksInstalled: boolean;
}

export const DEFAULT_CONFIG: AppConfig = {
  port: 3939,
  hotkeys: { left: 'F13', center: 'F14', right: 'F15' },
  keys: {
    left: { type: 'approve', keys: 'y' },
    center: { type: 'hotkey', keys: 'F13' },
    right: { type: 'reject', keys: 'n' },
  },
  // Fully saturated colors: LEDs wash muted sRGB palette colors out (a red
  // with G/B components reads as pink on the strip).
  states: {
    idle: { color: '#000000', effect: 'off' },
    working: { color: '#0044ff', effect: 'scan' },
    attention: { color: '#ff0000', effect: 'flash' },
    done: { color: '#00ff00', effect: 'pulse' },
  },
  doneDecaySeconds: 45,
  ledBrightness: 1,
  processAllowlist: [
    // windows
    'windowsterminal',
    'wt.exe',
    'cmd.exe',
    'powershell',
    'pwsh',
    'conhost',
    'code.exe',
    'cursor.exe',
    'alacritty',
    'wezterm',
    'ghostty',
    // macos
    'iterm',
    'terminal',
    'code',
    'cursor',
    'kitty',
  ],
  guardEnabled: true,
  launchAtLogin: false,
};
