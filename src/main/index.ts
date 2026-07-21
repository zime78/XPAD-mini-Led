import { app, BrowserWindow, ipcMain, Menu, nativeImage, Tray } from 'electron';
import path from 'node:path';
import {
  AppConfig,
  EMPTY_TRACK,
  KnobKeymapBackup,
  StatusSnapshot,
  TrackInfo,
} from '../shared/types';
import { loadConfig, saveConfig } from './config';
import { DeviceHost } from './device/device-host';
import { renderTrackFrame } from './display/frame-renderer';
import { FineVolumeController } from './input/fine-volume';
import { NowPlayingMonitor } from './music/now-playing';

let tray: Tray | null = null;
let settingsWindow: BrowserWindow | null = null;
let config: AppConfig;
let deviceHost: DeviceHost;
let fineVolumeController: FineVolumeController;
let monitor: NowPlayingMonitor;
let currentTrack: TrackInfo = structuredClone(EMPTY_TRACK);
let previewDataUrl: string | null = null;
let renderSequence = 0;
let pendingRender: { sequence: number; track: TrackInfo; config: AppConfig } | null = null;
let rendering = false;
const hidDisabled = process.env.XPAD_DISABLE_HID === '1';

function resourcePath(...parts: string[]): string {
  const root = app.isPackaged ? process.resourcesPath : path.join(__dirname, '../..');
  return path.join(root, 'assets', ...parts);
}

function trayIcon(): Electron.NativeImage {
  const name =
    currentTrack.state === 'playing'
      ? 'working.png'
      : currentTrack.state === 'paused'
        ? 'attention.png'
        : 'idle.png';
  return nativeImage.createFromPath(resourcePath('tray', name));
}

function currentStatus(): StatusSnapshot {
  const fineVolumeError = fineVolumeController?.lastError ?? null;
  return {
    deviceConnected: deviceHost?.connected ?? false,
    protocolReady: deviceHost?.protocolReady ?? false,
    track: currentTrack,
    monitorError: monitor?.lastError ?? null,
    previewDataUrl,
    knobFineVolumeState: fineVolumeError
      ? 'error'
      : (deviceHost?.knobFineVolumeState ?? 'disabled'),
    knobFineVolumeError: fineVolumeError ?? deviceHost?.knobFineVolumeError ?? null,
  };
}

function broadcastStatus(): void {
  const status = currentStatus();
  updateTray(status);
  settingsWindow?.webContents.send('status-changed', status);
}

