import { EventEmitter } from 'node:events';
import HID from 'node-hid';

export const XPAD_VID = 0x3710;
export const XPAD_PID = 0x2507;
export const USAGE_PAGE_BULK = 0xff12;
export const USAGE_BULK = 0x02;

const RECONNECT_POLL_MS = 3000;

/** Opens only the XPAD Mini vendor bulk collection used for RAM framebuffer writes. */
export class XpadDevice extends EventEmitter {
  private pollTimer: NodeJS.Timeout | null = null;
  private _bulk: HID.HID | null = null;
  private _connected = false;

  get connected(): boolean {
    return this._connected;
  }

  get bulk(): HID.HID | null {
    return this._bulk;
  }

  start(): void {
    this.tryOpen();
    this.pollTimer = setInterval(() => {
      if (!this._connected) this.tryOpen();
    }, RECONNECT_POLL_MS);
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.close();
  }

  private tryOpen(): void {
    try {
      const info = HID.devices().find(
        (device) =>
          device.vendorId === XPAD_VID &&
          device.productId === XPAD_PID &&
          device.usagePage === USAGE_PAGE_BULK &&
          device.usage === USAGE_BULK
      );
      if (!info?.path) return;
      // XPAD Mini is a composite keyboard/HID device. macOS requires the
      // non-exclusive open mode so the OS can grant Input Monitoring access.
      this._bulk = new HID.HID(info.path, { nonExclusive: true });
      this._bulk.on('error', () => this.onError());
      this._connected = true;
      console.log('[hid] XPAD Mini bulk channel connected');
      this.emit('connect');
    } catch (error) {
      console.error('[hid] XPAD Mini open failed', error);
      this.close();
    }
  }

  private onError(): void {
    if (!this._connected) return;
    console.log('[hid] XPAD Mini disconnected');
    this.close();
    this.emit('disconnect');
  }

  private close(): void {
    this._connected = false;
    try {
      this._bulk?.close();
    } catch {
      // Already closed by the operating system.
    }
    this._bulk = null;
  }
}
