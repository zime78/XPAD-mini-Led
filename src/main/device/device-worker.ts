import { parentPort, workerData } from 'node:worker_threads';
import type {
  KeyboardDeviceSnapshot,
  KeyboardKeymapBackup,
  KeyboardSettings,
  KnobFineVolumeState,
  KnobKeymapBackup,
  ProfileId,
} from '../../shared/types';
import { XpadDevice } from './hid';
import { XpadProtocol } from './protocol';

export type WorkerInMessage =
  | { type: 'setFrame'; frame: Uint8Array }
  | {
      type: 'configureKnob';
      enabled: boolean;
      backup?: KnobKeymapBackup;
    }
  | { type: 'readKeyboardProfiles'; requestId: number }
  | {
      type: 'configureKeyboardMappings';
      requestId: number;
      settings: KeyboardSettings;
      backup?: KeyboardKeymapBackup;
    }
  | { type: 'selectKeyboardProfile'; requestId: number; profileId: ProfileId }
  | { type: 'reconnect' }
  | { type: 'shutdown' };

export type WorkerOutMessage =
  | {
      type: 'status';
      connected: boolean;
      protocolReady: boolean;
      knobFineVolumeState: KnobFineVolumeState;
      knobFineVolumeError: string | null;
      knobKeymapBackup?: KnobKeymapBackup;
      activeProfileId?: ProfileId;
      keyboardSnapshot?: KeyboardDeviceSnapshot;
      keyboardKeymapBackup?: KeyboardKeymapBackup;
    }
  | {
      type: 'keyboardProfiles';
      requestId: number;
      snapshot?: KeyboardDeviceSnapshot;
      error?: string;
    }
  | {
      type: 'keyboardProfileSelected';
      requestId: number;
      profileId?: ProfileId;
      error?: string;
    }
  | {
      type: 'keyboardMappingsConfigured';
      requestId: number;
      snapshot?: KeyboardDeviceSnapshot;
      backup?: KeyboardKeymapBackup;
      error?: string;
    };

const port = parentPort;
if (!port) throw new Error('device-worker must run in a worker thread');

const device = new XpadDevice();
const protocol = new XpadProtocol(device);
const initialKnobConfig = workerData as {
  enabled: boolean;
  backup?: KnobKeymapBackup;
  keyboardSettings: KeyboardSettings;
  keyboardBackup?: KeyboardKeymapBackup;
  keyboardMappingsEnabled: boolean;
};

let currentFrame: Buffer | null = null;
let timer: NodeJS.Timeout | null = null;
let epoch = 0;
let streamingPaused = false;
let knobEnabled = initialKnobConfig.enabled;
let knobBackup = initialKnobConfig.backup;
let knobFineVolumeState: KnobFineVolumeState = knobEnabled ? 'pending' : 'disabled';
let knobFineVolumeError: string | null = null;
let knobConfigVersion = 0;
let knobQueue = Promise.resolve();
let keyboardSnapshot: KeyboardDeviceSnapshot | null = null;
let keyboardSettings = structuredClone(initialKnobConfig.keyboardSettings);
let keyboardBackup = initialKnobConfig.keyboardBackup;
let keyboardMappingsEnabled = initialKnobConfig.keyboardMappingsEnabled;
let keyboardMappingsApplied = false;

function reportStatus(): void {
  port!.postMessage({
    type: 'status',
    connected: device.connected,
    protocolReady: protocol.ready,
    knobFineVolumeState,
    knobFineVolumeError,
    ...(knobBackup ? { knobKeymapBackup: knobBackup } : {}),
    ...(protocol.activeProfileId ? { activeProfileId: protocol.activeProfileId } : {}),
    ...(keyboardSnapshot ? { keyboardSnapshot } : {}),
    ...(keyboardBackup ? { keyboardKeymapBackup: keyboardBackup } : {}),
  } satisfies WorkerOutMessage);
}

