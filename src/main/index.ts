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
  KeyboardKeymapBackup,
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
  EMPTY_YOUTUBE_ACCOUNT,
  YOUTUBE_PROFILE_ID,
  YOUTUBE_TRANSPORT_COMMANDS,
  type YoutubeAccountState,
  type YoutubeCommandResult,
  type YoutubePlaybackInfo,
  type YoutubeTransportCommand,
} from '../shared/types';
import { loadConfig, saveConfig } from './config';
import { DiagnosticLog } from './diagnostic-log';
import { DeviceHost } from './device/device-host';
import { resolveDisplayTrack } from './display/display-state';
import { renderTrackFrame } from './display/frame-renderer';
import type { VolumeFeedback } from './display/volume-overlay';
import {
  addYoutubeVideo,
  currentYoutubeItem,
  moveYoutubeVideo,
  rememberYoutubeMetadata,
  removeYoutubeVideo,
  sameYoutubePlayback,
  selectYoutubeIndex,
  stepYoutubeIndex,
  withYoutubeQueue,
} from './display/youtube-library';
import { fetchYoutubeOembed } from './display/youtube-oembed';
import {
  clearYoutubeSession,
  parseYouTubeVideoId,
  readYoutubeAccountState,
  YouTubeLcdPlayer,
} from './display/youtube-lcd';
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
let youtubeLcd: YouTubeLcdPlayer | null = null;
let youtubePlayback: YoutubePlaybackInfo | null = null;
let youtubeAccount: YoutubeAccountState = { ...EMPTY_YOUTUBE_ACCOUNT };
const hidDisabled = process.env.XPAD_DISABLE_HID === '1';
const youtubeTestRequested = process.env.XPAD_YOUTUBE_TEST === '1';
// 음성은 Mac에서 재생한다. 소프트 디코드·백그라운드 스로틀은 오디오 언더런을 만든다.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-background-timer-throttling');
const VOLUME_FEEDBACK_DURATION_MS = 1600;
const PLAYER_WINDOW_SIZES: Record<PlayerViewMode, { width: number; height: number }> = {
  expanded: { width: 680, height: 320 },
  mini: { width: 300, height: 248 },
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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
    youtubeLcdActive: Boolean(youtubeLcd?.active),
    youtubePlayback: youtubeLcd?.active ? youtubePlayback : null,
    youtubeAccount,
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
      {
        label: 'XPAD Mini 다시 연결',
        enabled: !hidDisabled,
        click: () => {
          if (!hidDisabled) deviceHost.reconnect();
        },
      },
      { type: 'separator' },
      { label: '지금 새로고침', click: () => void monitor.refresh() },
      {
        label: youtubeLcd?.active
          ? '유튜브 샘플 중지'
          : '유튜브 샘플 LCD 테스트',
        click: () => {
          if (youtubeLcd?.active) stopYoutubeLcdSample();
          else startYoutubeLcdSample();
        },
      },
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
    height: 860,
    minWidth: 680,
    minHeight: 720,
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
  if (youtubeLcd?.active) return;
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

/** 상태가 바뀌면 다시 그린다. 유튜브가 LCD를 쓰는 중이면 음악 프레임은 올리지 않는다. */
function refreshDisplay(reason: string): void {
  const mode = youtubeLcd?.active ? 'youtube' : 'music';
  diagnosticLog?.log('display-refresh', {
    reason,
    mode,
    profile: deviceHost?.activeProfileId ?? config.keyboardSettings.activeProfileId,
    youtubeActive: Boolean(youtubeLcd?.active),
    track: currentTrack.title,
    service: currentTrack.service,
    state: currentTrack.state,
  });
  console.log(
    `[display] refresh reason=${reason} mode=${mode} profile=${deviceHost?.activeProfileId ?? config.keyboardSettings.activeProfileId} track=${currentTrack.title}`
  );
  if (youtubeLcd?.active) {
    broadcastStatus();
    return;
  }
  renderAndSend(resolveDisplayTrack(currentTrack));
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

function youtubeVideoIdToPlay(): string | null {
  return (
    parseYouTubeVideoId(process.env.XPAD_YOUTUBE_ID ?? '') ??
    currentYoutubeItem(config.youtubeLibrary)?.videoId ??
    null
  );
}

function pendingYoutubePlayback(videoId: string): YoutubePlaybackInfo {
  const item = currentYoutubeItem(config.youtubeLibrary);
  return withYoutubeQueue(
    {
      videoId,
      title: item?.videoId === videoId ? item.title : '',
      channel: item?.videoId === videoId ? item.channel : '',
      state: 'stopped',
      duration: 0,
      position: 0,
      signedIn: youtubeAccount.signedIn,
      adPlaying: false,
    },
    config.youtubeLibrary
  );
}

function persistYoutubeLibrary(library: typeof config.youtubeLibrary): void {
  config = saveConfig({ ...config, youtubeLibrary: library });
}

function youtubeCommandResult(): YoutubeCommandResult {
  return {
    config: structuredClone(config),
    status: currentStatus(),
  };
}

function startYoutubeIfNeeded(): void {
  const videoId = youtubeVideoIdToPlay();
  if (!videoId) {
    stopYoutubeLcdSample(false);
    return;
  }
  startYoutubeLcdSample(videoId);
}

function startYoutubeLcdSample(rawId = youtubeVideoIdToPlay()): void {
  const videoId = rawId ? parseYouTubeVideoId(rawId) : null;
  if (!videoId) {
    console.error('[youtube-lcd] invalid video id', rawId);
    stopYoutubeLcdSample(false);
    return;
  }
  if (!youtubeLcd) youtubeLcd = new YouTubeLcdPlayer();
  youtubePlayback = pendingYoutubePlayback(videoId);
  youtubeLcd.start({
    videoId,
    onFrame: (frame) => {
      if (!youtubeLcd?.active) return;
      if (!hidDisabled && deviceHost?.protocolReady) deviceHost.setFrame(frame);
    },
    onPreview: (dataUrl) => {
      if (!youtubeLcd?.active) return;
      previewDataUrl = dataUrl;
      playerWindow?.webContents.send('status-changed', currentStatus());
    },
    onInfo: (info) => {
      if (!youtubeLcd?.active) return;
      const remembered = rememberYoutubeMetadata(config.youtubeLibrary, info);
      if (remembered !== config.youtubeLibrary) persistYoutubeLibrary(remembered);
      const next = withYoutubeQueue(info, config.youtubeLibrary);
      const changed = !sameYoutubePlayback(youtubePlayback, next);
      youtubePlayback = next;
      youtubeAccount = {
        signedIn: next.signedIn,
        label: next.signedIn ? '연결됨' : EMPTY_YOUTUBE_ACCOUNT.label,
      };
      if (changed) broadcastStatus();
    },
    onEnded: () => {
      if (!youtubeLcd?.active) return;
      void controlYoutube('next').catch((error) => {
        console.error('[youtube-lcd] auto-next failed', error);
      });
    },
    onStopped: () => {
      youtubePlayback = null;
      refreshDisplay('youtube-stopped');
    },
  });
  broadcastStatus();
}

function stopYoutubeLcdSample(silent = false): void {
  youtubeLcd?.stop({ silent });
  youtubePlayback = null;
  if (silent) return;
  previewDataUrl = null;
  broadcastStatus();
  refreshDisplay('youtube-stop');
}

async function playYoutubeIndex(index: number): Promise<void> {
  const selected = selectYoutubeIndex(config.youtubeLibrary, index);
  persistYoutubeLibrary(selected);
  const item = currentYoutubeItem(selected);
  if (!item) {
    stopYoutubeLcdSample(false);
    return;
  }
  if (youtubeLcd?.active) {
    youtubePlayback = pendingYoutubePlayback(item.videoId);
    broadcastStatus();
    await youtubeLcd.load(item.videoId);
    return;
  }
  startYoutubeLcdSample(item.videoId);
}

async function controlYoutube(command: YoutubeTransportCommand): Promise<void> {
  if (command === 'play-pause') {
    if (!youtubeLcd?.active) {
      startYoutubeIfNeeded();
      if (!youtubeLcd?.active) throw new Error('재생할 영상이 없습니다.');
      return;
    }
    await youtubeLcd.controlPlayPause();
    return;
  }
  const stepped = stepYoutubeIndex(config.youtubeLibrary, command === 'next' ? 1 : -1);
  if (!currentYoutubeItem(stepped)) throw new Error('재생할 영상이 없습니다.');
  persistYoutubeLibrary(stepped);
  await playYoutubeIndex(stepped.currentIndex);
}

async function addYoutubeFromInput(raw: string): Promise<YoutubeCommandResult> {
  const videoId = parseYouTubeVideoId(raw);
  if (!videoId) throw new Error('YouTube 영상 URL 또는 ID를 입력하세요.');
  const meta = await fetchYoutubeOembed(videoId);
  const wasEmpty = config.youtubeLibrary.items.length === 0;
  persistYoutubeLibrary(
    addYoutubeVideo(config.youtubeLibrary, {
      videoId,
      title: meta.title,
      channel: meta.channel,
      addedAt: new Date().toISOString(),
    })
  );
  if (wasEmpty && (deviceHost?.activeProfileId ?? config.keyboardSettings.activeProfileId) === YOUTUBE_PROFILE_ID) {
    startYoutubeIfNeeded();
  }
  return youtubeCommandResult();
}

async function removeYoutubeAt(index: number): Promise<YoutubeCommandResult> {
  const removingCurrent = index === config.youtubeLibrary.currentIndex;
  persistYoutubeLibrary(removeYoutubeVideo(config.youtubeLibrary, index));
  if (config.youtubeLibrary.items.length === 0) {
    stopYoutubeLcdSample(false);
  } else if (removingCurrent && youtubeLcd?.active) {
    await playYoutubeIndex(config.youtubeLibrary.currentIndex);
  } else {
    broadcastStatus();
  }
  return youtubeCommandResult();
}

async function signInYoutube(): Promise<YoutubeCommandResult> {
  if (!youtubeLcd) youtubeLcd = new YouTubeLcdPlayer();
  youtubeAccount = await youtubeLcd.openSignInWindow();
  if (youtubeLcd.active) startYoutubeIfNeeded();
  else broadcastStatus();
  return youtubeCommandResult();
}

async function signOutYoutube(): Promise<YoutubeCommandResult> {
  await clearYoutubeSession();
  youtubeAccount = { ...EMPTY_YOUTUBE_ACCOUNT };
  if (youtubeLcd?.active) startYoutubeIfNeeded();
  else broadcastStatus();
  return youtubeCommandResult();
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
  const keyboardKeymapBackup =
    next.keyboardKeymapBackup ?? config.keyboardKeymapBackup;
  config = saveConfig({
    ...next,
    knobKeymapBackup,
    keyboardKeymapBackup,
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
  refreshDisplay('config');
  return config;
}

function storeKnobKeymapBackup(backup: KnobKeymapBackup): void {
  if (JSON.stringify(config.knobKeymapBackup) === JSON.stringify(backup)) return;
  config = saveConfig({ ...config, knobKeymapBackup: backup });
}

function storeKeyboardKeymapBackup(backup: KeyboardKeymapBackup): void {
  if (JSON.stringify(config.keyboardKeymapBackup) === JSON.stringify(backup)) return;
  config = saveConfig({ ...config, keyboardKeymapBackup: backup });
}

async function saveKeyboardSettings(
  next: KeyboardSettings
): Promise<KeyboardSettingsSaveResult> {
  requireDeviceSettingsReady();
  const settings = normalizeKeyboardSettings(next);
  const previousSettings = structuredClone(config.keyboardSettings);
  const runtimeStatus = keyActionRouter.configure(settings);
  if (settings.enabled && runtimeStatus.shortcutState !== 'active') {
    keyActionRouter.configure(previousSettings);
    throw new Error(
      runtimeStatus.shortcutError ?? 'F16~F18 앱 실행 단축키를 활성화하지 못했습니다.'
    );
  }
  let result: Awaited<ReturnType<DeviceHost['configureKeyboardMappings']>>;
  try {
    result = await deviceHost.configureKeyboardMappings(settings, config.keyboardKeymapBackup);
  } catch (error) {
    keyActionRouter.configure(previousSettings);
    throw error;
  }
  try {
    config = saveConfig({
      ...config,
      keyboardSettings: settings,
      keyboardKeymapBackup: result.backup,
    });
  } catch (error) {
    keyActionRouter.configure(previousSettings);
    try {
      await deviceHost.configureKeyboardMappings(previousSettings, result.backup);
    } catch (rollbackError) {
      throw new Error(
        `설정 파일 저장 실패: ${errorMessage(error)} / 장치 원복 실패: ${errorMessage(rollbackError)}`
      );
    }
    throw new Error(`설정 파일 저장 실패: ${errorMessage(error)}`);
  }
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

/** 앱을 켜면 장치는 항상 P1 음악 화면부터 시작한다. 사용자가 P5를 누르기 전에는 유튜브를 켜지 않는다. */
async function applyStartupProfile(): Promise<void> {
  diagnosticLog?.log('startup-profile', { to: 1 });
  console.log('[display] startup profile P1');
  await switchKeyboardProfile(1);
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
    diagnosticLog?.log('profile-switch', {
      to: selectedProfileId,
      youtube: selectedProfileId === YOUTUBE_PROFILE_ID,
      track: currentTrack.title,
    });
    console.log(`[display] profile-switch to=${selectedProfileId} youtube=${selectedProfileId === YOUTUBE_PROFILE_ID}`);
    if (selectedProfileId === YOUTUBE_PROFILE_ID) {
      startYoutubeIfNeeded();
    } else {
      stopYoutubeLcdSample(false);
      void monitor.refresh();
    }
  } catch (error) {
    profileSwitchError = error instanceof Error ? error.message : String(error);
  } finally {
    profileSwitching = false;
    broadcastStatus();
  }
  return currentStatus();
}

async function executeKeyboardAction(action: KeyboardAction): Promise<void> {
  if (action.type === 'youtube-transport') {
    await controlYoutube(action.command);
    return;
  }
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
  const youtubeActive =
    Boolean(youtubeLcd?.active) ||
    status.keyboardProfileState.activeProfileId === YOUTUBE_PROFILE_ID;
  try {
    if (youtubeActive) {
      const command =
        value === 'left' ? 'previous' : value === 'center' ? 'play-pause' : 'next';
      await controlYoutube(command);
      return { ok: true, error: null };
    }
    const profile = status.keyboardProfileState.profiles[status.keyboardProfileState.activeProfileId];
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

function requireSettingsOrPlayer(event: Electron.IpcMainInvokeEvent): void {
  const requester = BrowserWindow.fromWebContents(event.sender);
  if (requester !== settingsWindow && requester !== playerWindow) {
    throw new Error('설정 또는 재생 창에서만 사용할 수 있는 요청입니다.');
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
  ipcMain.handle('youtube-library-add', async (event, value: unknown) => {
    requireSettingsOrPlayer(event);
    return addYoutubeFromInput(typeof value === 'string' ? value : '');
  });
  ipcMain.handle('youtube-library-remove', async (event, value: unknown) => {
    requireSettingsOrPlayer(event);
    if (typeof value !== 'number') throw new Error('목록에서 해당 영상을 찾지 못했습니다.');
    return removeYoutubeAt(value);
  });
  ipcMain.handle('youtube-library-move', async (event, index: unknown, direction: unknown) => {
    requireSettingsOrPlayer(event);
    if (typeof index !== 'number' || (direction !== -1 && direction !== 1)) {
      throw new Error('목록 순서를 바꿀 수 없습니다.');
    }
    persistYoutubeLibrary(moveYoutubeVideo(config.youtubeLibrary, index, direction));
    broadcastStatus();
    return youtubeCommandResult();
  });
  ipcMain.handle('youtube-library-play', async (event, value: unknown) => {
    requireSettingsOrPlayer(event);
    if (typeof value !== 'number') throw new Error('재생할 영상을 찾지 못했습니다.');
    await playYoutubeIndex(value);
    return youtubeCommandResult();
  });
  ipcMain.handle('youtube-control', async (event, value: unknown) => {
    requireSettingsOrPlayer(event);
    if (
      typeof value !== 'string' ||
      !YOUTUBE_TRANSPORT_COMMANDS.includes(value as YoutubeTransportCommand)
    ) {
      throw new Error('지원하지 않는 YouTube 동작입니다.');
    }
    await controlYoutube(value as YoutubeTransportCommand);
    return youtubeCommandResult();
  });
  ipcMain.handle('youtube-sign-in', async (event) => {
    requireSettingsOrPlayer(event);
    return signInYoutube();
  });
  ipcMain.handle('youtube-sign-out', async (event) => {
    requireSettingsOrPlayer(event);
    return signOutYoutube();
  });
  ipcMain.handle('save-keyboard-settings', async (event, next: KeyboardSettings) => {
    requireKeyboardWindow(event);
    return await saveKeyboardSettings(next);
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
  ipcMain.handle('reconnect-device', () => {
    if (!hidDisabled) deviceHost.reconnect();
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

    let lastDeviceReady = false;
    let startupProfileApplied = false;
    deviceHost.on('status', () => {
      diagnosticLog.log('device-status', {
        connected: deviceHost.connected,
        protocolReady: deviceHost.protocolReady,
        knobFineVolumeState: deviceHost.knobFineVolumeState,
      });
      if (deviceHost.activeProfileId && startupProfileApplied) {
        syncKeyboardActiveProfile(deviceHost.activeProfileId);
      }
      const ready = Boolean(deviceHost.connected && deviceHost.protocolReady);
      if (ready !== lastDeviceReady) {
        lastDeviceReady = ready;
        if (ready) {
          if (!startupProfileApplied) {
            startupProfileApplied = true;
            void applyStartupProfile().catch((error) => {
              console.error('[display] startup profile P1 failed', error);
              refreshDisplay('device-ready');
            });
          } else if (
            (deviceHost.activeProfileId ?? config.keyboardSettings.activeProfileId) ===
            YOUTUBE_PROFILE_ID
          ) {
            startYoutubeIfNeeded();
          } else {
            refreshDisplay('device-ready');
          }
        } else {
          stopYoutubeLcdSample(true);
          broadcastStatus();
        }
        return;
      }
      broadcastStatus();
    });
    deviceHost.on('knob-backup', storeKnobKeymapBackup);
    deviceHost.on('keyboard-backup', storeKeyboardKeymapBackup);
    fineVolumeController.on('status', broadcastStatus);
    fineVolumeController.on('volume-adjusted', showVolumeFeedback);
    keyActionRouter.on('status', broadcastKeyboardStatus);
    monitor.on('change', (track: TrackInfo) => {
      currentTrack = track;
      refreshDisplay('track-change');
    });
    monitor.on('status', broadcastStatus);

    registerIpc();
    const keyboardRuntime = keyActionRouter.configure(config.keyboardSettings);
    const shortcutsReady =
      !hidDisabled &&
      fineVolumeController.configure(
        config.fineVolumeEnabled,
        config.fineVolumeStepsPerDetent
      );
    if (!hidDisabled) {
      deviceHost.start(
        config.fineVolumeEnabled && shortcutsReady,
        config.knobKeymapBackup,
        config.keyboardSettings,
        config.keyboardKeymapBackup,
        keyboardRuntime.shortcutState === 'active'
      );
    }
    tray = new Tray(trayIcon());
    tray.on('double-click', () => openPlayerWindow());
    configureLoginItem();
    renderAndSend(currentTrack);
    monitor.start();
    openPlayerWindow();
    if (youtubeTestRequested) startYoutubeIfNeeded();
    void readYoutubeAccountState()
      .then((account) => {
        youtubeAccount = account;
        broadcastStatus();
      })
      .catch(() => undefined);
  });

  app.on('activate', () => openPlayerWindow());
  app.on('window-all-closed', () => {});

  let shuttingDown = false;
  app.on('will-quit', (event) => {
    if (shuttingDown) return;
    shuttingDown = true;
    event.preventDefault();
    monitor?.stop();
    stopYoutubeLcdSample(true);
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
