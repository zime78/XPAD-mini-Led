import {
  createFixedProfileOne,
  EDITABLE_PROFILE_IDS,
  KEYBOARD_SLOTS,
  PROFILE_IDS,
  type EditableProfileId,
  type KeyboardDeviceSnapshot,
  type KeyboardKeymapBackup,
  type KeyboardProfileSettings,
  type KeyboardSettings,
  type KeyboardSlot,
  type KnobKeymapBackup,
  type ProfileId,
} from '../../shared/types';
import { XpadDevice } from './hid';
import {
  decodeKeyboardAction,
  encodeKeyboardAction,
  KEY_ACTION_OFFSET,
  KEY_INFO_SIZE,
  KEY_OUTPUT_EXTENDED,
  KEY_OUTPUT_KEYBOARD,
  KEY_OUTPUT_TYPE_OFFSET,
  SLOT_KEY_INFO_INDEX,
  SLOT_SHORTCUT_KEY,
} from './keyboard-profile-codec';

export const LCD_WIDTH = 240;
export const LCD_HEIGHT = 135;

const PACKET_SIZE = 1024;
const REPORT_ID = 0x22;
const APPLICATION_ECHO = 0x04;
const CMD_SCREEN_INFO = 0x02;
const CMD_KEY_INFO = 0x10;
const CMD_DISPLAY = 0x25;
const KEY_ACTION_SIZE = 4;
const KEY_MODIFIER_OFFSET = 20;
const KEY_KEYCODE_OFFSET = 21;
const SYSTEM_INFO_SIZE = 44;
const SYSTEM_INFO_CONFIG_OFFSET = 5;
const SYSTEM_INFO_CONFIG_RANGE_MASK = 0xf0;
const SYSTEM_INFO_CONFIG_SELECTION_MASK = 0x0f;
const PROFILE_SWITCH_DELAY_MS = 80;
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

export interface KeyboardMappingResult {
  state: 'disabled' | 'active';
  backup: KeyboardKeymapBackup;
  snapshot: KeyboardDeviceSnapshot;
}

type KeyboardEntryMatrix = Record<
  EditableProfileId,
  Record<KeyboardSlot, Buffer>
>;

/**
 * Minimal Sayo API v2 client for the XPAD Mini.
 * It verifies ScreenInfo, selects the active RAM profile, writes RGB565 frames,
 * and can temporarily map the two knob directions and Profile 2~5 bottom keys
 * through KeyInfo. Save (0x0D), flash, LED and bootloader commands remain
 * intentionally absent, so all writes are RAM-only.
 */
export class XpadProtocol {
  private _ready = false;
  private _activeProfileId: ProfileId | null = null;
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

  get activeProfileId(): ProfileId | null {
    return this._activeProfileId;
  }

