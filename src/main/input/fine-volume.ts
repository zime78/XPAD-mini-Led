import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { globalShortcut } from 'electron';
import { DiagnosticLog } from '../diagnostic-log';

const VOLUME_DOWN_ACCELERATOR = 'F20';
const VOLUME_UP_ACCELERATOR = 'F19';

export interface FineVolumeAdjustment {
  volume: number;
}

interface VolumeAdjustmentResult {
  before: number;
  target: number;
  after: number;
  requestedSteps: number;
  movedSteps: number;
  attemptCount: number;
}

type FineVolumeAdjuster = (
  detents: number,
  stepsPerDetent: number
) => Promise<VolumeAdjustmentResult>;

export class FineVolumeController extends EventEmitter {
  private stepsPerDetent = 1;
  private registered = false;
  private pendingDetents = 0;
  private adjusting = false;
  private lastShortcutAt = 0;
  private adjustmentSequence = 0;
  lastError: string | null = null;

  constructor(
    private diagnostics: Pick<DiagnosticLog, 'log'>,
    private adjustVolume: FineVolumeAdjuster = adjustSystemVolume
  ) {
    super();
  }

  configure(enabled: boolean, stepsPerDetent: number): boolean {
    this.stepsPerDetent = Math.min(
      5,
      Math.max(1, Math.round(stepsPerDetent) || 1)
    );
    this.diagnostics.log('fine-volume-configure', {
      enabled,
      stepsPerDetent: this.stepsPerDetent,
      alreadyRegistered: this.registered,
    });
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
      this.receiveShortcut('down', -1);
    });
    const upRegistered = globalShortcut.register(VOLUME_UP_ACCELERATOR, () => {
      this.receiveShortcut('up', 1);
    });
    this.diagnostics.log('shortcut-registration', {
      downRegistered,
      upRegistered,
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
    this.pendingDetents = 0;
    this.diagnostics.log('shortcut-unregistered');
  }

  private receiveShortcut(direction: 'down' | 'up', detentDelta: number): void {
    const now = Date.now();
    const pendingBefore = this.pendingDetents;
    this.pendingDetents += detentDelta;
    this.diagnostics.log('shortcut-received', {
      direction,
      detentDelta,
      pendingBefore,
      pendingAfter: this.pendingDetents,
      stepsPerDetent: this.stepsPerDetent,
      adjusting: this.adjusting,
      sincePreviousMs: this.lastShortcutAt === 0 ? -1 : now - this.lastShortcutAt,
    });
    this.lastShortcutAt = now;
    if (!this.adjusting) void this.drainAdjustments();
  }

  private async drainAdjustments(): Promise<void> {
    this.adjusting = true;
    try {
      while (this.pendingDetents !== 0) {
        const detents = this.pendingDetents;
        const stepsPerDetent = this.stepsPerDetent;
        this.pendingDetents = 0;
        const adjustmentId = ++this.adjustmentSequence;
        const startedAt = Date.now();
        this.diagnostics.log('adjustment-started', {
          adjustmentId,
          detents,
          stepsPerDetent,
          requestedSteps: Math.abs(detents) * stepsPerDetent,
        });
        const result = await this.adjustVolume(detents, stepsPerDetent);
        this.diagnostics.log('adjustment-completed', {
          adjustmentId,
          detents,
          stepsPerDetent,
          requestedSteps: result.requestedSteps,
          movedSteps: result.movedSteps,
          attemptCount: result.attemptCount,
          before: result.before,
          target: result.target,
          after: result.after,
          changed: result.before !== result.after,
          appliedAsRequested: result.target === result.after,
          atBoundary:
            result.movedSteps < result.requestedSteps &&
            (result.target === 0 || result.target === 100),
          durationMs: Date.now() - startedAt,
        });
        this.setError(null);
        const adjustment: FineVolumeAdjustment = {
          volume: Math.min(100, Math.max(0, Math.round(result.after))),
        };
        this.emit('volume-adjusted', adjustment);
      }
    } catch (error) {
      const discardedDetents = this.pendingDetents;
      this.pendingDetents = 0;
      this.diagnostics.log('adjustment-failed', {
        discardedDetents,
        message: error instanceof Error ? error.message : String(error),
      });
      this.setError(
        `미세 볼륨 조절 실패: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      this.adjusting = false;
      if (this.pendingDetents !== 0) void this.drainAdjustments();
    }
  }

  private setError(error: string | null): void {
    if (this.lastError === error) return;
    this.lastError = error;
    this.emit('status');
  }
}

function adjustSystemVolume(
  detents: number,
  stepsPerDetent: number
): Promise<VolumeAdjustmentResult> {
  const direction = Math.sign(detents);
  const requestedSteps =
    Math.abs(Math.trunc(detents)) * Math.max(1, Math.trunc(stepsPerDetent));
  const script = [
    'set currentSettings to get volume settings',
    'set initialVolume to output volume of currentSettings',
    'set appliedVolume to initialVolume',
    'set targetVolume to initialVolume',
    'set movedSteps to 0',
    'set attemptCount to 0',
    `repeat ${requestedSteps} times`,
    'set stepStartVolume to appliedVolume',
    `set targetVolume to stepStartVolume + (${direction})`,
    'if targetVolume < 0 then set targetVolume to 0',
    'if targetVolume > 100 then set targetVolume to 100',
    'set volume output volume targetVolume',
    'set attemptCount to attemptCount + 1',
    'set appliedVolume to output volume of (get volume settings)',
    'repeat while appliedVolume = stepStartVolume and targetVolume > 0 and targetVolume < 100',
    `set targetVolume to targetVolume + (${direction})`,
    'if targetVolume < 0 then set targetVolume to 0',
    'if targetVolume > 100 then set targetVolume to 100',
    'set volume output volume targetVolume',
    'set attemptCount to attemptCount + 1',
    'set appliedVolume to output volume of (get volume settings)',
    'end repeat',
    'if appliedVolume is not stepStartVolume then set movedSteps to movedSteps + 1',
    'end repeat',
    'return (initialVolume as text) & "," & (targetVolume as text) & "," & (appliedVolume as text) & "," & (movedSteps as text) & "," & (attemptCount as text)',
  ].join('\n');

  return new Promise((resolve, reject) => {
    execFile(
      '/usr/bin/osascript',
      ['-e', script],
      { timeout: 2000 },
      (error, stdout) => {
        if (error) return reject(error);
        const [before, target, after, movedSteps, attemptCount] = String(stdout)
          .trim()
          .split(',')
          .map(Number);
        if (
          ![before, target, after, movedSteps, attemptCount].every(Number.isFinite)
        ) {
          return reject(new Error('볼륨 조절 결과를 해석하지 못했습니다.'));
        }
        resolve({ before, target, after, requestedSteps, movedSteps, attemptCount });
      }
    );
  });
}
