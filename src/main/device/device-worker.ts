import { parentPort, workerData } from 'node:worker_threads';
import type {
  KnobFineVolumeState,
  KnobKeymapBackup,
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
  | { type: 'shutdown' };

export interface WorkerOutMessage {
  type: 'status';
  connected: boolean;
  protocolReady: boolean;
  knobFineVolumeState: KnobFineVolumeState;
  knobFineVolumeError: string | null;
  knobKeymapBackup?: KnobKeymapBackup;
}

const port = parentPort;
if (!port) throw new Error('device-worker must run in a worker thread');

const device = new XpadDevice();
const protocol = new XpadProtocol(device);
const initialKnobConfig = workerData as {
  enabled: boolean;
  backup?: KnobKeymapBackup;
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

function reportStatus(): void {
  port!.postMessage({
    type: 'status',
    connected: device.connected,
    protocolReady: protocol.ready,
    knobFineVolumeState,
    knobFineVolumeError,
    ...(knobBackup ? { knobKeymapBackup: knobBackup } : {}),
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
  knobFineVolumeState = knobEnabled ? 'pending' : 'disabled';
  knobFineVolumeError = null;
  reportStatus();
});
protocol.onReady = () => {
  reportStatus();
  queueKnobConfiguration();
};

function pauseStreaming(): void {
  streamingPaused = true;
  if (timer) clearTimeout(timer);
  timer = null;
  epoch++;
}

function resumeStreaming(): void {
  streamingPaused = false;
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
      if (!protocol.ready) return;
      try {
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

port.on('message', (message: WorkerInMessage) => {
  if (message.type === 'setFrame') {
    currentFrame = Buffer.from(message.frame);
    scheduleStreaming();
  } else if (message.type === 'configureKnob') {
    knobEnabled = message.enabled;
    knobBackup = message.backup ?? knobBackup;
    queueKnobConfiguration();
  } else if (message.type === 'shutdown') {
    void shutdown();
  }
});

async function shutdown(): Promise<void> {
  pauseStreaming();
  knobConfigVersion++;
  try {
    await knobQueue;
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
