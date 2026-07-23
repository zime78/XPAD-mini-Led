import { EventEmitter } from 'node:events';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type {
  KeyboardDeviceSnapshot,
  KeyboardKeymapBackup,
  KeyboardSettings,
  KnobFineVolumeState,
  KnobKeymapBackup,
  ProfileId,
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
  private profileRequests = new Map<
    number,
    {
      resolve: (profileId: ProfileId) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private keyboardMappingRequests = new Map<
    number,
    {
      resolve: (result: {
        snapshot: KeyboardDeviceSnapshot;
        backup: KeyboardKeymapBackup;
      }) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  connected = false;
  protocolReady = false;
  knobFineVolumeState: KnobFineVolumeState = 'disabled';
  knobFineVolumeError: string | null = null;
  knobKeymapBackup: KnobKeymapBackup | undefined;
  activeProfileId: ProfileId | null = null;
  keyboardSnapshot: KeyboardDeviceSnapshot | null = null;
  keyboardKeymapBackup: KeyboardKeymapBackup | undefined;

  start(
    enabled: boolean,
    backup: KnobKeymapBackup | undefined,
    keyboardSettings: KeyboardSettings,
    keyboardBackup: KeyboardKeymapBackup | undefined,
    keyboardMappingsEnabled: boolean
  ): void {
    this.worker = new Worker(path.join(__dirname, 'device-worker.js'), {
      workerData: {
        enabled,
        backup,
        keyboardSettings,
        keyboardBackup,
        keyboardMappingsEnabled,
      },
    });
    this.worker.on('message', (message: WorkerOutMessage) => {
      if (message.type === 'keyboardProfiles') {
        const request = this.keyboardRequests.get(message.requestId);
        if (!request) return;
        this.keyboardRequests.delete(message.requestId);
        clearTimeout(request.timer);
        if (message.snapshot) {
          this.keyboardSnapshot = structuredClone(message.snapshot);
          this.activeProfileId = message.snapshot.activeProfileId;
          request.resolve(message.snapshot);
        } else {
          request.reject(new Error(message.error ?? '키보드 프로필을 읽지 못했습니다.'));
        }
        return;
      }
      if (message.type === 'keyboardProfileSelected') {
        const request = this.profileRequests.get(message.requestId);
        if (!request) return;
        this.profileRequests.delete(message.requestId);
        clearTimeout(request.timer);
        if (message.profileId) {
          this.activeProfileId = message.profileId;
          if (this.keyboardSnapshot) {
            this.keyboardSnapshot.activeProfileId = message.profileId;
          }
          request.resolve(message.profileId);
        } else {
          request.reject(new Error(message.error ?? '키보드 프로필을 전환하지 못했습니다.'));
        }
        return;
      }
      if (message.type === 'keyboardMappingsConfigured') {
        const request = this.keyboardMappingRequests.get(message.requestId);
        if (!request) return;
        this.keyboardMappingRequests.delete(message.requestId);
        clearTimeout(request.timer);
        if (message.snapshot && message.backup) {
          this.keyboardSnapshot = structuredClone(message.snapshot);
          this.activeProfileId = message.snapshot.activeProfileId;
          this.keyboardKeymapBackup = structuredClone(message.backup);
          request.resolve({ snapshot: message.snapshot, backup: message.backup });
        } else {
          request.reject(new Error(message.error ?? '키보드 매핑을 적용하지 못했습니다.'));
        }
        return;
      }
      const previousBackup = JSON.stringify(this.knobKeymapBackup);
      const previousKeyboardBackup = JSON.stringify(this.keyboardKeymapBackup);
      this.connected = message.connected;
      this.protocolReady = message.protocolReady;
      this.knobFineVolumeState = message.knobFineVolumeState;
      this.knobFineVolumeError = message.knobFineVolumeError;
      this.knobKeymapBackup = message.knobKeymapBackup;
      this.activeProfileId = message.activeProfileId ?? null;
      this.keyboardKeymapBackup = message.keyboardKeymapBackup;
      if (message.keyboardSnapshot) {
        this.keyboardSnapshot = structuredClone(message.keyboardSnapshot);
      }
      if (
        this.knobKeymapBackup &&
        JSON.stringify(this.knobKeymapBackup) !== previousBackup
      ) {
        this.emit('knob-backup', this.knobKeymapBackup);
      }
      if (
        this.keyboardKeymapBackup &&
        JSON.stringify(this.keyboardKeymapBackup) !== previousKeyboardBackup
      ) {
        this.emit('keyboard-backup', this.keyboardKeymapBackup);
      }
      this.emit('status');
    });
    this.worker.on('error', (error) => console.error('[device-host] worker error', error));
    this.worker.on('exit', (code) => {
      if (code !== 0) console.error(`[device-host] worker exited with ${code}`);
      this.connected = false;
      this.protocolReady = false;
      this.knobFineVolumeState = 'disabled';
      this.activeProfileId = null;
      this.keyboardSnapshot = null;
      this.rejectKeyboardRequests('XPAD 장치 워커가 종료되었습니다.');
      this.rejectProfileRequests('XPAD 장치 워커가 종료되었습니다.');
      this.rejectKeyboardMappingRequests('XPAD 장치 워커가 종료되었습니다.');
      this.emit('status');
    });
  }

  setFrame(frame: Buffer): void {
    this.send({ type: 'setFrame', frame });
  }

  configureKnob(enabled: boolean, backup?: KnobKeymapBackup): void {
    this.send({ type: 'configureKnob', enabled, backup });
  }

  /** 워커의 HID 핸들을 강제로 닫았다 다시 열어 USB 재연결을 수동으로 유도한다. */
  reconnect(): void {
    this.send({ type: 'reconnect' });
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

  selectKeyboardProfile(profileId: ProfileId): Promise<ProfileId> {
    if (!this.worker || !this.connected || !this.protocolReady) {
      return Promise.reject(new Error('XPAD Mini 연결과 프로토콜 준비가 필요합니다.'));
    }
    const requestId = ++this.requestSequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.profileRequests.delete(requestId);
        reject(new Error('키보드 프로필 전환이 20초 안에 끝나지 않았습니다.'));
      }, 20_000);
      this.profileRequests.set(requestId, { resolve, reject, timer });
      try {
        this.worker?.postMessage({
          type: 'selectKeyboardProfile',
          requestId,
          profileId,
        } satisfies WorkerInMessage);
      } catch (error) {
        this.profileRequests.delete(requestId);
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  configureKeyboardMappings(
    settings: KeyboardSettings,
    backup?: KeyboardKeymapBackup
  ): Promise<{ snapshot: KeyboardDeviceSnapshot; backup: KeyboardKeymapBackup }> {
    if (!this.worker || !this.connected || !this.protocolReady) {
      return Promise.reject(new Error('XPAD Mini 연결과 프로토콜 준비가 필요합니다.'));
    }
    const requestId = ++this.requestSequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.keyboardMappingRequests.delete(requestId);
        reject(new Error('키보드 매핑 적용이 30초 안에 끝나지 않았습니다.'));
      }, 30_000);
      this.keyboardMappingRequests.set(requestId, { resolve, reject, timer });
      try {
        this.worker?.postMessage({
          type: 'configureKeyboardMappings',
          requestId,
          settings,
          backup,
        } satisfies WorkerInMessage);
      } catch (error) {
        this.keyboardMappingRequests.delete(requestId);
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  shutdown(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    this.rejectKeyboardRequests('앱이 종료되어 키보드 프로필 읽기를 중단했습니다.');
    this.rejectProfileRequests('앱이 종료되어 키보드 프로필 전환을 중단했습니다.');
    this.rejectKeyboardMappingRequests('앱이 종료되어 키보드 매핑 적용을 중단했습니다.');
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

  private rejectProfileRequests(message: string): void {
    for (const request of this.profileRequests.values()) {
      clearTimeout(request.timer);
      request.reject(new Error(message));
    }
    this.profileRequests.clear();
  }

  private rejectKeyboardMappingRequests(message: string): void {
    for (const request of this.keyboardMappingRequests.values()) {
      clearTimeout(request.timer);
      request.reject(new Error(message));
    }
    this.keyboardMappingRequests.clear();
  }
}
