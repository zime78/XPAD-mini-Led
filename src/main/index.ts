import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  Tray,
} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {
  ApplicationSelection,
  AppConfig,
  EMPTY_TRACK,
  KeyboardAction,
  KeyboardActionResult,
  KeyboardBackupInput,
  KeyboardRuntimeStatus,
  KeyboardSettings,
  KeyboardSettingsSaveResult,
  KEYBOARD_SLOTS,
  KeyboardSlot,
  KnobKeymapBackup,
  MEDIA_KEY_CODES,
  MediaKeyCode,
  PlayerViewMode,
  PROFILE_IDS,
  ProfileId,
  StatusSnapshot,
  TrackInfo,
} from '../shared/types';
import { loadConfig, saveConfig } from './config';
import { DiagnosticLog } from './diagnostic-log';
import { DeviceHost } from './device/device-host';
import { renderTrackFrame } from './display/frame-renderer';
import type { VolumeFeedback } from './display/volume-overlay';
import { KeyboardBackupStore } from './keyboard-backups';
import {
  isLaunchableAppPath,
  mergeKeyboardDeviceSnapshot,
  normalizeKeyboardSettings,
  parseKeyboardAction,
} from './keyboard-settings';
import {
  type FineVolumeAdjustment,
  FineVolumeController,
} from './input/fine-volume';
import { KeyActionRouter } from './input/key-action-router';
import { NowPlayingMonitor } from './music/now-playing';
import { controlPlayback } from './music/playback-controls';

let tray: Tray | null = null;
let playerWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let keyboardWindow: BrowserWindow | null = null;
let config: AppConfig;
let deviceHost: DeviceHost;
let fineVolumeController: FineVolumeController;
let diagnosticLog: DiagnosticLog;
let monitor: NowPlayingMonitor;
let keyboardBackupStore: KeyboardBackupStore;
let keyActionRouter: KeyActionRouter;
let currentTrack: TrackInfo = structuredClone(EMPTY_TRACK);
let previewDataUrl: string | null = null;
let renderSequence = 0;
let pendingRender: {
  sequence: number;
  track: TrackInfo;
  config: AppConfig;
  volumeFeedback: VolumeFeedback | null;
} | null = null;
let rendering = false;
let activeVolumeFeedback: VolumeFeedback | null = null;
let volumeFeedbackTimer: ReturnType<typeof setTimeout> | null = null;
let profileSwitching = false;
let profileSwitchError: string | null = null;
let playerViewMode: PlayerViewMode = 'expanded';
const hidDisabled = process.env.XPAD_DISABLE_HID === '1';
const VOLUME_FEEDBACK_DURATION_MS = 1600;
const PLAYER_WINDOW_SIZES: Record<PlayerViewMode, { width: number; height: number }> = {
  expanded: { width: 680, height: 320 },
  mini: { width: 300, height: 248 },
};

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
  const deviceKeyboardSettings = deviceHost?.keyboardSnapshot
    ? mergeKeyboardDeviceSnapshot(config.keyboardSettings, deviceHost.keyboardSnapshot)
    : config.keyboardSettings;
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
    keyboardProfileState: {
      activeProfileId:
        deviceHost?.activeProfileId ?? deviceKeyboardSettings.activeProfileId,
      profiles: structuredClone(deviceKeyboardSettings.profiles),
      switching: profileSwitching,
      error: profileSwitchError,
    },
  };
}

function deviceSettingsReady(): boolean {
  return Boolean(deviceHost?.connected && deviceHost.protocolReady);
}

function requireDeviceSettingsReady(): void {
  if (!deviceSettingsReady()) {
    throw new Error('XPAD Mini 연결과 LCD 프로토콜 준비 후 설정을 변경할 수 있습니다.');
  }
}

function broadcastStatus(): void {
  const status = currentStatus();
  updateTray(status);
  playerWindow?.webContents.send('status-changed', status);
  settingsWindow?.webContents.send('status-changed', status);
  keyboardWindow?.webContents.send('status-changed', status);
}

