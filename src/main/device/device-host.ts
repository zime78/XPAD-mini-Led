import { EventEmitter } from 'node:events';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type {
  KnobFineVolumeState,
  KnobKeymapBackup,
} from '../../shared/types';
import type { WorkerInMessage, WorkerOutMessage } from './device-worker';

export class DeviceHost extends EventEmitter {
  private worker: Worker | null = null;
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
      if (message.type !== 'status') return;
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
      this.emit('status');
    });
  }

  setFrame(frame: Buffer): void {
    this.send({ type: 'setFrame', frame });
  }

  configureKnob(enabled: boolean, backup?: KnobKeymapBackup): void {
    this.send({ type: 'configureKnob', enabled, backup });
  }

  shutdown(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
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
}