  private reset(): void {
    this._ready = false;
    this._activeProfileId = null;
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
      try {
        this._activeProfileId = (
          profileIndexFromSystemInfo(packet.subarray(8, 8 + SYSTEM_INFO_SIZE)) + 1
        ) as ProfileId;
      } catch {
        this._activeProfileId = null;
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

  async readKeyboardProfiles(): Promise<KeyboardDeviceSnapshot> {
    if (!this._ready) throw new Error('XPAD 프로토콜이 준비되지 않았습니다.');

    const originalSystemInfo = await this.readSystemInfoWithRetry();
    if (!originalSystemInfo) throw new Error('XPAD SystemInfo를 읽지 못했습니다.');
    const originalProfileIndex = profileIndexFromSystemInfo(originalSystemInfo);
    const profiles = {
      1: createFixedProfileOne(),
    } as Record<ProfileId, KeyboardProfileSettings>;
    let currentSystemInfo = originalSystemInfo;
    let scanError: unknown = null;
    let restoreError: unknown = null;

    try {
      for (const profileId of EDITABLE_PROFILE_IDS) {
        const profileIndex = profileId - 1;
        if (profileIndexFromSystemInfo(currentSystemInfo) !== profileIndex) {
          currentSystemInfo = await this.switchProfile(currentSystemInfo, profileIndex);
        }

        const assignments = {} as KeyboardProfileSettings['assignments'];
        for (const slot of KEYBOARD_SLOTS) {
          const entry = await this.readKeyInfoWithRetry(SLOT_KEY_INFO_INDEX[slot]);
          if (!entry) {
            throw new Error(`Profile ${profileId} ${slot} 버튼 KeyInfo를 읽지 못했습니다.`);
          }
          assignments[slot] = decodeKeyboardAction(entry);
        }
        profiles[profileId] = { id: profileId, assignments };
      }
    } catch (error) {
      scanError = error;
    } finally {
      try {
        const latestSystemInfo = (await this.readSystemInfoWithRetry()) ?? currentSystemInfo;
        if (profileIndexFromSystemInfo(latestSystemInfo) !== originalProfileIndex) {
          await this.switchProfile(latestSystemInfo, originalProfileIndex);
        }
      } catch (error) {
        restoreError = error;
      }
    }

    if (restoreError) {
      const reason = restoreError instanceof Error ? restoreError.message : String(restoreError);
      throw new Error(`프로필 조회 후 원래 Profile ${originalProfileIndex + 1} 복원에 실패했습니다: ${reason}`);
    }
    if (scanError) throw scanError;

    return {
      activeProfileId: (originalProfileIndex + 1) as ProfileId,
      profiles,
    };
  }

  async configureKeyboardAppMappings(
    settings: KeyboardSettings,
    storedBackup?: KeyboardKeymapBackup
  ): Promise<KeyboardMappingResult> {
    return this.applyKeyboardAppMappings(settings, storedBackup, false);
  }

  async restoreKeyboardAppMappings(
    storedBackup: KeyboardKeymapBackup
  ): Promise<KeyboardMappingResult> {
    return this.applyKeyboardAppMappings(null, storedBackup, true);
  }

  private async applyKeyboardAppMappings(
    settings: KeyboardSettings | null,
    storedBackup: KeyboardKeymapBackup | undefined,
    restoring: boolean
  ): Promise<KeyboardMappingResult> {
    if (!this._ready) throw new Error('XPAD 프로토콜이 준비되지 않았습니다.');
    if (restoring && !storedBackup) {
      throw new Error('P2~P5 하단 버튼 원본 백업이 없어 복원할 수 없습니다.');
    }

    const originalSystemInfo = await this.readSystemInfoWithRetry();
    if (!originalSystemInfo) throw new Error('XPAD SystemInfo를 읽지 못했습니다.');
    const originalProfileIndex = profileIndexFromSystemInfo(originalSystemInfo);
    let currentSystemInfo = originalSystemInfo;
    const currentEntries = {} as KeyboardEntryMatrix;
    const targets = {} as KeyboardEntryMatrix;
    const backupEntries = {} as KeyboardEntryMatrix;
    const written: Array<{
      profileId: EditableProfileId;
      slot: KeyboardSlot;
      previous: Buffer;
    }> = [];
    let operationError: unknown = null;
    let rollbackError: unknown = null;
    let restoreProfileError: unknown = null;
    const rollbackChanges = async () => {
      for (const change of [...written].reverse()) {
        const profileIndex = change.profileId - 1;
        if (profileIndexFromSystemInfo(currentSystemInfo) !== profileIndex) {
          currentSystemInfo = await this.switchProfile(currentSystemInfo, profileIndex);
        }
        await this.writeKeyInfo(SLOT_KEY_INFO_INDEX[change.slot], change.previous);
      }
    };

    try {
      // 첫 쓰기 전에 P2~P5의 하단 버튼 12개를 모두 확보한다.
      for (const profileId of EDITABLE_PROFILE_IDS) {
        const profileIndex = profileId - 1;
        if (profileIndexFromSystemInfo(currentSystemInfo) !== profileIndex) {
          currentSystemInfo = await this.switchProfile(currentSystemInfo, profileIndex);
        }
        const entries = {} as Record<KeyboardSlot, Buffer>;
        for (const slot of KEYBOARD_SLOTS) {
          const entry = await this.readKeyInfoWithRetry(SLOT_KEY_INFO_INDEX[slot]);
          if (!entry) {
            throw new Error(`Profile ${profileId} ${slot} 버튼 KeyInfo를 읽지 못했습니다.`);
          }
          entries[slot] = entry;
        }
        currentEntries[profileId] = entries;
      }

      for (const profileId of EDITABLE_PROFILE_IDS) {
        const profileTargets = {} as Record<KeyboardSlot, Buffer>;
        const profileBackup = {} as Record<KeyboardSlot, Buffer>;
        for (const slot of KEYBOARD_SLOTS) {
          const current = currentEntries[profileId][slot];
          const saved = decodeKeyInfo(storedBackup?.profiles[profileId]?.[slot]);
          const shortcut = encodeKeyboardAction(current, {
            type: 'key',
            keyCode: SLOT_SHORTCUT_KEY[slot],
          });
          if (!shortcut) throw new Error(`Profile ${profileId} ${slot} 단축키를 만들지 못했습니다.`);
          const currentlyMapped = hasSameKeyAction(current, shortcut);

          if (restoring) {
            if (!saved) {
              throw new Error(`Profile ${profileId} ${slot} 원본 백업이 손상되었습니다.`);
            }
            profileBackup[slot] = saved;
            profileTargets[slot] = currentlyMapped ? saved : current;
            continue;
          }

          profileBackup[slot] = saved && currentlyMapped ? saved : current;
          const action = settings!.profiles[profileId].assignments[slot];
          profileTargets[slot] =
            action.type === 'launch-app'
              ? shortcut
              : currentlyMapped && saved
                ? saved
                : current;
        }
        backupEntries[profileId] = profileBackup;
        targets[profileId] = profileTargets;
      }

      for (const profileId of EDITABLE_PROFILE_IDS) {
        const profileIndex = profileId - 1;
        if (profileIndexFromSystemInfo(currentSystemInfo) !== profileIndex) {
          currentSystemInfo = await this.switchProfile(currentSystemInfo, profileIndex);
        }
        for (const slot of KEYBOARD_SLOTS) {
          const previous = currentEntries[profileId][slot];
          const target = targets[profileId][slot];
          if (hasSameKeyAction(previous, target)) continue;
          written.push({ profileId, slot, previous });
          await this.writeKeyInfo(SLOT_KEY_INFO_INDEX[slot], target);
        }
      }
    } catch (error) {
      operationError = error;
      try {
        await rollbackChanges();
      } catch (error) {
        rollbackError = error;
      }
    } finally {
      try {
        const latestSystemInfo = (await this.readSystemInfoWithRetry()) ?? currentSystemInfo;
        if (profileIndexFromSystemInfo(latestSystemInfo) !== originalProfileIndex) {
          await this.switchProfile(latestSystemInfo, originalProfileIndex);
        }
      } catch (error) {
        restoreProfileError = error;
      }
    }

    if (!operationError && restoreProfileError) {
      operationError = restoreProfileError;
      restoreProfileError = null;
      try {
        currentSystemInfo = (await this.readSystemInfoWithRetry()) ?? currentSystemInfo;
        await rollbackChanges();
      } catch (error) {
        rollbackError = error;
      }
      try {
        const latestSystemInfo = (await this.readSystemInfoWithRetry()) ?? currentSystemInfo;
        if (profileIndexFromSystemInfo(latestSystemInfo) !== originalProfileIndex) {
          await this.switchProfile(latestSystemInfo, originalProfileIndex);
        }
      } catch (error) {
        restoreProfileError = error;
      }
    }

    if (operationError || rollbackError || restoreProfileError) {
      const reasons = [
        operationError && `적용 실패: ${errorMessage(operationError)}`,
        rollbackError && `키 원복 실패: ${errorMessage(rollbackError)}`,
        restoreProfileError &&
          `원래 Profile ${originalProfileIndex + 1} 복원 실패: ${errorMessage(restoreProfileError)}`,
      ].filter(Boolean);
      throw new Error(reasons.join(' / '));
    }

    const finalEntries = targets;
    const profiles = { 1: createFixedProfileOne() } as Record<
      ProfileId,
      KeyboardProfileSettings
    >;
    for (const profileId of EDITABLE_PROFILE_IDS) {
      profiles[profileId] = {
        id: profileId,
        assignments: {
          left: decodeKeyboardAction(finalEntries[profileId].left),
          center: decodeKeyboardAction(finalEntries[profileId].center),
          right: decodeKeyboardAction(finalEntries[profileId].right),
        },
      };
    }
    const backup = encodeKeyboardBackup(backupEntries);
    const hasAppMappings = Boolean(
      settings &&
        EDITABLE_PROFILE_IDS.some((profileId) =>
          KEYBOARD_SLOTS.some(
            (slot) => settings.profiles[profileId].assignments[slot].type === 'launch-app'
          )
        )
    );
    return {
      state: hasAppMappings ? 'active' : 'disabled',
      backup,
      snapshot: {
        activeProfileId: (originalProfileIndex + 1) as ProfileId,
        profiles,
      },
    };
  }

  async selectProfile(profileId: ProfileId): Promise<ProfileId> {
    if (!this._ready) throw new Error('XPAD 프로토콜이 준비되지 않았습니다.');
    if (!PROFILE_IDS.includes(profileId)) {
      throw new Error(`잘못된 프로필입니다: ${profileId}`);
    }

    const systemInfo = await this.readSystemInfoWithRetry();
    if (!systemInfo) throw new Error('XPAD SystemInfo를 읽지 못했습니다.');
    const profileIndex = profileId - 1;
    if (profileIndexFromSystemInfo(systemInfo) === profileIndex) {
      this._activeProfileId = profileId;
      return profileId;
    }

    await this.switchProfile(systemInfo, profileIndex);
    return profileId;
  }

  private async switchProfile(systemInfo: Buffer, profileIndex: number): Promise<Buffer> {
    if (profileIndex < 0 || profileIndex >= PROFILE_IDS.length) {
      throw new Error(`잘못된 프로필 인덱스입니다: ${profileIndex}`);
    }
    const device = this.device.bulk;
    if (!device) throw new Error('XPAD 장치 연결이 끊겼습니다.');

    const next = Buffer.from(systemInfo);
    next[SYSTEM_INFO_CONFIG_OFFSET] =
      (next[SYSTEM_INFO_CONFIG_OFFSET] & SYSTEM_INFO_CONFIG_RANGE_MASK) | profileIndex;
    if (!this.tryWrite(device, this.buildPacket(CMD_SCREEN_INFO, next), '프로필 RAM 전환')) {
      throw new Error(`Profile ${profileIndex + 1} RAM 전환에 실패했습니다.`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, PROFILE_SWITCH_DELAY_MS));
    const readback = await this.readSystemInfoWithRetry();
    if (!readback || profileIndexFromSystemInfo(readback) !== profileIndex) {
      throw new Error(`Profile ${profileIndex + 1} 전환 readback 검증에 실패했습니다.`);
    }
    this._activeProfileId = (profileIndex + 1) as ProfileId;
    return readback;
  }

  private async readSystemInfoWithRetry(): Promise<Buffer | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const info = await this.readSystemInfo();
      if (info) return info;
    }
    return null;
  }