function broadcastKeyboardStatus(): void {
  keyboardWindow?.webContents.send(
    'keyboard-status-changed',
    keyActionRouter.status
  );
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
      { label: '키보드 설정…', click: () => openKeyboardSettingsWindow() },
      { label: '설정…', click: () => openSettingsWindow() },
      { type: 'separator' },
      { label: '종료', click: () => app.quit() },
    ])
  );
}

function loadAppWindow(
  targetWindow: BrowserWindow,
  view: 'player' | 'settings' | 'keyboard'
): void {
  if (process.env.ELECTRON_RENDERER_URL) {
    const rendererUrl = new URL(process.env.ELECTRON_RENDERER_URL);
    rendererUrl.searchParams.set('view', view);
    void targetWindow.loadURL(rendererUrl.toString());
  } else {
    void targetWindow.loadFile(path.join(__dirname, '../renderer/index.html'), {
      query: { view },
    });
  }
}

function windowWebPreferences(): Electron.WebPreferences {
  return {
    preload: path.join(__dirname, '../preload/index.js'),
    contextIsolation: true,
    nodeIntegration: false,
  };
}

function openPlayerWindow(): void {
  if (playerWindow) {
    playerWindow.show();
    playerWindow.focus();
    return;
  }
  const size = PLAYER_WINDOW_SIZES[playerViewMode];
  playerWindow = new BrowserWindow({
    width: size.width,
    height: size.height,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'XPAD Mini Now Playing',
    autoHideMenuBar: true,
    webPreferences: windowWebPreferences(),
  });
  playerWindow.on('closed', () => (playerWindow = null));
  loadAppWindow(playerWindow, 'player');
}

function setPlayerViewMode(mode: PlayerViewMode): PlayerViewMode {
  playerViewMode = mode;
  const size = PLAYER_WINDOW_SIZES[mode];
  playerWindow?.setSize(size.width, size.height, true);
  return playerViewMode;
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
    title: 'XPAD Mini Now Playing 설정',
    autoHideMenuBar: true,
    webPreferences: windowWebPreferences(),
  });
  settingsWindow.on('closed', () => (settingsWindow = null));
  loadAppWindow(settingsWindow, 'settings');
}

function openKeyboardSettingsWindow(): void {
  if (keyboardWindow) {
    keyboardWindow.show();
    keyboardWindow.focus();
    return;
  }
  keyboardWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 900,
    minHeight: 680,
    title: 'XPAD Mini 키보드 설정',
    autoHideMenuBar: true,
    webPreferences: windowWebPreferences(),
  });
  keyboardWindow.on('closed', () => (keyboardWindow = null));
  loadAppWindow(keyboardWindow, 'keyboard');
}

function renderAndSend(track: TrackInfo): void {
  const sequence = ++renderSequence;
  pendingRender = {
    sequence,
    track: structuredClone(track),
    config: structuredClone(config),
    volumeFeedback: activeVolumeFeedback
      ? structuredClone(activeVolumeFeedback)
      : null,
  };
  if (!rendering) void drainRenderQueue();
}

function showVolumeFeedback(adjustment: FineVolumeAdjustment): void {
  activeVolumeFeedback = { volume: adjustment.volume };
  if (volumeFeedbackTimer) clearTimeout(volumeFeedbackTimer);
  renderAndSend(currentTrack);
  volumeFeedbackTimer = setTimeout(() => {
    volumeFeedbackTimer = null;
    activeVolumeFeedback = null;
    renderAndSend(currentTrack);
  }, VOLUME_FEEDBACK_DURATION_MS);
}

function disposeVolumeFeedback(): void {
  if (volumeFeedbackTimer) clearTimeout(volumeFeedbackTimer);
  volumeFeedbackTimer = null;
  activeVolumeFeedback = null;
}

