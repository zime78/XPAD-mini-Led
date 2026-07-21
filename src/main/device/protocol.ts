import type { KnobKeymapBackup } from '../../shared/types';
import { XpadDevice } from './hid';

export const LCD_WIDTH = 240;
export const LCD_HEIGHT = 135;

const PACKET_SIZE = 1024;
const REPORT_ID = 0x22;
const APPLICATION_ECHO = 0x04;
const CMD_SCREEN_INFO = 0x02;
const CMD_KEY_INFO = 0x10;
const CMD_DISPLAY = 0x25;
const KEY_INFO_SIZE = 56;
const KEY_OUTPUT_TYPE_OFFSET = 16;
const KEY_ACTION_OFFSET = 20;
const KEY_ACTION_SIZE = 4;
const KEY_MODIFIER_OFFSET = 20;
const KEY_KEYCODE_OFFSET = 21;
const KEY_OUTPUT_KEYBOARD = 0;
const KEY_OUTPUT_EXTENDED = 3;
const KNOB_LEFT_INDEX = 15;
const KNOB_RIGHT_INDEX = 14;
const F20_USAGE = 0x6f;
const F19_USAGE = 0x6e;
const LEGACY_F21_USAGE = 0x70;
const EXTENDED_VOLUME_UP = 10;
const EXTENDED_VOLUME_DOWN = 11;

export interface KnobMappingResult {
  state: 'disabled' | 'active';
  backup?: KnobKeymapBackup;
}

/**
 * Minimal Sayo API v2 client for the XPAD Mini.
 * It verifies ScreenInfo, writes RGB565 frames, and can temporarily map the
 * two knob directions through KeyInfo. Save (0x0D), flash, LED and bootloader
 * commands remain intentionally absent, so all writes are RAM-only.
 */
export class XpadProtocol {
  private _ready = false;
  private lastFrame: Buffer | null = null;
  private framesUntilFull = 0;
  private lastLcdWrite = 0;
  private lastError = 0;
  onReady: (() => void) | null = null;

  constructor(private device: XpadDevice) {
    device.on('connect', () => {
      this.reset();
      void this.verify();
    });
    device.on('disconnect', () => this.reset());
  }

  get ready(): boolean {
    return this._ready;
  }

  private reset(): void {
    this._ready = false;
    this.lastFrame = null;
    this.framesUntilFull = 0;
    this.lastLcdWrite = 0;
  }

  private async verify(): Promise<void> {
    const device = this.device.bulk;
    if (!device) return;
    const onData = (data: Buffer) => {
      const packet = Buffer.from(data);
      if (packet[0] !== REPORT_ID || packet[6] !== CMD_SCREEN_INFO) return;
      const width = packet.readUInt16LE(8);
      const height = packet.readUInt16LE(10);
      device.removeListener('data', onData);
      if (width !== LCD_WIDTH || height !== LCD_HEIGHT) {
        console.error(`[protocol] unexpected screen ${width}x${height}`);
        return;
      }
      this._ready = true;
      console.log(`[protocol] ScreenInfo ${width}x${height} — RAM streaming ready`);
      this.onReady?.();
    };
    try {
      device.on('data', onData);
      device.write(this.buildPacket(CMD_SCREEN_INFO, Buffer.alloc(0)));
      setTimeout(() => device.removeListener('data', onData), 2000);
    } catch (error) {
      device.removeListener('data', onData);
      console.error('[protocol] ScreenInfo failed', error);
    }
  }

