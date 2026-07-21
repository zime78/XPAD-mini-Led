import { contextBridge, ipcRenderer } from 'electron';
import type { AppConfig, StatusSnapshot } from '../shared/types';

const api = {
  getStatus: (): Promise<StatusSnapshot> => ipcRenderer.invoke('get-status'),
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke('get-config'),
  setConfig: (config: AppConfig): Promise<AppConfig> =>
    ipcRenderer.invoke('set-config', config),
  refreshNowPlaying: (): Promise<StatusSnapshot> =>
    ipcRenderer.invoke('refresh-now-playing'),
  onStatusChanged: (callback: (status: StatusSnapshot) => void): (() => void) => {
    const listener = (_event: unknown, status: StatusSnapshot) => callback(status);
    ipcRenderer.on('status-changed', listener);
    return () => ipcRenderer.removeListener('status-changed', listener);
  },
};

export type XpadApi = typeof api;

contextBridge.exposeInMainWorld('xpad', api);
