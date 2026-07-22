import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppConfig,
  ApplicationSelection,
  KeyboardAction,
  KeyboardActionResult,
  KeyboardBackupInput,
  KeyboardBackupList,
  KeyboardRuntimeStatus,
  KeyboardSettings,
  KeyboardSettingsSaveResult,
  StatusSnapshot,
} from '../shared/types';

const api = {
  getStatus: (): Promise<StatusSnapshot> => ipcRenderer.invoke('get-status'),
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke('get-config'),
  setConfig: (config: AppConfig): Promise<AppConfig> =>
    ipcRenderer.invoke('set-config', config),
  refreshNowPlaying: (): Promise<StatusSnapshot> =>
    ipcRenderer.invoke('refresh-now-playing'),
  openSettingsWindow: (): Promise<void> => ipcRenderer.invoke('open-settings-window'),
  closeSettingsWindow: (): Promise<void> => ipcRenderer.invoke('close-settings-window'),
  openKeyboardSettingsWindow: (): Promise<void> =>
    ipcRenderer.invoke('open-keyboard-settings-window'),
  closeKeyboardSettingsWindow: (): Promise<void> =>
    ipcRenderer.invoke('close-keyboard-settings-window'),
  getKeyboardSettings: (): Promise<KeyboardSettings> =>
    ipcRenderer.invoke('get-keyboard-settings'),
  saveKeyboardSettings: (
    settings: KeyboardSettings
  ): Promise<KeyboardSettingsSaveResult> =>
    ipcRenderer.invoke('save-keyboard-settings', settings),
  getKeyboardRuntimeStatus: (): Promise<KeyboardRuntimeStatus> =>
    ipcRenderer.invoke('get-keyboard-runtime-status'),
  listKeyboardBackups: (): Promise<KeyboardBackupList> =>
    ipcRenderer.invoke('list-keyboard-backups'),
  createKeyboardBackup: (input: KeyboardBackupInput): Promise<KeyboardBackupList> =>
    ipcRenderer.invoke('create-keyboard-backup', input),
  overwriteKeyboardBackup: (
    id: string,
    input: KeyboardBackupInput
  ): Promise<KeyboardBackupList> =>
    ipcRenderer.invoke('overwrite-keyboard-backup', id, input),
  deleteKeyboardBackup: (id: string): Promise<KeyboardBackupList> =>
    ipcRenderer.invoke('delete-keyboard-backup', id),
  loadKeyboardBackup: (id: string): Promise<KeyboardSettings> =>
    ipcRenderer.invoke('load-keyboard-backup', id),
  pickApplication: (): Promise<ApplicationSelection | null> =>
    ipcRenderer.invoke('pick-application'),
  testKeyboardAction: (action: KeyboardAction): Promise<KeyboardActionResult> =>
    ipcRenderer.invoke('test-keyboard-action', action),
  checkApplicationPath: (appPath: string): Promise<KeyboardActionResult> =>
    ipcRenderer.invoke('check-application-path', appPath),
  onStatusChanged: (callback: (status: StatusSnapshot) => void): (() => void) => {
    const listener = (_event: unknown, status: StatusSnapshot) => callback(status);
    ipcRenderer.on('status-changed', listener);
    return () => ipcRenderer.removeListener('status-changed', listener);
  },
  onKeyboardStatusChanged: (
    callback: (status: KeyboardRuntimeStatus) => void
  ): (() => void) => {
    const listener = (_event: unknown, status: KeyboardRuntimeStatus) => callback(status);
    ipcRenderer.on('keyboard-status-changed', listener);
    return () => ipcRenderer.removeListener('keyboard-status-changed', listener);
  },
};

export type XpadApi = typeof api;

contextBridge.exposeInMainWorld('xpad', api);