async function drainRenderQueue(): Promise<void> {
  rendering = true;
  try {
    while (pendingRender) {
      const job = pendingRender;
      pendingRender = null;
      try {
        const rendered = await renderTrackFrame(
          job.track,
          job.config,
          job.volumeFeedback
        );
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
  config = saveConfig({
    ...next,
    knobKeymapBackup,
    keyboardSettings: config.keyboardSettings,
  });
  monitor.configure(config.servicePreference, config.pollIntervalMs);
  const shortcutsReady =
    !hidDisabled &&
    fineVolumeController.configure(
      config.fineVolumeEnabled,
      config.fineVolumeStepsPerDetent
    );
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

function saveKeyboardSettings(next: KeyboardSettings): KeyboardSettingsSaveResult {
  requireDeviceSettingsReady();
  const settings = normalizeKeyboardSettings(next);
  config = saveConfig({ ...config, keyboardSettings: settings });
  const runtimeStatus = keyActionRouter.configure(settings);
  return { settings: structuredClone(settings), runtimeStatus };
}

function syncKeyboardActiveProfile(profileId: ProfileId): void {
  if (config.keyboardSettings.activeProfileId === profileId) return;
  const keyboardSettings = {
    ...config.keyboardSettings,
    activeProfileId: profileId,
  };
  config = saveConfig({ ...config, keyboardSettings });
  keyActionRouter.selectProfile(profileId);
}

async function switchKeyboardProfile(profileId: ProfileId): Promise<StatusSnapshot> {
  if (profileSwitching) return currentStatus();
  profileSwitching = true;
  profileSwitchError = null;
  broadcastStatus();
  try {
    requireDeviceSettingsReady();
    const selectedProfileId = await deviceHost.selectKeyboardProfile(profileId);
    syncKeyboardActiveProfile(selectedProfileId);
  } catch (error) {
    profileSwitchError = error instanceof Error ? error.message : String(error);
  } finally {
    profileSwitching = false;
    broadcastStatus();
  }
  return currentStatus();
}

async function executeKeyboardAction(action: KeyboardAction): Promise<void> {
  if (action.type === 'key') {
    if (!MEDIA_KEY_CODES.includes(action.keyCode as MediaKeyCode)) {
      throw new Error(
        '일반 키는 로컬 설정과 백업만 지원합니다. 안전한 장치 적용이 지원된 뒤 실행할 수 있습니다.'
      );
    }
    await controlPlayback(
      action.keyCode as MediaKeyCode,
      currentTrack.service,
      config.servicePreference
    );
    await monitor.refresh();
    return;
  }
  if (action.type === 'unsupported') {
    throw new Error('미지원');
  }
  validateApplicationPath(action.appPath);
  const error = await shell.openPath(action.appPath);
  if (error) throw new Error(error);
}

async function testKeyboardAction(value: unknown): Promise<KeyboardActionResult> {
  const action = parseKeyboardAction(value);
  if (!action) return { ok: false, error: '지원하지 않는 키 동작입니다.' };
  try {
    await executeKeyboardAction(action);
    return { ok: true, error: null };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runPlayerAction(value: unknown): Promise<KeyboardActionResult> {
  if (typeof value !== 'string' || !KEYBOARD_SLOTS.includes(value as KeyboardSlot)) {
    return { ok: false, error: '지원하지 않는 버튼 위치입니다.' };
  }
  const status = currentStatus();
  const profile = status.keyboardProfileState.profiles[status.keyboardProfileState.activeProfileId];
  try {
    await executeKeyboardAction(profile.assignments[value as KeyboardSlot]);
    return { ok: true, error: null };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function pickApplication(): Promise<ApplicationSelection | null> {
  const owner = keyboardWindow;
  if (!owner) throw new Error('키보드 설정 창을 찾지 못했습니다.');
  const result = await dialog.showOpenDialog(owner, {
    title: '키에서 실행할 macOS 애플리케이션 선택',
    properties: ['openFile'],
    filters: [{ name: 'macOS 애플리케이션', extensions: ['app'] }],
  });
  if (result.canceled || result.filePaths.length !== 1) return null;
  const appPath = result.filePaths[0];
  validateApplicationPath(appPath);
  const icon = await app.getFileIcon(appPath, { size: 'normal' });
  return {
    appName: path.basename(appPath, path.extname(appPath)),
    appPath,
    iconDataUrl: icon.toDataURL(),
  };
}

function validateApplicationPath(appPath: string): void {
  if (!isLaunchableAppPath(appPath)) {
    throw new Error('macOS .app 절대경로만 사용할 수 있습니다.');
  }
  try {
    if (!fs.statSync(appPath).isDirectory()) {
      throw new Error('선택한 경로가 애플리케이션 번들이 아닙니다.');
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('애플리케이션 번들')) {
      throw error;
    }
    throw new Error('선택한 애플리케이션을 찾을 수 없습니다.');
  }
}

function requireKeyboardWindow(event: Electron.IpcMainInvokeEvent): void {
  const requester = BrowserWindow.fromWebContents(event.sender);
  if (!keyboardWindow || requester !== keyboardWindow) {
    throw new Error('키보드 설정 창에서만 사용할 수 있는 요청입니다.');
  }
}

function requirePlayerWindow(event: Electron.IpcMainInvokeEvent): void {
  const requester = BrowserWindow.fromWebContents(event.sender);
  if (!playerWindow || requester !== playerWindow) {
    throw new Error('재생 창에서만 사용할 수 있는 요청입니다.');
  }
}

function registerIpc(): void {
  ipcMain.handle('get-status', () => currentStatus());
  ipcMain.handle('get-config', () => config);
  ipcMain.handle('set-config', (_event, next: AppConfig) => {
    requireDeviceSettingsReady();
    return applyConfig(next);
  });
  ipcMain.handle('open-settings-window', () => openSettingsWindow());
  ipcMain.handle('close-settings-window', (event) => {
    const requester = BrowserWindow.fromWebContents(event.sender);
    const target = settingsWindow;
    if (requester === target) target?.close();
  });
  ipcMain.handle('open-keyboard-settings-window', () => openKeyboardSettingsWindow());
  ipcMain.handle('close-keyboard-settings-window', (event) => {
    const requester = BrowserWindow.fromWebContents(event.sender);
    const target = keyboardWindow;
    if (requester === target) target?.close();
  });
  ipcMain.handle('get-keyboard-settings', async (event) => {
    requireKeyboardWindow(event);
    requireDeviceSettingsReady();
    const snapshot = await deviceHost.readKeyboardProfiles();
    syncKeyboardActiveProfile(snapshot.activeProfileId);
    return mergeKeyboardDeviceSnapshot(config.keyboardSettings, snapshot);
  });
  ipcMain.handle('switch-keyboard-profile', async (event, value: unknown) => {
    requirePlayerWindow(event);
    if (typeof value !== 'number' || !PROFILE_IDS.includes(value as ProfileId)) {
      throw new Error('P1~P5 프로필만 선택할 수 있습니다.');
    }
    return switchKeyboardProfile(value as ProfileId);
  });
  ipcMain.handle('get-player-view-mode', (event) => {
    requirePlayerWindow(event);
    return playerViewMode;
  });
  ipcMain.handle('set-player-view-mode', (event, value: unknown) => {
    requirePlayerWindow(event);
    if (value !== 'expanded' && value !== 'mini') {
      throw new Error('지원하지 않는 재생 창 모드입니다.');
    }
    return setPlayerViewMode(value);
  });
  ipcMain.handle('run-player-action', (event, slot: unknown) => {
    requirePlayerWindow(event);
    return runPlayerAction(slot);
  });
  ipcMain.handle('save-keyboard-settings', (event, next: KeyboardSettings) => {
    requireKeyboardWindow(event);
    return saveKeyboardSettings(next);
  });
  ipcMain.handle('get-keyboard-runtime-status', (event): KeyboardRuntimeStatus => {
    requireKeyboardWindow(event);
    return keyActionRouter.status;
  });
  ipcMain.handle('list-keyboard-backups', (event) => {
    requireKeyboardWindow(event);
    return keyboardBackupStore.list();
  });
  ipcMain.handle('create-keyboard-backup', (event, input: KeyboardBackupInput) => {
    requireKeyboardWindow(event);
    requireDeviceSettingsReady();
    return keyboardBackupStore.create(input);
  });
  ipcMain.handle(
    'overwrite-keyboard-backup',
    (event, id: string, input: KeyboardBackupInput) => {
      requireKeyboardWindow(event);
      requireDeviceSettingsReady();
      return keyboardBackupStore.overwrite(id, input);
    }
  );
  ipcMain.handle('delete-keyboard-backup', (event, id: string) => {
    requireKeyboardWindow(event);
    requireDeviceSettingsReady();
    return keyboardBackupStore.delete(id);
  });
  ipcMain.handle('load-keyboard-backup', (event, id: string) => {
    requireKeyboardWindow(event);
    return keyboardBackupStore.load(id);
  });
  ipcMain.handle('pick-application', async (event) => {
    requireKeyboardWindow(event);
    requireDeviceSettingsReady();
    return pickApplication();
  });
  ipcMain.handle('test-keyboard-action', (event, action: unknown) => {
    requireKeyboardWindow(event);
    requireDeviceSettingsReady();
    return testKeyboardAction(action);
  });
  ipcMain.handle('check-application-path', (event, appPath: string): KeyboardActionResult => {
    requireKeyboardWindow(event);
    try {
      validateApplicationPath(appPath);
      return { ok: true, error: null };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
  ipcMain.handle('refresh-now-playing', async () => {
    await monitor.refresh();
    return currentStatus();
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => openPlayerWindow());

  app.whenReady().then(() => {
    app.setName('XPAD Mini Now Playing');
    config = loadConfig();
    diagnosticLog = new DiagnosticLog(app.getPath('userData'));
    diagnosticLog.log('app-started', {
      version: app.getVersion(),
      packaged: app.isPackaged,
      hidDisabled,
    });
    deviceHost = new DeviceHost();
    keyboardBackupStore = new KeyboardBackupStore(app.getPath('userData'));
    keyActionRouter = new KeyActionRouter(executeKeyboardAction);
    fineVolumeController = new FineVolumeController(diagnosticLog);
    monitor = new NowPlayingMonitor(
      config.servicePreference,
      config.pollIntervalMs,
      app.getPath('temp')
    );

    deviceHost.on('status', () => {
      diagnosticLog.log('device-status', {
        connected: deviceHost.connected,
        protocolReady: deviceHost.protocolReady,
        knobFineVolumeState: deviceHost.knobFineVolumeState,
      });
      if (deviceHost.activeProfileId) {
        syncKeyboardActiveProfile(deviceHost.activeProfileId);
      }
      broadcastStatus();
    });
    deviceHost.on('knob-backup', storeKnobKeymapBackup);
    fineVolumeController.on('status', broadcastStatus);
    fineVolumeController.on('volume-adjusted', showVolumeFeedback);
    keyActionRouter.on('status', broadcastKeyboardStatus);
    monitor.on('change', (track: TrackInfo) => {
      currentTrack = track;
      renderAndSend(track);
    });
    monitor.on('status', broadcastStatus);

    registerIpc();
    keyActionRouter.configure(config.keyboardSettings);
    const shortcutsReady =
      !hidDisabled &&
      fineVolumeController.configure(
        config.fineVolumeEnabled,
        config.fineVolumeStepsPerDetent
      );
    if (!hidDisabled) {
      deviceHost.start(
        config.fineVolumeEnabled && shortcutsReady,
        config.knobKeymapBackup
      );
    }
    tray = new Tray(trayIcon());
    tray.on('double-click', () => openPlayerWindow());
    configureLoginItem();
    renderAndSend(currentTrack);
    monitor.start();
    openPlayerWindow();
  });

  app.on('activate', () => openPlayerWindow());
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
      disposeVolumeFeedback();
      keyActionRouter?.dispose();
      fineVolumeController?.dispose();
      diagnosticLog?.log('app-stopped');
      void (diagnosticLog?.flush() ?? Promise.resolve()).finally(() => app.exit(0));
    };
    setTimeout(finish, 4000);
    void deviceHost?.shutdown().then(finish, finish);
  });
}
