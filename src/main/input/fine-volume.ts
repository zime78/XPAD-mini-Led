import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { globalShortcut } from 'electron';

const VOLUME_DOWN_ACCELERATOR = 'F20';
const VOLUME_UP_ACCELERATOR = 'F19';

export class FineVolumeController extends EventEmitter {
  private stepPercent = 1;
  private registered = false;
  private pendingDelta = 0;
  private adjusting = false;
  lastError: string | null = null;

  configure(enabled: boolean, stepPercent: number): boolean {
    this.stepPercent = Math.min(5, Math.max(1, Math.round(stepPercent) || 1));
    if (!enabled) {
      this.unregister();
      this.setError(null);
      return true;
    }
    if (this.registered) {
      this.setError(null);
      return true;
    }

    const downRegistered = globalShortcut.register(VOLUME_DOWN_ACCELERATOR, () => {
      this.queueAdjustment(-this.stepPercent);
    });
    const upRegistered = globalShortcut.register(VOLUME_UP_ACCELERATOR, () => {
      this.queueAdjustment(this.stepPercent);
    });
    if (!downRegistered || !upRegistered) {
      globalShortcut.unregister(VOLUME_DOWN_ACCELERATOR);
      globalShortcut.unregister(VOLUME_UP_ACCELERATOR);
      this.registered = false;
      this.setError('XPAD 노브용 F20/F19 단축키를 등록하지 못했습니다.');
      return false;
    }

    this.registered = true;
    this.setError(null);
    return true;
  }

  dispose(): void {
    this.unregister();
    this.removeAllListeners();
  }

  private unregister(): void {
    if (!this.registered) return;
    globalShortcut.unregister(VOLUME_DOWN_ACCELERATOR);
    globalShortcut.unregister(VOLUME_UP_ACCELERATOR);
    this.registered = false;
    this.pendingDelta = 0;
  }

  private queueAdjustment(delta: number): void {
    this.pendingDelta += delta;
    if (!this.adjusting) void this.drainAdjustments();
  }

  private async drainAdjustments(): Promise<void> {
    this.adjusting = true;
    try {
      while (this.pendingDelta !== 0) {
        const delta = this.pendingDelta;
        this.pendingDelta = 0;
        await adjustSystemVolume(delta);
        this.setError(null);
      }
    } catch (error) {
      this.pendingDelta = 0;
      this.setError(
        `미세 볼륨 조절 실패: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      this.adjusting = false;
      if (this.pendingDelta !== 0) void this.drainAdjustments();
    }
  }

  private setError(error: string | null): void {
    if (this.lastError === error) return;
    this.lastError = error;
    this.emit('status');
  }
}

function adjustSystemVolume(delta: number): Promise<void> {
  const integerDelta = Math.trunc(delta);
  const script = [
    'set currentSettings to get volume settings',
    'set currentVolume to output volume of currentSettings',
    `set targetVolume to currentVolume + (${integerDelta})`,
    'if targetVolume < 0 then set targetVolume to 0',
    'if targetVolume > 100 then set targetVolume to 100',
    'set volume output volume targetVolume',
  ].join('\n');

  return new Promise((resolve, reject) => {
    execFile('/usr/bin/osascript', ['-e', script], { timeout: 2000 }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