  async configureKnobFineVolume(
    enabled: boolean,
    storedBackup?: KnobKeymapBackup
  ): Promise<KnobMappingResult> {
    if (!this._ready) throw new Error('XPAD 프로토콜이 준비되지 않았습니다.');

    const currentLeft = await this.readKeyInfoWithRetry(KNOB_LEFT_INDEX);
    const currentRight = await this.readKeyInfoWithRetry(KNOB_RIGHT_INDEX);
    if (!currentLeft || !currentRight) {
      throw new Error('XPAD 노브 KeyInfo를 읽지 못했습니다.');
    }

    const decodedLeft = decodeKeyInfo(storedBackup?.left);
    const decodedRight = decodeKeyInfo(storedBackup?.right);
    const savedLeft = isExtendedMapping(decodedLeft, EXTENDED_VOLUME_DOWN)
      ? decodedLeft
      : null;
    const savedRight = isExtendedMapping(decodedRight, EXTENDED_VOLUME_UP)
      ? decodedRight
      : null;
    const leftMapped = isKeyboardMapping(currentLeft, F20_USAGE);
    const rightMapped = isKeyboardMapping(currentRight, F19_USAGE);
    const rightLegacyMapped = isKeyboardMapping(currentRight, LEGACY_F21_USAGE);

    if (!enabled) {
      const restoreLeft = leftMapped ? savedLeft : null;
      const restoreRight = rightMapped || rightLegacyMapped ? savedRight : null;
      if (leftMapped && !restoreLeft) {
        throw new Error('왼쪽 노브 원본 백업이 없어 안전하게 복원할 수 없습니다.');
      }
      if ((rightMapped || rightLegacyMapped) && !restoreRight) {
        throw new Error('오른쪽 노브 원본 백업이 없어 안전하게 복원할 수 없습니다.');
      }
      await this.applyKnobEntries(
        currentLeft,
        currentRight,
        restoreLeft ?? currentLeft,
        restoreRight ?? currentRight
      );
      return { state: 'disabled', ...(storedBackup ? { backup: storedBackup } : {}) };
    }

    if (!leftMapped && !isExtendedMapping(currentLeft, EXTENDED_VOLUME_DOWN)) {
      throw new Error(
        `왼쪽 노브가 예상한 Vol- 또는 앱 매핑 상태가 아닙니다 (${describeKeyInfoAction(currentLeft)}).`
      );
    }
    if (
      !rightMapped &&
      !rightLegacyMapped &&
      !isExtendedMapping(currentRight, EXTENDED_VOLUME_UP)
    ) {
      throw new Error(
        `오른쪽 노브가 예상한 Vol+ 또는 앱 매핑 상태가 아닙니다 (${describeKeyInfoAction(currentRight)}).`
      );
    }

    // 초기 F21 기반 빌드를 포함해 앱 전용 매핑만 출고 Vol-/Vol+
    // 엔트리로 안전하게 복구한다.
    const backupLeft =
      savedLeft ??
      (leftMapped
        ? makeExtendedMapping(currentLeft, EXTENDED_VOLUME_DOWN)
        : currentLeft);
    const backupRight =
      savedRight ??
      (rightMapped || rightLegacyMapped
        ? makeExtendedMapping(currentRight, EXTENDED_VOLUME_UP)
        : currentRight);

    const backup: KnobKeymapBackup = {
      left: backupLeft.toString('base64'),
      right: backupRight.toString('base64'),
    };
    await this.applyKnobEntries(
      currentLeft,
      currentRight,
      leftMapped ? currentLeft : makeKeyboardMapping(currentLeft, F20_USAGE),
      rightMapped ? currentRight : makeKeyboardMapping(currentRight, F19_USAGE)
    );
    return { state: 'active', backup };
  }

  private async applyKnobEntries(
    currentLeft: Buffer,
    currentRight: Buffer,
    targetLeft: Buffer,
    targetRight: Buffer
  ): Promise<void> {
    let leftWriteAttempted = false;
    try {
      if (!currentLeft.equals(targetLeft)) {
        leftWriteAttempted = true;
        await this.writeKeyInfo(KNOB_LEFT_INDEX, targetLeft);
      }
      if (!currentRight.equals(targetRight)) {
        await this.writeKeyInfo(KNOB_RIGHT_INDEX, targetRight);
      }
    } catch (error) {
      if (leftWriteAttempted) {
        try {
          await this.writeKeyInfo(KNOB_LEFT_INDEX, currentLeft);
        } catch (rollbackError) {
          console.error('[protocol] knob remap rollback failed', rollbackError);
        }
      }
      throw error;
    }
  }

