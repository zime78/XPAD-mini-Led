import { EventEmitter } from 'node:events';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type {
  KeyboardDeviceSnapshot,
  KnobFineVolumeState,
  KnobKeymapBackup,
} from '../../shared/types';
import type { WorkerInMessage, WorkerOutMessage } from './device-worker';

export class DeviceHost extends EventEmitter {
  private worker: Worker | null = null;
  private requestSequence = 0;
  private keyboardRequests = new Map<
    number,
    {
      resolve: (snapshot: KeyboardDeviceSnapshot) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  connected = false;
  protocolReady = false;
  knobFineVolumeState: KnobFineVolumeState = 'disabled';
  knobFineVolumeError: string | null = null;
  knobKeymapBackup: KnobKeymapBackup | undefined;

  start(enabled: boolean, backup?: KnobKeymapBackup): void {
    this.worker = new Worker(path.join(__dirname, 'device-worker.js'), {
      workerData: { enabled, backup },
    });
    this.worker.on('message', (message: WorkerOutMessage) => {
      if (message.type === 'keyboardProfiles') {
        const request = this.keyboardRequests.get(message.requestId);
        if (!request) return;
        this.keyboardRequests.delete(message.requestId);
        clearTimeout(request.timer);
        if (message.snapshot) request.resolve(message.snapshot);
        else request.reject(new Error(message.error ?? '키보드 프로필을 읽지 못했습니다.'));
        return;
      }
      const previousBackup = JSON.stringify(this.knobKeymapBackup);
      this.connected = message.connected;
      this.protocolReady = message.protocolReady;
      this.knobFineVolumeState = message.knobFineVolumeState;
      this.knobFineVolumeError = message.knobFineVolumeError;
      this.knobKeymapBackup = message.knobKeymapBackup;
      if (
        this.knobKeymapBackup &&
        JSON.stringify(this.knobKeymapBackup) !== previousBackup
      ) {
        this.emit('knob-backup', this.knobKeymapBackup);
      }
      this.emit('status');
    });
    this.worker.on('error', (error) => console.error('[device-host] worker error', error));
    this.worker.on('exit', (code) => {
      if (code !== 0) console.error(`[device-host] worker exited with ${code}`);
      this.connected = false;
      this.protocolReady = false;
      this.knobFineVolumeState = 'disabled';
      this.rejectKeyboardRequests('XPAD 장치 워커가 종료되었습니다.');
      this.emit('status');
    });
  }

  setFrame(frame: Buffer): void {
    this.send({ type: 'setFrame', frame });
  }

  configureKnob(enabled: boolean, backup?: KnobKeymapBackup): void {
    this.send({ type: 'configureKnob', enabled, backup });
  }

  readKeyboardProfiles(): Promise<KeyboardDeviceSnapshot> {
    if (!this.worker || !this.connected || !this.protocolReady) {
      return Promise.reject(new Error('XPAD Mini 연결과 프로토콜 준비가 필요합니다.'));
    }
    const requestId = ++this.requestSequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.keyboardRequests.delete(requestId);
        reject(new Error('키보드 프로필 읽기가 20초 안에 끝나지 않았습니다.'));
      }, 20_000);
      this.keyboardRequests.set(requestId, { resolve, reject, timer });
      try {
        this.worker?.postMessage({
          type: 'readKeyboardProfiles',
          requestId,
        } satisfies WorkerInMessage);
      } catch (error) {
        this.keyboardRequests.delete(requestId);
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  shutdown(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    this.rejectKeyboardRequests('앱이 종료되어 키보드 프로필 읽기를 중단했습니다.');
    if (!worker) return Promise.resolve();
    return new Promise((resolve) => {
      worker.once('exit', () => resolve());
      try {
        worker.postMessage({ type: 'shutdown' } satisfies WorkerInMessage);
      } catch {
        resolve();
      }
    });
  }

  private send(message: WorkerInMessage): void {
    try {
      this.worker?.postMessage(message);
    } catch (error) {
      console.error('[device-host] postMessage failed', error);
    }
  }

  private rejectKeyboardRequests(message: string): void {
    for (const request of this.keyboardRequests.values()) {
      clearTimeout(request.timer);
      request.reject(new Error(message));
    }
    this.keyboardRequests.clear();
  }
}