function updateTray(status: StatusSnapshot): void {
  if (!tray) return;
  tray.setImage(trayIcon());
  const playback =
    status.track.state === 'playing'
      ? `${status.track.title} — ${status.track.artist}`
      : status.track.state === 'paused'
        ? `일시 정지: ${status.track.title}`
        : '재생 중인 음악 없음';
  tray.setToolTip(`XPAD Mini Now Playing — ${playback}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: playback, enabled: false },
      {
        label: status.protocolReady ? 'XPAD Mini 연결됨' : 'XPAD Mini 연결 대기 중',
        enabled: false,
      },
      { type: 'separator' },
      { label: '지금 새로고침', click: () => void monitor.refresh() },
      { label: '설정…', click: () => openSettingsWindow() },
      { type: 'separator' },
      { label: '종료', click: () => app.quit() },
    ])
  );
}

function openSettingsWindow(): void {
  if (settingsWindow) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 760,
    height: 690,
    minWidth: 680,
    minHeight: 620,
    title: 'XPAD Mini Now Playing',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWindow.on('closed', () => (settingsWindow = null));
  if (process.env.ELECTRON_RENDERER_URL) {
    void settingsWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void settingsWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

function renderAndSend(track: TrackInfo): void {
  const sequence = ++renderSequence;
  pendingRender = {
    sequence,
    track: structuredClone(track),
    config: structuredClone(config),
  };
  if (!rendering) void drainRenderQueue();
}

async function drainRenderQueue(): Promise<void> {
  rendering = true;
  try {
    while (pendingRender) {
      const job = pendingRender;
      pendingRender = null;
      try {
        const rendered = await renderTrackFrame(job.track, job.config);
        if (job.sequence !== renderSequence) continue;
        previewDataUrl = rendered.previewDataUrl;
        if (!hidDisabled) deviceHost.setFrame(rendered.rgb565);
      } catch (error) {
        if (job.sequence !== renderSequence) continue;
        console.error('[display] render failed', error);
        previewDataUrl = null;
      }
      broadcastStatus();
    }
  } finally {
    rendering = false;
    if (pendingRender) void drainRenderQueue();
  }
}

function configureLoginItem(): void {
  if (app.isPackaged && !hidDisabled) {
    app.setLoginItemSettings({ openAtLogin: config.launchAtLogin });
  }
}

function applyConfig(next: AppConfig): AppConfig {
  const knobKeymapBackup = next.knobKeymapBackup ?? config.knobKeymapBackup;
  config = saveConfig({ ...next, knobKeymapBackup });
  monitor.configure(config.servicePreference, config.pollIntervalMs);
  const shortcutsReady =
    !hidDisabled &&
    fineVolumeController.configure(config.fineVolumeEnabled, config.fineVolumeStepPercent);
  if (!hidDisabled) {
    deviceHost.configureKnob(
      config.fineVolumeEnabled && shortcutsReady,
      config.knobKeymapBackup
    );
  }
  configureLoginItem();
  renderAndSend(currentTrack);
  broadcastStatus();
  return config;
}

function storeKnobKeymapBackup(backup: KnobKeymapBackup): void {
  if (JSON.stringify(config.knobKeymapBackup) === JSON.stringify(backup)) return;
  config = saveConfig({ ...config, knobKeymapBackup: backup });
}

function registerIpc(): void {
  ipcMain.handle('get-status', () => currentStatus());
  ipcMain.handle('get-config', () => config);
  ipcMain.handle('set-config', (_event, next: AppConfig) => applyConfig(next));
  ipcMain.handle('refresh-now-playing', async () => {
    await monitor.refresh();
    return currentStatus();
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => openSettingsWindow());

  app.whenReady().then(() => {
    app.setName('XPAD Mini Now Playing');
    config = loadConfig();
    deviceHost = new DeviceHost();
    fineVolumeController = new FineVolumeController();
    monitor = new NowPlayingMonitor(
      config.servicePreference,
      config.pollIntervalMs,
      app.getPath('temp')
    );

    deviceHost.on('status', broadcastStatus);
    deviceHost.on('knob-backup', storeKnobKeymapBackup);
    fineVolumeController.on('status', broadcastStatus);
    monitor.on('change', (track: TrackInfo) => {
      currentTrack = track;
      renderAndSend(track);
    });
    monitor.on('status', broadcastStatus);

    registerIpc();
    const shortcutsReady =
      !hidDisabled &&
      fineVolumeController.configure(
        config.fineVolumeEnabled,
        config.fineVolumeStepPercent
      );
    if (!hidDisabled) {
      deviceHost.start(
        config.fineVolumeEnabled && shortcutsReady,
        config.knobKeymapBackup
      );
    }
    tray = new Tray(trayIcon());
    tray.on('double-click', () => openSettingsWindow());
    configureLoginItem();
    renderAndSend(currentTrack);
    monitor.start();
    openSettingsWindow();
  });

  app.on('activate', () => openSettingsWindow());
  app.on('window-all-closed', () => {});

  let shuttingDown = false;
  app.on('will-quit', (event) => {
    if (shuttingDown) return;
    shuttingDown = true;
    event.preventDefault();
    monitor?.stop();
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      fineVolumeController?.dispose();
      app.exit(0);
    };
    setTimeout(finish, 4000);
    void deviceHost?.shutdown().then(finish, finish);
  });
}