function scheduleStreaming(): void {
  if (streamingPaused) return;
  if (timer) clearTimeout(timer);
  const currentEpoch = ++epoch;
  const tick = async () => {
    if (currentEpoch !== epoch) return;
    if (currentFrame && protocol.ready) await protocol.drawLcdFrame(currentFrame);
    if (currentEpoch === epoch) timer = setTimeout(() => void tick(), 220);
  };
  void tick();
}

device.on('connect', reportStatus);
device.on('disconnect', () => {
  // 분리 중에는 스트리밍을 멈춰, 잔존 tick의 LCD draw(0x25)가 재연결 직후
  // 프로필 스캔 I/O(0x02/0x10)와 인터리브되어 화면을 오염시키는 것을 막는다.
  // 재연결 시 onReady → queueKnobConfiguration의 finally에서 다시 재개된다.
  pauseStreaming();
  knobFineVolumeState = knobEnabled ? 'pending' : 'disabled';
  knobFineVolumeError = null;
  keyboardSnapshot = null;
  keyboardMappingsApplied = false;
  reportStatus();
});
protocol.onReady = () => {
  reportStatus();
  queueKnobConfiguration();
  queueKeyboardMappingSync();
};

function pauseStreaming(): void {
  streamingPaused = true;
  if (timer) clearTimeout(timer);
  timer = null;
  epoch++;
}

function resumeStreaming(): void {
  streamingPaused = false;
  // pause 구간(프로필 스캔·KeyInfo 쓰기)이 LCD를 흐트러뜨릴 수 있으므로,
  // 재개 시 diff 캐시를 비워 전체 프레임을 강제 전송해 화면을 복구한다.
  protocol.invalidateFrameCache();
  scheduleStreaming();
}

function queueKnobConfiguration(): void {
  const version = ++knobConfigVersion;
  pauseStreaming();
  knobFineVolumeState = knobEnabled ? 'pending' : 'disabled';
  knobFineVolumeError = null;
  reportStatus();
  knobQueue = knobQueue
    .catch(() => {})
    .then(async () => {
      try {
        if (!protocol.ready) return;
        const result = await protocol.configureKnobFineVolume(knobEnabled, knobBackup);
        if (result.backup) knobBackup = result.backup;
        if (version !== knobConfigVersion) return;
        knobFineVolumeState = result.state;
        knobFineVolumeError = null;
      } catch (error) {
        if (version !== knobConfigVersion) return;
        knobFineVolumeState = 'error';
        knobFineVolumeError = error instanceof Error ? error.message : String(error);
        console.error('[worker] knob configuration failed', error);
      } finally {
        if (version === knobConfigVersion) {
          reportStatus();
          resumeStreaming();
        }
      }
    });
}

function queueKeyboardProfileRead(requestId: number): void {
  knobQueue = knobQueue
    .catch(() => {})
    .then(async () => {
      pauseStreaming();
      try {
        if (!protocol.ready) throw new Error('XPAD 프로토콜이 준비되지 않았습니다.');
        const snapshot = await protocol.readKeyboardProfiles();
        keyboardSnapshot = snapshot;
        port!.postMessage({
          type: 'keyboardProfiles',
          requestId,
          snapshot,
        } satisfies WorkerOutMessage);
        reportStatus();
      } catch (error) {
        port!.postMessage({
          type: 'keyboardProfiles',
          requestId,
          error: error instanceof Error ? error.message : String(error),
        } satisfies WorkerOutMessage);
      } finally {
        resumeStreaming();
      }
    });
}

function queueKeyboardMappingSync(): void {
  knobQueue = knobQueue
    .catch(() => {})
    .then(async () => {
      pauseStreaming();
      try {
        if (!protocol.ready) return;
        if (keyboardMappingsEnabled) {
          const result = await protocol.configureKeyboardAppMappings(
            keyboardSettings,
            keyboardBackup
          );
          keyboardBackup = result.backup;
          keyboardSnapshot = result.snapshot;
          keyboardMappingsApplied = result.state === 'active';
        } else if (keyboardBackup) {
          const result = await protocol.restoreKeyboardAppMappings(keyboardBackup);
          keyboardSnapshot = result.snapshot;
          keyboardMappingsApplied = false;
        } else {
          keyboardSnapshot = await protocol.readKeyboardProfiles();
          keyboardMappingsApplied = false;
        }
        reportStatus();
      } catch (error) {
        console.error('[worker] keyboard mapping sync failed', error);
      } finally {
        resumeStreaming();
      }
    });
}

