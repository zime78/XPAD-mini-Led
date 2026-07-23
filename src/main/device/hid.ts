import { EventEmitter } from 'node:events';
import HID from 'node-hid';

export const XPAD_VID = 0x3710;
export const XPAD_PID = 0x2507;
export const USAGE_PAGE_BULK = 0xff12;
export const USAGE_BULK = 0x02;

const RECONNECT_POLL_MS = 3000;
const MISS_STREAK_LIMIT = 2;
const WRITE_FAIL_LIMIT = 5;

/** Opens only the XPAD Mini vendor bulk collection used for RAM framebuffer writes. */
export class XpadDevice extends EventEmitter {
  private pollTimer: NodeJS.Timeout | null = null;
  private _bulk: HID.HID | null = null;
  private _connected = false;
  private missStreak = 0;
  private writeFailStreak = 0;

  get connected(): boolean {
    return this._connected;
  }

  get bulk(): HID.HID | null {
    return this._bulk;
  }

  start(): void {
    this.tryOpen();
    this.pollTimer = setInterval(() => this.poll(), RECONNECT_POLL_MS);
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.close();
  }

  /** 사용자 요청으로 현재 핸들을 강제로 닫고 즉시 다시 연다(재연결 버튼용). */
  reconnect(): void {
    // 현재 핸들을 강제로 닫고(연결 상태였으면 disconnect 통지 → 프로토콜 reset) 즉시 다시 연다.
    this.handleDisconnect();
    this.tryOpen();
  }

  /**
   * 장치 write 성공/실패를 보고받아 연속 실패로 물리 분리를 감지한다.
   * macOS는 USB 분리 후에도 HID.devices() enumeration에 장치를 한동안 남기므로
   * enumeration만으로는 분리를 못 잡는다(실측). 실제 write 실패가 더 신뢰할 수 있는 신호다.
   */
  reportWriteHealth(ok: boolean): void {
    if (ok) {
      this.writeFailStreak = 0;
      return;
    }
    if (!this._connected) return;
    if (++this.writeFailStreak >= WRITE_FAIL_LIMIT) {
      this.writeFailStreak = 0;
      console.log('[hid] write 연속 실패 → 장치 분리로 판정');
      this.handleDisconnect();
    }
  }

  /** 3초 폴링 콜백: 연결 중이면 stale 핸들을 검사하고, 아니면 열기를 시도한다. */
  private poll(): void {
    if (this._connected) {
      // 평상시 read 루프가 꺼져 있어 'error' 이벤트로는 분리를 감지할 수 없다.
      // enumeration으로 확인하되, macOS HID.devices()의 간헐적 누락을 오탐하지 않도록
      // 2회 연속(≈6초) miss일 때만 stale로 판정한다. 오탐을 막으면서도
      // 실제 분리는 수동 재연결 버튼으로 즉시 복구할 수 있다.
      if (this.findBulkInfo()) {
        this.missStreak = 0;
      } else if (++this.missStreak >= MISS_STREAK_LIMIT) {
        this.missStreak = 0;
        this.handleDisconnect();
      }
      return;
    }
    this.missStreak = 0;
    this.tryOpen();
  }

  /** XPAD Mini의 vendor bulk 컬렉션(VID/PID·usagePage 0xFF12·usage 0x02) 엔트리를 enumeration에서 찾는다. */
  private findBulkInfo(): HID.Device | null {
    return (
      HID.devices().find(
        (device) =>
          device.vendorId === XPAD_VID &&
          device.productId === XPAD_PID &&
          device.usagePage === USAGE_PAGE_BULK &&
          device.usage === USAGE_BULK
      ) ?? null
    );
  }

  /** bulk 컬렉션 핸들을 열어 연결 상태로 전환한다(장치가 없으면 조용히 반환). */
  private tryOpen(): void {
    try {
      const info = this.findBulkInfo();
      if (!info?.path) return;
      // XPAD Mini is a composite keyboard/HID device. macOS requires the
      // non-exclusive open mode so the OS can grant Input Monitoring access.
      this._bulk = new HID.HID(info.path, { nonExclusive: true });
      this._bulk.on('error', () => this.handleDisconnect());
      this._connected = true;
      console.log('[hid] XPAD Mini bulk channel connected');
      this.emit('connect');
    } catch (error) {
      console.error('[hid] XPAD Mini open failed', error);
      this.close();
    }
  }

  /** 핸들을 닫고 필요 시 disconnect 이벤트를 발생시킨다(read 루프 'error'·polling·reconnect 공통 경로). */
  private handleDisconnect(): void {
    if (!this._connected && !this._bulk) return;
    const wasConnected = this._connected;
    this.missStreak = 0;
    this.writeFailStreak = 0;
    this.close();
    if (wasConnected) {
      console.log('[hid] XPAD Mini disconnected');
      this.emit('disconnect');
    }
  }

  private close(): void {
    this._connected = false;
    try {
      // reconnect 반복 시 'error' 리스너가 잔류하지 않도록 명시적으로 정리한다.
      this._bulk?.removeAllListeners('error');
      this._bulk?.close();
    } catch {
      // Already closed by the operating system.
    }
    this._bulk = null;
  }
}