  private async readSystemInfo(): Promise<Buffer | null> {
    const info = await this.readPayload(CMD_SCREEN_INFO, 0, SYSTEM_INFO_SIZE, 'SystemInfo 읽기');
    if (!info) return null;
    if (info.readUInt16LE(0) !== LCD_WIDTH || info.readUInt16LE(2) !== LCD_HEIGHT) {
      return null;
    }
    try {
      profileIndexFromSystemInfo(info);
      return info;
    } catch {
      return null;
    }
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
    return this.readPayload(CMD_KEY_INFO, index, KEY_INFO_SIZE, 'KeyInfo 읽기');
  }

  private readPayload(
    command: number,
    index: number,
    expectedSize: number,
    context: string
  ): Promise<Buffer | null> {
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
          packet[6] !== command ||
          packet[7] !== index
        ) {
          return;
        }
        const payloadLength = packet.readUInt16LE(4) - 4;
        if (payloadLength !== expectedSize) return finish(null);
        finish(Buffer.from(packet.subarray(8, 8 + expectedSize)));
      };
      const timer = setTimeout(() => finish(null), 800);
      device.on('data', onData);
      if (
        !this.tryWrite(
          device,
          this.buildPacket(command, Buffer.alloc(0), index),
          context
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
      throw new Error(`KeyInfo ${index} 쓰기에 실패했습니다.`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    const readback = await this.readKeyInfoWithRetry(index);
    if (!readback || !readback.equals(entry)) {
      throw new Error(`KeyInfo ${index} readback 검증에 실패했습니다.`);
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

function profileIndexFromSystemInfo(info: Buffer): number {
  if (info.length !== SYSTEM_INFO_SIZE) {
    throw new Error(`잘못된 SystemInfo 길이입니다: ${info.length}`);
  }
  const configByte = info[SYSTEM_INFO_CONFIG_OFFSET];
  const profileCount = configByte >> 4;
  const profileIndex = configByte & SYSTEM_INFO_CONFIG_SELECTION_MASK;
  if (profileCount < PROFILE_IDS.length || profileIndex >= PROFILE_IDS.length) {
    throw new Error(
      `지원하지 않는 SystemInfo 프로필 값입니다: range=${profileCount}, selection=${profileIndex}`
    );
  }
  return profileIndex;
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

function encodeKeyboardBackup(entries: KeyboardEntryMatrix): KeyboardKeymapBackup {
  const profiles = {} as KeyboardKeymapBackup['profiles'];
  for (const profileId of EDITABLE_PROFILE_IDS) {
    profiles[profileId] = {
      left: entries[profileId].left.toString('base64'),
      center: entries[profileId].center.toString('base64'),
      right: entries[profileId].right.toString('base64'),
    };
  }
  return { profiles };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