function queueKeyboardMappingConfiguration(
  requestId: number,
  settings: KeyboardSettings,
  backup?: KeyboardKeymapBackup
): void {
  knobQueue = knobQueue
    .catch(() => {})
    .then(async () => {
      pauseStreaming();
      try {
        const result = await protocol.configureKeyboardAppMappings(settings, backup);
        keyboardSettings = structuredClone(settings);
        keyboardMappingsEnabled = true;
        keyboardMappingsApplied = result.state === 'active';
        keyboardBackup = result.backup;
        keyboardSnapshot = result.snapshot;
        port!.postMessage({
          type: 'keyboardMappingsConfigured',
          requestId,
          snapshot: result.snapshot,
          backup: result.backup,
        } satisfies WorkerOutMessage);
        reportStatus();
      } catch (error) {
        port!.postMessage({
          type: 'keyboardMappingsConfigured',
          requestId,
          error: error instanceof Error ? error.message : String(error),
        } satisfies WorkerOutMessage);
      } finally {
        resumeStreaming();
      }
    });
}

function queueKeyboardProfileSelection(requestId: number, profileId: ProfileId): void {
  knobQueue = knobQueue
    .catch(() => {})
    .then(async () => {
      pauseStreaming();
      try {
        const selectedProfileId = await protocol.selectProfile(profileId);
        if (keyboardSnapshot) {
          keyboardSnapshot = {
            ...keyboardSnapshot,
            activeProfileId: selectedProfileId,
          };
        }
        port!.postMessage({
          type: 'keyboardProfileSelected',
          requestId,
          profileId: selectedProfileId,
        } satisfies WorkerOutMessage);
        reportStatus();
      } catch (error) {
        port!.postMessage({
          type: 'keyboardProfileSelected',
          requestId,
          error: error instanceof Error ? error.message : String(error),
        } satisfies WorkerOutMessage);
      } finally {
        resumeStreaming();
      }
    });
}

port.on('message', (message: WorkerInMessage) => {
  if (message.type === 'setFrame') {
    currentFrame = Buffer.from(message.frame);
    scheduleStreaming();
  } else if (message.type === 'configureKnob') {
    knobEnabled = message.enabled;
    knobBackup = message.backup ?? knobBackup;
    queueKnobConfiguration();
  } else if (message.type === 'readKeyboardProfiles') {
    queueKeyboardProfileRead(message.requestId);
  } else if (message.type === 'configureKeyboardMappings') {
    queueKeyboardMappingConfiguration(
      message.requestId,
      message.settings,
      message.backup
    );
  } else if (message.type === 'selectKeyboardProfile') {
    queueKeyboardProfileSelection(message.requestId, message.profileId);
  } else if (message.type === 'reconnect') {
    // 핸들을 강제로 닫고 다시 연다. connect 이벤트 → reportStatus,
    // protocol.onReady → knob/keyboard 재설정이 자동으로 이어진다.
    device.reconnect();
  } else if (message.type === 'shutdown') {
    void shutdown();
  }
});

async function shutdown(): Promise<void> {
  pauseStreaming();
  knobConfigVersion++;
  try {
    await knobQueue;
    if (protocol.ready && keyboardBackup && keyboardMappingsApplied) {
      await protocol.restoreKeyboardAppMappings(keyboardBackup);
    }
    if (protocol.ready && knobBackup) {
      await protocol.configureKnobFineVolume(false, knobBackup);
    }
  } catch (error) {
    console.error('[worker] knob restore during shutdown failed', error);
  } finally {
    device.stop();
    process.exit(0);
  }
}

device.start();
reportStatus();