  private async readKeyInfoWithRetry(index: number): Promise<Buffer | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const entry = await this.readKeyInfo(index);
      if (entry) return entry;
    }
    return null;
  }

  private readKeyInfo(index: number): Promise<Buffer | null> {
    const device = this.device.bulk;
    if (!device) return Promise.resolve(null);
    return new Promise((resolve) => {
      let finished = false;
      const finish = (entry: Buffer | null) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        device.removeListener('data', onData);
        resolve(entry);
      };
      const onData = (data: Buffer) => {
        const packet = Buffer.from(data);
        if (
          packet[0] !== REPORT_ID ||
          packet[6] !== CMD_KEY_INFO ||
          packet[7] !== index
        ) {
          return;
        }
        const payloadLength = packet.readUInt16LE(4) - 4;
        if (payloadLength !== KEY_INFO_SIZE) return finish(null);
        finish(Buffer.from(packet.subarray(8, 8 + KEY_INFO_SIZE)));
      };
      const timer = setTimeout(() => finish(null), 800);
      device.on('data', onData);
      if (
        !this.tryWrite(
          device,
          this.buildPacket(CMD_KEY_INFO, Buffer.alloc(0), index),
          'KeyInfo 읽기'
        )
      ) {
        finish(null);
      }
    });
  }

  private async writeKeyInfo(index: number, entry: Buffer): Promise<void> {
    if (entry.length !== KEY_INFO_SIZE) throw new Error('잘못된 KeyInfo 길이입니다.');
    const device = this.device.bulk;
    if (!device) throw new Error('XPAD 장치 연결이 끊겼습니다.');
    if (!this.tryWrite(device, this.buildPacket(CMD_KEY_INFO, entry, index), 'KeyInfo 쓰기')) {
      throw new Error(`노브 KeyInfo ${index} 쓰기에 실패했습니다.`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    const readback = await this.readKeyInfoWithRetry(index);
    if (!readback || !hasSameKeyAction(readback, entry)) {
      throw new Error(`노브 KeyInfo ${index} readback 검증에 실패했습니다.`);
    }
  }

  async drawLcdFrame(rgb565: Buffer): Promise<void> {
    const device = this.device.bulk;
    if (!device || !this._ready) return;
    if (rgb565.length !== LCD_WIDTH * LCD_HEIGHT * 2) {
      throw new Error(`Invalid LCD frame length: ${rgb565.length}`);
    }

    const chunkSize = PACKET_SIZE - 12;
    const force = this.lastFrame === null || this.framesUntilFull <= 0;
    this.framesUntilFull = force ? 300 : this.framesUntilFull - 1;
    let sent = 0;

    for (let offset = 0; offset < rgb565.length; offset += chunkSize) {
      const length = Math.min(chunkSize, rgb565.length - offset);
      if (
        !force &&
        this.lastFrame &&
        rgb565.compare(this.lastFrame, offset, offset + length, offset, offset + length) === 0
      ) {
        continue;
      }
      const payload = Buffer.alloc(4 + length);
      payload.writeUInt32LE(offset, 0);
      rgb565.copy(payload, 4, offset, offset + length);
      if (!this.tryWrite(device, this.buildPacket(CMD_DISPLAY, payload), 'LCD 쓰기')) {
        this.lastFrame = null;
        return;
      }
      sent++;
      await new Promise<void>((resolve) =>
        sent % 6 === 0 ? setTimeout(resolve, 4) : setImmediate(resolve)
      );
    }

    if (sent === 0 && Date.now() - this.lastLcdWrite > 250) {
      const length = Math.min(chunkSize, rgb565.length);
      const payload = Buffer.alloc(4 + length);
      payload.writeUInt32LE(0, 0);
      rgb565.copy(payload, 4, 0, length);
      sent = this.tryWrite(device, this.buildPacket(CMD_DISPLAY, payload), 'LCD keep-alive')
        ? 1
        : 0;
    }
    if (sent > 0) this.lastLcdWrite = Date.now();
    this.lastFrame = Buffer.from(rgb565);
  }

  private buildPacket(command: number, payload: Buffer, index = 0): Buffer {
    const packet = Buffer.alloc(PACKET_SIZE);
    packet[0] = REPORT_ID;
    packet[1] = APPLICATION_ECHO;
    packet.writeUInt16LE(payload.length + 4, 4);
    packet[6] = command;
    packet[7] = index;
    payload.copy(packet, 8);
    const usedLength = 8 + payload.length + (payload.length % 2);
    let checksum = 0;
    for (let offset = 0; offset < usedLength; offset += 2) {
      checksum = (checksum + packet.readUInt16LE(offset)) & 0xffff;
    }
    packet.writeUInt16LE(checksum, 2);
    return packet;
  }

  private tryWrite(
    device: NonNullable<XpadDevice['bulk']>,
    packet: Buffer,
    context: string
  ): boolean {
    try {
      device.write(packet);
      return true;
    } catch (error) {
      const now = Date.now();
      if (now - this.lastError > 5000) {
        this.lastError = now;
        console.error(`[protocol] ${context} failed`, error);
      }
      return false;
    }
  }
}

function decodeKeyInfo(value: string | undefined): Buffer | null {
  if (!value) return null;
  try {
    const entry = Buffer.from(value, 'base64');
    return entry.length === KEY_INFO_SIZE ? entry : null;
  } catch {
    return null;
  }
}

function isKeyboardMapping(entry: Buffer, usage: number): boolean {
  return (
    entry.readUInt32LE(KEY_OUTPUT_TYPE_OFFSET) === KEY_OUTPUT_KEYBOARD &&
    entry[KEY_MODIFIER_OFFSET] === 0 &&
    entry[KEY_KEYCODE_OFFSET] === usage &&
    entry[KEY_KEYCODE_OFFSET + 1] === 0 &&
    entry[KEY_KEYCODE_OFFSET + 2] === 0
  );
}

function isExtendedMapping(entry: Buffer | null, action: number): entry is Buffer {
  return (
    entry !== null &&
    entry.readUInt32LE(KEY_OUTPUT_TYPE_OFFSET) === KEY_OUTPUT_EXTENDED &&
    entry[KEY_MODIFIER_OFFSET] === action &&
    entry[KEY_MODIFIER_OFFSET + 1] === 0 &&
    entry[KEY_MODIFIER_OFFSET + 2] === 0 &&
    entry[KEY_MODIFIER_OFFSET + 3] === 0
  );
}

function hasSameKeyAction(actual: Buffer, expected: Buffer): boolean {
  const expectedType = expected.readUInt32LE(KEY_OUTPUT_TYPE_OFFSET);
  if (expectedType === KEY_OUTPUT_KEYBOARD) {
    return isKeyboardMapping(actual, expected[KEY_KEYCODE_OFFSET]);
  }
  if (expectedType === KEY_OUTPUT_EXTENDED) {
    return isExtendedMapping(actual, expected[KEY_MODIFIER_OFFSET]);
  }
  return false;
}

function makeKeyboardMapping(entry: Buffer, usage: number): Buffer {
  const mapped = Buffer.from(entry);
  mapped.writeUInt32LE(KEY_OUTPUT_KEYBOARD, KEY_OUTPUT_TYPE_OFFSET);
  mapped.fill(0, KEY_ACTION_OFFSET, KEY_ACTION_OFFSET + KEY_ACTION_SIZE);
  mapped[KEY_KEYCODE_OFFSET] = usage;
  return mapped;
}

function makeExtendedMapping(entry: Buffer, action: number): Buffer {
  const mapped = Buffer.from(entry);
  mapped.writeUInt32LE(KEY_OUTPUT_EXTENDED, KEY_OUTPUT_TYPE_OFFSET);
  mapped.fill(0, KEY_ACTION_OFFSET, KEY_ACTION_OFFSET + KEY_ACTION_SIZE);
  mapped[KEY_MODIFIER_OFFSET] = action;
  return mapped;
}

function describeKeyInfoAction(entry: Buffer): string {
  return `class=${entry.readUInt32LE(0)}, output=${entry.readUInt32LE(KEY_OUTPUT_TYPE_OFFSET)}, action=${entry
    .subarray(KEY_ACTION_OFFSET, KEY_ACTION_OFFSET + KEY_ACTION_SIZE)
    .toString('hex')}`;
}
