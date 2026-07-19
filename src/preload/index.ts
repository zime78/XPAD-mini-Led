import { contextBridge, ipcRenderer } from 'electron';
import type { AppConfig, ClaudeState, StatusSnapshot } from '../shared/types';

const api = {
  getStatus: (): Promise<StatusSnapshot> => ipcRenderer.invoke('get-status'),
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke('get-config'),
  setConfig: (config: AppConfig): Promise<AppConfig> =>
    ipcRenderer.invoke('set-config', config),
  simulateState: (state: ClaudeState): Promise<void> =>
    ipcRenderer.invoke('simulate-state', state),
  installHooks: (): Promise<{ backupPath: string | null }> =>
    ipcRenderer.invoke('install-hooks'),
  uninstallHooks: (): Promise<void> => ipcRenderer.invoke('uninstall-hooks'),
  onStatusChanged: (cb: (status: StatusSnapshot) => void): (() => void) => {
    const listener = (_e: unknown, status: StatusSnapshot) => cb(status);
    ipcRenderer.on('status-changed', listener);
    return () => ipcRenderer.removeListener('status-changed', listener);
  },
};

export type XpadApi = typeof api;

contextBridge.exposeInMainWorld('xpad', api);
